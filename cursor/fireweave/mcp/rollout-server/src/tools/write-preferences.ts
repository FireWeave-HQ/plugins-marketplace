import { z } from 'zod';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RolloutConfigSchema } from '@fireweaveai/fw-rollout-types';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';

const CONFIG_RELATIVE_PATH = '.fireweave/rollout.config.json';

export interface WritePreferencesResult {
  written: true;
  path: string;
}

function sortedStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  }, 2);
}

export async function writePreferences(
  config: RolloutConfig,
  cwd: string = process.cwd(),
): Promise<WritePreferencesResult> {
  // Validate before writing
  RolloutConfigSchema.parse(config);

  const configDir = join(cwd, '.fireweave');
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);

  await mkdir(configDir, { recursive: true });
  await Bun.write(configPath, sortedStringify(config) + '\n');

  return { written: true, path: configPath };
}

const WritePreferencesInputSchema = z.object({
  config: RolloutConfigSchema,
  cwd: z.string().optional().describe('Working directory to write .fireweave/rollout.config.json (defaults to process.cwd())'),
});

export const writePreferencesTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'write_preferences',
      {
        title: 'Write Preferences',
        description: 'Writes the rollout configuration to .fireweave/rollout.config.json with sorted keys and 2-space indentation.',
        inputSchema: WritePreferencesInputSchema.shape,
      },
      async (args) => {
        const { config, cwd } = args;
        try {
          const result = await writePreferences(config as RolloutConfig, cwd);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
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
