import { test, expect } from 'bun:test';
import type { SimpleGit } from 'simple-git';
import { detectBaseline } from './detect-baseline';

// ---------------------------------------------------------------------------
// Helper: minimal fake SimpleGit factory
// ---------------------------------------------------------------------------
function makeFakeGit(overrides: {
  logLatest?: { hash: string; message: string } | null;
  semverTags?: string[];
  revparseOriginMain?: string;
  revparseMain?: string;
  revparseThrows?: boolean;
}): SimpleGit {
  return {
    log: async (_opts?: unknown) => {
      if (overrides.logLatest !== undefined) {
        return { all: overrides.logLatest ? [overrides.logLatest] : [], latest: overrides.logLatest, total: overrides.logLatest ? 1 : 0 };
      }
      return { all: [], latest: undefined, total: 0 };
    },
    tags: async () => {
      const all = overrides.semverTags ?? [];
      return { all, latest: all[all.length - 1] };
    },
    revparse: async (args: string[]) => {
      if (overrides.revparseThrows) throw new Error('not a git repo');
      if (args.includes('origin/main')) {
        if (overrides.revparseOriginMain) return overrides.revparseOriginMain;
        throw new Error('unknown revision origin/main');
      }
      if (args.includes('main')) {
        if (overrides.revparseMain) return overrides.revparseMain;
        throw new Error('unknown revision main');
      }
      throw new Error(`unknown ref: ${args.join(' ')}`);
    },
  } as unknown as SimpleGit;
}

// ---------------------------------------------------------------------------
// All 3 candidate kinds present
// ---------------------------------------------------------------------------
test('detectBaseline returns all 3 candidates when data available', async () => {
  const git = makeFakeGit({
    logLatest: { hash: 'abc123', message: 'chore: tag rollout' },
    semverTags: ['v1.0.0', 'v1.1.0', 'v2.0.0'],
    revparseOriginMain: 'deadbeef',
  });

  const result = await detectBaseline({ git });

  expect(result.candidates).toHaveLength(3);
  expect(result.candidates.find((c) => c.kind === 'fw-rollout-trailer')?.ref).toBe('abc123');
  expect(result.candidates.find((c) => c.kind === 'release-tag')?.ref).toBe('v2.0.0');
  expect(result.candidates.find((c) => c.kind === 'main-head')?.ref).toBe('deadbeef');
});

// ---------------------------------------------------------------------------
// Only main-head when no trailer commits and no semver tags
// ---------------------------------------------------------------------------
test('detectBaseline returns only main-head when no trailer/tags', async () => {
  const git = makeFakeGit({
    logLatest: null,
    semverTags: ['non-semver-tag', 'release-2025'],
    revparseOriginMain: 'cafebabe',
  });

  const result = await detectBaseline({ git });

  expect(result.candidates).toHaveLength(1);
  const c = result.candidates[0];
  expect(c?.kind).toBe('main-head');
  expect(c?.ref).toBe('cafebabe');
});

// ---------------------------------------------------------------------------
// Falls back to local main when origin/main not available
// ---------------------------------------------------------------------------
test('detectBaseline falls back to local main when origin/main missing', async () => {
  const git = makeFakeGit({
    logLatest: null,
    semverTags: [],
    revparseMain: 'feedface',
    // no revparseOriginMain → throws → fallback to main
  });

  const result = await detectBaseline({ git });

  expect(result.candidates).toHaveLength(1);
  const c = result.candidates[0];
  expect(c?.kind).toBe('main-head');
  expect(c?.ref).toBe('feedface');
});

// ---------------------------------------------------------------------------
// No candidates when git is completely empty / no refs
// ---------------------------------------------------------------------------
test('detectBaseline returns empty candidates on bare/empty repo', async () => {
  const git = makeFakeGit({
    logLatest: null,
    semverTags: [],
    revparseThrows: true,
  });

  const result = await detectBaseline({ git });

  expect(result.candidates).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Filters non-semver tags correctly
// ---------------------------------------------------------------------------
test('detectBaseline ignores non-semver tags', async () => {
  const git = makeFakeGit({
    logLatest: null,
    // simple-git returns tags in alphabetical order; v0.0.1 < v1.2.3
    semverTags: ['latest', 'stable', 'v0.0.1', 'v1.2.3', 'pre-release-1'],
    revparseOriginMain: 'aabbcc',
  });

  const result = await detectBaseline({ git });

  const releaseCandidate = result.candidates.find((c) => c.kind === 'release-tag');
  expect(releaseCandidate).toBeDefined();
  // v0.0.1 and v1.2.3 are semver; last in the filtered array is v1.2.3
  expect(releaseCandidate?.ref).toBe('v1.2.3');
});
