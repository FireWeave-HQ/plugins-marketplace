import { test, expect } from 'bun:test';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifyNoOrphanFlags } from './verify-no-orphan-flags';

// ---------------------------------------------------------------------------
// Minimal valid config builder
// ---------------------------------------------------------------------------
function makeConfig(flagKey = 'fw-my-feature'): RolloutConfig {
  return {
    version: 1,
    orgId: 'org-test',
    projectId: 'proj-test',
    projectName: 'Test Project',
    feature: {
      name: 'test-feature',
      description: 'A test feature',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    flags: [{
      key: flagKey,
      providerId: 'launchdarkly',
      type: 'boolean',
      safeDefault: false,
    }],
    rollout: {
      style: 'linear-percent',
      schedule: [{ percent: 100, holdMinutes: 0 }],
      guardrails: [],
    },
    wrapPoints: [{ file: 'src/feature.ts', symbol: 'myFeature', wrapStyle: 'function-guard', flagKey }],
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
      no_orphan_flags: 'block',
      safe_defaults: 'block',
      no_mixed_provider_calls: 'advisory',
      telemetry_completeness: 'advisory',
      rollout_config_schema: 'block',
      provider_health: 'advisory',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('verifyNoOrphanFlags: no callback → skipped with info finding, passes', async () => {
  const result = await verifyNoOrphanFlags({ config: makeConfig() });
  expect(result.rule).toBe('no_orphan_flags');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('info');
  expect(result.findings[0]!.message).toContain('skipped');
});

test('verifyNoOrphanFlags: callback returns only the expected flag → no orphans, passes', async () => {
  const config = makeConfig('fw-my-feature');
  const result = await verifyNoOrphanFlags({
    config,
    listProviderFlags: async () => ['fw-my-feature'],
  });
  expect(result.rule).toBe('no_orphan_flags');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyNoOrphanFlags: callback returns orphan fw- flag → warn finding, still passes', async () => {
  const config = makeConfig('fw-my-feature');
  const result = await verifyNoOrphanFlags({
    config,
    listProviderFlags: async () => ['fw-my-feature', 'fw-old-experiment'],
  });
  expect(result.rule).toBe('no_orphan_flags');
  expect(result.pass).toBe(true); // warn doesn't block
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('warn');
  expect(result.findings[0]!.message).toContain('fw-old-experiment');
  expect(result.findings[0]!.fix).toBeDefined();
});

test('verifyNoOrphanFlags: flags without fw- prefix are ignored', async () => {
  const config = makeConfig('fw-my-feature');
  const result = await verifyNoOrphanFlags({
    config,
    listProviderFlags: async () => ['fw-my-feature', 'third-party-flag', 'custom-flag'],
  });
  expect(result.pass).toBe(true);
  // Non-fw- flags are not reported
  expect(result.findings).toHaveLength(0);
});

test('verifyNoOrphanFlags: multiple orphans emits one finding per orphan', async () => {
  const config = makeConfig('fw-active');
  const result = await verifyNoOrphanFlags({
    config,
    listProviderFlags: async () => ['fw-active', 'fw-orphan-1', 'fw-orphan-2'],
  });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(2);
  const messages = result.findings.map((f) => f.message);
  expect(messages.some((m) => m.includes('fw-orphan-1'))).toBe(true);
  expect(messages.some((m) => m.includes('fw-orphan-2'))).toBe(true);
});

test('verifyNoOrphanFlags: callback throws → warn finding, still passes', async () => {
  const config = makeConfig('fw-my-feature');
  const result = await verifyNoOrphanFlags({
    config,
    listProviderFlags: async () => { throw new Error('NATS timeout'); },
  });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('warn');
  expect(result.findings[0]!.message).toContain('NATS timeout');
});
