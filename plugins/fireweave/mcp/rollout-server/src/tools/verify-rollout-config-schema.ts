import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RolloutConfigSchema } from '@fireweaveai/fw-rollout-types';
import type { VerificationFinding } from '@fireweaveai/fw-rollout-types';
import { coerceConfigArg } from './_coerce-config';

export interface VerifyRolloutConfigSchemaOpts {
  config: unknown;
}

export interface VerifyRolloutConfigSchemaResult {
  rule: 'rollout_config_schema';
  pass: boolean;
  findings: VerificationFinding[];
}

export async function verifyRolloutConfigSchema(
  opts: VerifyRolloutConfigSchemaOpts,
): Promise<VerifyRolloutConfigSchemaResult> {
  const result = RolloutConfigSchema.safeParse(opts.config);

  if (result.success) {
    return { rule: 'rollout_config_schema', pass: true, findings: [] };
  }

  const findings: VerificationFinding[] = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return {
      rule: 'rollout_config_schema' as const,
      severity: 'block' as const,
      message: `${path}: ${issue.message}`,
      fix: `Fix the value at "${path}" to satisfy the schema requirement: ${issue.message}`,
    };
  });

  return { rule: 'rollout_config_schema', pass: false, findings };
}

const VerifyRolloutConfigSchemaInputSchema = z.object({
  config: z.unknown().describe('Raw config object to validate against RolloutConfigSchema'),
});

export const verifyRolloutConfigSchemaTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'verify_rollout_config_schema',
      {
        title: 'Verify Rollout Config Schema',
        description:
          'Validates a .fireweave/rollout.config.json object against RolloutConfigSchema. Returns pass/fail with per-field findings.',
        inputSchema: VerifyRolloutConfigSchemaInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await verifyRolloutConfigSchema({
            config: coerceConfigArg((args as { config: unknown }).config),
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: message }) },
            ],
          };
        }
      },
    );
  },
};
