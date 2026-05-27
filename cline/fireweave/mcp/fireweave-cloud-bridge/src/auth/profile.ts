/**
 * Read-only client for the unified `fw-cli` profile store at
 * `~/.fireweave/profiles/<alias>.json`. Mirrors the resolver in
 * `packages/fw-cli/src/auth/profile.ts` so this MCP server can find
 * the active profile and use its access token + server URL without
 * its own OAuth flow.
 *
 * Resolver order (matches fw-cli):
 *   1. FW_PROFILE env var (override)
 *   2. <cwd>/.fireweave/rollout.config.json `profile` field
 *   3. ~/.fireweave/config.json `activeProfile`
 *   4. exactly one profile on disk → use it
 *   5. otherwise: { kind: 'missing', reason }
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

export type ProfileKind = 'cloud' | 'custom';

export interface Profile {
  version: 2;
  alias: string;
  kind: ProfileKind;
  server_url: string;
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
  issued_at: string;
  user: { id: string; name?: string; email?: string };
  org: { id: string; name?: string };
}

export interface ResolveOptions {
  /** Override home directory (test injection). */
  home?: string;
  /** Override repo cwd for the per-repo `profile` field. */
  cwd?: string;
  /** Explicit profile alias to use (env var FW_PROFILE or programmatic). */
  flagAlias?: string;
}

export type ResolveResult =
  | {
      kind: 'ok';
      profile: Profile;
      source: 'flag' | 'repo' | 'global-default' | 'sole';
    }
  | { kind: 'missing'; reason: string };

function profilesDir(home: string): string {
  return join(home, '.fireweave', 'profiles');
}

function profilePath(alias: string, home: string): string {
  return join(profilesDir(home), `${alias}.json`);
}

function homeConfigPath(home: string): string {
  return join(home, '.fireweave', 'config.json');
}

function isProfile(raw: unknown): raw is Profile {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (r.version !== 2) return false;
  if (typeof r.alias !== 'string') return false;
  if (r.kind !== 'cloud' && r.kind !== 'custom') return false;
  if (typeof r.server_url !== 'string') return false;
  if (typeof r.access_token !== 'string') return false;
  if (typeof r.refresh_token !== 'string') return false;
  if (!r.user || typeof r.user !== 'object') return false;
  if (typeof (r.user as { id?: unknown }).id !== 'string') return false;
  if (!r.org || typeof r.org !== 'object') return false;
  if (typeof (r.org as { id?: unknown }).id !== 'string') return false;
  return true;
}

export function loadProfile(
  alias: string,
  home: string = homedir()
): Profile | null {
  try {
    const path = profilePath(alias, home);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return isProfile(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function listProfiles(home: string = homedir()): Profile[] {
  let entries: string[];
  try {
    entries = readdirSync(profilesDir(home));
  } catch {
    return [];
  }
  const profiles: Profile[] = [];
  for (const e of entries) {
    if (!e.endsWith('.json')) continue;
    const alias = e.slice(0, -'.json'.length);
    const p = loadProfile(alias, home);
    if (p) profiles.push(p);
  }
  profiles.sort((a, b) => a.alias.localeCompare(b.alias));
  return profiles;
}

interface HomeConfig {
  activeProfile?: string | null;
}

function loadHomeConfig(home: string): HomeConfig {
  try {
    const path = homeConfigPath(home);
    if (!existsSync(path)) return {};
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      activeProfile:
        typeof raw.activeProfile === 'string' ? raw.activeProfile : null,
    };
  } catch {
    return {};
  }
}

interface RepoConfig {
  profile?: string;
}

function loadRepoConfig(cwd: string): RepoConfig | null {
  try {
    const path = join(cwd, '.fireweave', 'rollout.config.json');
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      profile: typeof raw.profile === 'string' ? raw.profile : undefined,
    };
  } catch {
    return null;
  }
}

export function resolveActiveProfile(opts: ResolveOptions = {}): ResolveResult {
  const home = opts.home ?? homedir();
  const cwd = opts.cwd ?? process.cwd();

  // 1. Flag / env override
  const flagAlias = opts.flagAlias ?? process.env.FW_PROFILE;
  if (flagAlias) {
    const p = loadProfile(flagAlias, home);
    if (p) return { kind: 'ok', profile: p, source: 'flag' };
    return {
      kind: 'missing',
      reason: `Profile '${flagAlias}' (from FW_PROFILE) not found in ~/.fireweave/profiles/`,
    };
  }

  // 2. Repo binding
  const repoCfg = loadRepoConfig(cwd);
  if (repoCfg?.profile) {
    const p = loadProfile(repoCfg.profile, home);
    if (p) return { kind: 'ok', profile: p, source: 'repo' };
    return {
      kind: 'missing',
      reason: `Repo pinned to profile '${repoCfg.profile}', but it no longer exists. Run \`fw init\` to re-bind.`,
    };
  }

  // 3. Global default
  const homeCfg = loadHomeConfig(home);
  if (homeCfg.activeProfile) {
    const p = loadProfile(homeCfg.activeProfile, home);
    if (p) return { kind: 'ok', profile: p, source: 'global-default' };
  }

  // 4. Sole profile
  const all = listProfiles(home);
  if (all.length === 1) return { kind: 'ok', profile: all[0]!, source: 'sole' };

  // 5. Missing
  if (all.length === 0) {
    return {
      kind: 'missing',
      reason:
        'No Fireweave profiles found. Run `fw login` (or `fw init` for guided setup).',
    };
  }
  return {
    kind: 'missing',
    reason: `Multiple profiles exist (${all.map((p) => p.alias).join(', ')}). Run \`fw profile use <alias>\` to set the active one.`,
  };
}

/**
 * Convenience: resolve the active profile and return just the bits MCP tools
 * need. Throws on missing — callers can catch to format an MCP error.
 */
export function ensureAuth(opts: ResolveOptions = {}): {
  accessToken: string;
  baseUrl: string;
  profile: Profile;
} {
  const r = resolveActiveProfile(opts);
  if (r.kind === 'missing') {
    throw new Error(r.reason);
  }
  return {
    accessToken: r.profile.access_token,
    baseUrl: r.profile.server_url,
    profile: r.profile,
  };
}
