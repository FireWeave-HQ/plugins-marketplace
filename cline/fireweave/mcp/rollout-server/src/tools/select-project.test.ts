import { test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { selectProject } from './select-project';

const PROJECTS = [
  { id: 'proj-alpha', name: 'Alpha' },
  { id: 'proj-beta', name: 'Beta' },
];

let tmpDir: string | null = null;

async function makeTmp(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'select-project-test-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ---------------------------------------------------------------------------
// Creates new config file when absent
// ---------------------------------------------------------------------------
test('select_project writes new config when file absent', async () => {
  const dir = await makeTmp();
  const configPath = join(dir, '.fireweave', 'rollout.config.json');

  const result = await selectProject({
    projectId: 'proj-alpha',
    projectName: 'Alpha',
    projects: PROJECTS,
    configPath,
  });

  expect(result.projectId).toBe('proj-alpha');
  expect(result.projectName).toBe('Alpha');
  expect(result.configPath).toBe(configPath);

  const written = await Bun.file(configPath).json() as Record<string, unknown>;
  expect(written.projectId).toBe('proj-alpha');
  expect(written.projectName).toBe('Alpha');
});

// ---------------------------------------------------------------------------
// Merges into existing config, preserving other fields
// ---------------------------------------------------------------------------
test('select_project merges projectId/projectName into existing config', async () => {
  const dir = await makeTmp();
  const configPath = join(dir, 'rollout.config.json');

  // Pre-write a config with extra fields
  await Bun.write(configPath, JSON.stringify({ version: 1, orgId: 'org-x', projectId: 'old-id', extra: 'preserved' }, null, 2));

  await selectProject({
    projectId: 'proj-beta',
    projectName: 'Beta',
    projects: PROJECTS,
    configPath,
  });

  const written = await Bun.file(configPath).json() as Record<string, unknown>;
  expect(written.projectId).toBe('proj-beta');
  expect(written.projectName).toBe('Beta');
  // Other fields preserved
  expect(written.orgId).toBe('org-x');
  expect(written.extra).toBe('preserved');
  expect(written.version).toBe(1);
});

// ---------------------------------------------------------------------------
// Validates against provided projects list
// ---------------------------------------------------------------------------
test('select_project throws when projectId not in list', async () => {
  const dir = await makeTmp();
  const configPath = join(dir, 'rollout.config.json');

  await expect(
    selectProject({
      projectId: 'proj-unknown',
      projectName: 'Unknown',
      projects: PROJECTS,
      configPath,
    }),
  ).rejects.toThrow('proj-unknown');
});

// ---------------------------------------------------------------------------
// Handles malformed existing JSON gracefully
// ---------------------------------------------------------------------------
test('select_project overwrites malformed existing JSON', async () => {
  const dir = await makeTmp();
  const configPath = join(dir, 'rollout.config.json');

  await Bun.write(configPath, '{ not valid json !!!');

  const result = await selectProject({
    projectId: 'proj-alpha',
    projectName: 'Alpha',
    projects: PROJECTS,
    configPath,
  });

  expect(result.projectId).toBe('proj-alpha');
  const written = await Bun.file(configPath).json() as Record<string, unknown>;
  expect(written.projectId).toBe('proj-alpha');
});
