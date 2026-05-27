/**
 * Acceptance tests for `read_confirmation_receipts`.
 *
 * R-IDs: R-002-3, R-002-6
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConfirmationReceipts } from './read-confirmation-receipts';
import { writeConfirmationReceipt } from './write-confirmation-receipt';
import { writeLockfile } from './lockfile';
import { computeQuestionHash } from './question-hash';
import { GATE_INVENTORY } from './gate-inventory';
import type { LockfileState } from '@fireweaveai/fw-rollout-types';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'fw-readreceipts-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('R-002-3 read_confirmation_receipts returns the userConfirmations map', () => {
  test('returns empty receipts on absent lockfile', async () => {
    const result = await readConfirmationReceipts({}, tmpDir);
    expect(result.receipts).toEqual({});
  });

  test('returns empty receipts when lockfile has no userConfirmations field', async () => {
    const lf: LockfileState = {
      version: 1,
      lastStep: 'discovery',
      lastStepTimestamp: '2026-05-14T00:00:00.000Z',
    };
    await writeLockfile(lf, tmpDir);
    const result = await readConfirmationReceipts({}, tmpDir);
    expect(result.receipts).toEqual({});
  });

  test('returns all 3 receipts when 3 have been written', async () => {
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-1-FEATURE-SURFACE',
        questionHash: 'a'.repeat(64),
        selectedOption: 'diff',
        stepNumber: '1',
      },
      tmpDir
    );
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-TYPE',
        questionHash: 'b'.repeat(64),
        selectedOption: 'feature',
        stepNumber: '2',
      },
      tmpDir
    );
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-NAME',
        questionHash: 'c'.repeat(64),
        selectedOption: 'dark-mode',
        stepNumber: '2',
      },
      tmpDir
    );

    const result = await readConfirmationReceipts({}, tmpDir);
    expect(Object.keys(result.receipts)).toHaveLength(3);
    expect(result.receipts['GATE-1-FEATURE-SURFACE']).toBeDefined();
    expect(result.receipts['GATE-2-TYPE']).toBeDefined();
    expect(result.receipts['GATE-2-NAME']).toBeDefined();
  });
});

describe('R-002-6 read_confirmation_receipts stale annotation on hash mismatch', () => {
  test('marks receipt stale when stored hash differs from GATE_INVENTORY recompute', async () => {
    // Write a receipt with a deliberately wrong hash.
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-TYPE',
        questionHash: 'wrong-hash-' + 'x'.repeat(50),
        selectedOption: 'feature',
        stepNumber: '2',
      },
      tmpDir
    );

    const result = await readConfirmationReceipts(
      { checkAgainst: GATE_INVENTORY },
      tmpDir
    );

    const receipt = result.receipts['GATE-2-TYPE'];
    expect(receipt).toBeDefined();
    expect(receipt!.stale).toBe(true);
  });

  test('omits stale annotation (or sets false) when hash matches', async () => {
    const gate = GATE_INVENTORY.find((g) => g.gateId === 'GATE-2-TYPE')!;
    const correctHash = computeQuestionHash({
      gateId: gate.gateId,
      questionText: gate.canonicalQuestion,
      optionsSorted: [],
    });
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-TYPE',
        questionHash: correctHash,
        selectedOption: 'feature',
        stepNumber: '2',
      },
      tmpDir
    );

    const result = await readConfirmationReceipts(
      { checkAgainst: GATE_INVENTORY },
      tmpDir
    );

    const receipt = result.receipts['GATE-2-TYPE'];
    expect(receipt).toBeDefined();
    expect(receipt!.stale === true).toBe(false);
  });

  test('without checkAgainst, never annotates stale', async () => {
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-2-TYPE',
        questionHash: 'whatever-hash-doesnt-matter-here',
        selectedOption: 'feature',
        stepNumber: '2',
      },
      tmpDir
    );
    const result = await readConfirmationReceipts({}, tmpDir);
    const receipt = result.receipts['GATE-2-TYPE'];
    expect(receipt).toBeDefined();
    expect(receipt!.stale).toBeUndefined();
  });

  test('staleness check skips receipts whose gateId is not in checkAgainst', async () => {
    await writeConfirmationReceipt(
      {
        gateId: 'GATE-5-COHORT-KEY-checkout',
        questionHash: 'h'.repeat(64),
        selectedOption: 'user.id',
        stepNumber: '5',
      },
      tmpDir
    );
    const result = await readConfirmationReceipts(
      { checkAgainst: GATE_INVENTORY },
      tmpDir
    );
    const receipt = result.receipts['GATE-5-COHORT-KEY-checkout'];
    expect(receipt).toBeDefined();
    // Dynamic gate not in the static inventory — no stale annotation.
    expect(receipt!.stale).toBeUndefined();
  });
});
