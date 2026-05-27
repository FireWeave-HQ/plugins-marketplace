import { z } from 'zod';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import ts from 'typescript';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

// ---------------------------------------------------------------------------
// Patterns that identify telemetry/observability call expressions.
// A match on node.expression.getText() against any of these patterns means
// the wrap-point file contains at least one telemetry call, satisfying the
// requirement that rollout regressions can be observed.
// ---------------------------------------------------------------------------
const TELEMETRY_PATTERNS: RegExp[] = [
  // Logging
  /\.log$/,
  /\.info$/,
  /\.warn$/,
  /\.error$/,
  /\.debug$/,
  /\.trace$/,
  // Event capture (PostHog, Mixpanel, Segment, Amplitude)
  /\.capture$/,
  /\.track$/,
  // Metrics
  /\.record$/,
  /\.increment$/,
  /\.gauge$/,
  /\.histogram$/,
  // Tracing / spans
  /\.startSpan$/,
  /\.endSpan$/,
  /\.startActiveSpan$/,
  /\.addEvent$/,
  // Bare console shortcuts
  /^console\.(log|info|warn|error|debug)$/,
];

export interface VerifyTelemetryCompletenessOpts {
  config: RolloutConfig;
  repoRoot?: string;
}

export interface VerifyTelemetryCompletenessResult {
  rule: 'telemetry_completeness';
  pass: boolean;
  findings: VerificationFinding[];
}

export async function verifyTelemetryCompleteness(
  opts: VerifyTelemetryCompletenessOpts,
): Promise<VerifyTelemetryCompletenessResult> {
  const root = opts.repoRoot ?? process.cwd();
  const findings: VerificationFinding[] = [];

  for (const wp of opts.config.wrapPoints) {
    const filePath = path.join(root, wp.file);
    const source = await Bun.file(filePath)
      .text()
      .catch(() => null);

    // Missing file: skip silently (cohort-keying verifier handles this separately)
    if (!source) continue;

    const sf = ts.createSourceFile(
      wp.file,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    let foundTelemetry = false;

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callText = node.expression.getText(sf);
        if (TELEMETRY_PATTERNS.some((pattern) => pattern.test(callText))) {
          foundTelemetry = true;
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);

    if (!foundTelemetry) {
      findings.push({
        rule: 'telemetry_completeness',
        severity: 'warn',
        file: wp.file,
        message: `wrap-point '${wp.symbol}' in '${wp.file}' has no detected telemetry calls (log/capture/record/span); rollout regressions may be undetectable`,
        fix: 'Add at least one log, metric-record, or tracing span call inside the wrapped function body.',
      });
    }
  }

  // 'warn' findings do not block — pass is true unless there are 'block' findings.
  return {
    rule: 'telemetry_completeness',
    pass: findings.every((f) => f.severity !== 'block'),
    findings,
  };
}

const VerifyTelemetryCompletenessInputSchema = z.object({
  config: z.unknown().describe('RolloutConfig object to check for telemetry calls'),
  repoRoot: z.string().optional().describe('Absolute path to the repository root'),
});

export const verifyTelemetryCompletenessTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_telemetry_completeness',
      {
        title: 'Verify Telemetry Completeness',
        description:
          'Walks each wrap-point file with the TypeScript AST to check for at least one telemetry call (logging, event capture, metric record, or tracing span). Files with no telemetry emit a warn finding — rollout regressions may be undetectable without observability hooks.',
        inputSchema: VerifyTelemetryCompletenessInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await verifyTelemetryCompleteness({
            config: coerceConfigArg((args as { config: unknown }).config) as unknown as RolloutConfig,
            repoRoot: (args as { repoRoot?: string }).repoRoot,
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
