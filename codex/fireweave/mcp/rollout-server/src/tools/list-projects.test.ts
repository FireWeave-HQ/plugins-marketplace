import { test, expect, describe } from 'bun:test';
import {
  listProjects,
  runListProjectsAlias,
  defaultListProjectsForwarder,
} from './list-projects';

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
test('list_projects returns project list on 200', async () => {
  const mockProjects = [
    { id: 'proj-1', name: 'Alpha' },
    { id: 'proj-2', name: 'Beta' },
  ];

  const fakeFetch = async (_url: string, _init?: RequestInit) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ projects: mockProjects }),
    }) as Response;

  const result = await listProjects({
    fetch: fakeFetch,
    baseUrl: 'https://fake.api',
    accessToken: 'tok-abc',
  });

  expect(result.projects).toEqual(mockProjects);
  expect(result.projects).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Correct Authorization header is sent
// ---------------------------------------------------------------------------
test('list_projects sends Authorization: Bearer header', async () => {
  let capturedInit: RequestInit | undefined;

  const fakeFetch = async (_url: string, init?: RequestInit) => {
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ projects: [] }),
    } as Response;
  };

  await listProjects({
    fetch: fakeFetch,
    baseUrl: 'https://fake.api',
    accessToken: 'my-token',
  });

  const headers = capturedInit?.headers as Record<string, string>;
  expect(headers?.['Authorization']).toBe('Bearer my-token');
});

// ---------------------------------------------------------------------------
// 401 returns structured error
// ---------------------------------------------------------------------------
test('list_projects throws on 401', async () => {
  const fakeFetch = async (_url: string, _init?: RequestInit) =>
    ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }) as Response;

  await expect(
    listProjects({
      fetch: fakeFetch,
      baseUrl: 'https://fake.api',
      accessToken: 'bad-tok',
    })
  ).rejects.toThrow('Unauthorized');
});

// ---------------------------------------------------------------------------
// Non-401 HTTP error
// ---------------------------------------------------------------------------
test('list_projects throws on 500', async () => {
  const fakeFetch = async (_url: string, _init?: RequestInit) =>
    ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as Response;

  await expect(
    listProjects({
      fetch: fakeFetch,
      baseUrl: 'https://fake.api',
      accessToken: 'tok',
    })
  ).rejects.toThrow('HTTP 500');
});

// ---------------------------------------------------------------------------
// R-004-3 — Wave A deprecation alias plumbing
// ---------------------------------------------------------------------------
describe('R-004-3 Wave A alias forwards to proxy + emits stderr DEPRECATION', () => {
  test('writes DEPRECATION warning via injected log', async () => {
    const messages: string[] = [];
    await runListProjectsAlias(
      {},
      {
        forwarder: async () => ({ projects: [] }),
        log: (m) => messages.push(m),
      }
    );
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('DEPRECATION');
    expect(messages[0]).toContain('list_projects');
    expect(messages[0]).toContain('fireweave-server-proxy');
  });

  test('returns the forwarder response unchanged', async () => {
    const expected = { projects: [{ id: 'p1', name: 'one' }] };
    const out = await runListProjectsAlias(
      {},
      { forwarder: async () => expected, log: () => {} }
    );
    expect(out).toBe(expected);
  });

  test('forwards args to the forwarder verbatim', async () => {
    let captured: unknown;
    await runListProjectsAlias(
      { foo: 'bar' },
      {
        forwarder: async (a) => {
          captured = a;
          return {};
        },
        log: () => {},
      }
    );
    expect(captured).toEqual({ foo: 'bar' });
  });

  test('default forwarder returns NOT_YET_MIGRATED envelope', async () => {
    const out = (await defaultListProjectsForwarder({})) as {
      error?: { code?: string; message?: string };
    };
    expect(out.error?.code).toBe('NOT_YET_MIGRATED');
    expect(out.error?.message).toContain('fireweave-server-proxy');
  });

  test('increments usage counter when incrementUsage is supplied', async () => {
    const counts: string[] = [];
    await runListProjectsAlias(
      {},
      {
        forwarder: async () => ({}),
        log: () => {},
        incrementUsage: (n) => counts.push(n),
      }
    );
    expect(counts).toEqual(['list_projects']);
  });
});
