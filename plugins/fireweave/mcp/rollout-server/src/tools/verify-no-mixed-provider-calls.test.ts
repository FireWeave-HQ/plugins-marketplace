import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifyNoMixedProviderCalls } from './verify-no-mixed-provider-calls';

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
  const dir = await mkdtemp(path.join(tmpdir(), 'fw-mixed-test-'));
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
        cohort_keying: 'advisory',
        no_orphan_flags: 'advisory',
        safe_defaults: 'block',
        no_mixed_provider_calls: 'block',
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

test('verifyNoMixedProviderCalls: file with no provider imports passes', async () => {
  const src = `
    import { evaluate } from '@fireweaveai/sdk';
    export function myFeature(userId: string) {
      return evaluate('test-flag', userId);
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.rule).toBe('no_mixed_provider_calls');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyNoMixedProviderCalls: file with posthog-node import fails', async () => {
  const src = `
    import PostHog from 'posthog-node';
    export function myFeature(userId: string) {
      const client = new PostHog('key');
      return client.isFeatureEnabled('test-flag', userId);
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.rule).toBe('no_mixed_provider_calls');
  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain('posthog-node');
  expect(result.findings[0]!.file).toBe(relativePath);
  expect(result.findings[0]!.line).toBeGreaterThan(0);
  expect(result.findings[0]!.fix).toBeDefined();
});

test('verifyNoMixedProviderCalls: file with launchdarkly import fails', async () => {
  const src = `
    import * as ld from 'launchdarkly-node-server-sdk';
    export async function myFeature(userId: string) {
      const client = ld.init('sdk-key');
      return client.variation('test-flag', { key: userId }, false);
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.pass).toBe(false);
  expect(result.findings[0]!.message).toContain('launchdarkly-node-server-sdk');
});

test('verifyNoMixedProviderCalls: scoped @launchdarkly package import fails', async () => {
  const src = `
    import * as ld from '@launchdarkly/node-server-sdk';
    export async function myFeature(userId: string) {
      return true;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.pass).toBe(false);
  expect(result.findings[0]!.message).toContain('@launchdarkly/node-server-sdk');
});

test('verifyNoMixedProviderCalls: sub-path import of known package fails', async () => {
  const src = `
    import { something } from 'posthog-node/utils';
    export function myFeature() { return true; }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.pass).toBe(false);
  expect(result.findings[0]!.message).toContain('posthog-node/utils');
});

test('verifyNoMixedProviderCalls: missing file is silently skipped (passes)', async () => {
  const opts = makeConfig('nonexistent/feature.ts', '/tmp/no-such-dir');

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyNoMixedProviderCalls: multiple provider imports in same file → multiple findings', async () => {
  const src = `
    import PostHog from 'posthog-node';
    import * as ld from 'launchdarkly-node-server-sdk';
    export function myFeature() { return true; }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyNoMixedProviderCalls(opts);
  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(2);
});
