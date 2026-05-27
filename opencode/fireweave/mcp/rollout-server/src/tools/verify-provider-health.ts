import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

export interface VerifyProviderHealthOpts {
  config: RolloutConfig;
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface VerifyProviderHealthResult {
  rule: 'provider_health';
  pass: boolean;
  findings: VerificationFinding[];
}

export async function verifyProviderHealth(
  opts: VerifyProviderHealthOpts,
): Promise<VerifyProviderHealthResult> {
  const findings: VerificationFinding[] = [];

  // Collect unique non-null provider IDs
  const providerIds = new Set(
    Object.values(opts.config.providers).filter((p): p is string => p !== null),
  );

  for (const providerId of providerIds) {
    // At MVP, we cannot reach provider health endpoints without credentials in this
    // verification layer (credentials live in fw-server's integration RPC). We emit
    // an advisory 'info' finding instead of 'block' so the verifier always passes
    // unless a future enhancement wires actual health probes.
    if (providerId === 'fireweave-posthog') {
      findings.push({
        rule: 'provider_health',
        severity: 'info',
        message: `provider '${providerId}' health-check is advisory-only at MVP (configured in CLI runtime, not at this layer)`,
      });
    } else {
      findings.push({
        rule: 'provider_health',
        severity: 'info',
        message: `provider '${providerId}' has no health check wired; assumed healthy`,
      });
    }
  }

  // Pass = no 'block' findings; advisory info findings do not block.
  return {
    rule: 'provider_health',
    pass: findings.every((f) => f.severity !== 'block'),
    findings,
  };
}

const VerifyProviderHealthInputSchema = z.object({
  config: z.unknown().describe('RolloutConfig object whose providers to ping'),
});

export const verifyProviderHealthTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_provider_health',
      {
        title: 'Verify Provider Health',
        description:
          'Checks that all provider entries in the rollout config are reachable. At MVP this is advisory-only (no credentials available at verification time); returns info findings for each provider.',
        inputSchema: VerifyProviderHealthInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await verifyProviderHealth({
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
