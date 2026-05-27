/**
 * Spike B output — policy table consumed by `guarded_call`.
 *
 * Maps every `(failureClass, isConfigurationStep)` cell to a
 * `{ retryBudget, remediation }` entry. The remediation strings are
 * verbatim from pitch 026 §Tool-Failure Classification Table.
 *
 * Spike B (`spike-tool-failure-policy.md`) explains how this table was
 * chosen and the assumption set it rests on: in absence of empirical
 * cloud-failure-rate data, every `retryBudget` is `0` for v1 (hard-abort
 * discipline). Retry plumbing exists in `guarded_call` but is disabled by
 * policy until 30 days of telemetry are available.
 *
 * R-IDs: R-003-8, R-003-10
 */

import type { ClassifierResult } from './_failure-classifier';

/**
 * The full universe of policy cells covers the classifier's seven primary
 * outputs plus three derived/synthesised classes (`config_tool_failure`,
 * `confirmation_missing`, `manifest_mismatch`) — 10 classes total. The
 * classifier itself only ever returns `ClassifierResult`; the wider union
 * exists so the policy table is a single complete lookup surface.
 */
export type PolicyClass = ClassifierResult | 'confirmation_missing';

export interface PolicyCell {
  readonly retryBudget: number;
  readonly remediation: string;
}

/**
 * Remediation strings are kept under their own constants so the table
 * stays readable. The `config_tool_failure` variant appends the
 * half-state warning per the pitch's `config_tool_failure` row.
 */
const REM_OK = 'proceed';

const REM_NETWORK =
  'The MCP server could not be reached. Check your network connection to ' +
  '`${server_url}`, restart `fireweave-server-proxy` if cloud-routed, or ' +
  'escalate to the platform team. Run `/fireweave:safe-rollout` again once ' +
  'connectivity is restored.';

const REM_TIMEOUT =
  'The MCP server did not respond within 30 seconds. Check status at ' +
  'status.fireweave.cloud (if cloud-routed) or restart the local MCP ' +
  'server. Run `/fireweave:safe-rollout` again once the server is responsive.';

const REM_CLIENT_4XX =
  'The MCP server rejected the request with HTTP ${status}: ${body}. Run ' +
  '`fw doctor` to diagnose auth/permission issues, then ' +
  '`/fireweave:safe-rollout` again.';

const REM_SERVER_5XX =
  'The Fireweave cloud MCP returned HTTP ${status}. Check ' +
  'status.fireweave.cloud, retry `/fireweave:safe-rollout` once the cloud ' +
  'is healthy, or escalate to your platform team.';

const REM_SCHEMA_DRIFT =
  'The MCP server returned a response shape this skill version does not ' +
  'understand. The cloud may be ahead of your skill. Run `fw doctor` and ' +
  'update the skill, or escalate.';

const REM_TOOL_NOT_FOUND =
  'The MCP server does not register the tool `${toolName}`. The skill ' +
  'expected it on `${serverPrefix}`. Run `fw doctor` and check the ' +
  'manifest, or escalate.';

const REM_CONFIG_HALF_STATE_SUFFIX =
  ' This was a configuration step; the rollout may be in a half-created ' +
  "state. Do not retry blindly. Inspect the lockfile's " +
  '`lastConfigFailure` block before re-invoking the skill.';

const REM_CONFIRMATION_MISSING = '(use embedded `remediation` field verbatim)';

const REM_MANIFEST_MISMATCH =
  'The MCP server inventory does not match what this skill version ' +
  'expects. Differences: ${diffSummary}. Run `fw doctor` and update either ' +
  'the skill or the servers.';

/**
 * Build the per-cell entry. Configuration-step rows for non-ok classes
 * append the half-state warning; the underlying class's remediation is
 * preserved so the user sees both pieces of context.
 */
function makeCell(base: string, isConfigStep: boolean): PolicyCell {
  if (!isConfigStep || base === REM_OK) {
    return Object.freeze({ retryBudget: 0, remediation: base });
  }
  return Object.freeze({
    retryBudget: 0,
    remediation: base + REM_CONFIG_HALF_STATE_SUFFIX,
  });
}

/**
 * `POLICY_TABLE` is frozen at the top level; the per-cell record under
 * each class key is also frozen by `makeCell`. The cell map is
 * `Record<'false'|'true', PolicyCell>` for ergonomic JSON-friendly access.
 */
export const POLICY_TABLE: Readonly<
  Record<PolicyClass, Readonly<Record<'false' | 'true', PolicyCell>>>
> = Object.freeze({
  ok: Object.freeze({
    false: makeCell(REM_OK, false),
    true: makeCell(REM_OK, true),
  }),
  network: Object.freeze({
    false: makeCell(REM_NETWORK, false),
    true: makeCell(REM_NETWORK, true),
  }),
  timeout: Object.freeze({
    false: makeCell(REM_TIMEOUT, false),
    true: makeCell(REM_TIMEOUT, true),
  }),
  client_4xx: Object.freeze({
    false: makeCell(REM_CLIENT_4XX, false),
    true: makeCell(REM_CLIENT_4XX, true),
  }),
  server_5xx: Object.freeze({
    false: makeCell(REM_SERVER_5XX, false),
    true: makeCell(REM_SERVER_5XX, true),
  }),
  schema_drift: Object.freeze({
    false: makeCell(REM_SCHEMA_DRIFT, false),
    true: makeCell(REM_SCHEMA_DRIFT, true),
  }),
  tool_not_found: Object.freeze({
    false: makeCell(REM_TOOL_NOT_FOUND, false),
    true: makeCell(REM_TOOL_NOT_FOUND, true),
  }),
  config_tool_failure: Object.freeze({
    // Both columns identical — `config_tool_failure` only fires when
    // `isConfigurationStep` is true; the false column is a synthetic
    // round-trip target for callers that ask for the cell directly.
    false: makeCell(REM_SERVER_5XX, true),
    true: makeCell(REM_SERVER_5XX, true),
  }),
  confirmation_missing: Object.freeze({
    false: makeCell(REM_CONFIRMATION_MISSING, false),
    true: makeCell(REM_CONFIRMATION_MISSING, true),
  }),
  manifest_mismatch: Object.freeze({
    false: makeCell(REM_MANIFEST_MISMATCH, false),
    true: makeCell(REM_MANIFEST_MISMATCH, true),
  }),
});

/**
 * Look up the policy cell for a given (class, configuration-step) pair.
 * Both columns of every row are populated — no undefined returns possible.
 */
export function getRemediation(
  failureClass: PolicyClass,
  isConfigurationStep: boolean
): PolicyCell {
  const row = POLICY_TABLE[failureClass];
  return isConfigurationStep ? row.true : row.false;
}
