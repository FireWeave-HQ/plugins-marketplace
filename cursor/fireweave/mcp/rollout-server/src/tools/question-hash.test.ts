/**
 * Acceptance tests for `computeQuestionHash`.
 *
 * R-IDs: R-001-5
 */

import { test, expect, describe } from 'bun:test';
import { computeQuestionHash } from './question-hash';

describe('R-001-5 computeQuestionHash deterministic SHA-256', () => {
  test('returns a 64-char hex string', () => {
    const hash = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'What kind of change is this?',
      optionsSorted: ['feature', 'bugfix', 'refactor'],
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('repeated calls with identical input produce identical output', () => {
    const input = {
      gateId: 'GATE-2-TYPE',
      questionText: 'What kind of change is this?',
      optionsSorted: ['feature', 'bugfix', 'refactor'],
    };
    const a = computeQuestionHash(input);
    const b = computeQuestionHash(input);
    expect(a).toBe(b);
  });

  test('whitespace-trimmed input matches non-trimmed input with the same content', () => {
    const trimmed = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'What kind of change is this?',
      optionsSorted: ['feature', 'bugfix'],
    });
    const padded = computeQuestionHash({
      gateId: '  GATE-2-TYPE  ',
      questionText: '   What kind of change is this?\n',
      optionsSorted: ['  feature  ', '\tbugfix\t'],
    });
    expect(padded).toBe(trimmed);
  });

  test('option order does not matter (input is sorted ascending)', () => {
    const aOrder = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q',
      optionsSorted: ['alpha', 'beta', 'gamma'],
    });
    const bOrder = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q',
      optionsSorted: ['gamma', 'alpha', 'beta'],
    });
    expect(aOrder).toBe(bOrder);
  });

  test('different question text yields different hash', () => {
    const a = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q1',
      optionsSorted: ['x'],
    });
    const b = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q2',
      optionsSorted: ['x'],
    });
    expect(a).not.toBe(b);
  });

  test('different gate ID yields different hash', () => {
    const a = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q',
      optionsSorted: ['x'],
    });
    const b = computeQuestionHash({
      gateId: 'GATE-3-ROLLOUT-STYLE',
      questionText: 'q',
      optionsSorted: ['x'],
    });
    expect(a).not.toBe(b);
  });

  test('different option set yields different hash', () => {
    const a = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q',
      optionsSorted: ['x'],
    });
    const b = computeQuestionHash({
      gateId: 'GATE-2-TYPE',
      questionText: 'q',
      optionsSorted: ['x', 'y'],
    });
    expect(a).not.toBe(b);
  });

  test('empty options list still produces a valid hash', () => {
    const hash = computeQuestionHash({
      gateId: 'GATE-9-SHA-READY',
      questionText: 'Ready to register?',
      optionsSorted: [],
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
