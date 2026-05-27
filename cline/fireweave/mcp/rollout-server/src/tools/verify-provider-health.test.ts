import { test, expect } from 'bun:test';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifyProviderHealth } from './verify-provider-health';

// ---------------------------------------------------------------------------
// Minimal valid config builder
// ---------------------------------------------------------------------------
function makeConfig(providers: Partial<RolloutConfig['providers']> = {}): RolloutConfig {
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
    wrapPoints: [{ file: 'src/feature.ts', symbol: 'myFeature', wrapStyle: 'function-guard' }],
    providers: {
      'feature-flag.control': null,
      'feature-flag.evaluation': null,
      'error.regression-detection': null,
      'metric.query': null,
      'log.ingestion': null,
      'trace.distributed': null,
      'flag.change-feed': null,
      'alert.lifecycle': null,
      'experiment.lifecycle': null,
      ...providers,
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('verifyProviderHealth: empty providers (all null) passes with no findings', async () => {
  const result = await verifyProviderHealth({ config: makeConfig() });
  expect(result.rule).toBe('provider_health');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifyProviderHealth: single non-null provider emits info finding, still passes', async () => {
  const result = await verifyProviderHealth({
    config: makeConfig({ 'feature-flag.evaluation': 'launchdarkly' }),
  });
  expect(result.rule).toBe('provider_health');
  expect(result.pass).toBe(true);
  // One unique provider → one info finding
  expect(result.findings.length).toBeGreaterThan(0);
  for (const f of result.findings) {
    expect(f.rule).toBe('provider_health');
    expect(f.severity).toBe('info');
  }
});

test('verifyProviderHealth: fireweave-posthog provider emits advisory finding', async () => {
  const result = await verifyProviderHealth({
    config: makeConfig({ 'feature-flag.evaluation': 'fireweave-posthog' }),
  });
  expect(result.pass).toBe(true);
  const posthogFinding = result.findings.find((f) =>
    f.message.includes('fireweave-posthog'),
  );
  expect(posthogFinding).toBeDefined();
  expect(posthogFinding?.severity).toBe('info');
  expect(posthogFinding?.message).toContain('advisory-only');
});

test('verifyProviderHealth: duplicate provider IDs emit only one finding (deduplication)', async () => {
  const result = await verifyProviderHealth({
    config: makeConfig({
      'feature-flag.control': 'launchdarkly',
      'feature-flag.evaluation': 'launchdarkly', // same ID
    }),
  });
  expect(result.pass).toBe(true);
  // Set deduplication: only 1 unique providerId → 1 finding
  expect(result.findings).toHaveLength(1);
});

test('verifyProviderHealth: multiple distinct providers each emit a finding', async () => {
  const result = await verifyProviderHealth({
    config: makeConfig({
      'feature-flag.evaluation': 'launchdarkly',
      'metric.query': 'datadog',
    }),
  });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(2);
});
