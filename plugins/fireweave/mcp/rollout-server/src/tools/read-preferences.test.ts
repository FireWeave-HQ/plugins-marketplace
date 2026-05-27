import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPreferences } from './read-preferences';

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
  tmpDir = await mkdtemp(join(tmpdir(), 'rollout-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test('read_preferences returns config when file is present', async () => {
  const configDir = join(tmpDir, '.fireweave');
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'rollout.config.json'), JSON.stringify(VALID_CONFIG));

  const result = await readPreferences(tmpDir);
  expect(result.found).toBe(true);
  if (result.found) {
    expect(result.config.projectId).toBe('proj-456');
    expect(result.config.version).toBe(1);
  }
});

test('read_preferences returns found=false when file is absent', async () => {
  const result = await readPreferences(tmpDir);
  expect(result.found).toBe(false);
  expect(result.config).toBeNull();
});
