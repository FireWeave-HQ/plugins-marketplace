import { test, expect } from 'bun:test';
import type { SimpleGit } from 'simple-git';
import { tagBaselineCommit } from './tag-baseline-commit';

// ---------------------------------------------------------------------------
// Helper: captures all git.raw() call args
// ---------------------------------------------------------------------------
function makeFakeGit(opts: {
  headAuthorEmail: string;
  configEmail: string;
  newHeadSha?: string;
}): { git: SimpleGit; calls: string[][] } {
  const calls: string[][] = [];
  const newHead = opts.newHeadSha ?? 'newhash1234';

  const git = {
    raw: async (args: string[]) => {
      calls.push([...args]);

      const cmd = args[0];
      if (cmd === 'log') return opts.headAuthorEmail + '\n';
      if (cmd === 'config') return opts.configEmail + '\n';
      if (cmd === 'commit') return '';
      if (cmd === 'rev-parse') return newHead + '\n';
      if (cmd === 'tag') return '';
      return '';
    },
  } as unknown as SimpleGit;

  return { git, calls };
}

// ---------------------------------------------------------------------------
// Amend path: HEAD author matches config user
// ---------------------------------------------------------------------------
test('tagBaselineCommit amends HEAD when author matches git config user', async () => {
  const { git, calls } = makeFakeGit({
    headAuthorEmail: 'dev@example.com',
    configEmail: 'dev@example.com',
    newHeadSha: 'abc111',
  });

  const result = await tagBaselineCommit({ rolloutId: 'rlt-001', git });

  // Should have called git commit --amend
  const commitCall = calls.find((c) => c[0] === 'commit' && c.includes('--amend'));
  expect(commitCall).toBeDefined();
  expect(commitCall).toContain('--amend');
  expect(commitCall).toContain('--no-edit');

  // Trailers present
  expect(commitCall?.join(' ')).toContain('Fireweave-Rollout-Id: rlt-001');

  // Should NOT have created an empty commit
  const emptyCommit = calls.find((c) => c[0] === 'commit' && c.includes('--allow-empty'));
  expect(emptyCommit).toBeUndefined();

  expect(result.ref).toBe('abc111');
  expect(result.tag).toBe('fw-rollout/rlt-001');
});

// ---------------------------------------------------------------------------
// Empty-commit path: HEAD author differs from config user
// ---------------------------------------------------------------------------
test('tagBaselineCommit creates empty commit when author does not match user', async () => {
  const { git, calls } = makeFakeGit({
    headAuthorEmail: 'other@example.com',
    configEmail: 'dev@example.com',
    newHeadSha: 'def222',
  });

  const result = await tagBaselineCommit({ rolloutId: 'rlt-002', git });

  const emptyCommit = calls.find((c) => c[0] === 'commit' && c.includes('--allow-empty'));
  expect(emptyCommit).toBeDefined();
  expect(emptyCommit?.join(' ')).toContain('Fireweave-Rollout-Id: rlt-002');

  // Should NOT amend
  const amendCall = calls.find((c) => c[0] === 'commit' && c.includes('--amend'));
  expect(amendCall).toBeUndefined();

  expect(result.ref).toBe('def222');
  expect(result.tag).toBe('fw-rollout/rlt-002');
});

// ---------------------------------------------------------------------------
// Tag creation: correct tag name and lightweight (no -a)
// ---------------------------------------------------------------------------
test('tagBaselineCommit creates a lightweight tag with correct name', async () => {
  const { git, calls } = makeFakeGit({
    headAuthorEmail: 'dev@example.com',
    configEmail: 'dev@example.com',
    newHeadSha: 'ff0011',
  });

  await tagBaselineCommit({ rolloutId: 'my-rollout-xyz', git });

  const tagCall = calls.find((c) => c[0] === 'tag');
  expect(tagCall).toBeDefined();
  expect(tagCall?.[1]).toBe('fw-rollout/my-rollout-xyz');
  expect(tagCall?.[2]).toBe('ff0011');
  // Lightweight tag: no -a flag
  expect(tagCall).not.toContain('-a');
});

// ---------------------------------------------------------------------------
// Empty-commit path when git config user.email throws
// ---------------------------------------------------------------------------
test('tagBaselineCommit uses empty-commit path when config email unavailable', async () => {
  const calls: string[][] = [];
  const git = {
    raw: async (args: string[]) => {
      calls.push([...args]);
      const cmd = args[0];
      if (cmd === 'log') return 'author@example.com\n';
      if (cmd === 'config') throw new Error('no user.email configured');
      if (cmd === 'commit') return '';
      if (cmd === 'rev-parse') return 'aabb0099\n';
      if (cmd === 'tag') return '';
      return '';
    },
  } as unknown as SimpleGit;

  const result = await tagBaselineCommit({ rolloutId: 'rlt-003', git });

  const emptyCommit = calls.find((c) => c[0] === 'commit' && c.includes('--allow-empty'));
  expect(emptyCommit).toBeDefined();
  expect(result.tag).toBe('fw-rollout/rlt-003');
});
