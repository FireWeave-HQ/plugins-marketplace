import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recommendRolloutStrategy,
  runRecommendRolloutStrategyWithGuard,
  runRecommendRolloutStrategyAlias,
  defaultRecommendRolloutStrategyForwarder,
} from './recommend-rollout-strategy';
import { writeConfirmationReceipt } from './write-confirmation-receipt';

// ---------------------------------------------------------------------------
// Heuristic 1: dark-launch when no user-visible change
// ---------------------------------------------------------------------------
test('recommends dark-launch when hasUserVisibleChange is false', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'Background data pipeline change',
    hasUserVisibleChange: false,
    isPrimaryConversionSurface: false,
    cohortGated: false,
  });

  expect(result.recommended).toBe('dark-launch');
  expect(result.reason).toContain('no user-visible');
  expect(result.ranked[0]?.style).toBe('dark-launch');
});

// ---------------------------------------------------------------------------
// Heuristic 1 wins over other flags (dark-launch has highest priority)
// ---------------------------------------------------------------------------
test('dark-launch wins even when isPrimaryConversionSurface and cohortGated are true', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'Shadow call for conversion funnel',
    hasUserVisibleChange: false,
    isPrimaryConversionSurface: true,
    cohortGated: true,
  });

  expect(result.recommended).toBe('dark-launch');
});

// ---------------------------------------------------------------------------
// Heuristic 2: experiment-with-control for primary conversion surface
// ---------------------------------------------------------------------------
test('recommends experiment-with-control for primary conversion surface', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'New checkout button placement',
    hasUserVisibleChange: true,
    isPrimaryConversionSurface: true,
    cohortGated: false,
  });

  expect(result.recommended).toBe('experiment-with-control');
  expect(result.reason).toContain('primary conversion surface');
  expect(result.ranked[0]?.style).toBe('experiment-with-control');
});

// ---------------------------------------------------------------------------
// Heuristic 2 wins over cohort flag
// ---------------------------------------------------------------------------
test('experiment-with-control beats cohort-based when both flags set', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'Checkout flow update for power users',
    hasUserVisibleChange: true,
    isPrimaryConversionSurface: true,
    cohortGated: true,
  });

  expect(result.recommended).toBe('experiment-with-control');
});

// ---------------------------------------------------------------------------
// Heuristic 3: cohort-based when cohortGated and not conversion surface
// ---------------------------------------------------------------------------
test('recommends cohort-based when cohortGated is true', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'Feature for enterprise tier users only',
    hasUserVisibleChange: true,
    isPrimaryConversionSurface: false,
    cohortGated: true,
  });

  expect(result.recommended).toBe('cohort-based');
  expect(result.reason).toContain('user segment');
});

// ---------------------------------------------------------------------------
// Default: linear-percent
// ---------------------------------------------------------------------------
test('recommends linear-percent as default fallback', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'Minor UI polish update',
    hasUserVisibleChange: true,
    isPrimaryConversionSurface: false,
    cohortGated: false,
  });

  expect(result.recommended).toBe('linear-percent');
});

// ---------------------------------------------------------------------------
// Ranked list always has 4 entries, recommended first
// ---------------------------------------------------------------------------
test('ranked list has 4 entries with recommended first', async () => {
  const result = await recommendRolloutStrategy({
    featureDescription: 'General change',
    hasUserVisibleChange: true,
    isPrimaryConversionSurface: false,
    cohortGated: false,
  });

  expect(result.ranked).toHaveLength(4);
  expect(result.ranked[0]?.style).toBe(result.recommended);
  // All 4 strategies present
  const styles = result.ranked.map((r) => r.style);
  expect(styles).toContain('linear-percent');
  expect(styles).toContain('experiment-with-control');
  expect(styles).toContain('cohort-based');
  expect(styles).toContain('dark-launch');
});

