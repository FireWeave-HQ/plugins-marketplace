import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readLockfile,
  writeLockfile,
  clearLockfile,
  type LockfileState,
} from './lockfile';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'fw-lockfile-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const SAMPLE_STATE: LockfileState = {
  version: 1,
  lastStep: 'codegen',
  lastStepTimestamp: '2026-05-09T12:00:00.000Z',
  rolloutId: 'roll_abc',
  workingSpec: { feature: { name: 'dark-mode' } },
  diffApplied: true,
};

test('readLockfile returns null when file is absent', async () => {
  const result = await readLockfile(tmpDir);
  expect(result).toBeNull();
});

test('writeLockfile then readLockfile round-trips', async () => {
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const result = await readLockfile(tmpDir);
  expect(result).toEqual(SAMPLE_STATE);
});

test('writeLockfile creates .fireweave/.cache/ if absent', async () => {
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const cacheDir = join(tmpDir, '.fireweave', '.cache');
  const s = await stat(cacheDir);
  expect(s.isDirectory()).toBe(true);
});

test('writeLockfile uses atomic rename (no leftover .tmp on success)', async () => {
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const tmpPath = join(tmpDir, '.fireweave', '.cache', '.lockfile.tmp');
  let exists = true;
  try {
    await stat(tmpPath);
  } catch {
    exists = false;
  }
  expect(exists).toBe(false);
});

test('writeLockfile validates schema (rejects unknown lastStep)', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bad: any = { ...SAMPLE_STATE, lastStep: 'not-a-step' };
  await expect(writeLockfile(bad, tmpDir)).rejects.toThrow();
});

test('readLockfile returns null on corrupt JSON (recovery)', async () => {
  const cacheDir = join(tmpDir, '.fireweave', '.cache');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, '.lockfile'), '{ this is not json');
  const result = await readLockfile(tmpDir);
  expect(result).toBeNull();
});

test('readLockfile returns null on schema mismatch (recovery)', async () => {
  const cacheDir = join(tmpDir, '.fireweave', '.cache');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, '.lockfile'),
    JSON.stringify({ version: 99, lastStep: 'unknown' }),
  );
  const result = await readLockfile(tmpDir);
  expect(result).toBeNull();
});

test('clearLockfile removes the file', async () => {
  await writeLockfile(SAMPLE_STATE, tmpDir);
  await clearLockfile(tmpDir);
  const result = await readLockfile(tmpDir);
  expect(result).toBeNull();
});

test('clearLockfile is idempotent when file is absent', async () => {
  await expect(clearLockfile(tmpDir)).resolves.toBeUndefined();
});

test('writeLockfile creates .gitignore with .fireweave/.cache/ when absent', async () => {
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
  expect(content).toContain('.fireweave/.cache/');
});

test('writeLockfile appends to existing .gitignore (preserves prior entries)', async () => {
  await writeFile(join(tmpDir, '.gitignore'), 'node_modules\ndist\n');
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
  expect(content).toContain('node_modules');
  expect(content).toContain('dist');
  expect(content).toContain('.fireweave/.cache/');
});

test('writeLockfile does not duplicate gitignore entry when already present', async () => {
  await writeFile(
    join(tmpDir, '.gitignore'),
    'node_modules\n.fireweave/.cache/\n',
  );
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
  const occurrences = content.split('.fireweave/.cache/').length - 1;
  expect(occurrences).toBe(1);
});

test('writeLockfile recognises the un-trailing-slash variant of the gitignore line', async () => {
  await writeFile(join(tmpDir, '.gitignore'), '.fireweave/.cache\n');
  await writeLockfile(SAMPLE_STATE, tmpDir);
  const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
  // We should NOT have appended a duplicate.
  const occurrences = content.split(/\.fireweave\/\.cache/).length - 1;
  expect(occurrences).toBe(1);
});

test('partial discovery state writes successfully (rolloutId optional)', async () => {
  const partial: LockfileState = {
    version: 1,
    lastStep: 'discovery',
    lastStepTimestamp: '2026-05-09T12:00:00.000Z',
  };
  await writeLockfile(partial, tmpDir);
  const result = await readLockfile(tmpDir);
  expect(result).toEqual(partial);
});

test('register-step state captures rolloutId for force-push detection', async () => {
  const registerState: LockfileState = {
    version: 1,
    lastStep: 'register',
    lastStepTimestamp: '2026-05-09T12:00:00.000Z',
    rolloutId: 'roll_xyz',
  };
  await writeLockfile(registerState, tmpDir);
  const result = await readLockfile(tmpDir);
  expect(result?.rolloutId).toBe('roll_xyz');
});
