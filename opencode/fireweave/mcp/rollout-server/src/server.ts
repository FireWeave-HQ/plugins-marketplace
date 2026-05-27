import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'node:path';
import { mkdir, readFile, rename } from 'node:fs/promises';
import {
  ensureAuthTool,
  listProjectsTool,
  selectProjectTool,
  detectBaselineTool,
  extractDiffSurfaceTool,
  analyzeCodebaseTool,
  recommendRolloutStrategyTool,
  proposeMetricsTool,
  generateWrapperTool,
  readPreferencesTool,
  writePreferencesTool,
  tagBaselineCommitTool,
  verifyCohortKeyingTool,
  verifyNoOrphanFlagsTool,
  verifySafeDefaultsTool,
  verifyNoMixedProviderCallsTool,
  verifyTelemetryCompletenessTool,
  verifyRolloutConfigSchemaTool,
  verifyProviderHealthTool,
  readLockfileTool,
  writeLockfileTool,
  clearLockfileTool,
  writeConfirmationReceiptTool,
  readConfirmationReceiptsTool,
  guardedCallTool,
  REGISTER_TIME_REQUIRED_GATES,
  DYNAMIC_GATE_PREFIXES,
  DEPRECATION_ALLOWLIST,
} from './index';

// ---------------------------------------------------------------------------
// Tool-usage counter (R-004-7)
//
// In-memory map of <toolName, invocationCount>, mirrored to
// `.fireweave/.cache/tool-usage-counts.json` on every increment. The
// counter is the input to Wave-B's safety gating — if a deprecated alias
// has zero invocations over a quiet period, it's safe to delete.
// ---------------------------------------------------------------------------

const USAGE_COUNTER_RELATIVE_PATH = '.fireweave/.cache/tool-usage-counts.json';
const USAGE_COUNTER_DIR = '.fireweave/.cache';

const toolUsageCounts = new Map<string, number>();

function usageCounterPath(cwd: string): string {
  return join(cwd, USAGE_COUNTER_RELATIVE_PATH);
}

async function loadToolUsageCounts(cwd: string = process.cwd()): Promise<void> {
  try {
    const raw = await readFile(usageCounterPath(cwd), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        toolUsageCounts.set(k, v);
      }
    }
  } catch {
    // Missing / corrupt — start with an empty counter.
  }
}

async function persistToolUsageCounts(
  cwd: string = process.cwd()
): Promise<void> {
  const target = usageCounterPath(cwd);
  const tmp = `${target}.tmp`;
  await mkdir(join(cwd, USAGE_COUNTER_DIR), { recursive: true });
  const obj: Record<string, number> = {};
  for (const [k, v] of toolUsageCounts.entries()) obj[k] = v;
  await Bun.write(tmp, JSON.stringify(obj, null, 2) + '\n');
  await rename(tmp, target);
}

/**
 * Increment the in-memory counter for `toolName` and persist to disk.
 * Called by the Wave A deprecation aliases on every invocation.
 *
 * R-ID: R-004-7
 */
export function incrementToolUsage(toolName: string): void {
  const next = (toolUsageCounts.get(toolName) ?? 0) + 1;
  toolUsageCounts.set(toolName, next);
  // Fire-and-forget — the counter is best-effort. A slow disk write must
  // not block the alias forwarding path.
  void persistToolUsageCounts().catch(() => {});
}

/**
 * Read the current in-memory tool-usage counter as a plain object.
 *
 * R-ID: R-004-7
 */
export function getToolUsageCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of toolUsageCounts.entries()) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// Registered-tool inventory (R-004-6)
// ---------------------------------------------------------------------------

export interface RegisteredToolEntry {
  name: string;
  server: 'rollout-server';
  aliasOf?: 'fireweave-server-proxy';
}

/**
 * The complete list of MCP tool names registered on this rollout-server.
 * Mirrors the `*.registerWith(server)` block below. Kept manually in sync
 * — the `tool-responsibility.test.ts` parses `server.ts` to verify the
 * list aligns with the on-disk tool files, so drift is caught at test
 * time.
 *
 * R-ID: R-004-6
 */
export const REGISTERED_TOOL_NAMES: readonly string[] = Object.freeze([
  'ensure_auth',
  'list_projects',
  'select_project',
  'detect_baseline',
  'extract_diff_surface',
  'analyze_codebase',
  'recommend_rollout_strategy',
  'propose_metrics',
  'generate_wrapper',
  'read_preferences',
  'write_preferences',
  'tag_baseline_commit',
  'verify_cohort_keying',
  'verify_no_orphan_flags',
  'verify_safe_defaults',
  'verify_no_mixed_provider_calls',
  'verify_telemetry_completeness',
  'verify_rollout_config_schema',
  'verify_provider_health',
  'read_lockfile',
  'write_lockfile',
  'clear_lockfile',
  'write_confirmation_receipt',
  'read_confirmation_receipts',
  'guarded_call',
]);

