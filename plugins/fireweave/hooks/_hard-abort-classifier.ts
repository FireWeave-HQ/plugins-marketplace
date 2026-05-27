/**
 * Spike A — hard-abort UX classifier (R-005-8).
 *
 * Maps an (askUserQuestionResult, lockfile) pair onto one of three labels:
 * `model_skip`, `user_cancel`, or `transport_error`.
 *
 * See `.binaryos/build-state/026-safe-rollout-confirmation-enforcement/spike-hard-abort-ux.md`
 * for the decision-table rationale and fixtures.
 */

export type AbortEventLabel = 'model_skip' | 'user_cancel' | 'transport_error';

export interface AskUserQuestionResult {
  userCancelled?: boolean;
}

export interface AbortEventLockfile {
  lastConfigFailure?: {
    failedToolId: string;
    failureClass: string;
    failedAt: string;
    remediation: string;
  };
  userConfirmations?: Record<string, unknown>;
}

export interface AbortEventInput {
  askUserQuestionResult: AskUserQuestionResult | null;
  lockfile: AbortEventLockfile;
}

export function classifyAbortEvent(input: AbortEventInput): AbortEventLabel {
  const { askUserQuestionResult, lockfile } = input;

  if (askUserQuestionResult?.userCancelled === true) {
    return 'user_cancel';
  }

  if (askUserQuestionResult === null && lockfile.lastConfigFailure) {
    return 'transport_error';
  }

  return 'model_skip';
}
