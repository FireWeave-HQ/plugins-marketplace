/**
 * MCP↔REST translator for fireweave-cloud-bridge.
 *
 * Each MCP `tools/call` is mapped via T2's source-pinned `bridgeManifest`:
 *   1. Look up `bridgeManifest[name]` → { verb, path, inputSchema }.
 *   2. Validate `args` against `inputSchema` (zod).
 *   3. Substitute `{paramName}` segments of `entry.path` with
 *      `args[paramName]`, consuming those keys from a working clone so they
 *      do not leak into body / query.
 *   4. Build `${profile.server_url}${interpolatedPath}` with a Bearer header.
 *   5. POST/PATCH → remaining args JSON-encoded into the body.
 *      GET/DELETE → remaining args appended as query string.
 *   6. `fetch(url, init)`.
 *   7. 2xx → wrap parsed JSON as `{ content: [{ type: 'text', text }] }`.
 *      non-2xx → same shape with `isError: true` and `upstream <status>: <body>`.
 *
 * R-003-5 invariant: no runtime fetch of the tool list. The manifest is
 * source-pinned via T2's import; build-time pin > runtime discovery.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { bridgeManifest } from './manifest';

/**
 * Outbound `User-Agent` for every REST call. Stamped onto each fetch so
 * fw-server cloud-side observability can attribute /v1/* traffic to the
 * bridge (pitch 033 scope-006 R-006-1). Source-pinned from
 * `../package.json` to keep the value in lock-step with the published
 * version — no environment-driven override.
 */
import packageJson from '../package.json' with { type: 'json' };
const USER_AGENT = `fireweave-cloud-bridge/${packageJson.version}`;

export interface ResolvedProfile {
  alias: string;
  server_url: string;
  access_token: string;
}

export interface BuildProxyOptions {
  resolveProfile: () =>
    | Promise<ResolvedProfile | null>
    | ResolvedProfile
    | null;
}

export interface ProxyHandle {
  server: Server;
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResult>;
}

const PATH_PARAM_PATTERN = /\{([^/{}]+)\}/g;

const VERBS_WITH_BODY = new Set(['POST', 'PATCH', 'PUT']);

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function okResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

async function readUpstreamBody(res: Response): Promise<string> {
  const raw = await res.text();
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function substitutePath(
  pathTemplate: string,
  args: Record<string, unknown>
): { path: string; remaining: Record<string, unknown> } {
  const remaining = { ...args };
  const path = pathTemplate.replace(PATH_PARAM_PATTERN, (_, key: string) => {
    const value = remaining[key];
    delete remaining[key];
    return encodeURIComponent(String(value ?? ''));
  });
  return { path, remaining };
}

function buildQueryString(remaining: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(remaining)) {
    if (value === undefined || value === null) continue;
    params.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function buildProxy(
  opts: BuildProxyOptions
): Promise<ProxyHandle> {
  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> => {
    const entry = bridgeManifest[name];
    if (!entry) return errorResult(`unknown tool: ${name}`);

    const parsed = entry.inputSchema.safeParse(args);
    if (!parsed.success) {
      return errorResult(`invalid args for ${name}: ${parsed.error.message}`);
    }

    const profile = await Promise.resolve(opts.resolveProfile());
    if (!profile) {
      return errorResult(
        'no active Fireweave profile. Run `fw login` (or `fw init`) and retry.'
      );
    }

    const validatedArgs = parsed.data as Record<string, unknown>;
    const { path, remaining } = substitutePath(entry.path, validatedArgs);

    const verb = entry.verb.toUpperCase();
    const hasBody = VERBS_WITH_BODY.has(verb);
    const url = hasBody
      ? `${profile.server_url}${path}`
      : `${profile.server_url}${path}${buildQueryString(remaining)}`;

    const init: RequestInit = {
      method: verb,
      headers: {
        Authorization: `Bearer ${profile.access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      ...(hasBody ? { body: JSON.stringify(remaining) } : {}),
    };

    const res = await fetch(url, init);

    if (!res.ok) {
      const body = await readUpstreamBody(res);
      return errorResult(`upstream ${res.status}: ${body}`);
    }

    const text = await res.text();
    const payload = text ? safeJsonParse(text) : null;
    return okResult(payload);
  };

  const server = new Server(
    { name: 'fireweave-cloud-bridge', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = Object.entries(bridgeManifest).map(([name, entry]) => ({
      name,
      description: `${entry.verb} ${entry.path}`,
      inputSchema: zodObjectToJsonSchema(entry.inputSchema),
    }));
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return callTool(request.params.name, args);
  });

  return { server, callTool };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Minimal Zod-object → JSON-Schema-ish projection for MCP `tools/list`.
 * The MCP SDK accepts any object-shaped JSON schema here; we only need the
 * property names + a generic string type for primitive path params.
 * Bodies are validated upstream — the bridge is the wire-level shim, not
 * the contract authority.
 */
function zodObjectToJsonSchema(schema: z.ZodType): {
  type: 'object';
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
} {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      properties[key] = { type: 'string' };
    }
    return { type: 'object', properties, additionalProperties: true };
  }
  return { type: 'object', additionalProperties: true };
}
