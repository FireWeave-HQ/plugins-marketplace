import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { simpleGit, type SimpleGit } from 'simple-git';

export interface BaselineCandidate {
  kind: 'fw-rollout-trailer' | 'release-tag' | 'main-head';
  ref: string;
  description: string;
}

export interface DetectBaselineOpts {
  repoRoot?: string;
  git?: SimpleGit;
}

const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+$/;

export async function detectBaseline(
  opts: DetectBaselineOpts = {},
): Promise<{ candidates: BaselineCandidate[] }> {
  const git = opts.git ?? simpleGit(opts.repoRoot ?? process.cwd());
  const candidates: BaselineCandidate[] = [];

  // 1. Most recent commit with Fireweave-Rollout-Id trailer
  try {
    const logResult = await git.log({
      '--grep': 'Fireweave-Rollout-Id:',
      '--max-count': '1',
    });
    if (logResult.latest) {
      candidates.push({
        kind: 'fw-rollout-trailer',
        ref: logResult.latest.hash,
        description: `Most recent commit tagged with Fireweave-Rollout-Id trailer: ${logResult.latest.message.slice(0, 72)}`,
      });
    }
  } catch {
    // repo has no matching commits — skip
  }

  // 2. Most recent semver-shaped tag (vX.Y.Z or X.Y.Z)
  try {
    const tagsResult = await git.tags();
    const semverTags = tagsResult.all.filter((t) => SEMVER_TAG_RE.test(t));
    if (semverTags.length > 0) {
      // Tags come in alphabetical order from simple-git; take the last one as most recent
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const latestTag = semverTags[semverTags.length - 1]!;
      candidates.push({
        kind: 'release-tag',
        ref: latestTag,
        description: `Most recent semver release tag: ${latestTag}`,
      });
    }
  } catch {
    // no tags in repo — skip
  }

  // 3. HEAD of main branch (try origin/main then main)
  try {
    let mainRef: string | null = null;
    try {
      mainRef = (await git.revparse(['origin/main'])).trim();
    } catch {
      try {
        mainRef = (await git.revparse(['main'])).trim();
      } catch {
        // neither exists — skip
      }
    }
    if (mainRef) {
      candidates.push({
        kind: 'main-head',
        ref: mainRef,
        description: 'Current HEAD of main branch',
      });
    }
  } catch {
    // skip if revparse fails entirely
  }

  return { candidates };
}

const DetectBaselineInputSchema = z.object({
  repoRoot: z
    .string()
    .optional()
    .describe('Root of the git repository (defaults to cwd)'),
});

export const detectBaselineTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'detect_baseline',
      {
        title: 'Detect Baseline',
        description:
          'Returns candidate baseline refs for the rollout: most recent Fireweave-Rollout-Id commit, most recent semver tag, and HEAD of main.',
        inputSchema: DetectBaselineInputSchema.shape,
      },
      async (args) => {
        try {
          const result = await detectBaseline({ repoRoot: (args as { repoRoot?: string }).repoRoot });
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
