import { test, expect } from 'bun:test';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifySafeDefaults } from './verify-safe-defaults';

// ---------------------------------------------------------------------------
// Minimal valid config builder
// ---------------------------------------------------------------------------
function makeConfig(
  type: 'boolean' | 'multivariate',
  safeDefault: boolean | string | number | null,
): RolloutConfig {
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
      key: 'test-flag',
      providerId: 'launchdarkly',
      type,
      safeDefault,
    }],
    rollout: {
      style: 'linear-percent',
      schedule: [{ percent: 100, holdMinutes: 0 }],
      guardrails: [],
    },
    wrapPoints: [{ file: 'src/feature.ts', symbol: 'myFeature', wrapStyle: 'function-guard', flagKey: 'test-flag' }],
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('verifySafeDefaults: boolean flag with boolean safeDefault passes', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('boolean', false) });
  expect(result.rule).toBe('safe_defaults');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifySafeDefaults: boolean flag with true safeDefault also passes', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('boolean', true) });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifySafeDefaults: boolean flag with null safeDefault passes', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('boolean', null) });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifySafeDefaults: boolean flag with string safeDefault fails', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('boolean', 'control') });
  expect(result.rule).toBe('safe_defaults');
  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain("(type='boolean')");
  expect(result.findings[0]!.message).toContain('string');
  expect(result.findings[0]!.fix).toBeDefined();
});

test('verifySafeDefaults: boolean flag with numeric safeDefault fails', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('boolean', 1) });
  expect(result.pass).toBe(false);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain('number');
});

test('verifySafeDefaults: multivariate flag with string variant key passes', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('multivariate', 'control') });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifySafeDefaults: multivariate flag with null safeDefault passes', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('multivariate', null) });
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

test('verifySafeDefaults: multivariate flag with numeric safeDefault fails', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('multivariate', 42) });
  expect(result.rule).toBe('safe_defaults');
  expect(result.pass).toBe(false);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain("(type='multivariate')");
  expect(result.findings[0]!.fix).toBeDefined();
});

test('verifySafeDefaults: multivariate flag with boolean safeDefault fails', async () => {
  const result = await verifySafeDefaults({ config: makeConfig('multivariate', false) });
  expect(result.pass).toBe(false);
  expect(result.findings[0]!.severity).toBe('block');
  expect(result.findings[0]!.message).toContain('boolean');
});
