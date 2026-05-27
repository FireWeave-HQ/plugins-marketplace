/**
 * Lockfile module for B10 — skill resume + force-push handling.
 *
 * Persists `lastStep` plus working state at `.fireweave/.cache/.lockfile` so
 * the safe-rollout skill can recover from interruption (process crash,
 * IDE restart, /clear, etc). The cache directory is gitignored — this is
 * per-machine scratch, not committed configuration. The committed config
 * is `.fireweave/rollout.config.json`, owned by `read/write_preferences`.
 *
 * State machine recorded by `lastStep`:
 *
 *   - 'discovery' — Step 0–4 still in progress (cheap to redo)
 *   - 'codegen'   — Step 5–7. `diffApplied` flips true once the skill has
 *                   actually called `Edit` on user files.
 *   - 'summary'   — Step 8.5 reached; user is reviewing before register
 *   - 'register'  — `register_rollout` returned a `rolloutId`. Subsequent
 *                   skill runs check force-push against this rollout's
 *                   participant.
 *
 * On successful register the skill calls `clear_lockfile` so the cache
 * goes back to a clean slate. The lockfile being absent is the "no work
 * in progress" state; the skill restarts at Step 0.
 *
 * Atomic write: we write `.lockfile.tmp` first, then `rename` — the rename
 * is atomic on POSIX so a crash mid-write leaves either the old lockfile
 * or none, never a half-written one.
 */

import { z } from 'zod';
import { join } from 'node:path';
import { mkdir, rename, readFile, unlink } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  LockfileStateSchema,
  ConfirmationReceiptSchema,
  LastConfigFailureSchema,
  type LockfileState,
  type LastConfigFailure,
} from '@fireweaveai/fw-rollout-types';

const LOCKFILE_RELATIVE_PATH = '.fireweave/.cache/.lockfile';
const LOCKFILE_DIR = '.fireweave/.cache';
const GITIGNORE_LINE = '.fireweave/.cache/';

/**
 * Schema definitions are owned by `@fireweaveai/fw-rollout-types`
 * (`packages/fw-rollout-types/src/lockfile.zod.ts`). They are re-exported
 * here so existing MCP tool consumers keep their import path, while
 * downstream packages can depend on the shared types without reaching
 * across the plugin boundary.
 *
 * Schema v2 adds two optional fields atop v1 (backwards-compatible):
 *   - `userConfirmations` — map of gate ID → `ConfirmationReceiptSchema`
 *   - `lastConfigFailure` — half-state marker after a guarded_call failure
 */
export {
  LockfileStateSchema,
  ConfirmationReceiptSchema,
  LastConfigFailureSchema,
};
export type { LockfileState };

function lockfilePath(cwd: string): string {
  return join(cwd, LOCKFILE_RELATIVE_PATH);
}

function lockfileTmpPath(cwd: string): string {
  return join(cwd, LOCKFILE_RELATIVE_PATH + '.tmp');
}

function lockfileDir(cwd: string): string {
  return join(cwd, LOCKFILE_DIR);
}

export async function readLockfile(
  cwd: string = process.cwd()
): Promise<LockfileState | null> {
  const path = lockfilePath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }

  // Corrupt JSON or schema mismatch: surface as null (the skill will
  // restart from Step 0). `safeParse` keeps schema validation in-band
  // without depending on `instanceof ZodError` — that check breaks when
  // the throwing zod and the catching zod resolve to different module
  // instances across workspace boundaries.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = LockfileStateSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function writeLockfile(
  state: LockfileState,
  cwd: string = process.cwd()
): Promise<void> {
  // Validate before writing — keeps the on-disk file always-valid.
  const validated = LockfileStateSchema.parse(state);
  await mkdir(lockfileDir(cwd), { recursive: true });
  await ensureGitignored(cwd);

  const tmp = lockfileTmpPath(cwd);
  const final = lockfilePath(cwd);
  await Bun.write(tmp, JSON.stringify(validated, null, 2) + '\n');
  // POSIX rename is atomic — crash-safe between tmp-write and final-write.
  await rename(tmp, final);
}

/**
 * Single-purpose helper that merges a `lastConfigFailure` block into the
 * lockfile atomically. Used by `guarded_call` to record half-state on
 * configuration-step failures.
 *
 * Initializes a minimal lockfile when none exists yet — the half-state
 * marker is meaningful even when the skill hasn't reached `codegen` yet
 * (e.g. failure during Step 0.2 environment selection).
 *
 * R-IDs: R-003-2, R-003-5
 */