/**
 * Returns the rollout-server's tool inventory with deprecation-alias
 * routing populated for the Wave A migrated tools.
 *
 * R-ID: R-004-6
 */
export function listRegisteredTools(): RegisteredToolEntry[] {
  return REGISTERED_TOOL_NAMES.map((name) => {
    const entry: RegisteredToolEntry = { name, server: 'rollout-server' };
    if (DEPRECATION_ALLOWLIST.includes(name)) {
      entry.aliasOf = 'fireweave-server-proxy';
    }
    return entry;
  });
}

// ---------------------------------------------------------------------------
// Server boot
// ---------------------------------------------------------------------------

/**
 * Build the rollout-server with all tools + the confirmation-receipts
 * capability resource registered. Extracted so unit tests can construct
 * a fresh server instance without the stdio connect side-effect.
 *
 * Module-level boot is gated on `import.meta.main` below so importing
 * this file (e.g., from `tool-responsibility.test.ts`) does NOT spawn a
 * stdio MCP server. Only direct invocation (`bun src/server.ts`) does.
 */
export function buildRolloutServer(): McpServer {
  const server = new McpServer({
    name: 'fireweave-rollout-server',
    version: '0.1.0',
  });

  const aliasRegistrationOpts = { incrementUsage: incrementToolUsage };

  ensureAuthTool.registerWith(server);
  listProjectsTool.registerWith(server, aliasRegistrationOpts);
  selectProjectTool.registerWith(server);
  detectBaselineTool.registerWith(server);
  extractDiffSurfaceTool.registerWith(server, aliasRegistrationOpts);
  analyzeCodebaseTool.registerWith(server);
  recommendRolloutStrategyTool.registerWith(server, aliasRegistrationOpts);
  proposeMetricsTool.registerWith(server, aliasRegistrationOpts);
  generateWrapperTool.registerWith(server);
  readPreferencesTool.registerWith(server);
  writePreferencesTool.registerWith(server);
  tagBaselineCommitTool.registerWith(server);
  verifyCohortKeyingTool.registerWith(server);
  verifyNoOrphanFlagsTool.registerWith(server);
  verifySafeDefaultsTool.registerWith(server);
  verifyNoMixedProviderCallsTool.registerWith(server);
  verifyTelemetryCompletenessTool.registerWith(server);
  verifyRolloutConfigSchemaTool.registerWith(server);
  verifyProviderHealthTool.registerWith(server);

  // B10 — skill resume + force-push detection
  readLockfileTool.registerWith(server);
  writeLockfileTool.registerWith(server);
  clearLockfileTool.registerWith(server);

  // Scope-002 — confirmation receipts + downstream tool refusal
  writeConfirmationReceiptTool.registerWith(server);
  readConfirmationReceiptsTool.registerWith(server);

  // Scope-003 — guarded_call wrapper. Registered with an empty
  // dispatchTable for v1; Wave A aliases provide the cloud-side surface.
  guardedCallTool.registerWith(server);

  // Scope-004 — get_tool_usage_counts (R-004-7). Exposes the per-tool
  // invocation counter so external readers (Wave-B safety gate) can
  // decide which deprecated aliases are quiet enough to delete.
  server.registerTool(
    'get_tool_usage_counts',
    {
      title: 'Get Tool Usage Counts',
      description:
        'Returns the per-tool invocation counter persisted at ' +
        '`.fireweave/.cache/tool-usage-counts.json`. Used by Wave-B safety ' +
        'gating to decide which deprecated aliases are quiet enough to delete.',
      inputSchema: z.object({}).shape,
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ counts: getToolUsageCounts() }),
        },
      ],
    })
  );

  // confirmation-receipts capability resource (R-002-7). The skill's
  // Step 0.1 preflight reads this to detect confirmation-enforcement
  // support; if absent, the skill prints a hard-abort upgrade message.
  const CONFIRMATION_RECEIPTS_CAPABILITY_URI =
    'capability://confirmation-receipts/v1';
  server.registerResource(
    'confirmation-receipts',
    CONFIRMATION_RECEIPTS_CAPABILITY_URI,
    {
      title: 'Confirmation Receipts Capability',
      description:
        "Advertises this server's confirmation-receipts: v1 surface. " +
        'Lists the always-required gate IDs and the dynamic-suffix gate ' +
        'prefixes the skill must enforce.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: CONFIRMATION_RECEIPTS_CAPABILITY_URI,
          mimeType: 'application/json',
          text: JSON.stringify({
            version: 'v1',
            required_gates: REGISTER_TIME_REQUIRED_GATES,
            dynamic_gate_prefixes: DYNAMIC_GATE_PREFIXES,
          }),
        },
      ],
    })
  );

  return server;
}

// Module-level boot — only when invoked directly. Tests import this
// file for `listRegisteredTools` / `incrementToolUsage` etc. and must
// NOT trigger the stdio transport.
if (import.meta.main) {
  await loadToolUsageCounts();
  const server = buildRolloutServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
