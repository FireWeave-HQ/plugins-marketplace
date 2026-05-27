/**
 * Acceptance test for T3 — bridge MCP <-> REST translator (proxy.ts).
 *
 * R-IDs: R-003-4
 *   - R-003-4 (NON-NEG) @usecase
 *     bridge.callTool('register_rollout', { metadata, participant })
 *       -> translates to POST /v1/rollouts with correct body, returns
 *          response wrapped in MCP CallToolResult shape;
 *     bridge.callTool('seal_rollout', { rolloutId })
 *       -> translates to POST /v1/rollouts/:rolloutId/seal.
 *
 * Translator contract (asserted via outbound-fetch capture):
 *   1. Look up bridgeManifest[toolName] (from T2's manifest.ts).
 *   2. Validate args against inputSchema. Reject -> MCP error result.
 *   3. Substitute path templates: '/v1/rollouts/{id}/seal' + args.id
 *      -> '/v1/rollouts/<id>/seal'. Path-param keys are consumed from
 *      the body payload.
 *   4. Build request: `${profile.server_url}${path}` with
 *      Authorization: Bearer ${profile.access_token}.
 *   5. POST/PATCH body = non-path-param args as JSON. GET = query string.
 *   6. Send via global `fetch`.
 *   7. Wrap response in
 *      { content: [{ type: 'text', text: JSON.stringify(body) }] }.
 *   8. On non-2xx: return MCP error result with status + body
 *      (`isError: true` is the documented MCP convention).
 *
 * Public surface contract for the T3 builder:
 *   - Default-import or named-import `buildProxy({ resolveProfile })` from
 *     `../src/proxy`.
 *   - The returned object MUST expose `callTool(toolName: string,
 *     args: Record<string, unknown>): Promise<CallToolResult>` reachable
 *     from this test. The builder is free to either:
 *       (a) expose `callTool` directly on the returned handle, OR
 *       (b) route through the MCP SDK Server's `tools/call` handler.
 *     If (b), the builder MUST add a test-only helper (e.g.
 *     `handle.dispatchTool(name, args)`) that fans the JSON-RPC envelope
 *     `{ method: 'tools/call', params: { name, arguments: args } }` and
 *     returns the CallToolResult — this test calls `callTool` either way.
 *   - TODO(builder): if the natural shape uses Server.setRequestHandler,
 *     export the dispatch helper under the name `callTool` so this test
 *     keeps reading as MCP tool dispatch.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

import { buildProxy } from '../src/proxy';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

const STUB_PROFILE = {
  alias: 'test',
  server_url: 'https://api.test',
  access_token: 'test_token_001',
};

/**
 * Narrow `result.content[0]` from the MCP `CallToolResult` content union
 * (text | image | audio | resource | resource_link) to the `text` member.
 * The MCP SDK types content[0] as a discriminated union; only the `text`
 * variant carries a `.text` field. Tests must narrow before accessing it
 * or `tsc --noEmit` will fail with TS2339.
 */
function expectTextContent(
  content: ReadonlyArray<{ type: string }> | undefined,
  label: string
): { type: 'text'; text: string } {
  const first = content?.[0];
  if (!first || first.type !== 'text') {
    throw new Error(`expected text content[0] for ${label}`);
  }
  // Safe cast: discriminator check above guarantees `text: string` is present.
  return first as { type: 'text'; text: string };
}

