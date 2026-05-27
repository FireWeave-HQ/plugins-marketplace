import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifyCohortKeying } from './verify-cohort-keying';

// ---------------------------------------------------------------------------
// Temp directory cleanup
// ---------------------------------------------------------------------------
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempFile(filename: string, content: string): Promise<{ dir: string; relativePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fw-cohort-test-'));
  tempDirs.push(dir);
  await writeFile(path.join(dir, filename), content, 'utf8');
  return { dir, relativePath: filename };
}

function makeConfig(wrapPointFile: string, repoRoot: string): { config: RolloutConfig; repoRoot: string } {
  return {
    repoRoot,
    config: {
      version: 1,
      orgId: 'org-test',
      projectId: 'proj-test',
      projectName: 'Test Project',
      feature: {
        name: 'test-feature',
        description: 'A test feature',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      flag: {
        key: 'test-flag',
        providerId: 'launchdarkly',
        type: 'boolean',
        safeDefault: false,
      },
      rollout: {
        style: 'linear-percent',
        schedule: [{ percent: 100, holdMinutes: 0 }],
        guardrails: [],
      },
      wrapPoints: [
        {
          file: wrapPointFile,
          symbol: 'myFeature',
          wrapStyle: 'function-guard',
        },
      ],
      providers: {
        'feature-flag.control': 'launchdarkly',
        'feature-flag.evaluation': 'launchdarkly',
        'error.regression-detection': null,
        'metric.query': null,
        'log.ingestion': null,
        'trace.distributed': null,
        'flag.change-feed': null,
        'alert.lifecycle': null,
        'experiment.lifecycle': null,
      },
      metrics: [],
      verification: {
        cohort_keying: 'block',
        no_orphan_flags: 'advisory',
        safe_defaults: 'block',
        no_mixed_provider_calls: 'advisory',
        telemetry_completeness: 'advisory',
        rollout_config_schema: 'block',
        provider_health: 'advisory',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('verifyCohortKeying: file with evaluate(key, userId) passes', async () => {
  const src = `
    import { evaluate } from '@fireweaveai/sdk';
    export function myFeature(userId: string) {
      const enabled = evaluate('test-flag', userId);
      if (enabled) { return 'new'; }
      return 'old';
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyCohortKeying(opts);
  expect(result.rule).toBe('cohort_keying');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyCohortKeying: file with getFeatureFlag(key, distinctId) passes', async () => {
  const src = `
    import { posthog } from 'posthog-node';
    export function myFeature(userId: string) {
      const flag = posthog.getFeatureFlag('test-flag', userId);
      return flag;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyCohortKeying(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyCohortKeying: evaluate(key) without distinctId fails with block', async () => {
  const src = `
    import { evaluate } from '@fireweaveai/sdk';
    export function myFeature() {
      // Missing distinctId — evaluates globally
      const enabled = evaluate('test-flag');
      return enabled ? 'new' : 'old';
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyCohortKeying(opts);
  expect(result.rule).toBe('cohort_keying');
  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain('distinctId');
});

test('verifyCohortKeying: file with no evaluation call fails with block', async () => {
  const src = `
    export function myFeature(userId: string) {
      // No flag evaluation at all
      return 'old';
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyCohortKeying(opts);
  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain('no evaluate');
});

test('verifyCohortKeying: missing file emits warn finding but does not block', async () => {
  const opts = makeConfig('nonexistent/file.ts', '/tmp/no-such-dir');

  const result = await verifyCohortKeying(opts);
  expect(result.pass).toBe(true); // warn doesn't block
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('warn');
  expect(result.findings[0]!.message).toContain('not found');
});

test('verifyCohortKeying: isFeatureEnabled with two args passes', async () => {
  const src = `
    export function myFeature(ctx: { userId: string }) {
      const on = client.isFeatureEnabled('test-flag', ctx.userId);
      return on;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyCohortKeying(opts);
  expect(result.pass).toBe(true);
});
