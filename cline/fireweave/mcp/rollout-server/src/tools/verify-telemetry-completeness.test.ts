import { test, expect, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifyTelemetryCompleteness } from './verify-telemetry-completeness';

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
  const dir = await mkdtemp(path.join(tmpdir(), 'fw-telemetry-test-'));
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

test('verifyTelemetryCompleteness: console.log passes', async () => {
  const src = `
    export function myFeature(userId: string) {
      console.log('feature enabled for', userId);
      return true;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.rule).toBe('telemetry_completeness');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyTelemetryCompleteness: logger.info passes', async () => {
  const src = `
    import { logger } from './logger';
    export function myFeature(userId: string) {
      logger.info({ userId }, 'feature activated');
      return true;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyTelemetryCompleteness: posthog.capture passes', async () => {
  const src = `
    export function myFeature(userId: string) {
      analytics.capture('feature-viewed', { userId });
      return true;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyTelemetryCompleteness: metrics.record passes', async () => {
  const src = `
    export function myFeature() {
      metrics.record('feature.activated', 1);
      return true;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyTelemetryCompleteness: span.startSpan passes', async () => {
  const src = `
    export function myFeature() {
      const span = tracer.startSpan('feature.operation');
      span.endSpan();
      return true;
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyTelemetryCompleteness: no telemetry calls emits warn finding, still passes', async () => {
  const src = `
    export function myFeature(userId: string) {
      // Pure logic, no observability
      if (userId.startsWith('beta-')) {
        return 'new-path';
      }
      return 'old-path';
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.rule).toBe('telemetry_completeness');
  // 'warn' does NOT block — pass should still be true
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('warn');
  expect(result.findings[0]!.message).toContain('myFeature');
  expect(result.findings[0]!.fix).toBeDefined();
});

test('verifyTelemetryCompleteness: missing file is silently skipped (passes, no findings)', async () => {
  const opts = makeConfig('nonexistent/feature.ts', '/tmp/no-such-dir');

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyTelemetryCompleteness: console.warn also passes', async () => {
  const src = `
    export function myFeature() {
      console.warn('degraded mode active');
      return 'old';
    }
  `;
  const { dir, relativePath } = await makeTempFile('feature.ts', src);
  const opts = makeConfig(relativePath, dir);

  const result = await verifyTelemetryCompleteness(opts);
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});
