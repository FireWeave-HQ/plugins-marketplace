import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writePreferences } from './write-preferences';

const VALID_CONFIG = {
  version: 1 as const,
  orgId: 'org-123',
  projectId: 'proj-456',
  projectName: 'my-project',
  feature: {
    name: 'dark-mode',
    description: 'Dark mode rollout',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  flags: [{
    key: 'dark-mode-flag',
    providerId: 'posthog',
    type: 'boolean' as const,
    safeDefault: false,
  }],
  rollout: {
    style: 'linear-percent' as const,
    schedule: [{ percent: 10, holdMinutes: 60 }, { percent: 100, holdMinutes: 0 }],
    guardrails: [],
  },
  wrapPoints: [{ file: 'src/app.ts', symbol: 'renderApp', wrapStyle: 'function-guard' as const, flagKey: 'dark-mode-flag' }],
  providers: {
    'feature-flag.control': 'posthog',
    'feature-flag.evaluation': 'posthog',
    'error.regression-detection': null,
    'metric.query': null,
    'log.ingestion': null,
    'trace.distributed': null,
    'flag.change-feed': null,
    'alert.lifecycle': null,
    'experiment.lifecycle': null,
  },
  metrics: [],
  verification: {
    cohort_keying: 'advisory' as const,
    no_orphan_flags: 'advisory' as const,
    safe_defaults: 'block' as const,
    no_mixed_provider_calls: 'advisory' as const,
    telemetry_completeness: 'skip' as const,
    rollout_config_schema: 'block' as const,
    provider_health: 'advisory' as const,
  },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rollout-write-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test('write_preferences writes valid config with sorted keys and 2-space indent', async () => {
  const result = await writePreferences(VALID_CONFIG, tmpDir);
  expect(result.written).toBe(true);
  expect(result.path).toContain('.fireweave/rollout.config.json');

  const content = await readFile(result.path, 'utf-8');
  const parsed = JSON.parse(content);

  // Verify content round-trips correctly
  expect(parsed.version).toBe(1);
  expect(parsed.projectId).toBe('proj-456');

  // Verify sorted keys at top level
  const keys = Object.keys(parsed);
  const sortedKeys = [...keys].sort();
  expect(keys).toEqual(sortedKeys);

  // Verify 2-space indentation
  expect(content).toContain('  "version"');
});
