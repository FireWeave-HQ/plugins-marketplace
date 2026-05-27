#!/usr/bin/env bun
/**
 * Entrypoint for fireweave-cloud-bridge. Resolves the active fw-cli profile,
 * runs a startup `GET /v1/whoami` auth probe, then builds the MCP↔REST proxy
 * (T3) and connects it to stdio for Claude Code.
 *
 * The probe (T4 / R-003-7) has three outcomes:
 *   - 2xx                 → continue to buildProxy + transport.connect.
 *   - 401 / 403           → write 'run `fw login`' to stderr, exit(1).
 *   - thrown / other non-2xx → warn 'no-auth-verified mode' to stderr,
 *                              continue (best-effort offline-tolerant start).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildProxy as defaultBuildProxy } from './proxy';
import { resolveActiveProfile } from './auth/profile';
import type { ResolvedProfile } from './proxy';

// `server` is intentionally typed loosely: tests inject `{ connect: Mock }`
// fakes, and prod injects the MCP SDK `Server`. Both shapes carry a
// compatible `.connect(...)` and that is all this entrypoint relies on.
type ServerLike = { connect: (...args: never[]) => Promise<void> };

export interface StartupOpts {
  resolveProfile: () => ResolvedProfile | null;
  buildProxy: (opts: {
    resolveProfile: () => ResolvedProfile | null;
  }) => Promise<{ server: ServerLike }>;
  fetch?: typeof fetch;
  stderr?: { write: (msg: string) => void };
  exit?: (code: number) => void;
  connectTransport?: (server: ServerLike) => Promise<void>;
}

export async function runStartup(opts: StartupOpts): Promise<void> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const stderr = opts.stderr ?? process.stderr;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const connectTransport =
    opts.connectTransport ??
    (async (server) => {
      const transport = new StdioServerTransport();
      await (server.connect as (t: StdioServerTransport) => Promise<void>)(
        transport
      );
    });

  const profile = opts.resolveProfile();
  if (!profile) {
    stderr.write(
      '[fireweave-cloud-bridge] no active profile — run `fw login`\n'
    );
    exit(1);
    return;
  }

  try {
    const res = await fetchFn(`${profile.server_url}/v1/whoami`, {
      headers: { Authorization: `Bearer ${profile.access_token}` },
    });
    if (res.status === 401 || res.status === 403) {
      stderr.write(
        `[fireweave-cloud-bridge] startup failed: run \`fw login\` (whoami returned ${res.status})\n`
      );
      exit(1);
      return;
    }
    if (res.status >= 400) {
      stderr.write(
        `[fireweave-cloud-bridge] whoami probe non-2xx (${res.status}) — entering no-auth-verified mode\n`
      );
    }
  } catch {
    stderr.write(
      '[fireweave-cloud-bridge] whoami probe network-unreachable — entering no-auth-verified mode\n'
    );
  }

  const handle = await opts.buildProxy({ resolveProfile: () => profile });
  await connectTransport(handle.server);
}

if (import.meta.main) {
  runStartup({
    resolveProfile: () => {
      const r = resolveActiveProfile();
      if (r.kind === 'missing') return null;
      return {
        alias: r.profile.alias,
        server_url: r.profile.server_url,
        access_token: r.profile.access_token,
      };
    },
    buildProxy: async (opts) => {
      const handle = await defaultBuildProxy(opts);
      return { server: handle.server };
    },
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[fireweave-cloud-bridge] startup failed: ${message}\n`
    );
    process.exit(1);
  });
}
