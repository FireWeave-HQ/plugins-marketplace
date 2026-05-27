/**
 * Shared receipt-guard predicate.
 *
 * Downstream MCP tools call `requireReceipts(lockfile, [gateIds])` at the top
 * of their handler. If any required receipt is absent, the guard returns the
 * canonical `CONFIRMATION_MISSING` error envelope; the caller short-circuits
 * with that envelope as its own response — no state mutation, no upstream
 * call. The skill's universal rules instruct it to print the embedded
 * remediation verbatim and stop.
 *
 * `requireFullInventory` is the register-time variant — used by the
 * `register_rollout` Wave A alias (Scope 004) to verify every always-required
 * gate has a receipt before forwarding to the cloud-side tool.
 *
 * Source of truth for required gates per tool: pitch 026 §Scope 002.
 *
 * R-IDs: R-002-4, R-002-5, R-002-8
 */

import type { LockfileState } from '@fireweaveai/fw-rollout-types';

/**
 * Always-required gates at register time. Conditional gates
 * (`GATE-4-PROVIDER-BINDING`, `GATE-6-ZERO-METRIC-WARNING`, …) and dynamic
 * suffix gates (`GATE-5-COHORT-KEY-*`, `GATE-6-ACCEPT-METRIC-*`) are NOT
 * included — they are only required when the corresponding condition fires
 * during the skill walk.
 */
export const REGISTER_TIME_REQUIRED_GATES: readonly string[] = Object.freeze([
  'GATE-1-FEATURE-SURFACE',
  'GATE-2-TYPE',
  'GATE-2-NAME',
  'GATE-2-DESCRIPTION',
  'GATE-3-ROLLOUT-STYLE',
  'GATE-0.2-ENVIRONMENT-CHOICE',
  'GATE-8.5-REGISTER-OR-EDIT',
]);

/**
 * Per-tool receipt requirements. Keyed by MCP tool name.
 *
 * NOTE: tool names referenced here that are NOT yet present on
 * `rollout-server` (e.g. `propose_wrap_points`, `generate_rollout_codegen`,
 * `register_rollout`) are populated here proactively so Scope 004's Wave A
 * alias can call into this guard without re-deriving the table.
 */
export const RECEIPT_REQUIREMENTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    propose_wrap_points: Object.freeze(['GATE-1-FEATURE-SURFACE']),
    propose_metrics: Object.freeze(['GATE-1-FEATURE-SURFACE']),
    generate_rollout_codegen: Object.freeze([
      'GATE-1-FEATURE-SURFACE',
      'GATE-5-WRAP-SELECT',
    ]),
    register_rollout: REGISTER_TIME_REQUIRED_GATES,
    recommend_rollout_strategy: Object.freeze([
      'GATE-2-TYPE',
      'GATE-2-NAME',
      'GATE-2-DESCRIPTION',
    ]),
  });

export interface ConfirmationMissingError {
  error: {
    code: 'CONFIRMATION_MISSING';
    missingGateId: string;
    step: string;
    remediation: string;
  };
}

/**
 * Map a gate ID back to its leading step number for error envelopes.
 * The pattern is `GATE-<step>-<rest>` where `<step>` may itself contain a
 * dot (e.g. `8.5`). We take everything between the first dash and the
 * second dash that follows the step.
 */
function stepFromGateId(gateId: string): string {
  // "GATE-8.5-REGISTER-OR-EDIT" → ["GATE", "8.5", "REGISTER", ...]
  const parts = gateId.split('-');
  return parts[1] ?? '';
}

function buildRemediation(missingGateId: string, step: string): string {
  return (
    `Step ${step} requires the user to answer the gate ${missingGateId} ` +
    `question. Print this message verbatim to the user, then stop. Do not ` +
    `retry or infer. On the user's next invocation, the skill will resume ` +
    `at the appropriate step and re-ask.`
  );
}

function makeError(missingGateId: string): ConfirmationMissingError {
  const step = stepFromGateId(missingGateId);
  return {
    error: {
      code: 'CONFIRMATION_MISSING',
      missingGateId,
      step,
      remediation: buildRemediation(missingGateId, step),
    },
  };
}

/**
 * Return `null` when every required receipt is present in
 * `lockfile.userConfirmations`. Otherwise return the canonical
 * `CONFIRMATION_MISSING` envelope keyed on the FIRST missing gate.
 *
 * `lockfile === null` is treated as "no receipts yet" — the first required
 * gate is reported missing.
 */
export function requireReceipts(
  lockfile: LockfileState | null,
  requiredGateIds: readonly string[]
): ConfirmationMissingError | null {
  const receipts = lockfile?.userConfirmations ?? {};
  for (const gateId of requiredGateIds) {
    if (!(gateId in receipts)) {
      return makeError(gateId);
    }
  }
  return null;
}

/**
 * Register-time variant — checks `REGISTER_TIME_REQUIRED_GATES`.
 */
export function requireFullInventory(
  lockfile: LockfileState | null
): ConfirmationMissingError | null {
  return requireReceipts(lockfile, REGISTER_TIME_REQUIRED_GATES);
}
