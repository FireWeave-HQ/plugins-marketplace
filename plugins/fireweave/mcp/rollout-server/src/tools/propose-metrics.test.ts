import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  proposeMetrics,
  runProposeMetricsWithGuard,
  runProposeMetricsAlias,
  defaultProposeMetricsForwarder,
} from './propose-metrics';
import { writeConfirmationReceipt } from './write-confirmation-receipt';

// ---------------------------------------------------------------------------
// Baseline: error rate is ALWAYS included
// ---------------------------------------------------------------------------
test('proposeMetrics always includes error-rate metric as baseline', async () => {
  const result = await proposeMetrics({
    featureDescription: 'change the button colour',
    flagKey: 'button-colour',
  });

  const errorRate = result.proposals.find((p) => p.id.includes('error-rate'));
  expect(errorRate).toBeDefined();
  expect(errorRate!.sourceCapability).toBe('error.regression-detection');
  expect(errorRate!.severity).toBe('page');
  expect(errorRate!.queryLanguage).toBe('hogql');
  // HogQL query must reference the flag key
  expect(errorRate!.query).toContain('button-colour');
});

// ---------------------------------------------------------------------------
// Performance keyword triggers p95 latency metric
// ---------------------------------------------------------------------------
test('proposeMetrics includes p95-latency metric when description mentions performance', async () => {
  const result = await proposeMetrics({
    featureDescription:
      'Optimise checkout performance by reducing latency on the API',
    flagKey: 'checkout-perf',
  });

  const latency = result.proposals.find((p) => p.id.includes('p95-latency'));
  expect(latency).toBeDefined();
  expect(latency!.query).toContain('quantile(0.95)');
  expect(latency!.query).toContain('checkout-perf');
  expect(latency!.severity).toBe('warn');
});

// ---------------------------------------------------------------------------
// Conversion keyword triggers funnel conversion metric
// ---------------------------------------------------------------------------
test('proposeMetrics includes funnel-conversion metric when description mentions checkout', async () => {
  const result = await proposeMetrics({
    featureDescription:
      'New checkout flow with updated payment form to improve conversion',
    flagKey: 'new-checkout',
  });

  const funnel = result.proposals.find((p) =>
    p.id.includes('funnel-conversion')
  );
  expect(funnel).toBeDefined();
  expect(funnel!.query).toContain('new-checkout');
  expect(funnel!.sourceCapability).toBe('metric.query');
});

// ---------------------------------------------------------------------------
// Retention keyword triggers retention metric
// ---------------------------------------------------------------------------
test('proposeMetrics includes retention metric when description mentions engagement', async () => {
  const result = await proposeMetrics({
    featureDescription:
      'New onboarding flow to improve user engagement and retention',
    flagKey: 'onboarding-v2',
  });

  const retention = result.proposals.find((p) => p.id.includes('retention'));
  expect(retention).toBeDefined();
  expect(retention!.query).toContain('onboarding-v2');
  expect(retention!.query).toContain('distinct_id');
});

// ---------------------------------------------------------------------------
// Multiple keywords can trigger multiple metrics simultaneously
// ---------------------------------------------------------------------------
test('proposeMetrics can return multiple metrics for a rich description', async () => {
  const result = await proposeMetrics({
    featureDescription:
      'Revamped checkout flow improving conversion rate and performance. ' +
      'Improves user retention via engagement features.',
    flagKey: 'mega-checkout',
  });

  // At least error rate + funnel + latency + retention
  expect(result.proposals.length).toBeGreaterThanOrEqual(4);
  const ids = result.proposals.map((p) => p.id);
  expect(ids.some((id) => id.includes('error-rate'))).toBe(true);
  expect(ids.some((id) => id.includes('funnel-conversion'))).toBe(true);
  expect(ids.some((id) => id.includes('p95-latency'))).toBe(true);
  expect(ids.some((id) => id.includes('retention'))).toBe(true);
});

// ---------------------------------------------------------------------------
// isPrimaryConversionSurface hint triggers funnel metric even without keywords
// ---------------------------------------------------------------------------
test('proposeMetrics includes funnel-conversion when isPrimaryConversionSurface=true', async () => {
  const result = await proposeMetrics({
    featureDescription: 'small UI tweak with no obvious funnel impact',
    flagKey: 'ui-tweak',
    codeAnalysis: { isPrimaryConversionSurface: true },
  });

  const funnel = result.proposals.find((p) =>
    p.id.includes('funnel-conversion')
  );
  expect(funnel).toBeDefined();
});

// ---------------------------------------------------------------------------
// hasUserVisibleChange hint triggers retention metric even without keywords
// ---------------------------------------------------------------------------
test('proposeMetrics includes retention when hasUserVisibleChange=true', async () => {
  const result = await proposeMetrics({
    featureDescription: 'backend change with user-visible effect',
    flagKey: 'backend-change',
    codeAnalysis: { hasUserVisibleChange: true },
  });

  const retention = result.proposals.find((p) => p.id.includes('retention'));
  expect(retention).toBeDefined();
});

