import { z } from 'zod';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const CONFIG_RELATIVE_PATH = '.fireweave/rollout.config.json';

export interface Project {
  id: string;
  name: string;
}

export interface SelectProjectOpts {
  projectId: string;
  projectName: string;
  /** Validated against this list — projectId must exist here */
  projects: Project[];
  /** Defaults to .fireweave/rollout.config.json relative to cwd */
  configPath?: string;
}

export interface SelectProjectResult {
  projectId: string;
  projectName: string;
  configPath: string;
}

export async function selectProject(opts: SelectProjectOpts): Promise<SelectProjectResult> {
  const { projectId, projectName, projects } = opts;
  const configPath = opts.configPath ?? join(process.cwd(), CONFIG_RELATIVE_PATH);

  // Validate projectId is in the provided list
  const found = projects.find((p) => p.id === projectId);
  if (!found) {
    throw new Error(
      `Project "${projectId}" not found in the provided project list (${projects.map((p) => p.id).join(', ')})`,
    );
  }

  // Ensure directory exists
  const configDir = configPath.replace(/[/\\][^/\\]+$/, '');
  await mkdir(configDir, { recursive: true });

  // Read existing config or start with a minimal stub
  let existing: Record<string, unknown> = {};
  const file = Bun.file(configPath);
  const fileExists = await file.exists();
  if (fileExists) {
    try {
      existing = (await file.json()) as Record<string, unknown>;
    } catch {
      // malformed JSON — overwrite with minimal stub
      existing = {};
    }
  }

  // Merge projectId / projectName, preserving all other fields
  const updated = { ...existing, projectId, projectName };

  await Bun.write(configPath, JSON.stringify(updated, null, 2) + '\n');

  return { projectId, projectName, configPath };
}

const SelectProjectInputSchema = z.object({
  projectId: z.string().min(1).describe('ID of the project to select'),
  projectName: z.string().min(1).describe('Human-readable name of the project'),
  projects: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .describe('Full project list for validation (from list_projects)'),
  configPath: z
    .string()
    .optional()
    .describe('Override config file path (default: .fireweave/rollout.config.json in cwd)'),
});

export const selectProjectTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'select_project',
      {
        title: 'Select Project',
        description:
          'Writes/updates projectId in .fireweave/rollout.config.json. Validates that the project exists in the provided list.',
        inputSchema: SelectProjectInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await selectProject(
            args as unknown as SelectProjectOpts,
          );
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
