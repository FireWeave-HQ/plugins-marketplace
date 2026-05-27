/**
 * Canonical inventory of every gate the safe-rollout skill walks through.
 *
 * Sourced from pitch 026 Technical Reference §Gate Inventory. Each row in
 * that table corresponds to one entry below. The inventory is consumed by:
 *
 *   - the skill prose generator (to emit gate banners in SKILL.md)
 *   - the MCP tools that enforce confirmation receipts
 *     (`write_confirmation_receipt`, `read_confirmation_receipts`,
 *     downstream tool refusal logic in Scope 002)
 *   - the `register_rollout` predecessor-check (Scope 002), which iterates
 *     the inventory to confirm every required receipt is present.
 *
 * Conditional dynamic-suffix gates intentionally OMITTED from this static
 * inventory:
 *
 *   - `GATE-5-COHORT-KEY-<symbol>` — generated at Step 5 per wrap-point
 *     whose `cohortKeyExpression` is missing. The `<symbol>` suffix is
 *     synthesized from the wrap-point identifier at runtime, so the gate
 *     ID is unknowable in advance.
 *   - `GATE-6-ACCEPT-METRIC-<name>` — generated at Step 6 per proposed
 *     metric. The `<name>` suffix is the metric ID, again synthesized at
 *     runtime.
 *
 * Downstream code that iterates the inventory and additionally needs to
 * enforce these dynamic gates must synthesize their IDs from the current
 * working spec (wrap-points + accepted metrics) — they will not appear
 * here.
 *
 * The array is `Object.freeze`-d to prevent accidental mutation by
 * tooling that consumes it.
 *
 * R-IDs: R-001-3
 */

export interface GateInventoryEntry {
  /** Stable gate identifier, used as a lockfile.userConfirmations key. */
  readonly gateId: string;
  /** Numeric step the gate belongs to. Matches LockfileState stepNumber. */
  readonly stepNumber: string;
  /** The exact question shown to the user, verbatim from SKILL.md. */
  readonly canonicalQuestion: string;
}

export const GATE_INVENTORY: readonly GateInventoryEntry[] = Object.freeze([
  {
    gateId: 'GATE-0-RESUME-DECISION',
    stepNumber: '0',
    canonicalQuestion:
      'Diffs from a previous run are in your working tree. What would you like to do?',
  },
  {
    gateId: 'GATE-0-FORCE-PUSH-DECISION',
    stepNumber: '0',
    canonicalQuestion:
      'Branch HEAD changed since this rollout was registered. Update the participant SHA?',
  },
  {
    gateId: 'GATE-0.2-JOIN-OR-CREATE',
    stepNumber: '0.2',
    canonicalQuestion:
      'Open rollouts in this project — join an existing one or start fresh?',
  },
  {
    gateId: 'GATE-0.2-MULTI-REPO',
    stepNumber: '0.2',
    canonicalQuestion:
      'Does this rollout require coordinated changes in any other repo?',
  },
  {
    gateId: 'GATE-0.2-CAPABILITY-FALLBACK',
    stepNumber: '0.2',
    canonicalQuestion:
      'No feature-flag provider is connected. Use Fireweave-managed PostHog?',
  },
  {
    gateId: 'GATE-0.2-ENVIRONMENT-CHOICE',
    stepNumber: '0.2',
    canonicalQuestion: 'Which environment should the deploy gate watch?',
  },
  {
    gateId: 'GATE-1-FEATURE-SURFACE',
    stepNumber: '1',
    canonicalQuestion: 'How should I find what to wrap?',
  },
  {
    gateId: 'GATE-1-FIRST-TIME-DIRS',
    stepNumber: '1',
    canonicalQuestion: 'Which directories form the feature surface?',
  },
  {
    gateId: 'GATE-2-TYPE',
    stepNumber: '2',
    canonicalQuestion: 'What kind of change is this?',
  },
  {
    gateId: 'GATE-2-NAME',
    stepNumber: '2',
    canonicalQuestion: 'Short feature name (e.g. dark-mode-checkout)?',
  },
  {
    gateId: 'GATE-2-DESCRIPTION',
    stepNumber: '2',
    canonicalQuestion:
      "One-line description of what's being rolled out — what reviewers should know.",
  },
  {
    gateId: 'GATE-3-ROLLOUT-STYLE',
    stepNumber: '3',
    canonicalQuestion: "What's the rollout style?",
  },
  {
    gateId: 'GATE-4-PROVIDER-BINDING',
    stepNumber: '4',
    canonicalQuestion: 'Which provider should bind this capability?',
  },
  {
    gateId: 'GATE-5-WRAP-SELECT',
    stepNumber: '5',
    canonicalQuestion: 'Which wrap-point candidates should be confirmed?',
  },
  {
    gateId: 'GATE-6-ZERO-METRIC-WARNING',
    stepNumber: '6',
    canonicalQuestion:
      'No metrics selected — explicit confirmation to ship with no guardrails?',
  },
  {
    gateId: 'GATE-8-VERIFY-OVERRIDE',
    stepNumber: '8',
    canonicalQuestion: 'Verification failed: <count> findings. Block commit?',
  },
  {
    gateId: 'GATE-8.5-REGISTER-OR-EDIT',
    stepNumber: '8.5',
    canonicalQuestion: 'Register this rollout?',
  },
  {
    gateId: 'GATE-9-SHA-READY',
    stepNumber: '9',
    canonicalQuestion:
      "Ready to register? I'll need a commit SHA. Have you committed and pushed?",
  },
] as const);
