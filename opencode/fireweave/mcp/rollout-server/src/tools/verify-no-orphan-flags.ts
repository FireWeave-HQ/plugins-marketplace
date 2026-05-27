import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

export interface VerifyNoOrphanFlagsOpts {
  config: RolloutConfig;
  /**
   * Callback to list all flag keys currently registered on the given provider.
   * If not supplied (e.g. at CLI-time without live NATS), the check is skipped
   * and an advisory info finding is returned.
   *
   * At integration time (fw-server), wire this via NATS RPC to the provider plugin.
   */
  listProviderFlags?: (providerId: string) => Promise<string[]>;
}

export interface VerifyNoOrphanFlagsResult {
  rule: 'no_orphan_flags';
  pass: boolean;
  findings: VerificationFinding[];
}

export async function verifyNoOrphanFlags(
  opts: VerifyNoOrphanFlagsOpts,
): Promise<VerifyNoOrphanFlagsResult> {
  const findings: VerificationFinding[] = [];

  if (!opts.listProviderFlags) {
    findings.push({
      rule: 'no_orphan_flags',
      severity: 'info',
      message:
        'orphan-flag check skipped: no listProviderFlags callback supplied (wire via fw-server NATS RPC at integration time)',
    });
    return { rule: 'no_orphan_flags', pass: true, findings };
  }

  // Multi-flag: partition by providerId, then for each provider list its flags
  // and check which fw- prefixed flags don't have a matching entry in the
  // config's flags array.
  const expectedKeysByProvider = new Map<string, Set<string>>();
  for (const f of opts.config.flags) {
    const existing = expectedKeysByProvider.get(f.providerId) ?? new Set<string>();
    existing.add(f.key);
    expectedKeysByProvider.set(f.providerId, existing);
  }

  for (const [providerId, expectedKeys] of expectedKeysByProvider) {
    let allFlags: string[];
    try {
      allFlags = await opts.listProviderFlags(providerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      findings.push({
        rule: 'no_orphan_flags',
        severity: 'warn',
        message: `failed to list flags from provider '${providerId}': ${message}`,
      });
      continue;
    }

    for (const flag of allFlags) {
      if (!expectedKeys.has(flag) && flag.startsWith('fw-')) {
        findings.push({
          rule: 'no_orphan_flags',
          severity: 'warn',
          message: `flag '${flag}' on provider '${providerId}' has no matching rollout config — possible orphan`,
          fix: `Either create a rollout config for '${flag}' or remove the flag from the provider.`,
        });
      }
    }
  }

  // Only 'block' findings prevent pass; 'warn' findings are non-blocking.
  return {
    rule: 'no_orphan_flags',
    pass: findings.every((f) => f.severity !== 'block'),
    findings,
  };
}

const VerifyNoOrphanFlagsInputSchema = z.object({
  config: z.unknown().describe('RolloutConfig object to verify orphan flags for'),
});

export const verifyNoOrphanFlagsTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_no_orphan_flags',
      {
        title: 'Verify No Orphan Flags',
        description:
          'Compares flags registered on the provider against the rollout config. Flags matching the fw- prefix that have no config entry are reported as potential orphans. Requires a listProviderFlags callback; without one, returns an advisory skip.',
        inputSchema: VerifyNoOrphanFlagsInputSchema.shape,
      },
      async (args) => {
        try {
          // In the MCP tool invocation context there is no listProviderFlags callback —
          // callers that need live orphan detection must use the function directly.
          const result = await verifyNoOrphanFlags({
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
