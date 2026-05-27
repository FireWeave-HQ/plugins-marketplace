/**
 * Acceptance tests for the subagent-stop hook (R-005-7).
 *
 * The hook scans a transcript for trailing hard-abort error envelopes
 * (CONFIRMATION_MISSING, CONFIG_TOOL_FAILURE, SCHEMA_DRIFT,
 * TOOL_NOT_FOUND, MANIFEST_MISMATCH). On match → exit 2 with
 * `stop_reason` naming the failure class. Otherwise → exit 0.
 */

import { describe, expect, test } from 'bun:test';
import { runSubagentStop } from './subagent-stop';

const baseAgent = 'safe-rollout';

describe('R-005-7 runSubagentStop hard-abort detection', () => {
  test('CONFIRMATION_MISSING envelope at tail → exit 2 with hard-abort stop_reason', () => {
    const transcript = `
We attempted to call propose_metrics.
{
  "error": {
    "code": "CONFIRMATION_MISSING",
    "missingGateId": "GATE-1-FEATURE-SURFACE",
    "remediation": "Re-run /fireweave:safe-rollout and answer Step 1 before continuing."
  }
}
`.trim();
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(2);
    expect(result.stopReason).toBe('hard-abort:CONFIRMATION_MISSING');
  });

  test('CONFIG_TOOL_FAILURE envelope at tail → exit 2', () => {
    const transcript = `
Calling register_rollout via guarded_call.
{
  "error": {
    "code": "CONFIG_TOOL_FAILURE",
    "failureClass": "server_5xx",
    "remediation": "Cloud returned 503. Check status.fireweave.cloud and retry."
  }
}
`.trim();
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(2);
    expect(result.stopReason).toBe('hard-abort:CONFIG_TOOL_FAILURE');
  });

  test('SCHEMA_DRIFT envelope at tail → exit 2', () => {
    const transcript = `
{"error":{"code":"SCHEMA_DRIFT","remediation":"Run fw doctor or update the skill."}}
`.trim();
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(2);
    expect(result.stopReason).toBe('hard-abort:SCHEMA_DRIFT');
  });

  test('TOOL_NOT_FOUND envelope at tail → exit 2', () => {
    const transcript = `error: { "code": "TOOL_NOT_FOUND", "remediation": "Tool is not registered on the expected server." }`;
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(2);
    expect(result.stopReason).toBe('hard-abort:TOOL_NOT_FOUND');
  });

  test('MANIFEST_MISMATCH envelope at tail → exit 2', () => {
    const transcript = `{"code":"MANIFEST_MISMATCH","remediation":"Skill manifest does not match registered tools."}`;
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(2);
    expect(result.stopReason).toBe('hard-abort:MANIFEST_MISMATCH');
  });

  test('clean transcript without error envelope → exit 0', () => {
    const transcript = `
All gates passed. Rollout registered with rolloutId rollout_abc123.
Step 10 final summary printed.
`.trim();
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(0);
    expect(result.stopReason).toBeUndefined();
  });

  test('historical error mention without trailing envelope → exit 0 (pass-through)', () => {
    const transcript = `
Earlier in the run we discussed CONFIRMATION_MISSING semantics.
The model then proceeded with all gates intact and finished successfully.
`.trim();
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(0);
  });

  test('selects the LATEST matching hard-abort code when multiple appear', () => {
    const transcript = `
{"code":"CONFIRMATION_MISSING","remediation":"x"}
... later in the same session ...
{"error":{"code":"SCHEMA_DRIFT","remediation":"y"}}
`.trim();
    const result = runSubagentStop({ transcript, agentType: baseAgent });
    expect(result.exitCode).toBe(2);
    expect(result.stopReason).toBe('hard-abort:SCHEMA_DRIFT');
  });

  test('empty transcript → exit 0', () => {
    const result = runSubagentStop({ transcript: '', agentType: baseAgent });
    expect(result.exitCode).toBe(0);
  });
});
