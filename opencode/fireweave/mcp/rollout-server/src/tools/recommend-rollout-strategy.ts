/**
 * Wave A deprecation alias for `recommend_rollout_strategy`.
 *
 * The receipt-guard from Scope 002 is preserved — pitch 026 §Confirmation
 * Receipts requires Step-2 gates (TYPE / NAME / DESCRIPTION) before this
 * tool may proceed. The wrapper layering is now:
 *     receipt-guard → deprecation-warn → forward-to-proxy
 * If the receipt-guard short-circuits with `CONFIRMATION_MISSING`, the
 * alias does NOT emit the deprecation warning and does NOT forward — the
 * receipt envelope is the response.
 *
 * R-IDs: R-004-3, R-004-4
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readLockfile } from './lockfile';
import {
  RECEIPT_REQUIREMENTS,
  requireReceipts,
  type ConfirmationMissingError,
} from './_receipt-guard';

export type RolloutStyle =
  | 'linear-percent'
  | 'experiment-with-control'
  | 'cohort-based'
  | 'dark-launch';

export interface RecommendRolloutStrategyOpts {
  featureDescription: string;
  hasUserVisibleChange: boolean;
  isPrimaryConversionSurface: boolean;
  cohortGated: boolean;
}

export interface RankedStrategy {
  style: RolloutStyle;
  reason: string;
}

export interface RecommendRolloutStrategyResult {
  recommended: RolloutStyle;
  reason: string;
  ranked: RankedStrategy[];
}

// Default ordering of all strategies (used when building the ranked list)
const ALL_STRATEGIES: RankedStrategy[] = [
  {
    style: 'linear-percent',
    reason: 'Safe general-purpose progressive rollout',
  },
  {
    style: 'experiment-with-control',
    reason:
      'A/B with control reduces risk of attribution error on conversion surfaces',
  },
  {
    style: 'cohort-based',
    reason: 'Targets a specific user segment for early access',
  },
  {
    style: 'dark-launch',
    reason: 'Ships silently with no user-visible impact',
  },
];

export async function recommendRolloutStrategy(
  opts: RecommendRolloutStrategyOpts
): Promise<RecommendRolloutStrategyResult> {
  const { hasUserVisibleChange, isPrimaryConversionSurface, cohortGated } =
    opts;

  let recommended: RolloutStyle;
  let reason: string;

  // Heuristics applied in priority order
  if (!hasUserVisibleChange) {
    recommended = 'dark-launch';
    reason = 'no user-visible behavior change';
  } else if (isPrimaryConversionSurface) {
    recommended = 'experiment-with-control';
    reason =
      'primary conversion surface; A/B with control reduces risk of attribution error';
  } else if (cohortGated) {
    recommended = 'cohort-based';
    reason = 'feature description mentions specific user segment';
  } else {
    recommended = 'linear-percent';
    reason = 'default progressive rollout; no special routing required';
  }

  // Build ranked list: recommended first, then remaining in default order
  const remaining = ALL_STRATEGIES.filter((s) => s.style !== recommended);
  const ranked: RankedStrategy[] = [
    { style: recommended, reason },
    ...remaining,
  ];

  return { recommended, reason, ranked };
}

// ---------------------------------------------------------------------------
// Receipt-guard wrapper (R-002-4) — Step-3 cannot proceed until Step-2 gates
// (TYPE, NAME, DESCRIPTION) have receipts. Retained verbatim from Scope 002
// because Wave A LAYERS the deprecation alias on top of this check (rather
// than replacing it).
// ---------------------------------------------------------------------------
export async function runRecommendRolloutStrategyWithGuard(
  opts: RecommendRolloutStrategyOpts,
  cwd?: string
): Promise<RecommendRolloutStrategyResult | ConfirmationMissingError> {
  const lockfile = await readLockfile(cwd);
  const refusal = requireReceipts(
    lockfile,
    RECEIPT_REQUIREMENTS['recommend_rollout_strategy'] ?? []
  );
  if (refusal) return refusal;
  return recommendRolloutStrategy(opts);
}

// ---------------------------------------------------------------------------
// Wave A alias plumbing
// ---------------------------------------------------------------------------
const DEPRECATION_MESSAGE =
  'DEPRECATION: recommend_rollout_strategy has moved to ' +
  'fireweave-server-proxy; this alias will be removed in a future release.';

export interface AliasForwarder {
  (args: Record<string, unknown>): Promise<unknown>;
}

export const defaultRecommendRolloutStrategyForwarder: AliasForwarder =
  async () => ({
    error: {
      code: 'NOT_YET_MIGRATED',
      message:
        'recommend_rollout_strategy is being migrated to ' +
        'fireweave-server-proxy; cloud-side implementation not yet shipped.',
    },
  });

export interface RunRecommendRolloutStrategyAliasDeps {
  forwarder?: AliasForwarder;
  log?: (msg: string) => void;
  incrementUsage?: (toolName: string) => void;
  cwd?: string;
}

/**
 * Receipt-guarded Wave A alias. Layers:
 *   1. read lockfile + run receipt-guard against
 *      `RECEIPT_REQUIREMENTS['recommend_rollout_strategy']`. If a receipt
 *      is missing, short-circuit with the `CONFIRMATION_MISSING` envelope
 *      — no warning, no forwarding.
 *   2. emit DEPRECATION warning to stderr.
 *   3. increment usage counter.
 *   4. forward args to the proxy via the injected forwarder. Return its
 *      response unchanged.
 */