export async function writeLastConfigFailure(
  failure: LastConfigFailure,
  cwd: string = process.cwd()
): Promise<void> {
  const existing = await readLockfile(cwd);
  const base: LockfileState = existing ?? {
    version: 1,
    lastStep: 'discovery',
    lastStepTimestamp: new Date().toISOString(),
  };
  const next: LockfileState = { ...base, lastConfigFailure: failure };
  await writeLockfile(next, cwd);
}

/**
 * Structured representation of the skill's resume state, derived from the
 * lockfile. The skill calls this on every invocation; when
 * `lastConfigFailure` is present it MUST handle the half-state explicitly
 * rather than treating `lastStep` as the only source of truth.
 *
 * R-ID: R-003-7
 */
export interface ResumeState {
  lastStep?: LockfileState['lastStep'];
  lastConfigFailure?: LastConfigFailure;
  userConfirmations?: LockfileState['userConfirmations'];
}

export function getResumeState(lockfile: LockfileState | null): ResumeState {
  if (lockfile === null) return {};
  const out: ResumeState = { lastStep: lockfile.lastStep };
  if (lockfile.lastConfigFailure !== undefined) {
    out.lastConfigFailure = lockfile.lastConfigFailure;
  }
  if (lockfile.userConfirmations !== undefined) {
    out.userConfirmations = lockfile.userConfirmations;
  }
  return out;
}

export async function clearLockfile(
  cwd: string = process.cwd()
): Promise<void> {
  const path = lockfilePath(cwd);
  try {
    await unlink(path);
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Idempotent `.gitignore` management — adds `.fireweave/.cache/` if not
 * already present. We append rather than rewrite so we don't disturb
 * the user's existing entries.
 *
 * Why .fireweave/.cache/ specifically (instead of .fireweave/ wholesale):
 * the spec file `.fireweave/rollout.config.json` IS committed; only the
 * scratch cache dir is gitignored.
 */
async function ensureGitignored(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf-8');
  } catch (err) {
    if (
      !(
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      )
    ) {
      throw err;
    }
    // No .gitignore yet — that's fine, we'll create it below.
  }

  // Match either bare line or trailing-slash variant.
  const lineMatchers = [GITIGNORE_LINE, '.fireweave/.cache'];
  const lines = existing.split('\n').map((l) => l.trim());
  for (const m of lineMatchers) {
    if (lines.includes(m)) return;
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await Bun.write(gitignorePath, existing + prefix + GITIGNORE_LINE + '\n');
}

// ─── MCP tool wrappers ─────────────────────────────────────────────────

const cwdInputSchema = {
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory for .fireweave/.cache/.lockfile (defaults to process.cwd())'
    ),
};

export const readLockfileTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'read_lockfile',
      {
        title: 'Read Lockfile',
        description:
          'Reads `.fireweave/.cache/.lockfile` for the current project. ' +
          'Returns `{ found: true, state }` with the parsed lockfile, or ' +
          '`{ found: false, state: null }` when no lockfile exists or it ' +
          'is corrupt. The skill calls this at Step 0 to drive the resume ' +
          'state machine (B10).',
        inputSchema: cwdInputSchema,
      },
      async (args) => {
        try {
          const state = await readLockfile(args.cwd);
          if (state === null) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ found: false, state: null }),
                },
              ],
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ found: true, state }),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
          };
        }
      }
    );
  },
};

const writeLockfileInputSchema = {
  state: LockfileStateSchema,
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory for .fireweave/.cache/.lockfile (defaults to process.cwd())'
    ),
};

export const writeLockfileTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'write_lockfile',
      {
        title: 'Write Lockfile',
        description:
          'Atomically writes the resume-state lockfile at ' +
          '`.fireweave/.cache/.lockfile`. Creates `.fireweave/.cache/` if ' +
          'absent and appends `.fireweave/.cache/` to `.gitignore` if ' +
          'not already ignored. Skill calls this at every step boundary ' +
          'with the up-to-date `lastStep` + `workingSpec`.',
        inputSchema: writeLockfileInputSchema,
      },
      async (args) => {
        try {
          await writeLockfile(args.state as LockfileState, args.cwd);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ written: true }),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
          };
        }
      }
    );
  },
};

export const clearLockfileTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'clear_lockfile',
      {
        title: 'Clear Lockfile',
        description:
          'Removes `.fireweave/.cache/.lockfile`. Idempotent — silently ' +
          'succeeds when the file does not exist. The skill calls this ' +
          'after `register_rollout` succeeds, or when the user explicitly ' +
          'discards an in-progress rollout.',
        inputSchema: cwdInputSchema,
      },
      async (args) => {
        try {
          await clearLockfile(args.cwd);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ cleared: true }),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
          };
        }
      }
    );
  },
};
