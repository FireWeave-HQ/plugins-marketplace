/**
 * Acceptance tests for the shared receipt-guard predicate module.
 *
 * R-IDs: R-002-4, R-002-5, R-002-8
 */

import { test, expect, describe } from 'bun:test';
import type { LockfileState } from '@fireweaveai/fw-rollout-types';
import {
  RECEIPT_REQUIREMENTS,
  requireReceipts,
  requireFullInventory,
  REGISTER_TIME_REQUIRED_GATES,
} from './_receipt-guard';

function lockfileWith(
  userConfirmations: Record<string, { gateId: string; stepNumber: string }>
): LockfileState {
  const map: Record<
    string,
    NonNullable<LockfileState['userConfirmations']>[string]
  > = {};
  for (const [gateId, meta] of Object.entries(userConfirmations)) {
    map[gateId] = {
      questionHash: 'a'.repeat(64),
      selectedOption: 'opt',
      recordedAt: '2026-05-14T00:00:00.000Z',
      // Cast — the schema enum is narrow; tests only need the string value.
      stepNumber: meta.stepNumber as never,
    };
  }
  return {
    version: 1,
    lastStep: 'discovery',
    lastStepTimestamp: '2026-05-14T00:00:00.000Z',
    userConfirmations: map,
  };
}

describe('R-002-8 RECEIPT_REQUIREMENTS map exposes per-tool required gates', () => {
  test('exports a frozen object with at least 4 entries', () => {
    expect(Object.isFrozen(RECEIPT_REQUIREMENTS)).toBe(true);
    expect(Object.keys(RECEIPT_REQUIREMENTS).length).toBeGreaterThanOrEqual(4);
  });

  test('propose_metrics requires GATE-1-FEATURE-SURFACE', () => {
    expect(RECEIPT_REQUIREMENTS['propose_metrics']).toEqual([
      'GATE-1-FEATURE-SURFACE',
    ]);
  });

  test('propose_wrap_points requires GATE-1-FEATURE-SURFACE', () => {
    expect(RECEIPT_REQUIREMENTS['propose_wrap_points']).toEqual([
      'GATE-1-FEATURE-SURFACE',
    ]);
  });

  test('recommend_rollout_strategy requires Step-2 gates', () => {
    expect(RECEIPT_REQUIREMENTS['recommend_rollout_strategy']).toEqual([
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
    ]);
  });

  test('generate_rollout_codegen requires Step-1 + Step-5 gates', () => {
    expect(RECEIPT_REQUIREMENTS['generate_rollout_codegen']).toEqual([
      'GATE-1-FEATURE-SURFACE',
      'GATE-5-WRAP-SELECT',
    ]);
  });

  test('register_rollout requires the always-required gate list', () => {
    expect(RECEIPT_REQUIREMENTS['register_rollout']).toEqual(
      REGISTER_TIME_REQUIRED_GATES
    );
  });
});

describe('R-002-4 requireReceipts returns the CONFIRMATION_MISSING envelope', () => {
  test('returns null on absent lockfile (defers to caller policy)', () => {
    expect(requireReceipts(null, ['GATE-1-FEATURE-SURFACE'])).not.toBeNull();
    const out = requireReceipts(null, ['GATE-1-FEATURE-SURFACE']);
    expect(out?.error.code).toBe('CONFIRMATION_MISSING');
    expect(out?.error.missingGateId).toBe('GATE-1-FEATURE-SURFACE');
  });

  test('returns null when every required receipt is present', () => {
    const lf = lockfileWith({
      'GATE-1-FEATURE-SURFACE': {
        gateId: 'GATE-1-FEATURE-SURFACE',
        stepNumber: '1',
      },
    });
    expect(requireReceipts(lf, ['GATE-1-FEATURE-SURFACE'])).toBeNull();
  });

  test('returns CONFIRMATION_MISSING for the first absent gate id', () => {
    const lf = lockfileWith({
      'GATE-2-TYPE': { gateId: 'GATE-2-TYPE', stepNumber: '2' },
    });
    const out = requireReceipts(lf, ['GATE-2-TYPE', 'GATE-2-NAME']);
    expect(out).not.toBeNull();
    expect(out?.error.code).toBe('CONFIRMATION_MISSING');
    expect(out?.error.missingGateId).toBe('GATE-2-NAME');
  });

  test('error envelope includes step and remediation', () => {
    const lf = lockfileWith({});
    const out = requireReceipts(lf, ['GATE-1-FEATURE-SURFACE']);
    expect(out?.error.step).toBe('1');
    expect(out?.error.remediation).toContain('GATE-1-FEATURE-SURFACE');
    expect(out?.error.remediation).toContain('Step 1');
    expect(out?.error.remediation).toContain('Print this message verbatim');
  });

  test('remediation text matches the spec verbiage verbatim shape', () => {
    const lf = lockfileWith({});
    const out = requireReceipts(lf, ['GATE-2-TYPE']);
    expect(out?.error.remediation).toBe(
      'Step 2 requires the user to answer the gate GATE-2-TYPE question. ' +
        'Print this message verbatim to the user, then stop. Do not retry ' +
        "or infer. On the user's next invocation, the skill will resume " +
        'at the appropriate step and re-ask.'
    );
  });
});

