import { test, expect } from 'bun:test';
import type { RolloutConfig } from '@fireweaveai/fw-rollout-types';
import { verifyRolloutConfigSchema } from './verify-rollout-config-schema';

// ---------------------------------------------------------------------------
// Minimal valid RolloutConfig fixture
// ---------------------------------------------------------------------------
const VALID_CONFIG: RolloutConfig = {
  version: 1,
  orgId: 'org-acme',
  projectId: 'proj-alpha',
  projectName: 'Alpha',
  feature: {
    name: 'my-feature',
    description: 'A test feature',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  flags: [{
    key: 'my-flag',
    providerId: 'launchdarkly',
    type: 'boolean',
    safeDefault: false,
  }],
  rollout: {
    style: 'linear-percent',
    schedule: [
      { percent: 10, holdMinutes: 30 },
      { percent: 100, holdMinutes: 0 },
    ],
    guardrails: [],
  },
  wrapPoints: [
    {
      file: 'src/feature.ts',
      symbol: 'myFeature',
      wrapStyle: 'function-guard',
      flagKey: 'my-flag',
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
};

// ---------------------------------------------------------------------------
// Valid config passes
// ---------------------------------------------------------------------------
test('verifyRolloutConfigSchema passes for valid config', async () => {
  const result = await verifyRolloutConfigSchema({ config: VALID_CONFIG });

  expect(result.rule).toBe('rollout_config_schema');
  expect(result.pass).toBe(true);
  expect(result.findings).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Invalid config returns findings with paths
// ---------------------------------------------------------------------------
test('verifyRolloutConfigSchema returns findings for invalid config', async () => {
  const bad = { version: 1, orgId: '', projectId: 'x' }; // missing required fields, empty orgId

  const result = await verifyRolloutConfigSchema({ config: bad });

  expect(result.rule).toBe('rollout_config_schema');
  expect(result.pass).toBe(false);
  expect(result.findings.length).toBeGreaterThan(0);

  // All findings have rule = 'rollout_config_schema'
  for (const f of result.findings) {
    expect(f.rule).toBe('rollout_config_schema');
    expect(f.severity).toBe('block');
    expect(typeof f.message).toBe('string');
    expect(f.message.length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// Findings include field path in message
// ---------------------------------------------------------------------------
test('verifyRolloutConfigSchema includes field path in finding message', async () => {
  const bad = { version: 1, orgId: 'ok', projectId: 'ok', projectName: 'ok', feature: { name: '' } }; // feature.name empty

  const result = await verifyRolloutConfigSchema({ config: bad });
  expect(result.pass).toBe(false);

  const featureFinding = result.findings.find((f) => f.message.includes('feature'));
  expect(featureFinding).toBeDefined();
});

// ---------------------------------------------------------------------------
// Completely wrong type returns multiple findings
// ---------------------------------------------------------------------------
test('verifyRolloutConfigSchema handles completely wrong input (null)', async () => {
  const result = await verifyRolloutConfigSchema({ config: null });

  expect(result.pass).toBe(false);
  expect(result.findings.length).toBeGreaterThan(0);
  // Root-level issue
  const rootFinding = result.findings.find((f) => f.message.includes('(root)'));
  expect(rootFinding).toBeDefined();
});

// ---------------------------------------------------------------------------
// fix field is present and non-empty
// ---------------------------------------------------------------------------
test('verifyRolloutConfigSchema includes fix hint in findings', async () => {
  const result = await verifyRolloutConfigSchema({ config: {} });

  expect(result.pass).toBe(false);
  for (const f of result.findings) {
    expect(f.fix).toBeDefined();
    expect(typeof f.fix).toBe('string');
    expect((f.fix ?? '').length).toBeGreaterThan(0);
  }
});
