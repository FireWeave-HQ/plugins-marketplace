/**
 * Wave A deprecation alias for `extract_diff_surface`.
 *
 * Per pitch 026 §Tool Inventory: `extract_diff_surface` is conceptually
 * cloud — its local I/O is "none (consumes diff text)" and it parses an
 * upstream-conceptual structure. The Wave A alias forwards to the proxy.
 *
 * The pre-Wave-A implementation used `simple-git` to drive `git diff` —
 * a local I/O dependency. That implementation is retained as the pure
 * function `extractDiffSurface` so existing in-process callers (and the
 * unit tests) can still exercise it, but the MCP registration NO longer
 * calls it. The alias delegates to the injected forwarder.
 *
 * R-IDs: R-004-3, R-004-4
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { simpleGit, type SimpleGit } from 'simple-git';

export interface ExtractDiffSurfaceOpts {
  fromRef: string;
  toRef: string;
  repoRoot?: string;
  git?: SimpleGit;
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffFile {
  path: string;
  status: FileStatus;
}

export interface DiffSurface {
  files: DiffFile[];
  /** TODO: full TS LSP walk to extract exported symbol names; empty for MVP */
  changedSymbols: string[];
  /** SvelteKit route files detected by filename heuristic */
  changedRoutes: string[];
  /** Test files detected by filename heuristic */
  changedTests: string[];
}

/** Map git --name-status letter codes to FileStatus */
function parseStatusLetter(letter: string): FileStatus {
  switch (letter.charAt(0).toUpperCase()) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'M':
    default:
      return 'modified';
  }
}

const ROUTE_FILE_RE =
  /(\+page\.svelte|\+page\.(server\.)?(ts|js)|\+server\.(ts|js)|\+layout(\.server)?\.(ts|js|svelte))$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|js|tsx|jsx)$/;

export async function extractDiffSurface(
  opts: ExtractDiffSurfaceOpts
): Promise<DiffSurface> {
  const git = opts.git ?? simpleGit(opts.repoRoot ?? process.cwd());

  // git diff --name-status <fromRef>..<toRef>
  // Output format: one line per file: "<STATUS>\t<path>" or
  // "<STATUS>\t<old>\t<new>" for renames
  const raw = await git.diff([
    '--name-status',
    `${opts.fromRef}..${opts.toRef}`,
  ]);

  const files: DiffFile[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 2) continue;

    const statusLetter = parts[0]!;
    // For renames (R100\told\tnew), use the new path (parts[2]); otherwise parts[1]
    const filePath = parts.length >= 3 ? parts[2]! : parts[1]!;

    files.push({
      path: filePath,
      status: parseStatusLetter(statusLetter),
    });
  }

  const changedRoutes = files
    .filter((f) => f.status !== 'deleted' && ROUTE_FILE_RE.test(f.path))
    .map((f) => f.path);

  const changedTests = files
    .filter((f) => f.status !== 'deleted' && TEST_FILE_RE.test(f.path))
    .map((f) => f.path);

  return {
    files,
    changedSymbols: [], // TODO: full TS LSP walk in follow-up
    changedRoutes,
    changedTests,
  };
}

// ---------------------------------------------------------------------------
// Wave A alias plumbing
// ---------------------------------------------------------------------------
const DEPRECATION_MESSAGE =
  'DEPRECATION: extract_diff_surface has moved to fireweave-server-proxy; ' +
  'this alias will be removed in a future release.';

export interface AliasForwarder {
  (args: Record<string, unknown>): Promise<unknown>;
}

export const defaultExtractDiffSurfaceForwarder: AliasForwarder = async () => ({
  error: {
    code: 'NOT_YET_MIGRATED',
    message:
      'extract_diff_surface is being migrated to fireweave-server-proxy; ' +
      'cloud-side implementation not yet shipped.',
  },
});

export interface RunExtractDiffSurfaceAliasDeps {
  forwarder?: AliasForwarder;
  log?: (msg: string) => void;
  incrementUsage?: (toolName: string) => void;
}

/**
 * Run the alias. No receipt-guard layering applies — `extract_diff_surface`
 * is not in `RECEIPT_REQUIREMENTS`. The pattern is just:
 *   deprecation-warn → increment-counter → forward.
 */
export async function runExtractDiffSurfaceAlias(
  args: Record<string, unknown>,
  deps: RunExtractDiffSurfaceAliasDeps = {}
): Promise<unknown> {
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  log(DEPRECATION_MESSAGE);
  deps.incrementUsage?.('extract_diff_surface');

  const forwarder = deps.forwarder ?? defaultExtractDiffSurfaceForwarder;
  return forwarder(args);
}

const ExtractDiffSurfaceInputSchema = z
  .object({
    fromRef: z.string().optional(),
    toRef: z.string().optional(),
    repoRoot: z.string().optional(),
  })
  .passthrough();

export interface ExtractDiffSurfaceToolRegistrationOpts {
  forwarder?: AliasForwarder;
  incrementUsage?: (toolName: string) => void;
}

export const extractDiffSurfaceTool = {
  registerWith(
    server: McpServer,
    opts: ExtractDiffSurfaceToolRegistrationOpts = {}
  ) {
    server.registerTool(
      'extract_diff_surface',
      {
        title: 'Extract Diff Surface',
        description:
          "Stable tool — extracts the diff surface of the user's working tree " +
          'against develop. Used by Step 5 of safe-rollout. ' +
          'Per pitch 033, promoted from Wave-A alias to stable now that the ' +
          'cloud MCP proxy is being removed.',
        inputSchema: ExtractDiffSurfaceInputSchema.shape,
      },
      async (args) => {
        const result = await runExtractDiffSurfaceAlias(
          (args as Record<string, unknown>) ?? {},
          opts
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
  },
};
