import { z } from 'zod';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import ts from 'typescript';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

// ---------------------------------------------------------------------------
// NOTE on scope-awareness: this verifier uses a heuristic AST walk to detect
// evaluation calls anywhere in the source file, not scoped to the specific
// wrapped function body. Scope-aware analysis (verifying the call appears
// INSIDE the wrapped function indicated by wp.symbol) is deferred as a
// follow-up — it requires symbol-resolution that TypeScript Compiler API can
// provide but adds significant complexity.
// ---------------------------------------------------------------------------

export interface VerifyCohortKeyingOpts {
  config: RolloutConfig;
  repoRoot?: string;
}

export interface VerifyCohortKeyingResult {
  rule: 'cohort_keying';
  pass: boolean;
  findings: VerificationFinding[];
}

/** Pattern that matches known feature-flag evaluation call names. */
const EVAL_CALL_PATTERN = /evaluate$|getFeatureFlag$|isFeatureEnabled$/;

export async function verifyCohortKeying(
  opts: VerifyCohortKeyingOpts,
): Promise<VerifyCohortKeyingResult> {
  const root = opts.repoRoot ?? process.cwd();
  const findings: VerificationFinding[] = [];

  for (const wp of opts.config.wrapPoints) {
    const filePath = path.join(root, wp.file);
    const source = await Bun.file(filePath)
      .text()
      .catch(() => null);

    if (!source) {
      findings.push({
        rule: 'cohort_keying',
        severity: 'warn',
        file: wp.file,
        message: `wrap-point file '${wp.file}' not found; skipping cohort-keying check for '${wp.symbol}'`,
      });
      continue;
    }

    const sf = ts.createSourceFile(
      wp.file,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    let foundEvaluation = false;
    let foundDistinctId = false;

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const calleText = node.expression.getText(sf);
        if (EVAL_CALL_PATTERN.test(calleText)) {
          foundEvaluation = true;
          // The distinctId should be the second or later argument (arg index >= 1).
          if (node.arguments.length >= 2) {
            foundDistinctId = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);

    if (!foundEvaluation) {
      findings.push({
        rule: 'cohort_keying',
        severity: 'block',
        file: wp.file,
        message: `no evaluate/getFeatureFlag/isFeatureEnabled call found in wrap-point '${wp.symbol}' (${wp.file}); cohort keying cannot be verified`,
        fix: 'Add an evaluation call that passes a distinctId/userId as the second argument (e.g., evaluate(flagKey, userId)).',
      });
    } else if (!foundDistinctId) {
      findings.push({
        rule: 'cohort_keying',
        severity: 'block',
        file: wp.file,
        message: `evaluation call found in '${wp.symbol}' (${wp.file}) but called with fewer than 2 arguments — no distinctId supplied; flag is evaluated globally, violating cohort keying`,
        fix: 'Pass a user/entity identifier as the second argument to the evaluation call.',
      });
    }
  }

  return {
    rule: 'cohort_keying',
    pass: !findings.some((f) => f.severity === 'block'),
    findings,
  };
}

const VerifyCohortKeyingInputSchema = z.object({
  config: z.unknown().describe('RolloutConfig object to verify cohort keying for'),
  repoRoot: z.string().optional().describe('Absolute path to the repository root'),
});

export const verifyCohortKeyingTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_cohort_keying',
      {
        title: 'Verify Cohort Keying',
        description:
          'Walks each wrap-point file with the TypeScript AST to detect evaluation calls. Checks that a distinctId argument is passed so flags are keyed per-user/entity rather than globally.',
        inputSchema: VerifyCohortKeyingInputSchema.shape,
      },
      async (args) => {
        try {
          const a = args as { config: unknown; repoRoot?: string };
          const result = await verifyCohortKeying({
            config: coerceConfigArg(a.config) as unknown as RolloutConfig,
            repoRoot: a.repoRoot,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          };
        }
      },
    );
  },
};
