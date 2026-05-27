/**
 * Question-hash function for confirmation receipts.
 *
 * `computeQuestionHash` produces a 64-char hex SHA-256 of a gate's
 * canonical question + answer-options. The skill writes this hash
 * alongside each confirmation receipt; the Step 0 resume guard
 * re-computes it on every invocation and treats a mismatch as a STALE
 * receipt — the gate is re-asked rather than silently honoured.
 *
 * Determinism contract (per pitch 026 Technical Reference):
 *   - Whitespace on `gateId`, `questionText`, and every entry of
 *     `optionsSorted` is trimmed before hashing.
 *   - `optionsSorted` is sorted ascending before being joined, so input
 *     order does not affect the hash.
 *   - The wire format is `${gateId}|${trimmedQuestion}|${sortedOptions.join('||')}`
 *     before SHA-256.
 *
 * Algorithm choice: `node:crypto`'s `createHash('sha256')`, used over
 * `Bun.CryptoHasher` because the surrounding rollout-server code already
 * relies on Node-API equivalents (it must remain runnable under both Bun
 * and the standard Node MCP SDK harness).
 *
 * R-IDs: R-001-5
 */

import { createHash } from 'node:crypto';

export interface ComputeQuestionHashInput {
  /** Stable gate identifier, e.g. `GATE-2-TYPE`. */
  gateId: string;
  /** The exact question shown to the user. */
  questionText: string;
  /** The answer options. Caller hint to pre-sort; we sort defensively. */
  optionsSorted: readonly string[];
}

export function computeQuestionHash(input: ComputeQuestionHashInput): string {
  const gateId = input.gateId.trim();
  const questionText = input.questionText.trim();
  const sortedOptions = input.optionsSorted
    .map((opt) => opt.trim())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const payload = `${gateId}|${questionText}|${sortedOptions.join('||')}`;
  return createHash('sha256').update(payload).digest('hex');
}
