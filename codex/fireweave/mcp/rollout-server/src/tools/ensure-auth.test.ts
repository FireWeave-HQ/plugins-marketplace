import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureAuth, describeActiveProfile } from './ensure-auth';
import type { Profile } from '../auth/profile';

let tmpHome: string;
let tmpCwd: string;
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'rs-auth-h-'));
  tmpCwd = mkdtempSync(join(tmpdir(), 'rs-auth-c-'));
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

function makeProfile(alias: string, overrides: Partial<Profile> = {}): Profile {
  return {
    version: 2,
    alias,
    kind: 'cloud',
    server_url: 'https://app-server.fireweave.ai',
    access_token: 'cli_at_test',
    refresh_token: 'cli_rt_test',
    access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86_400_000 * 30).toISOString(),
    issued_at: new Date().toISOString(),
    user: { id: `u_${alias}`, name: 'Alice' },
    org: { id: `org_${alias}` },
    ...overrides,
  };
}

function writeProfile(home: string, p: Profile) {
  const dir = join(home, '.fireweave', 'profiles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${p.alias}.json`), JSON.stringify(p, null, 2));
}

function writeHomeConfig(home: string, activeProfile: string) {
  const dir = join(home, '.fireweave');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ activeProfile }));
}

test('ensureAuth returns access token + base URL from active profile', () => {
  writeProfile(tmpHome, makeProfile('dev'));
  writeHomeConfig(tmpHome, 'dev');
  const r = ensureAuth({ home: tmpHome, cwd: tmpCwd });
  expect(r.accessToken).toBe('cli_at_test');
  expect(r.baseUrl).toBe('https://app-server.fireweave.ai');
  expect(r.profile.alias).toBe('dev');
});

test('ensureAuth uses sole profile when nothing else is set', () => {
  writeProfile(tmpHome, makeProfile('only'));
  const r = ensureAuth({ home: tmpHome, cwd: tmpCwd });
  expect(r.profile.alias).toBe('only');
});

test('ensureAuth honors per-repo profile binding', () => {
  writeProfile(tmpHome, makeProfile('alice'));
  writeProfile(tmpHome, makeProfile('bob', { server_url: 'http://other:3001', access_token: 'cli_at_bob' }));
  writeHomeConfig(tmpHome, 'alice');
  const repoDir = join(tmpCwd, '.fireweave');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, 'rollout.config.json'), JSON.stringify({ profile: 'bob' }));

  const r = ensureAuth({ home: tmpHome, cwd: tmpCwd });
  expect(r.profile.alias).toBe('bob');
  expect(r.accessToken).toBe('cli_at_bob');
  expect(r.baseUrl).toBe('http://other:3001');
});

test('ensureAuth honors flagAlias override (FW_PROFILE-equivalent)', () => {
  writeProfile(tmpHome, makeProfile('alice'));
  writeProfile(tmpHome, makeProfile('bob', { access_token: 'cli_at_bob' }));
  writeHomeConfig(tmpHome, 'alice');
  const r = ensureAuth({ home: tmpHome, cwd: tmpCwd, flagAlias: 'bob' });
  expect(r.profile.alias).toBe('bob');
});

test('ensureAuth throws when no profile exists', () => {
  expect(() => ensureAuth({ home: tmpHome, cwd: tmpCwd })).toThrow(/No Fireweave profiles/);
});

test('ensureAuth throws when multiple profiles exist with no default', () => {
  writeProfile(tmpHome, makeProfile('alice'));
  writeProfile(tmpHome, makeProfile('bob'));
  expect(() => ensureAuth({ home: tmpHome, cwd: tmpCwd })).toThrow(/Multiple profiles exist/);
});

test('describeActiveProfile returns redacted summary (no tokens)', () => {
  writeProfile(tmpHome, makeProfile('dev'));
  writeHomeConfig(tmpHome, 'dev');
  const r = describeActiveProfile({ home: tmpHome, cwd: tmpCwd });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.profile).toBe('dev');
    expect(r.kind).toBe('cloud');
    expect(r.server_url).toBe('https://app-server.fireweave.ai');
    expect(r.user.name).toBe('Alice');
    expect((r as unknown as Record<string, unknown>).access_token).toBeUndefined();
  }
});

test('describeActiveProfile returns ok:false with helpful reason when missing', () => {
  const r = describeActiveProfile({ home: tmpHome, cwd: tmpCwd });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatch(/fw login|fw init/);
  }
});