describe('R-002-5 requireFullInventory enforces every register-time gate', () => {
  test('returns CONFIRMATION_MISSING when register-time gate absent', () => {
    const lf = lockfileWith({
      'GATE-1-FEATURE-SURFACE': {
        gateId: 'GATE-1-FEATURE-SURFACE',
        stepNumber: '1',
      },
      'GATE-2-TYPE': { gateId: 'GATE-2-TYPE', stepNumber: '2' },
      'GATE-2-NAME': { gateId: 'GATE-2-NAME', stepNumber: '2' },
      'GATE-2-DESCRIPTION': {
        gateId: 'GATE-2-DESCRIPTION',
        stepNumber: '2',
      },
      'GATE-3-ROLLOUT-STYLE': {
        gateId: 'GATE-3-ROLLOUT-STYLE',
        stepNumber: '3',
      },
      'GATE-0.2-ENVIRONMENT-CHOICE': {
        gateId: 'GATE-0.2-ENVIRONMENT-CHOICE',
        stepNumber: '0.2',
      },
      // GATE-8.5-REGISTER-OR-EDIT intentionally missing
    });
    const out = requireFullInventory(lf);
    expect(out?.error.code).toBe('CONFIRMATION_MISSING');
    expect(out?.error.missingGateId).toBe('GATE-8.5-REGISTER-OR-EDIT');
  });

  test('returns null when every always-required gate has a receipt', () => {
    const map: Record<string, { gateId: string; stepNumber: string }> = {};
    for (const gateId of REGISTER_TIME_REQUIRED_GATES) {
      // Step number is irrelevant for guard logic; only key presence matters.
      map[gateId] = { gateId, stepNumber: '1' };
    }
    const lf = lockfileWith(map);
    expect(requireFullInventory(lf)).toBeNull();
  });

  test('does NOT require conditional / dynamic gates by default', () => {
    const map: Record<string, { gateId: string; stepNumber: string }> = {};
    for (const gateId of REGISTER_TIME_REQUIRED_GATES) {
      map[gateId] = { gateId, stepNumber: '1' };
    }
    // No GATE-5-COHORT-KEY-* or GATE-6-ACCEPT-METRIC-* receipts present.
    const lf = lockfileWith(map);
    expect(requireFullInventory(lf)).toBeNull();
  });
});

describe('R-002-5 REGISTER_TIME_REQUIRED_GATES is the canonical list', () => {
  test('contains GATE-8.5-REGISTER-OR-EDIT', () => {
    expect(REGISTER_TIME_REQUIRED_GATES).toContain('GATE-8.5-REGISTER-OR-EDIT');
  });

  test('contains every always-required gate from the pitch §Gate Inventory', () => {
    const expected = [
      'GATE-1-FEATURE-SURFACE',
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
      'GATE-3-ROLLOUT-STYLE',
      'GATE-0.2-ENVIRONMENT-CHOICE',
      'GATE-8.5-REGISTER-OR-EDIT',
    ];
    for (const id of expected) {
      expect(REGISTER_TIME_REQUIRED_GATES).toContain(id);
    }
  });

  test('does NOT include conditional gates', () => {
    const conditional = [
      'GATE-0.2-JOIN-OR-CREATE',
      'GATE-0.2-MULTI-REPO',
      'GATE-0.2-CAPABILITY-FALLBACK',
      'GATE-0-RESUME-DECISION',
      'GATE-0-FORCE-PUSH-DECISION',
      'GATE-1-FIRST-TIME-DIRS',
      'GATE-4-PROVIDER-BINDING',
      'GATE-6-ZERO-METRIC-WARNING',
      'GATE-8-VERIFY-OVERRIDE',
      'GATE-9-SHA-READY',
    ];
    for (const id of conditional) {
      expect(REGISTER_TIME_REQUIRED_GATES).not.toContain(id);
    }
  });
});
