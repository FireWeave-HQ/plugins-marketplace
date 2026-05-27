/**
 * Propose metric templates for ONE flag.
 *
 * Multi-flag rollouts (Task 21): the caller iterates `config.flags[]` and
 * invokes this tool once per flag. Each call emits metrics scoped to that
 * flag's key (e.g. error-rate, p95-latency, funnel-conversion all reference
 * `properties['$feature/${flagKey}']` in their HogQL queries). For an N-flag
 * rollout, the operator gets N copies of each metric template — one per
 * flag — so per-flag regressions can be attributed correctly. Aggregate
 * cross-flag metrics are out of scope for this tool.
 *
 * Wave A: the MCP registration is a deprecation alias that forwards to
 * the proxy AFTER the Scope-002 receipt-guard runs. The pure-function
 * `proposeMetrics` is retained because in-process callers (and unit tests)
 * still exercise the local heuristics.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetricProposal } from '@fireweaveai/fw-rollout-types';
import { readLockfile } from './lockfile';
import {
  RECEIPT_REQUIREMENTS,
  requireReceipts,
  type ConfirmationMissingError,
} from './_receipt-guard';

export type { MetricProposal };

export interface ProposeMetricsOpts {
  featureDescription: string;
  flagKey: string;
  codeAnalysis?: {
    hasUserVisibleChange?: boolean;
    isPrimaryConversionSurface?: boolean;
  };
  providerCapabilities?: string[]; // e.g. ['metric.query', 'error.regression-detection']
}

export interface ProposeMetricsResult {
  proposals: MetricProposal[];
}

// ---------------------------------------------------------------------------
// HogQL query templates — flag cohort is isolated via PostHog feature property.
// Single quotes inside the queries are intentionally part of HogQL syntax.
// ---------------------------------------------------------------------------

function makeErrorRateMetric(flagKey: string): MetricProposal {
  return {
    id: `${flagKey}__error-rate`,
    metricName: 'Error Rate by Variant',
    query:
      `SELECT properties['$feature/${flagKey}'] AS variant, ` +
      `count() AS errors ` +
      `FROM events ` +
      `WHERE event = '$exception' ` +
      `AND properties['$feature/${flagKey}'] IS NOT NULL ` +
      `GROUP BY variant ` +
      `ORDER BY errors DESC`,
    queryLanguage: 'hogql',
    threshold: '10% increase vs baseline variant',
    severity: 'page',
    basis:
      'Baseline regression-detection metric — always included. ' +
      'Alerts if the test variant causes a significant uptick in exceptions.',
    sourceCapability: 'error.regression-detection',
  };
}

function makeFunnelConversionMetric(flagKey: string): MetricProposal {
  return {
    id: `${flagKey}__funnel-conversion`,
    metricName: 'Funnel Conversion by Variant',
    query:
      `SELECT properties['$feature/${flagKey}'] AS variant, ` +
      `count() AS conversions ` +
      `FROM events ` +
      `WHERE event = 'conversion' ` +
      `AND properties['$feature/${flagKey}'] IS NOT NULL ` +
      `GROUP BY variant`,
    queryLanguage: 'hogql',
    threshold: '5% decrease in conversion rate',
    severity: 'warn',
    basis:
      'Feature description mentions conversion/checkout/signup. ' +
      'Monitors whether the new variant improves or degrades funnel conversion.',
    sourceCapability: 'metric.query',
  };
}

function makeP95LatencyMetric(flagKey: string): MetricProposal {
  return {
    id: `${flagKey}__p95-latency`,
    metricName: 'p95 Latency by Variant',
    query:
      `SELECT properties['$feature/${flagKey}'] AS variant, ` +
      `quantile(0.95)(toFloat64OrNull(properties.duration_ms)) AS p95_ms ` +
      `FROM events ` +
      `WHERE properties['$feature/${flagKey}'] IS NOT NULL ` +
      `AND properties.duration_ms IS NOT NULL ` +
      `GROUP BY variant`,
    queryLanguage: 'hogql',
    threshold: '20% increase in p95 latency',
    severity: 'warn',
    basis:
      'Feature description mentions performance/latency. ' +
      'Tracks 95th percentile response time per flag variant.',
    sourceCapability: 'metric.query',
  };
}

function makeRetentionMetric(flagKey: string): MetricProposal {
  return {
    id: `${flagKey}__retention`,
    metricName: 'User Retention by Variant',
    query:
      `SELECT properties['$feature/${flagKey}'] AS variant, ` +
      `toDate(timestamp) AS day, ` +
      `count(DISTINCT distinct_id) AS active_users ` +
      `FROM events ` +
      `WHERE properties['$feature/${flagKey}'] IS NOT NULL ` +
      `GROUP BY variant, day ` +
      `ORDER BY day ASC`,
    queryLanguage: 'hogql',
    threshold: '10% decrease in daily active users for variant',
    severity: 'warn',
    basis:
      'Feature description mentions retention/engagement. ' +
      'Tracks daily unique users per flag variant over the rollout window.',
    sourceCapability: 'metric.query',
  };
}

// ---------------------------------------------------------------------------
// Keyword matcher — case-insensitive, word-boundary aware
// ---------------------------------------------------------------------------
function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function proposeMetrics(
  opts: ProposeMetricsOpts
): Promise<ProposeMetricsResult> {
  const { featureDescription, flagKey, codeAnalysis, providerCapabilities } =
    opts;

  const proposals: MetricProposal[] = [];

  // Determine which capabilities are available (default to both if not supplied)
  const caps = providerCapabilities ?? [
    'metric.query',
    'error.regression-detection',
  ];
  const hasMetricQuery = caps.includes('metric.query');
  const hasErrorDetection = caps.includes('error.regression-detection');

  // 1. Error rate is always included (baseline regression detection)
  if (hasErrorDetection || caps.length === 0) {
    proposals.push(makeErrorRateMetric(flagKey));
  }

  // 2. Funnel conversion — conversion/checkout/signup keywords or isPrimaryConversionSurface
  if (
    hasMetricQuery &&
    (containsAny(featureDescription, [
      'conversion',
      'checkout',
      'signup',
      'purchase',
      'subscribe',
    ]) ||
      codeAnalysis?.isPrimaryConversionSurface === true)
  ) {
    proposals.push(makeFunnelConversionMetric(flagKey));
  }

  // 3. p95 latency — performance/latency/speed/slow keywords
  if (
    hasMetricQuery &&
    containsAny(featureDescription, [
      'performance',
      'latency',
      'speed',
      'slow',
      'fast',
      'response time',
    ])
  ) {
    proposals.push(makeP95LatencyMetric(flagKey));
  }

  // 4. Retention — retention/engagement/DAU/active keywords
  if (
    hasMetricQuery &&
    (containsAny(featureDescription, [
      'retention',
      'engagement',
      'active user',
      'dau',
      'stickiness',
    ]) ||
      codeAnalysis?.hasUserVisibleChange === true)
  ) {
    proposals.push(makeRetentionMetric(flagKey));
  }

  return { proposals };
}

// ---------------------------------------------------------------------------
// Receipt-guard wrapper — called by the MCP handler (R-002-4).
//
// Keeps `proposeMetrics` pure (no lockfile I/O); the wrapper reads the
// current lockfile, runs the receipt-guard against the per-tool required
// list from RECEIPT_REQUIREMENTS, and short-circuits with the
// CONFIRMATION_MISSING envelope on failure. Retained verbatim from
// Scope 002; Wave A LAYERS the deprecation alias on top.
// ---------------------------------------------------------------------------
export async function runProposeMetricsWithGuard(
  opts: ProposeMetricsOpts,
  cwd?: string
): Promise<ProposeMetricsResult | ConfirmationMissingError> {
  const lockfile = await readLockfile(cwd);
  const refusal = requireReceipts(
    lockfile,
    RECEIPT_REQUIREMENTS['propose_metrics'] ?? []
  );
  if (refusal) return refusal;
  return proposeMetrics(opts);
}

// ---------------------------------------------------------------------------
// Wave A alias plumbing
// ---------------------------------------------------------------------------
const DEPRECATION_MESSAGE =
  'DEPRECATION: propose_metrics has moved to fireweave-server-proxy; ' +
  'this alias will be removed in a future release.';

export interface AliasForwarder {
  (args: Record<string, unknown>): Promise<unknown>;
}

export const defaultProposeMetricsForwarder: AliasForwarder = async () => ({
  error: {
    code: 'NOT_YET_MIGRATED',
    message:
      'propose_metrics is being migrated to fireweave-server-proxy; ' +
      'cloud-side implementation not yet shipped.',
  },
});

export interface RunProposeMetricsAliasDeps {
  forwarder?: AliasForwarder;
  log?: (msg: string) => void;
  incrementUsage?: (toolName: string) => void;
  cwd?: string;
}

/**
 * Receipt-guarded Wave A alias. Layers:
 *   1. receipt-guard against `RECEIPT_REQUIREMENTS['propose_metrics']`
 *      (`GATE-1-FEATURE-SURFACE`). Short-circuit on CONFIRMATION_MISSING.
 *   2. emit DEPRECATION warning.
 *   3. increment usage counter.
 *   4. forward args via injected forwarder; return its response verbatim.
 */
