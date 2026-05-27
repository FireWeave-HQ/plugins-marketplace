import { test, expect, describe } from 'bun:test';
import {
  extractDiffSurface,
  runExtractDiffSurfaceAlias,
  defaultExtractDiffSurfaceForwarder,
} from './extract-diff-surface';
import type { SimpleGit } from 'simple-git';

/** Construct a minimal SimpleGit mock that returns preset diff output */
function makeMockGit(diffOutput: string): SimpleGit {
  return {
    diff: async (_args: string[]) => diffOutput,
  } as unknown as SimpleGit;
}

// ---------------------------------------------------------------------------
// Happy path — mixed added, modified, deleted files
// ---------------------------------------------------------------------------
test('extractDiffSurface parses mixed status git output', async () => {
  const rawDiff = [
    'M\tsrc/lib/utils.ts',
    'A\tsrc/routes/+page.svelte',
    'D\tsrc/old-module.ts',
    'A\tsrc/routes/api/+server.ts',
    'M\tsrc/lib/utils.test.ts',
  ].join('\n');

  const result = await extractDiffSurface({
    fromRef: 'v1.0.0',
    toRef: 'HEAD',
    git: makeMockGit(rawDiff),
  });

  expect(result.files).toHaveLength(5);

  const modified = result.files.find((f) => f.path === 'src/lib/utils.ts');
  expect(modified?.status).toBe('modified');

  const added = result.files.find((f) => f.path === 'src/routes/+page.svelte');
  expect(added?.status).toBe('added');

  const deleted = result.files.find((f) => f.path === 'src/old-module.ts');
  expect(deleted?.status).toBe('deleted');
});

// ---------------------------------------------------------------------------
// Route detection heuristic
// ---------------------------------------------------------------------------
test('extractDiffSurface detects SvelteKit route files', async () => {
  const rawDiff = [
    'A\tsrc/routes/(app)/dashboard/+page.svelte',
    'M\tsrc/routes/api/users/+server.ts',
    'A\tsrc/routes/(app)/+layout.svelte',
    'M\tsrc/lib/regular.ts',
  ].join('\n');

  const result = await extractDiffSurface({
    fromRef: 'abc123',
    toRef: 'HEAD',
    git: makeMockGit(rawDiff),
  });

  expect(result.changedRoutes).toContain(
    'src/routes/(app)/dashboard/+page.svelte'
  );
  expect(result.changedRoutes).toContain('src/routes/api/users/+server.ts');
  expect(result.changedRoutes).toContain('src/routes/(app)/+layout.svelte');
  // regular TS should NOT appear in changedRoutes
  expect(result.changedRoutes).not.toContain('src/lib/regular.ts');
});

// ---------------------------------------------------------------------------
// Test file detection heuristic
// ---------------------------------------------------------------------------
test('extractDiffSurface detects test files', async () => {
  const rawDiff = [
    'M\tsrc/lib/auth.ts',
    'A\tsrc/lib/auth.test.ts',
    'M\tsrc/utils/parser.spec.ts',
    'A\tsrc/components/Button.test.tsx',
  ].join('\n');

  const result = await extractDiffSurface({
    fromRef: 'main',
    toRef: 'feature/auth',
    git: makeMockGit(rawDiff),
  });

  expect(result.changedTests).toContain('src/lib/auth.test.ts');
  expect(result.changedTests).toContain('src/utils/parser.spec.ts');
  expect(result.changedTests).toContain('src/components/Button.test.tsx');
  // Non-test should not appear
  expect(result.changedTests).not.toContain('src/lib/auth.ts');
});

// ---------------------------------------------------------------------------
// Rename status uses the new path
// ---------------------------------------------------------------------------
test('extractDiffSurface handles renamed files using destination path', async () => {
  const rawDiff = 'R100\tsrc/old-name.ts\tsrc/new-name.ts';

  const result = await extractDiffSurface({
    fromRef: 'v2.0.0',
    toRef: 'HEAD',
    git: makeMockGit(rawDiff),
  });

  expect(result.files).toHaveLength(1);
  expect(result.files[0]?.path).toBe('src/new-name.ts');
  expect(result.files[0]?.status).toBe('renamed');
});

// ---------------------------------------------------------------------------
// changedSymbols is always empty (MVP placeholder)
// ---------------------------------------------------------------------------
test('extractDiffSurface always returns empty changedSymbols for MVP', async () => {
  const rawDiff = 'M\tsrc/lib/important-module.ts';

  const result = await extractDiffSurface({
    fromRef: 'HEAD~5',
    toRef: 'HEAD',
    git: makeMockGit(rawDiff),
  });

  expect(result.changedSymbols).toEqual([]);
});

// ---------------------------------------------------------------------------
// Empty diff (no changed files)
// ---------------------------------------------------------------------------
test('extractDiffSurface handles empty diff output', async () => {
  const result = await extractDiffSurface({
    fromRef: 'HEAD~1',
    toRef: 'HEAD',
    git: makeMockGit(''),
  });

  expect(result.files).toEqual([]);
  expect(result.changedRoutes).toEqual([]);
  expect(result.changedTests).toEqual([]);
});

// ---------------------------------------------------------------------------
// R-004-3 — Wave A deprecation alias
// ---------------------------------------------------------------------------
describe('R-004-3 extract_diff_surface Wave A alias', () => {
  test('writes DEPRECATION warning via injected log', async () => {
    const logs: string[] = [];
    await runExtractDiffSurfaceAlias(
      {},
      { forwarder: async () => ({}), log: (m) => logs.push(m) }
    );
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('DEPRECATION');
    expect(logs[0]).toContain('extract_diff_surface');
  });

  test('returns the forwarder response unchanged', async () => {
    const expected = { files: [{ path: 'x', status: 'modified' }] };
    const out = await runExtractDiffSurfaceAlias(
      {},
      { forwarder: async () => expected, log: () => {} }
    );
    expect(out).toBe(expected);
  });

  test('forwards args to the forwarder verbatim', async () => {
    let captured: unknown;
    await runExtractDiffSurfaceAlias(
      { fromRef: 'main', toRef: 'HEAD' },
      {
        forwarder: async (a) => {
          captured = a;
          return {};
        },
        log: () => {},
      }
    );
    expect(captured).toEqual({ fromRef: 'main', toRef: 'HEAD' });
  });

  test('default forwarder returns NOT_YET_MIGRATED envelope', async () => {
    const out = (await defaultExtractDiffSurfaceForwarder({})) as {
      error: { code: string };
    };
    expect(out.error.code).toBe('NOT_YET_MIGRATED');
  });

  test('increments usage counter when incrementUsage is supplied', async () => {
    const counts: string[] = [];
    await runExtractDiffSurfaceAlias(
      {},
      {
        forwarder: async () => ({}),
        log: () => {},
        incrementUsage: (n) => counts.push(n),
      }
    );
    expect(counts).toEqual(['extract_diff_surface']);
  });
});
