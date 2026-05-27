/**
 * Acceptance test for MCP Responsibility Boundary Rule across every tool
 * registered on rollout-server.
 *
 * For each tool registered via `*.registerWith(server)` in `server.ts`:
 *   - locate the source file under `src/tools/<tool-name>.ts`
 *   - run `analyzeToolSource` on it
 *   - assert `violations.length === 0` UNLESS the tool name is on the
 *     `DEPRECATION_ALLOWLIST` carve-out
 *   - for each allowlisted tool, assert its source contains a stderr
 *     deprecation warning (regex match for `process.stderr.write` + DEPRECATION)
 *
 * R-IDs: R-004-2, R-004-4
 */

import { test, expect, describe } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeToolSource,
  DEPRECATION_ALLOWLIST,
} from './tools/_responsibility-rule';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_TS_PATH = join(__dirname, 'server.ts');
const TOOLS_DIR = join(__dirname, 'tools');

/**
 * Mapping from variable name (e.g. `listProjectsTool`) to the registered
 * MCP tool name (e.g. `list_projects`) and source filename
 * (e.g. `list-projects.ts`).
 *
 * Kept in sync with the per-tool `server.registerTool('name', …)` calls.
 * The test asserts the variable list matches the actual `registerWith`
 * invocations in `server.ts`, so any drift surfaces here.
 */
const TOOL_REGISTRY: Record<string, { toolName: string; sourceFile: string }> =
  {
    ensureAuthTool: {
      toolName: 'ensure_auth',
      sourceFile: 'ensure-auth.ts',
    },
    listProjectsTool: {
      toolName: 'list_projects',
      sourceFile: 'list-projects.ts',
    },
    selectProjectTool: {
      toolName: 'select_project',
      sourceFile: 'select-project.ts',
    },
    detectBaselineTool: {
      toolName: 'detect_baseline',
      sourceFile: 'detect-baseline.ts',
    },
    extractDiffSurfaceTool: {
      toolName: 'extract_diff_surface',
      sourceFile: 'extract-diff-surface.ts',
    },
    analyzeCodebaseTool: {
      toolName: 'analyze_codebase',
      sourceFile: 'analyze-codebase.ts',
    },
    recommendRolloutStrategyTool: {
      toolName: 'recommend_rollout_strategy',
      sourceFile: 'recommend-rollout-strategy.ts',
    },
    proposeMetricsTool: {
      toolName: 'propose_metrics',
      sourceFile: 'propose-metrics.ts',
    },
    generateWrapperTool: {
      toolName: 'generate_wrapper',
      sourceFile: 'generate-wrapper.ts',
    },
    readPreferencesTool: {
      toolName: 'read_preferences',
      sourceFile: 'read-preferences.ts',
    },
    writePreferencesTool: {
      toolName: 'write_preferences',
      sourceFile: 'write-preferences.ts',
    },
    tagBaselineCommitTool: {
      toolName: 'tag_baseline_commit',
      sourceFile: 'tag-baseline-commit.ts',
    },
    verifyCohortKeyingTool: {
      toolName: 'verify_cohort_keying',
      sourceFile: 'verify-cohort-keying.ts',
    },
    verifyNoOrphanFlagsTool: {
      toolName: 'verify_no_orphan_flags',
      sourceFile: 'verify-no-orphan-flags.ts',
    },
    verifySafeDefaultsTool: {
      toolName: 'verify_safe_defaults',
      sourceFile: 'verify-safe-defaults.ts',
    },
    verifyNoMixedProviderCallsTool: {
      toolName: 'verify_no_mixed_provider_calls',
      sourceFile: 'verify-no-mixed-provider-calls.ts',
    },
    verifyTelemetryCompletenessTool: {
      toolName: 'verify_telemetry_completeness',
      sourceFile: 'verify-telemetry-completeness.ts',
    },
    verifyRolloutConfigSchemaTool: {
      toolName: 'verify_rollout_config_schema',
      sourceFile: 'verify-rollout-config-schema.ts',
    },
    verifyProviderHealthTool: {
      toolName: 'verify_provider_health',
      sourceFile: 'verify-provider-health.ts',
    },
    readLockfileTool: {
      toolName: 'read_lockfile',
      sourceFile: 'lockfile.ts',
    },
    writeLockfileTool: {
      toolName: 'write_lockfile',
      sourceFile: 'lockfile.ts',
    },
    clearLockfileTool: {
      toolName: 'clear_lockfile',
      sourceFile: 'lockfile.ts',
    },
    writeConfirmationReceiptTool: {
      toolName: 'write_confirmation_receipt',
      sourceFile: 'write-confirmation-receipt.ts',
    },
    readConfirmationReceiptsTool: {
      toolName: 'read_confirmation_receipts',
      sourceFile: 'read-confirmation-receipts.ts',
    },
    guardedCallTool: {
      toolName: 'guarded_call',
      sourceFile: 'guarded-call.ts',
    },
  };

