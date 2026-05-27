import { z } from 'zod';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RolloutConfigSchema } from '@fireweaveai/fw-rollout-types';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';

const CONFIG_RELATIVE_PATH = '.fireweave/rollout.config.json';

export type ReadPreferencesResult =
  | { found: true; config: RolloutConfig }
  | { found: false; config: null };

export async function readPreferences(cwd: string = process.cwd()): Promise<ReadPreferencesResult> {
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);

  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();
    if (!exists) {
      return { found: false, config: null };
    }

    const raw = await file.json();
    const parsed = RolloutConfigSchema.parse(raw);
    return { found: true, config: parsed };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { found: false, config: null };
    }
    throw err;
  }
}

const ReadPreferencesInputSchema = z.object({
  cwd: z.string().optional().describe('Working directory to look for .fireweave/rollout.config.json (defaults to process.cwd())'),
});

export const readPreferencesTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'read_preferences',
      {
        title: 'Read Preferences',
        description: 'Reads the .fireweave/rollout.config.json file from the current project and validates it against RolloutConfigSchema.',
        inputSchema: ReadPreferencesInputSchema.shape,
      },
      async (args) => {
        const { cwd } = args;
        try {
          const result = await readPreferences(cwd);
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
