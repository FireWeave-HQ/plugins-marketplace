/**
 * subagent-stop hook (R-005-7).
 *
 * Scans a transcript for trailing hard-abort error envelopes and
 * terminates the session non-recoverably when one is found.
 *
 * The set of hard-abort codes is the same closed list as the
 * universal-rule entry in safe-rollout/SKILL.md:
 *   CONFIRMATION_MISSING, CONFIG_TOOL_FAILURE, SCHEMA_DRIFT,
 *   TOOL_NOT_FOUND, MANIFEST_MISMATCH.
 *
 * Distribution into specific runtimes (Claude Code, Cursor, Cline)
 * is out of scope for this pitch; this module exposes the pure
 * function — host runtimes wire it in separately.
 */

export type HardAbortCode =
  | 'CONFIRMATION_MISSING'
  | 'CONFIG_TOOL_FAILURE'
  | 'SCHEMA_DRIFT'
  | 'TOOL_NOT_FOUND'
  | 'MANIFEST_MISMATCH';

const HARD_ABORT_CODES: readonly HardAbortCode[] = Object.freeze([
  'CONFIRMATION_MISSING',
  'CONFIG_TOOL_FAILURE',
  'SCHEMA_DRIFT',
  'TOOL_NOT_FOUND',
  'MANIFEST_MISMATCH',
]);

export interface SubagentStopInput {
  transcript: string;
  agentType: string;
}

export interface SubagentStopResult {
  exitCode: 0 | 2;
  stopReason?: string;
}

export function runSubagentStop(input: SubagentStopInput): SubagentStopResult {
  const { transcript } = input;
  if (!transcript) return { exitCode: 0 };

  let latestMatch: { code: HardAbortCode; index: number } | undefined;

  for (const code of HARD_ABORT_CODES) {
    const pattern = new RegExp(`["']?code["']?\\s*:\\s*["']${code}["']`, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(transcript)) !== null) {
      if (!matchHasRemediation(transcript, match.index)) continue;
      if (!latestMatch || match.index > latestMatch.index) {
        latestMatch = { code, index: match.index };
      }
    }
  }

  if (!latestMatch) return { exitCode: 0 };

  return {
    exitCode: 2,
    stopReason: `hard-abort:${latestMatch.code}`,
  };
}

/**
 * Heuristic: a real error envelope co-locates the code with a
 * `remediation` field within ~512 chars. Prose mentions of the code
 * (e.g. "Earlier we discussed CONFIRMATION_MISSING semantics") do
 * not. Window-bounded so worst-case scan is O(n).
 */
function matchHasRemediation(transcript: string, codeIndex: number): boolean {
  const windowStart = Math.max(0, codeIndex - 256);
  const windowEnd = Math.min(transcript.length, codeIndex + 512);
  const window = transcript.slice(windowStart, windowEnd);
  return /remediation/i.test(window);
}
