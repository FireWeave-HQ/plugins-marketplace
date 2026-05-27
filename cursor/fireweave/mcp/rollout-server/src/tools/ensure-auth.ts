/**
 * `ensure_auth` MCP tool.
 *
 * Reads the active Fireweave profile from `~/.fireweave/profiles/<alias>.json`
 * (the unified `fw-cli` profile store). Returns the resolved server URL and
 * a redacted summary on success; returns a structured error pointing the
 * user at `fw login` / `fw init` when no profile is available.
 *
 * Note: This tool no longer drives its own OAuth device flow. The fw CLI
 * (`fw login`, `fw init`) is now the only place tokens are minted; the
 * MCP server simply consumes them.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureAuth as resolveAuth, resolveActiveProfile } from '../auth/profile';
import type { Profile, ResolveOptions } from '../auth/profile';

export interface EnsureAuthResult {
  ok: true;
  profile: string;
  kind: 'cloud' | 'custom';
  server_url: string;
  user: { id: string; name?: string; email?: string };
  org: { id: string; name?: string };
  source: 'flag' | 'repo' | 'global-default' | 'sole';
}

export interface EnsureAuthFailure {
  ok: false;
  error: string;
}

/**
 * Programmatic API used by other tools — returns the access token + base URL,
 * not the public-safe summary. Throws on missing.
 */
export function ensureAuth(opts: ResolveOptions = {}): { accessToken: string; baseUrl: string; profile: Profile } {
  return resolveAuth(opts);
}

/** Public-safe summary of the active profile (no tokens). */
export function describeActiveProfile(opts: ResolveOptions = {}): EnsureAuthResult | EnsureAuthFailure {
  const r = resolveActiveProfile(opts);
  if (r.kind === 'missing') {
    return { ok: false, error: r.reason };
  }
  return {
    ok: true,
    profile: r.profile.alias,
    kind: r.profile.kind,
    server_url: r.profile.server_url,
    user: r.profile.user,
    org: r.profile.org,
    source: r.source,
  };
}

export const ensureAuthTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'ensure_auth',
      {
        title: 'Ensure Auth',
        description:
          'Resolves the active Fireweave profile from `~/.fireweave/profiles/`. ' +
          'Returns the alias / kind / server URL / user / org. ' +
          'If no profile is found, returns an error pointing the user to `fw login` or `fw init`. ' +
          'This tool never mints tokens itself — use the `fw` CLI for login.',
        inputSchema: z.object({}).shape,
      },
      async () => {
        const summary = describeActiveProfile();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
        };
      },
    );
  },
};
