import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

export interface VerifySafeDefaultsOpts {
  config: RolloutConfig;
}

export interface VerifySafeDefaultsResult {
  rule: 'safe_defaults';
  pass: boolean;
  findings: VerificationFinding[];
}

export async function verifySafeDefaults(
  opts: VerifySafeDefaultsOpts,
): Promise<VerifySafeDefaultsResult> {
  const findings: VerificationFinding[] = [];

  // Multi-flag: validate each flag independently. Findings include the
  // flag key so operators can target their fix at the right flag.
  for (const flag of opts.config.flags) {
    const { key, type, safeDefault } = flag;
    if (type === 'boolean' && typeof safeDefault !== 'boolean' && safeDefault !== null) {
      findings.push({
        rule: 'safe_defaults',
        severity: 'block',
        message: `flag '${key}' (type='boolean') but safeDefault is ${typeof safeDefault} (${JSON.stringify(safeDefault)})`,
        fix: `Set flag '${key}' safeDefault to false (most conservative) or another boolean.`,
      });
    }
    if (type === 'multivariate' && typeof safeDefault !== 'string' && safeDefault !== null) {
      findings.push({
        rule: 'safe_defaults',
        severity: 'block',
        message: `flag '${key}' (type='multivariate') but safeDefault is ${typeof safeDefault} (${JSON.stringify(safeDefault)})`,
        fix: `Set flag '${key}' safeDefault to the variant key that represents the safe-fallback variant, or null.`,
      });
    }
  }

  return { rule: 'safe_defaults', pass: findings.length === 0, findings };
}

const VerifySafeDefaultsInputSchema = z.object({
  config: z.unknown().describe('RolloutConfig object to verify safe defaults for'),
});

export const verifySafeDefaultsTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_safe_defaults',
      {
        title: 'Verify Safe Defaults',
        description:
          'Checks that flag.safeDefault is type-compatible with flag.type. Boolean flags must have boolean or null safeDefault; multivariate flags must have string or null.',
        inputSchema: VerifySafeDefaultsInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await verifySafeDefaults({
            config: coerceConfigArg((args as { config: unknown }).config) as unknown as RolloutConfig,
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