async function readServerSource(): Promise<string> {
  return Bun.file(SERVER_TS_PATH).text();
}

function extractRegisteredVarNames(serverSource: string): string[] {
  const re = /(\w+Tool)\.registerWith\(server/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(serverSource)) !== null) {
    seen.add(m[1]!);
  }
  return [...seen];
}

describe('R-004-2 tool-responsibility test covers every registered tool', () => {
  test('every var in server.ts has a TOOL_REGISTRY entry', async () => {
    const source = await readServerSource();
    const vars = extractRegisteredVarNames(source);
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) {
      expect(TOOL_REGISTRY[v]).toBeDefined();
    }
  });

  test('no boundary violations on any non-allowlisted tool', async () => {
    const source = await readServerSource();
    const vars = extractRegisteredVarNames(source);

    for (const v of vars) {
      const entry = TOOL_REGISTRY[v]!;
      const filePath = join(TOOLS_DIR, entry.sourceFile);
      const result = await analyzeToolSource(filePath);

      if (DEPRECATION_ALLOWLIST.includes(entry.toolName)) {
        // Allowlisted Wave A aliases: violations may exist in source
        // (the original implementation is retained for back-compat
        // tests) — we instead assert the deprecation-warning marker.
        continue;
      }
      expect(
        result.violations,
        `${entry.toolName} (${entry.sourceFile}) has unexpected boundary violations`
      ).toEqual([]);
    }
  });

  test('every allowlisted tool source contains a stderr DEPRECATION warning', async () => {
    const deprecationRe =
      /process\.stderr\.write[\s\S]*?DEPRECATION|log\([^)]*\)\s*;?[\s\S]*?DEPRECATION|['"]DEPRECATION:[^'"]*['"]/;

    for (const toolName of DEPRECATION_ALLOWLIST) {
      // Find the source file in the registry by toolName.
      const entry = Object.values(TOOL_REGISTRY).find(
        (e) => e.toolName === toolName
      );
      expect(
        entry,
        `Allowlisted tool ${toolName} missing from TOOL_REGISTRY`
      ).toBeDefined();
      const filePath = join(TOOLS_DIR, entry!.sourceFile);
      const text = await Bun.file(filePath).text();
      expect(
        deprecationRe.test(text),
        `Allowlisted tool ${toolName} source ${entry!.sourceFile} ` +
          `missing stderr DEPRECATION warning`
      ).toBe(true);
    }
  });
});

describe('R-004-4 Wave A migration covers exactly the four cloud-conceptual tools', () => {
  test('DEPRECATION_ALLOWLIST contains exactly the four named tools', () => {
    expect([...DEPRECATION_ALLOWLIST].sort()).toEqual([
      'extract_diff_surface',
      'list_projects',
      'propose_metrics',
      'recommend_rollout_strategy',
    ]);
  });

  test('each allowlisted tool is registered on rollout-server', async () => {
    const source = await readServerSource();
    const vars = extractRegisteredVarNames(source);
    const registeredToolNames = vars
      .map((v) => TOOL_REGISTRY[v]?.toolName)
      .filter((n): n is string => typeof n === 'string');
    for (const toolName of DEPRECATION_ALLOWLIST) {
      expect(registeredToolNames).toContain(toolName);
    }
  });
});
