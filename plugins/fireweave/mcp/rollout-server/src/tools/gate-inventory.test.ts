/**
 * Acceptance tests for the GATE_INVENTORY canonical gate list.
 *
 * R-IDs: R-001-3
 */

import { test, expect, describe } from 'bun:test';
import { GATE_INVENTORY, type GateInventoryEntry } from './gate-inventory';

describe('R-001-3 GATE_INVENTORY enumerates every gate', () => {
  test('is a frozen array of length >= 17', () => {
    expect(Array.isArray(GATE_INVENTORY)).toBe(true);
    expect(GATE_INVENTORY.length).toBeGreaterThanOrEqual(17);
    expect(Object.isFrozen(GATE_INVENTORY)).toBe(true);
  });

  test('every entry has { gateId, stepNumber, canonicalQuestion } shape', () => {
    for (const entry of GATE_INVENTORY) {
      expect(typeof entry.gateId).toBe('string');
      expect(entry.gateId.length).toBeGreaterThan(0);
      expect(typeof entry.stepNumber).toBe('string');
      expect(entry.stepNumber.length).toBeGreaterThan(0);
      expect(typeof entry.canonicalQuestion).toBe('string');
      expect(entry.canonicalQuestion.length).toBeGreaterThan(0);
    }
  });

  test('covers every required step number', () => {
    const stepsSeen = new Set(GATE_INVENTORY.map((g) => g.stepNumber));
    const requiredSteps = [
      '0',
      '0.2',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '8',
      '8.5',
      '9',
    ];
    for (const step of requiredSteps) {
      expect(stepsSeen.has(step)).toBe(true);
    }
  });

  test('exposes the 17 canonical gate IDs from Technical Reference §Gate Inventory', () => {
    const ids = new Set(GATE_INVENTORY.map((g) => g.gateId));
    const expected = [
      'GATE-0-RESUME-DECISION',
      'GATE-0-FORCE-PUSH-DECISION',
      'GATE-0.2-JOIN-OR-CREATE',
      'GATE-0.2-MULTI-REPO',
      'GATE-0.2-CAPABILITY-FALLBACK',
      'GATE-0.2-ENVIRONMENT-CHOICE',
      'GATE-1-FEATURE-SURFACE',
      'GATE-1-FIRST-TIME-DIRS',
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
      'GATE-3-ROLLOUT-STYLE',
      'GATE-4-PROVIDER-BINDING',
      'GATE-5-WRAP-SELECT',
      'GATE-6-ZERO-METRIC-WARNING',
      'GATE-8-VERIFY-OVERRIDE',
      'GATE-8.5-REGISTER-OR-EDIT',
      'GATE-9-SHA-READY',
    ];
    for (const gateId of expected) {
      expect(ids.has(gateId)).toBe(true);
    }
  });

  test('gate IDs are unique', () => {
    const ids = GATE_INVENTORY.map((g) => g.gateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('does NOT include the dynamic-suffix conditional gates (runtime-generated)', () => {
    const ids = new Set(GATE_INVENTORY.map((g) => g.gateId));
    // These are generated per wrap-point / per metric at runtime, so they
    // must not appear as static entries.
    for (const id of ids) {
      expect(id.startsWith('GATE-5-COHORT-KEY-')).toBe(false);
      expect(id.startsWith('GATE-6-ACCEPT-METRIC-')).toBe(false);
    }
  });

  test('GateInventoryEntry typing is structurally accessible', () => {
    // Compile-time check: assignment to GateInventoryEntry interface succeeds.
    const first = GATE_INVENTORY[0];
    expect(first).toBeDefined();
    if (first) {
      const sample: GateInventoryEntry = first;
      expect(sample.gateId).toBeDefined();
    }
  });
});