export async function runProposeMetricsAlias(
  args: Record<string, unknown>,
  deps: RunProposeMetricsAliasDeps = {}
): Promise<unknown> {
  const lockfile = await readLockfile(deps.cwd);
  const refusal = requireReceipts(
    lockfile,
    RECEIPT_REQUIREMENTS['propose_metrics'] ?? []
  );
  if (refusal) return refusal;

  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  log(DEPRECATION_MESSAGE);
  deps.incrementUsage?.('propose_metrics');

  const forwarder = deps.forwarder ?? defaultProposeMetricsForwarder;
  return forwarder(args);
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------
const ProposeMetricsInputSchema = z
  .object({
    featureDescription: z.string().optional(),
    flagKey: z.string().optional(),
    codeAnalysis: z
      .object({
        hasUserVisibleChange: z.boolean().optional(),
        isPrimaryConversionSurface: z.boolean().optional(),
      })
      .optional(),
    providerCapabilities: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  })
  .passthrough();

export interface ProposeMetricsToolRegistrationOpts {
  forwarder?: AliasForwarder;
  incrementUsage?: (toolName: string) => void;
}

export const proposeMetricsTool = {
  registerWith(
    server: McpServer,
    opts: ProposeMetricsToolRegistrationOpts = {}
  ) {
    server.registerTool(
      'propose_metrics',
      {
        title: 'Propose Metrics (deprecation alias)',
        description:
          'Wave A deprecation alias — forwards to fireweave-server-proxy ' +
          'after the receipt-guard verifies GATE-1-FEATURE-SURFACE. Emits ' +
          'a DEPRECATION warning to stderr on every call when the guard ' +
          'passes.',
        inputSchema: ProposeMetricsInputSchema.shape,
      },
      async (args) => {
        try {
          const typedArgs = (args as Record<string, unknown>) ?? {};
          const cwd =
            typeof typedArgs.cwd === 'string'
              ? (typedArgs.cwd as string)
              : undefined;
          const result = await runProposeMetricsAlias(typedArgs, {
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