describe('R-003-4 @usecase: bridge proxy translates MCP tools/call to REST', () => {
  let fetchCalls: CapturedCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function installFetchMock(
    response: () => Response = () =>
      new Response(
        JSON.stringify({
          rolloutId: 'rollout_abc_001',
          participantId: 'rp_001',
          state: 'wrapping',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
  ): void {
    const fetchMock = mock(
      async (url: string | URL | Request, init: RequestInit = {}) => {
        fetchCalls.push({ url: String(url), init });
        return response();
      }
    );
    // Bun's mock typings return a function that's assignable to global fetch.
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  }

  it('register_rollout -> POST /v1/rollouts with body, returns MCP CallToolResult', async () => {
    installFetchMock();
    const proxy = await buildProxy({ resolveProfile: () => STUB_PROFILE });

    // register_rollout's manifest inputSchema is z.object({}).passthrough(),
    // so any non-path-param payload is valid. These represent the
    // R-003-4 example payload shape: { metadata, participant }.
    const result = await proxy.callTool('register_rollout', {
      metadata: { projectId: 'proj_001', repo: 'org/repo' },
      participant: { ref: 'main', sha: 'abc1234' },
    });

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    if (!call) throw new Error('expected one fetch call');

    expect(call.url).toBe('https://api.test/v1/rollouts');
    expect(call.init.method).toBe('POST');

    // Header capture: Bun's RequestInit headers may be a Headers instance
    // or a plain object. Normalise via Headers for a stable read.
    const headers = new Headers(
      call.init.headers as Record<string, string> | undefined
    );
    expect(headers.get('authorization')).toBe('Bearer test_token_001');

    // Body assertion — non-path-param args MUST be serialised as JSON body.
    // The proxy contract serialises bodies via JSON.stringify, so call.init.body
    // is always a string (or undefined for path-only requests). The non-string
    // branch is defensive — if a future change passes a stream/blob, we route
    // through `Response` to read the text via a double-cast through `unknown`.
    const rawBody = call.init.body;
    const bodyText =
      typeof rawBody === 'string'
        ? rawBody
        : rawBody
          ? await new Response(rawBody as unknown as string).text()
          : '';
    const parsedBody = bodyText ? JSON.parse(bodyText) : {};
    expect(parsedBody).toMatchObject({
      metadata: { projectId: 'proj_001', repo: 'org/repo' },
      participant: { ref: 'main', sha: 'abc1234' },
    });

    // MCP CallToolResult wrapping: { content: [{ type: 'text', text: JSON }] }
    const textContent = expectTextContent(result.content, 'register_rollout');
    expect(textContent.type).toBe('text');
    const wrappedBody = JSON.parse(textContent.text);
    expect(wrappedBody.rolloutId).toBe('rollout_abc_001');
  });

  it('seal_rollout -> POST /v1/rollouts/{id}/seal with path-param interpolation', async () => {
    installFetchMock();
    const proxy = await buildProxy({ resolveProfile: () => STUB_PROFILE });

    // seal_rollout's manifest inputSchema requires { id: string }; that id
    // is consumed by path-template substitution, NOT sent in the body.
    await proxy.callTool('seal_rollout', { id: 'rollout_abc_001' });

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    if (!call) throw new Error('expected one fetch call');

    expect(call.url).toBe('https://api.test/v1/rollouts/rollout_abc_001/seal');
    expect(call.init.method).toBe('POST');

    const headers = new Headers(
      call.init.headers as Record<string, string> | undefined
    );
    expect(headers.get('authorization')).toBe('Bearer test_token_001');
  });

  it('non-2xx upstream response -> MCP error result (isError: true)', async () => {
    installFetchMock(
      () =>
        new Response('{"error":"forbidden"}', {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
    );
    const proxy = await buildProxy({ resolveProfile: () => STUB_PROFILE });

    const result = await proxy.callTool('seal_rollout', { id: 'rollout_x' });

    // MCP convention for tool errors: isError: true on the CallToolResult.
    // The content array should still surface the upstream status + body so
    // the calling agent can see what went wrong.
    expect(result.isError).toBe(true);
    const textContent = expectTextContent(result.content, 'seal_rollout error');
    expect(textContent.type).toBe('text');
    // The error text should mention either the status code (403) or the
    // upstream error body — both are acceptable signals of the failure.
    const errorText = textContent.text;
    const mentionsStatus = errorText.includes('403');
    const mentionsBody = errorText.includes('forbidden');
    expect(mentionsStatus || mentionsBody).toBe(true);
  });
});