// ---------------------------------------------------------------------------
// R-002-4: receipt-guard refuses without Step-2 receipts
// ---------------------------------------------------------------------------
describe('R-002-4 recommend_rollout_strategy refuses without Step-2 receipts', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-recommend-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('returns CONFIRMATION_MISSING when GATE-2-TYPE absent', async () => {
    const result = await runRecommendRolloutStrategyWithGuard(
      {
        featureDescription: 'x',
        hasUserVisibleChange: true,
        isPrimaryConversionSurface: false,
        cohortGated: false,
      },
      tmpDir
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.code).toBe('CONFIRMATION_MISSING');
      expect(result.error.missingGateId).toBe('GATE-2-TYPE');
    }
  });

  test('reports next missing gate after first satisfied', async () => {
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-TYPE',
        questionHash: 'a'.repeat(64),
        selectedOption: 'feature',
        stepNumber: '2',
      },
      tmpDir
    );
    const result = await runRecommendRolloutStrategyWithGuard(
      {
        featureDescription: 'x',
        hasUserVisibleChange: true,
        isPrimaryConversionSurface: false,
        cohortGated: false,
      },
      tmpDir
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.missingGateId).toBe('GATE-2-NAME');
    }
  });

  test('proceeds when all three Step-2 receipts present', async () => {
    for (const gateId of [
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
    ] as const) {
      await writeConfirmationReceipt(
        {
          gateId,
          questionHash: 'a'.repeat(64),
          selectedOption: 'feature',
          stepNumber: '2',
        },
        tmpDir
      );
    }
    const result = await runRecommendRolloutStrategyWithGuard(
      {
        featureDescription: 'a small change',
        hasUserVisibleChange: true,
        isPrimaryConversionSurface: false,
        cohortGated: false,
      },
      tmpDir
    );
    expect('recommended' in result).toBe(true);
    if ('recommended' in result) {
      expect(result.recommended).toBe('linear-percent');
    }
  });
});

// ---------------------------------------------------------------------------
// R-004-3 — Wave A deprecation alias: receipt-guard → warn → forward
// ---------------------------------------------------------------------------
describe('R-004-3 recommend_rollout_strategy Wave A alias layering', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-recommend-alias-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeStep2Receipts() {
    for (const gateId of [
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
    ] as const) {
      await writeConfirmationReceipt(
        {
          gateId,
          questionHash: 'a'.repeat(64),
          selectedOption: 'feature',
          stepNumber: '2',
        },
        tmpDir
      );
    }
  }

  test('receipt-guard refuses BEFORE deprecation warning fires', async () => {
    const logs: string[] = [];
    const result = await runRecommendRolloutStrategyAlias(
      {},
      {
        cwd: tmpDir,
        log: (m) => logs.push(m),
        forwarder: async () => ({ recommended: 'linear-percent' }),
      }
    );
    expect(logs).toEqual([]);
    expect((result as { error: { code: string } }).error.code).toBe(
      'CONFIRMATION_MISSING'
    );
  });

  test('after receipts: emits DEPRECATION and forwards to proxy', async () => {
    await writeStep2Receipts();
    const logs: string[] = [];
    const forwarderResp = { proxied: true };
    const out = await runRecommendRolloutStrategyAlias(
      { featureDescription: 'x' },
      {
        cwd: tmpDir,
        log: (m) => logs.push(m),
        forwarder: async () => forwarderResp,
      }
    );
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('DEPRECATION');
    expect(logs[0]).toContain('recommend_rollout_strategy');
    expect(out).toBe(forwarderResp);
  });

  test('increments usage counter when guard passes', async () => {
    await writeStep2Receipts();
    const counts: string[] = [];
    await runRecommendRolloutStrategyAlias(
      {},
      {
        cwd: tmpDir,
        log: () => {},
        forwarder: async () => ({}),
        incrementUsage: (n) => counts.push(n),
      }
    );
    expect(counts).toEqual(['recommend_rollout_strategy']);
  });

  test('does NOT increment usage counter when guard refuses', async () => {
    const counts: string[] = [];
    await runRecommendRolloutStrategyAlias(
      {},
      {
        cwd: tmpDir,
        log: () => {},
        forwarder: async () => ({}),
        incrementUsage: (n) => counts.push(n),
      }
    );
    expect(counts).toEqual([]);
  });

  test('default forwarder returns NOT_YET_MIGRATED envelope', async () => {
    const out = (await defaultRecommendRolloutStrategyForwarder({})) as {
      error: { code: string };
    };
    expect(out.error.code).toBe('NOT_YET_MIGRATED');
  });
});
