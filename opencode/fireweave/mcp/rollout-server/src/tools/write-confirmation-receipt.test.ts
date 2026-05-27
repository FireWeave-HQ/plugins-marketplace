/**
 * Acceptance tests for `write_confirmation_receipt`.
 *
 * R-IDs: R-002-1, R-002-2
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeConfirmationReceipt,
  type WriteConfirmationReceiptInput,
} from './write-confirmation-receipt';
import { readLockfile, writeLockfile } from './lockfile';
import type { LockfileState } from '@fireweaveai/fw-rollout-types';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'fw-receipt-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const BASE_INPUT: WriteConfirmationReceiptInput = {
  gateId: 'GATE-2-TYPE',
  questionHash: 'a'.repeat(64),
  selectedOption: 'feature',
  stepNumber: '2',
};

describe('R-002-1 write_confirmation_receipt persists receipts atomically', () => {
  test('returns { written: true } on first write', async () => {
    const result = await writeConfirmationReceipt(BASE_INPUT, tmpDir);
    expect(result).toEqual({ written: true });
  });

  test('writes the receipt into lockfile.userConfirmations[gateId]', async () => {
    await writeConfirmationReceipt(BASE_INPUT, tmpDir);
    const lf = await readLockfile(tmpDir);
    expect(lf?.userConfirmations).toBeDefined();
    expect(lf!.userConfirmations!['GATE-2-TYPE']).toBeDefined();
    expect(lf!.userConfirmations!['GATE-2-TYPE']!.selectedOption).toBe(
      'feature'
    );
    expect(lf!.userConfirmations!['GATE-2-TYPE']!.questionHash).toBe(
      'a'.repeat(64)
    );
    expect(lf!.userConfirmations!['GATE-2-TYPE']!.stepNumber).toBe('2');
  });

  test('auto-sets recordedAt to the current time (ISO 8601)', async () => {
    const before = new Date().toISOString();
    await writeConfirmationReceipt(BASE_INPUT, tmpDir);
    const after = new Date().toISOString();
    const lf = await readLockfile(tmpDir);
    const recorded = lf!.userConfirmations!['GATE-2-TYPE']!.recordedAt;
    expect(recorded >= before).toBe(true);
    expect(recorded <= after).toBe(true);
  });

  test('initializes a minimal lockfile when none exists', async () => {
    // No prior writeLockfile call — the receipt tool must be defensive.
    await writeConfirmationReceipt(BASE_INPUT, tmpDir);
    const lf = await readLockfile(tmpDir);
    expect(lf).not.toBeNull();
    expect(lf?.version).toBe(1);
    expect(lf?.lastStep).toBe('discovery');
    expect(lf?.userConfirmations?.['GATE-2-TYPE']).toBeDefined();
  });

  test('preserves existing lockfile fields when merging', async () => {
    const initial: LockfileState = {
      version: 1,
      lastStep: 'codegen',
      lastStepTimestamp: '2026-05-14T00:00:00.000Z',
      rolloutId: 'roll_abc',
      workingSpec: { feature: { name: 'dark-mode' } },
    };
    await writeLockfile(initial, tmpDir);
    await writeConfirmationReceipt(BASE_INPUT, tmpDir);
    const lf = await readLockfile(tmpDir);
    expect(lf?.lastStep).toBe('codegen');
    expect(lf?.rolloutId).toBe('roll_abc');
    expect(lf?.workingSpec).toEqual({ feature: { name: 'dark-mode' } });
    expect(lf?.userConfirmations?.['GATE-2-TYPE']).toBeDefined();
  });

  test('second invocation with same gateId overwrites the prior receipt', async () => {
    await writeConfirmationReceipt(
      { ...BASE_INPUT, selectedOption: 'feature' },
      tmpDir
    );
    await writeConfirmationReceipt(
      { ...BASE_INPUT, selectedOption: 'bug-fix' },
      tmpDir
    );
    const lf = await readLockfile(tmpDir);
    const receipts = lf!.userConfirmations!;
    expect(Object.keys(receipts)).toHaveLength(1);
    expect(receipts['GATE-2-TYPE']!.selectedOption).toBe('bug-fix');
  });

  test('accumulates multiple receipts for different gate IDs', async () => {
    await writeConfirmationReceipt(BASE_INPUT, tmpDir);
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-NAME',
        questionHash: 'b'.repeat(64),
        selectedOption: 'dark-mode',
        stepNumber: '2',
      },
      tmpDir
    );
    const lf = await readLockfile(tmpDir);
    expect(Object.keys(lf!.userConfirmations!)).toHaveLength(2);
    expect(lf!.userConfirmations!['GATE-2-TYPE']).toBeDefined();
    expect(lf!.userConfirmations!['GATE-2-NAME']).toBeDefined();
  });

  test('persists selectedNotes when provided', async () => {
    await writeConfirmationReceipt(
      { ...BASE_INPUT, selectedNotes: 'user picked feature; rationale x' },
      tmpDir
    );
    const lf = await readLockfile(tmpDir);
    expect(lf!.userConfirmations!['GATE-2-TYPE']!.selectedNotes).toBe(
      'user picked feature; rationale x'
    );
  });
});

describe('R-002-2 write_confirmation_receipt rejects unknown gate IDs', () => {
  test('returns INVALID_GATE_ID error for unknown gate', async () => {
    const result = await writeConfirmationReceipt(
      { ...BASE_INPUT, gateId: 'GATE-NONEXISTENT' },
      tmpDir
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.code).toBe('INVALID_GATE_ID');
      expect(result.error.message).toBeDefined();
    }
  });

  test('lockfile unchanged on unknown gate id', async () => {
    const initial: LockfileState = {
      version: 1,
      lastStep: 'codegen',
      lastStepTimestamp: '2026-05-14T00:00:00.000Z',
      rolloutId: 'roll_xyz',
    };
    await writeLockfile(initial, tmpDir);
    await writeConfirmationReceipt(
      { ...BASE_INPUT, gateId: 'GATE-FAKE' },
      tmpDir
    );
    const lf = await readLockfile(tmpDir);
    expect(lf?.rolloutId).toBe('roll_xyz');
    expect(lf?.userConfirmations).toBeUndefined();
  });

  test('accepts all known static gate IDs from GATE_INVENTORY', async () => {
    const knownGates = [
      'GATE-0-RESUME-DECISION',
      'GATE-0.2-ENVIRONMENT-CHOICE',
      'GATE-1-FEATURE-SURFACE',
      'GATE-8.5-REGISTER-OR-EDIT',
    ];
    for (const gateId of knownGates) {
      const stepNumber = gateId.split('-')[1] as '0' | '0.2' | '1' | '8.5';
      const r = await writeConfirmationReceipt(
        { ...BASE_INPUT, gateId, stepNumber },
        tmpDir
      );
      expect('written' in r && r.written).toBe(true);
    }
  });

  test('accepts dynamic GATE-5-COHORT-KEY-* gate IDs', async () => {
    const r = await writeConfirmationReceipt(
      {
        gateId: 'GATE-5-COHORT-KEY-checkout-button',
        questionHash: 'c'.repeat(64),
        selectedOption: 'user.id',
        stepNumber: '5',
      },
      tmpDir
    );
    expect('written' in r && r.written).toBe(true);
  });

  test('accepts dynamic GATE-6-ACCEPT-METRIC-* gate IDs', async () => {
    const r = await writeConfirmationReceipt(
      {
        gateId: 'GATE-6-ACCEPT-METRIC-error-rate',
        questionHash: 'd'.repeat(64),
        selectedOption: 'yes',
        stepNumber: '6',
      },
      tmpDir
    );
    expect('written' in r && r.written).toBe(true);
  });

  test('rejects empty dynamic suffix (no symbol after prefix)', async () => {
    // `GATE-5-COHORT-KEY-` with nothing after is malformed.
    const r = await writeConfirmationReceipt(
      {
        gateId: 'GATE-5-COHORT-KEY-',
        questionHash: 'd'.repeat(64),
        selectedOption: 'x',
        stepNumber: '5',
      },
      tmpDir
    );
    expect('error' in r).toBe(true);
  });
});