export async function runRecommendRolloutStrategyAlias(
  args: Record<string, unknown>,
  deps: RunRecommendRolloutStrategyAliasDeps = {}
): Promise<unknown> {
  // Receipt-guard FIRST so deprecation noise doesn't drown the
  // CONFIRMATION_MISSING signal when the user hasn't confirmed yet.
  const lockfile = await readLockfile(deps.cwd);
  const refusal = requireReceipts(
    lockfile,
    RECEIPT_REQUIREMENTS['recommend_rollout_strategy'] ?? []
  );
  if (refusal) return refusal;

  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  log(DEPRECATION_MESSAGE);
  deps.incrementUsage?.('recommend_rollout_strategy');

  const forwarder = deps.forwarder ?? defaultRecommendRolloutStrategyForwarder;
  return forwarder(args);
}

const RecommendRolloutStrategyInputSchema = z
  .object({
    featureDescription: z.string().optional(),
    hasUserVisibleChange: z.boolean().optional(),
    isPrimaryConversionSurface: z.boolean().optional(),
    cohortGated: z.boolean().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();

export interface RecommendRolloutStrategyToolRegistrationOpts {
  forwarder?: AliasForwarder;
  incrementUsage?: (toolName: string) => void;
}

export const recommendRolloutStrategyTool = {
  registerWith(
    server: McpServer,
    opts: RecommendRolloutStrategyToolRegistrationOpts = {}
  ) {
    server.registerTool(
      'recommend_rollout_strategy',
      {
        title: 'Recommend Rollout Strategy (deprecation alias)',
        description:
          'Wave A deprecation alias — forwards to fireweave-server-proxy ' +
          'after the receipt-guard verifies Step-2 gates (TYPE/NAME/' +
          'DESCRIPTION). Emits a DEPRECATION warning to stderr on every ' +
          'call when the guard passes.',
        inputSchema: RecommendRolloutStrategyInputSchema.shape,
      },
      async (args) => {
        try {
          const typedArgs = (args as Record<string, unknown>) ?? {};
          const cwd =
            typeof typedArgs.cwd === 'string'
              ? (typedArgs.cwd as string)
              : undefined;
          const result = await runRecommendRolloutStrategyAlias(typedArgs, {
            ...opts,
            ...(cwd !== undefined && { cwd }),
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
          };
        }
      }
    );
  },
};
