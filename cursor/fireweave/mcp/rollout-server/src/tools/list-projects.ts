/**
 * Wave A deprecation alias for `list_projects`.
 *
 * Per pitch 026 §MCP Responsibility Split, `list_projects` is a cloud
 * tool — its target server is `fireweave-server-proxy`. This file is the
 * rollout-server-side shim that preserves the existing tool name (so
 * skill prose `mcp__rollout-server__list_projects` keeps functioning),
 * forwards to the proxy via a DI-injected forwarder, and writes a
 * `DEPRECATION` warning to `process.stderr` on every invocation.
 *
 * Forwarder shape: the dispatch is supplied at registration time (same
 * DI pattern as Scope 003's `createGuardedCall`). The default forwarder
 * returns a structured `NOT_YET_MIGRATED` envelope because the
 * cloud-side `list_projects` implementation is a downstream concern
 * (pitch 026 §Dependencies — cloud tools land in a future scope).
 *
 * R-IDs: R-004-3, R-004-4
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface Project {
  id: string;
  name: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ListProjectsOpts {
  fetch?: FetchLike;
  baseUrl: string;
  accessToken: string;
}

/**
 * Pre-Wave-A implementation. Retained for tests that exercise the
 * historical cloud round-trip — `list_projects.test.ts` still covers
 * the upstream HTTP shape. The MCP registration NO LONGER calls this;
 * the registration delegates to the DI-injected forwarder.
 */
export async function listProjects(
  opts: ListProjectsOpts
): Promise<{ projects: Project[] }> {
  const {
    fetch: fetchFn = globalThis.fetch as FetchLike,
    baseUrl,
    accessToken,
  } = opts;

  const res = await fetchFn(`${baseUrl}/api/cli/projects`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) {
    throw Object.assign(
      new Error('Unauthorized: access token is invalid or expired'),
      { status: 401 }
    );
  }

  if (!res.ok) {
    throw new Error(`list_projects request failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    projects?: Project[];
    success?: boolean;
    data?: { projects?: Project[] };
  };
  // Server returns either { projects } directly or { success, data: { projects } }
  const projects = body.projects ?? body.data?.projects ?? [];
  return { projects };
}

// ---------------------------------------------------------------------------
// Wave A alias plumbing
// ---------------------------------------------------------------------------

/** DEPRECATION warning emitted to stderr on every alias invocation. */
const DEPRECATION_MESSAGE =
  'DEPRECATION: list_projects has moved to fireweave-server-proxy; this ' +
  'alias will be removed in a future release.';

export interface AliasForwarder {
  (args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Default v1 forwarder — returns the `NOT_YET_MIGRATED` envelope because
 * the cloud-side `list_projects` tool has not been authored yet. The
 * shape is structured so the skill can detect it during the Wave A
 * soft-migration window.
 */
export const defaultListProjectsForwarder: AliasForwarder = async () => ({
  error: {
    code: 'NOT_YET_MIGRATED',
    message:
      'list_projects is being migrated to fireweave-server-proxy; ' +
      'cloud-side implementation not yet shipped.',
  },
});

export interface RunListProjectsAliasDeps {
  forwarder?: AliasForwarder;
  /** Logger — defaults to `process.stderr.write`. Injected for tests. */
  log?: (msg: string) => void;
  /** Increment tool-usage counter (R-004-7). Defaults to no-op. */
  incrementUsage?: (toolName: string) => void;
}

/**
 * Run the alias: emit the deprecation warning, increment the usage
 * counter, then delegate to the forwarder. Returns the forwarder's
 * response unchanged.
 *
 * Note: `list_projects` is NOT a receipt-gated tool (no entry in
 * `RECEIPT_REQUIREMENTS`). The receipt-guard layering documented in
 * the scope-004 task spec applies only to `propose_metrics` and
 * `recommend_rollout_strategy`; for `list_projects` the wrapper is
 * just `deprecation-warn → forward-to-proxy`.
 */
export async function runListProjectsAlias(
  args: Record<string, unknown>,
  deps: RunListProjectsAliasDeps = {}
): Promise<unknown> {
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  log(DEPRECATION_MESSAGE);
  deps.incrementUsage?.('list_projects');
  const forwarder = deps.forwarder ?? defaultListProjectsForwarder;
  return forwarder(args);
}

const ListProjectsInputSchema = z.object({}).passthrough();

export interface ListProjectsToolRegistrationOpts {
  forwarder?: AliasForwarder;
  incrementUsage?: (toolName: string) => void;
}

export const listProjectsTool = {
  registerWith(server: McpServer, opts: ListProjectsToolRegistrationOpts = {}) {
    server.registerTool(
      'list_projects',
      {
        title: 'List Projects (deprecation alias)',
        description:
          'Wave A deprecation alias — forwards to fireweave-server-proxy. ' +
          'Emits a DEPRECATION warning to stderr on every call. The ' +
          'cloud-side implementation lives on the upstream /api/mcp server.',
        inputSchema: ListProjectsInputSchema.shape,
      },
      async (args) => {
        const result = await runListProjectsAlias(
          (args as Record<string, unknown>) ?? {},
          opts
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
  },
};
