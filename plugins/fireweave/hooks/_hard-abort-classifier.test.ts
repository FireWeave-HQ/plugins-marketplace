/**
 * Acceptance tests for the Spike A hard-abort classifier.
 *
 * R-IDs: R-005-8
 *
 * The classifier maps an (askUserQuestionResult, lockfile) pair onto one of
 * three labels — `model_skip`, `user_cancel`, `transport_error` — per the
 * decision table documented in
 * `.binaryos/build-state/026-safe-rollout-confirmation-enforcement/spike-hard-abort-ux.md`.
 */

import { describe, expect, test } from 'bun:test';
import {
  classifyAbortEvent,
  type AbortEventInput,
} from './_hard-abort-classifier';

describe('R-005-8 classifyAbortEvent deterministic decision table', () => {
  test('F1 — transport failure during prior turn → transport_error', () => {
    const input: AbortEventInput = {
      askUserQuestionResult: null,
      lockfile: {
        lastConfigFailure: {
          failedToolId: 'register_rollout',
          failureClass: 'server_5xx',
          failedAt: '2026-05-14T00:00:00.000Z',
          remediation: 'Cloud returned 503; retry once healthy.',
        },
      },
    };
    expect(classifyAbortEvent(input)).toBe('transport_error');
  });

  test('F2 — explicit user cancel → user_cancel', () => {
    const input: AbortEventInput = {
      askUserQuestionResult: { userCancelled: true },
      lockfile: { userConfirmations: {} },
    };
    expect(classifyAbortEvent(input)).toBe('user_cancel');
  });

  test('F3 — model skip with predecessor receipts intact → model_skip', () => {
    const input: AbortEventInput = {
      askUserQuestionResult: null,
      lockfile: {
        userConfirmations: {
          'GATE-1-FEATURE-SURFACE': {
            questionHash: 'a'.repeat(64),
            selectedOption: 'Diff since last Fireweave rollout commit',
            recordedAt: '2026-05-14T00:00:00.000Z',
            stepNumber: '1',
          },
        },
      },
    };
    expect(classifyAbortEvent(input)).toBe('model_skip');
  });

  test('F4 — fully empty lockfile (default branch) → model_skip', () => {
    const input: AbortEventInput = {
      askUserQuestionResult: null,
      lockfile: {},
    };
    expect(classifyAbortEvent(input)).toBe('model_skip');
  });

  test('F5 — userCancelled wins over lastConfigFailure', () => {
    const input: AbortEventInput = {
      askUserQuestionResult: { userCancelled: true },
      lockfile: {
        lastConfigFailure: {
          failedToolId: 'tag_baseline_commit',
          failureClass: 'network',
          failedAt: '2026-05-14T00:00:00.000Z',
          remediation: 'Network timeout; retry.',
        },
      },
    };
    expect(classifyAbortEvent(input)).toBe('user_cancel');
  });

  test('returns one of the three documented labels for every fixture', () => {
    const validLabels = new Set([
      'model_skip',
      'user_cancel',
      'transport_error',
    ]);
    const inputs: AbortEventInput[] = [
      { askUserQuestionResult: null, lockfile: {} },
      { askUserQuestionResult: { userCancelled: true }, lockfile: {} },
      {
        askUserQuestionResult: null,
        lockfile: {
          lastConfigFailure: {
            failedToolId: 't',
            failureClass: 'timeout',
            failedAt: 'x',
            remediation: 'r',
          },
        },
      },
    ];
    for (const input of inputs) {
      expect(validLabels.has(classifyAbortEvent(input))).toBe(true);
    }
  });
});