// ---------------------------------------------------------------------------
// providerCapabilities filter — no metric.query cap should suppress query-based metrics
// ---------------------------------------------------------------------------
test('proposeMetrics suppresses metric.query proposals when capability not present', async () => {
  const result = await proposeMetrics({
    featureDescription: 'checkout performance and conversion improvement',
    flagKey: 'constrained-flag',
    providerCapabilities: ['error.regression-detection'], // no metric.query
  });

  // Only error-rate should be present (no funnel, no latency, no retention)
  expect(result.proposals).toHaveLength(1);
  expect(result.proposals[0]?.id).toContain('error-rate');
});

// ---------------------------------------------------------------------------
// All proposals satisfy MetricProposal schema constraints (non-empty strings)
// ---------------------------------------------------------------------------
test('proposeMetrics proposals satisfy schema constraints (min(1) strings)', async () => {
  const result = await proposeMetrics({
    featureDescription:
      'checkout performance latency conversion retention engagement signup',
    flagKey: 'full-flag',
  });

  for (const p of result.proposals) {
    expect(p.id.length).toBeGreaterThan(0);
    expect(p.metricName.length).toBeGreaterThan(0);
    expect(p.query.length).toBeGreaterThan(0);
    expect(p.threshold.length).toBeGreaterThan(0);
    expect(p.basis.length).toBeGreaterThan(0);
    expect(['hogql', 'promql', 'sql', 'datadog-query']).toContain(
      p.queryLanguage
    );
    expect(['info', 'warn', 'page']).toContain(p.severity);
    expect(['metric.query', 'error.regression-detection']).toContain(
      p.sourceCapability
    );
  }
});

// ---------------------------------------------------------------------------
// R-002-4: receipt-guard refuses when GATE-1-FEATURE-SURFACE receipt absent
// ---------------------------------------------------------------------------
describe('R-002-4 propose_metrics refuses without GATE-1-FEATURE-SURFACE receipt', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-proposemetrics-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('returns CONFIRMATION_MISSING when no receipts exist', async () => {
    const result = await runProposeMetricsWithGuard(
      { featureDescription: 'x', flagKey: 'y' },
      tmpDir
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.code).toBe('CONFIRMATION_MISSING');
      expect(result.error.missingGateId).toBe('GATE-1-FEATURE-SURFACE');
      expect(result.error.remediation).toContain('Step 1');
    }
  });

  test('proceeds when GATE-1-FEATURE-SURFACE receipt present', async () => {
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-1-FEATURE-SURFACE',
        questionHash: 'a'.repeat(64),
        selectedOption: 'diff',
        stepNumber: '1',
      },
      tmpDir
    );
    const result = await runProposeMetricsWithGuard(
      { featureDescription: 'simple', flagKey: 'flag-a' },
      tmpDir
    );
    expect('proposals' in result).toBe(true);
  });

  test('does NOT touch state when receipt missing (no lockfile mutation)', async () => {
    // Calling propose-metrics with no receipt — guard should return
    // CONFIRMATION_MISSING without writing anything.
    const result = await runProposeMetricsWithGuard(
      { featureDescription: 'x', flagKey: 'y' },
      tmpDir
    );
    expect('error' in result).toBe(true);
    // No lockfile should exist at all (guard reads, never writes).
    const lockfilePath = join(tmpDir, '.fireweave', '.cache', '.lockfile');
    let exists = true;
    try {
      const { stat } = await import('node:fs/promises');
      await stat(lockfilePath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R-004-3 — Wave A deprecation alias: receipt-guard → warn → forward
// ---------------------------------------------------------------------------
describe('R-004-3 propose_metrics Wave A alias layering', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-propose-alias-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFeatureSurfaceReceipt() {
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-1-FEATURE-SURFACE',
        questionHash: 'a'.repeat(64),
        selectedOption: 'small',
        stepNumber: '1',
      },
      tmpDir
    );
  }

  test('receipt-guard refuses BEFORE deprecation warning fires', async () => {
    const logs: string[] = [];
    const result = await runProposeMetricsAlias(
      {},
      {
        cwd: tmpDir,
        log: (m) => logs.push(m),
        forwarder: async () => ({ proposals: [] }),
      }
    );
    expect(logs).toEqual([]);
    expect((result as { error: { code: string } }).error.code).toBe(
      'CONFIRMATION_MISSING'
    );
  });

  test('after receipt: emits DEPRECATION and forwards to proxy', async () => {
    await writeFeatureSurfaceReceipt();
    const logs: string[] = [];
    const forwarderResp = { proposals: [{ id: 'x' }] };
    const out = await runProposeMetricsAlias(
      { flagKey: 'x', featureDescription: 'y' },
      {
        cwd: tmpDir,
        log: (m) => logs.push(m),
        forwarder: async () => forwarderResp,
      }
    );
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('DEPRECATION');
    expect(logs[0]).toContain('propose_metrics');
    expect(out).toBe(forwarderResp);
  });

  test('increments usage counter when guard passes', async () => {
    await writeFeatureSurfaceReceipt();
    const counts: string[] = [];
    await runProposeMetricsAlias(
      {},
      {
        cwd: tmpDir,
        log: () => {},
        forwarder: async () => ({}),
        incrementUsage: (n) => counts.push(n),
      }
    );
    expect(counts).toEqual(['propose_metrics']);
  });

  test('default forwarder returns NOT_YET_MIGRATED envelope', async () => {
    const out = (await defaultProposeMetricsForwarder({})) as {
      error: { code: string };
    };
    expect(out.error.code).toBe('NOT_YET_MIGRATED');
  });
});
