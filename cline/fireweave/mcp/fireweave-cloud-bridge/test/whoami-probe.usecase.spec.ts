/**
 * Acceptance test for T4 — bridge whoami startup auth probe (server.ts).
 *
 * R-IDs: R-003-7
 *   - R-003-7 (NON-NEG) @usecase
 *     bridge startup with valid bearer
 *       -> GET /v1/whoami succeeds, bridge registers tools and serves stdio
 *     bridge startup with network unreachable
 *       -> logs warning to stderr, enters no-auth-verified mode, still
 *          registers tools (best-effort startup)
 *     bridge startup with 401 response
 *       -> aborts with 'run fw login' message (process.exit non-zero)
 *
 * Public surface contract for the T4 builder:
 *   - Export `runStartup(opts: StartupOpts): Promise<void>` from
 *     `../src/server` (the existing top-level `main()` should be refactored
 *     into this testable shape).
 *   - StartupOpts shape (defaults shown in []):
 *       resolveProfile : () => { alias, server_url, access_token } | null
 *           — same shape `buildProxy` receives in T3 (already wired).
 *       buildProxy     : (opts) => Promise<{ server }>
 *           [defaults to importing `buildProxy` from './proxy']
 *       fetch          : typeof globalThis.fetch
 *           [defaults to globalThis.fetch]
 *       stderr         : { write(msg: string): void }
 *           [defaults to process.stderr]
 *       exit           : (code: number) => void
 *           [defaults to process.exit]
 *       connectTransport : (server) => Promise<void>
 *           [defaults to wrapping `new StdioServerTransport()` +
 *            `server.connect(transport)`]
 *
 * Probe sequence the builder must implement, between profile resolution
 * and `buildProxy`:
 *   1. Build `${profile.server_url}/v1/whoami`.
 *   2. Issue GET via injected `fetch` with `Authorization: Bearer <token>`.
 *   3. Branch on outcome:
 *        - 2xx          : continue (proxy + stdio).
 *        - 401          : write 'run fw login' message to stderr, call
 *                         exit(1), DO NOT continue to buildProxy.
 *        - thrown error : write 'no-auth-verified mode' warning to stderr,
 *                         continue to buildProxy (best-effort startup).
 *        - other status : (test scope is 200/401/thrown; behaviour for
 *                         403/5xx is unspecified by this RID and not
 *                         asserted here.)
 *
 * Runtime conventions:
 *   - `.spec.ts` extension, bun:test runner.
 *   - Single-arg `expect()` only.
 *   - No HeadersInit / BodyInit literals — Bun types vary; we read headers
 *     via `new Headers(...)`.
 *   - Strict-mode safe: every `Array<T>[i]` access is guarded.
 */

import { describe, it, expect, mock } from 'bun:test';

import { runStartup } from '../src/server';

const VALID_PROFILE = {
  alias: 'test',
  server_url: 'https://api.test',
  access_token: 'tok_valid',
} as const;

interface FetchCapture {
  url: string;
  init: RequestInit;
}

describe('R-003-7 @usecase: whoami startup probe', () => {
  it('valid bearer (200) -> continues to buildProxy and transport.connect', async () => {
    const stderrWrites: string[] = [];
    const exitCalls: number[] = [];
    const fetchCalls: FetchCapture[] = [];

    const fakeServer = { connect: mock(async () => {}) };
    const buildProxySpy = mock(async () => ({ server: fakeServer }));
    const connectSpy = mock(async () => {});

    const fetchSpy = mock(
      async (url: string | URL | Request, init: RequestInit = {}) => {
        fetchCalls.push({ url: String(url), init });
        return new Response(JSON.stringify({ userId: 'u1', alias: 'test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    );

    await runStartup({
      resolveProfile: () => ({ ...VALID_PROFILE }),
      buildProxy: buildProxySpy,
      fetch: fetchSpy as unknown as typeof fetch,
      stderr: {
        write: (msg: string) => {
          stderrWrites.push(msg);
        },
      },
      exit: (code: number) => {
        exitCalls.push(code);
      },
      connectTransport: connectSpy,
    });

    // Probe was issued against /v1/whoami with the bearer token.
    expect(fetchCalls).toHaveLength(1);
    const probeCall = fetchCalls[0];
    if (!probeCall) throw new Error('expected one whoami probe call');
    expect(probeCall.url).toBe('https://api.test/v1/whoami');

    const headers = new Headers(
      probeCall.init.headers as Record<string, string> | undefined
    );
    expect(headers.get('authorization')).toBe('Bearer tok_valid');

    // Success path: buildProxy is called, transport is connected, no exit.
    expect(buildProxySpy).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
    expect(exitCalls).toHaveLength(0);
  });

  it('network unreachable -> warns no-auth-verified mode, still calls buildProxy + connect', async () => {
    const stderrWrites: string[] = [];
    const exitCalls: number[] = [];

    const fakeServer = { connect: mock(async () => {}) };
    const buildProxySpy = mock(async () => ({ server: fakeServer }));
    const connectSpy = mock(async () => {});

    const fetchSpy = mock(async () => {
      throw new TypeError('fetch failed');
    });

    await runStartup({
      resolveProfile: () => ({ ...VALID_PROFILE }),
      buildProxy: buildProxySpy,
      fetch: fetchSpy as unknown as typeof fetch,
      stderr: {
        write: (msg: string) => {
          stderrWrites.push(msg);
        },
      },
      exit: (code: number) => {
        exitCalls.push(code);
      },
      connectTransport: connectSpy,
    });

    // Stderr should mention the degraded-mode signal so operators see it
    // when launching from a network-isolated environment.
    const joined = stderrWrites.join('');
    expect(joined).toMatch(/no-auth-verified/i);

    // Best-effort: proxy + transport must still come up.
    expect(buildProxySpy).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
    expect(exitCalls).toHaveLength(0);
  });

  it('401 -> writes "run fw login" to stderr and exits non-zero', async () => {
    const stderrWrites: string[] = [];
    const exitCalls: number[] = [];

    const fakeServer = { connect: mock(async () => {}) };
    const buildProxySpy = mock(async () => ({ server: fakeServer }));
    const connectSpy = mock(async () => {});

    const fetchSpy = mock(
      async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
    );

    await runStartup({
      resolveProfile: () => ({ ...VALID_PROFILE }),
      buildProxy: buildProxySpy,
      fetch: fetchSpy as unknown as typeof fetch,
      stderr: {
        write: (msg: string) => {
          stderrWrites.push(msg);
        },
      },
      exit: (code: number) => {
        exitCalls.push(code);
      },
      connectTransport: connectSpy,
    });

    // Stderr must surface the actionable remediation hint. The phrase
    // 'run fw login' is the user-facing instruction; case-insensitive
    // match tolerates 'Run `fw login`' / 'please run fw login' variants.
    const joined = stderrWrites.join('');
    expect(joined).toMatch(/run.*fw login/i);

    // Process exits non-zero. We assert `1` specifically since
    // R-003-7 frames this as 'aborts'; the builder is expected to
    // pass 1 (the default failure code). Tolerate alternate non-zero
    // codes by also asserting at least one exit call.
    expect(exitCalls.length).toBeGreaterThanOrEqual(1);
    expect(exitCalls).toContain(1);

    // On 401 the bridge MUST NOT continue to register tools or open
    // stdio — that's the difference from the network-unreachable path.
    expect(buildProxySpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });
});
