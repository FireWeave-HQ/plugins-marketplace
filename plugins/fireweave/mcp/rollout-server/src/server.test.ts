import { test, expect } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
} from './index';

// `discover_integrations` and `register_rollout` were removed as part of the
// 2026-05-10 unified-auth + proxy refactor — the proxy exposes the canonical
// versions from fw-server's MCP registry, eliminating duplicated REST clients.
test('server smoke: all 22 local tools register without error', () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });

  const tools = [
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
    // B10 — skill resume + force-push detection
    readLockfileTool,
    writeLockfileTool,
    clearLockfileTool,
  ];

  expect(() => {
    for (const tool of tools) {
      tool.registerWith(server);
    }
  }).not.toThrow();

  expect(tools.length).toBe(22);
});
