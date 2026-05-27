import { z } from 'zod';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import ts from 'typescript';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

// ---------------------------------------------------------------------------
// Known provider SDK package names.
// Direct imports of any of these inside a wrap-point file violate the rule
// that all provider interactions must go through Fireweave's integration RPC.
// ---------------------------------------------------------------------------
const KNOWN_PROVIDER_PACKAGES = [
  'posthog-node',
  'posthog-js',
  'launchdarkly-node-server-sdk',
  '@launchdarkly/node-server-sdk',
  '@datadog/datadog-api-client',
  'statsig-node',
  'statsig-server',
  '@optimizely/optimizely-sdk',
  'split-io',
];

export interface VerifyNoMixedProviderCallsOpts {
  config: RolloutConfig;
  repoRoot?: string;
}

export interface VerifyNoMixedProviderCallsResult {
  rule: 'no_mixed_provider_calls';
  pass: boolean;
  findings: VerificationFinding[];
}

export async function verifyNoMixedProviderCalls(
  opts: VerifyNoMixedProviderCallsOpts,
): Promise<VerifyNoMixedProviderCallsResult> {
  const root = opts.repoRoot ?? process.cwd();
  const findings: VerificationFinding[] = [];

  for (const wp of opts.config.wrapPoints) {
    const filePath = path.join(root, wp.file);
    const source = await Bun.file(filePath)
      .text()
      .catch(() => null);

    // Missing file: silently skip (cohort-keying verifier handles this separately)
    if (!source) continue;

    const sf = ts.createSourceFile(
      wp.file,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node)) {
        const moduleSpec = node.moduleSpecifier as ts.StringLiteral;
        const moduleName = moduleSpec.text;
        if (
          KNOWN_PROVIDER_PACKAGES.some(
            (pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`),
          )
        ) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          findings.push({
            rule: 'no_mixed_provider_calls',
            severity: 'block',
            file: wp.file,
            line,
            message: `direct import of provider package '${moduleName}' in wrap-point file '${wp.file}'; all provider calls must go through Fireweave's integration RPC`,
            fix: `Remove the direct import of '${moduleName}' and use the Fireweave evaluation SDK instead.`,
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  return {
    rule: 'no_mixed_provider_calls',
    pass: findings.length === 0,
    findings,
  };
}

const VerifyNoMixedProviderCallsInputSchema = z.object({
  config: z.unknown().describe('RolloutConfig object to check for direct provider imports'),
  repoRoot: z.string().optional().describe('Absolute path to the repository root'),
});

export const verifyNoMixedProviderCallsTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_no_mixed_provider_calls',
      {
        title: 'Verify No Mixed Provider Calls',
        description:
          'Walks each wrap-point file with the TypeScript AST to detect direct imports of known provider SDKs (posthog-node, launchdarkly-node-server-sdk, etc.). Direct provider imports violate the rule that all provider calls go through the Fireweave integration RPC layer.',
        inputSchema: VerifyNoMixedProviderCallsInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await verifyNoMixedProviderCalls({
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
