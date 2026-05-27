import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { simpleGit, type SimpleGit } from 'simple-git';

export interface TagBaselineCommitOpts {
  rolloutId: string;
  repoRoot?: string;
  git?: SimpleGit;
}

export interface TagBaselineCommitResult {
  ref: string;
  tag: string;
}

export async function tagBaselineCommit(
  opts: TagBaselineCommitOpts,
): Promise<TagBaselineCommitResult> {
  const { rolloutId } = opts;
  const git = opts.git ?? simpleGit(opts.repoRoot ?? process.cwd());

  const tagName = `fw-rollout/${rolloutId}`;
  const isoNow = new Date().toISOString();

  // 1. Determine if HEAD is the current user's commit
  const headAuthorEmail = (
    await git.raw(['log', '-1', '--format=%ae'])
  ).trim();

  let configEmail = '';
  try {
    configEmail = (await git.raw(['config', 'user.email'])).trim();
  } catch {
    // git config user.email not set — fall through to empty commit path
  }

  const trailerArgs = [
    '--trailer', `Fireweave-Rollout-Id: ${rolloutId}`,
    '--trailer', `Fireweave-Rollout-Started: ${isoNow}`,
  ];

  if (headAuthorEmail && configEmail && headAuthorEmail === configEmail) {
    // Amend HEAD to add trailers
    await git.raw([
      'commit', '--amend', '--no-edit', ...trailerArgs,
    ]);
  } else {
    // Create an empty commit with the trailers
    await git.raw([
      'commit', '--allow-empty',
      '-m', `chore(rollout): mark baseline for rollout ${rolloutId}`,
      ...trailerArgs,
    ]);
  }

  // 2. Get new HEAD sha
  const ref = (await git.raw(['rev-parse', 'HEAD'])).trim();

  // 3. Create lightweight tag pointing at new HEAD
  await git.raw(['tag', tagName, ref]);

  return { ref, tag: tagName };
}

const TagBaselineCommitInputSchema = z.object({
  rolloutId: z.string().min(1).describe('Rollout ID to embed in the trailer and tag name'),
  repoRoot: z.string().optional().describe('Root of the git repository (defaults to cwd)'),
});

export const tagBaselineCommitTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'tag_baseline_commit',
      {
        title: 'Tag Baseline Commit',
        description:
          'Adds Fireweave-Rollout-Id and Fireweave-Rollout-Started trailers to HEAD (amend if own commit, new empty commit otherwise) and creates a fw-rollout/<rolloutId> tag.',
        inputSchema: TagBaselineCommitInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await tagBaselineCommit(
            args as unknown as TagBaselineCommitOpts,
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
