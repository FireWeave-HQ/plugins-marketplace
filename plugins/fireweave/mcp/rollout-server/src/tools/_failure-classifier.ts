/**
 * Pure failure classifier — maps the raw observation of a dispatched tool
 * call to one of the eight canonical failure classes (plus `'ok'` for a
 * non-failure outcome).
 *
 * Decision table (precedence — first match wins, per pitch 026
 * Technical Reference §Tool-Failure Classification Table):
 *
 *   1. `toolFound === false`       → 'tool_not_found'
 *   2. `timedOut === true`         → 'timeout'
 *   3. `error.message` matches the network pattern → 'network'
 *   4. `httpStatus` in 400-499     → 'client_4xx'
 *   5. `httpStatus` in 500-599     → 'server_5xx'
 *   6. `schemaValid === false`     → 'schema_drift'
 *   7. otherwise                   → 'ok'
 *
 * `config_tool_failure`, `confirmation_missing`, and `manifest_mismatch`
 * are NOT primary classifier outputs — they are synthesized by the caller
 * (`guarded_call` wraps to `config_tool_failure` when the configuration
 * flag is set; receipts/manifest paths emit the other two).
 *
 * Determinism: this function is referentially transparent. It reads no
 * clocks, no random sources, no global mutable state — and never mutates
 * its input. R-003-6 asserts this via a 100x identical-input check.
 *
 * R-IDs: R-003-2, R-003-3, R-003-4, R-003-6
 */

import type { FailureClass } from '@fireweaveai/fw-rollout-types';

/**
 * The wider classifier result — superset of `FailureClass` with `'ok'`
 * representing the non-failure outcome. `'ok'` is intentionally NOT in the
 * `FailureClass` enum (which is the failure-only union persisted to the
 * lockfile).
 */
export type ClassifierResult = FailureClass | 'ok';

export interface ClassifierInput {
  /** Dispatcher's returned value (if no throw). */
  result?: unknown;
  /** Dispatcher's thrown error, if any. */
  error?: Error;
  /** HTTP status extracted by the dispatcher when applicable. */
  httpStatus?: number;
  /** Dispatcher-signalled timeout. */
  timedOut?: boolean;
  /** Schema-check outcome (set by the caller, not the classifier). */
  schemaValid?: boolean;
  /** Dispatcher signal — the tool name was/wasn't found in the dispatch table. */
  toolFound?: boolean;
}

const NETWORK_PATTERN =
  /^(?:fetch failed|getaddrinfo ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network)/i;

export function classifyResponse(input: ClassifierInput): ClassifierResult {
  if (input.toolFound === false) return 'tool_not_found';
  if (input.timedOut === true) return 'timeout';
  if (input.error && NETWORK_PATTERN.test(input.error.message))
    return 'network';
  if (typeof input.httpStatus === 'number') {
    if (input.httpStatus >= 400 && input.httpStatus < 500) return 'client_4xx';
    if (input.httpStatus >= 500 && input.httpStatus < 600) return 'server_5xx';
  }
  if (input.schemaValid === false) return 'schema_drift';
  return 'ok';
}
