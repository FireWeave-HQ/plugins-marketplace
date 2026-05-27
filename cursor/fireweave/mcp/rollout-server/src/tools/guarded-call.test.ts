/**
 * Acceptance tests for `guarded_call` wrapper + half-state side effect.
 *
 * R-IDs: R-003-1, R-003-2, R-003-3, R-003-4, R-003-5, R-003-7, R-003-8, R-003-10
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import {
  createGuardedCall,
  type GuardedCallInput,
  type DispatchTable,
} from './guarded-call';
import { readLockfile, writeLockfile, getResumeState } from './lockfile';
import { POLICY_TABLE, getRemediation } from './_remediation-table';
import type { PolicyClass } from './_remediation-table';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'fw-guarded-call-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function dispatchTableWith(
  entries: Record<string, (args: unknown) => Promise<unknown>>
): DispatchTable {
  return new Map(Object.entries(entries));
}

const baseInput = (
  overrides: Partial<GuardedCallInput> = {}
): GuardedCallInput => ({
  serverPrefix: 'mcp__rollout-server__',
  toolName: 'list_projects',
  args: {},
  isConfigurationStep: false,
  ...overrides,
});

describe('R-003-1 forwards successful calls transparently', () => {
  test('non-config success → { ok: true, result }; lockfile unchanged', async () => {
    const dispatch = dispatchTableWith({
      list_projects: async () => ({ projects: [{ id: 'p1', name: 'one' }] }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(baseInput(), { cwd: tmpDir });
    expect(out).toEqual({
      ok: true,
      result: { projects: [{ id: 'p1', name: 'one' }] },
    });
    expect(await readLockfile(tmpDir)).toBeNull();
  });

  test('config-step success → ok and lockfile unchanged (no half-state)', async () => {
    const dispatch = dispatchTableWith({
      register_rollout: async () => ({
        rolloutId: 'roll_1',
        state: 'drafting',
      }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        isConfigurationStep: true,
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(true);
    expect(await readLockfile(tmpDir)).toBeNull();
  });
});

describe('R-003-2 server_5xx classification + half-state write', () => {
  test('HTTP 503 + isConfigurationStep:true → CONFIG_TOOL_FAILURE + lockfile.lastConfigFailure', async () => {
    const dispatch = dispatchTableWith({
      register_rollout: async () => {
        const err = new Error('HTTP 503: cloud unavailable') as Error & {
          httpStatus?: number;
        };
        err.httpStatus = 503;
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        isConfigurationStep: true,
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.code).toBe('CONFIG_TOOL_FAILURE');
    expect(out.error.failureClass).toBe('server_5xx');
    expect(out.error.remediation).toBeTruthy();

    const lf = await readLockfile(tmpDir);
    expect(lf).not.toBeNull();
    expect(lf?.lastConfigFailure?.failedToolId).toBe('register_rollout');
    expect(lf?.lastConfigFailure?.failureClass).toBe('server_5xx');
    expect(lf?.lastConfigFailure?.remediation).toBeTruthy();
    expect(lf?.lastConfigFailure?.failedAt).toBeTruthy();
  });

  test('HTTP 503 + isConfigurationStep:false → server_5xx (no CONFIG_TOOL_FAILURE wrap) + no lockfile mutation', async () => {
    const dispatch = dispatchTableWith({
      list_projects: async () => {
        const err = new Error('HTTP 503: blip') as Error & {
          httpStatus?: number;
        };
        err.httpStatus = 503;
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(baseInput(), { cwd: tmpDir });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.failureClass).toBe('server_5xx');
    // Non-config failures don't synthesise CONFIG_TOOL_FAILURE.
    expect(out.error.code).not.toBe('CONFIG_TOOL_FAILURE');
    expect(await readLockfile(tmpDir)).toBeNull();
  });
});

describe('R-003-3 schema_drift classification via expectedResponseSchema', () => {
  test('mismatched response shape → SCHEMA_DRIFT', async () => {
    const dispatch = dispatchTableWith({
      register_rollout: async () => ({
        // missing rolloutId; bad state value
        wrongField: 'oops',
      }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        isConfigurationStep: false,
        expectedResponseSchema: 'RegisterRolloutResult',
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.code).toBe('SCHEMA_DRIFT');
    expect(out.error.failureClass).toBe('schema_drift');
  });

  test('matching response shape → ok', async () => {
    const dispatch = dispatchTableWith({
      register_rollout: async () => ({
        rolloutId: 'roll_1',
        state: 'drafting',
      }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        expectedResponseSchema: 'RegisterRolloutResult',
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(true);
  });
});

describe('R-003-4 tool_not_found classification', () => {
  test('missing entry in dispatchTable → TOOL_NOT_FOUND', async () => {
    const guarded = createGuardedCall({
      dispatchTable: dispatchTableWith({}),
    });
    const out = await guarded(
      baseInput({
        serverPrefix: 'mcp__fireweave-server-proxy__',
        toolName: 'list_phantom_tool',
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.code).toBe('TOOL_NOT_FOUND');
    expect(out.error.failureClass).toBe('tool_not_found');
  });

  test('TOOL_NOT_FOUND on config step also writes half-state', async () => {
    const guarded = createGuardedCall({
      dispatchTable: dispatchTableWith({}),
    });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        isConfigurationStep: true,
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.code).toBe('CONFIG_TOOL_FAILURE');
    expect(out.error.failureClass).toBe('tool_not_found');
    const lf = await readLockfile(tmpDir);
    expect(lf?.lastConfigFailure?.failureClass).toBe('tool_not_found');
  });
});

describe('R-003-5 configuration-step failures overwrite prior half-state', () => {
  test('prior lastConfigFailure is overwritten on second failure', async () => {
    // Seed lockfile with an older failure.
    await writeLockfile(
      {
        version: 1,
        lastStep: 'register',
        lastStepTimestamp: '2026-05-13T00:00:00.000Z',
        lastConfigFailure: {
          failedToolId: 'old_tool',
          failureClass: 'network',
          failedAt: '2026-05-13T00:00:00.000Z',
          remediation: 'old remediation',
        },
      },
      tmpDir
    );
    const dispatch = dispatchTableWith({
      register_rollout: async () => {
        const err = new Error('HTTP 503: another blip') as Error & {
          httpStatus?: number;
        };
        err.httpStatus = 503;
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        isConfigurationStep: true,
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(false);
    const lf = await readLockfile(tmpDir);
    expect(lf?.lastConfigFailure?.failedToolId).toBe('register_rollout');
    expect(lf?.lastConfigFailure?.failureClass).toBe('server_5xx');
    // Prior failure is gone — fully overwritten.
    expect(lf?.lastConfigFailure?.remediation).not.toBe('old remediation');
  });

  test('half-state payload carries failedAt timestamp + remediation', async () => {
    const dispatch = dispatchTableWith({
      register_rollout: async () => {
        const err = new Error('fetch failed');
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const before = Date.now();
    await guarded(
      baseInput({
        toolName: 'register_rollout',
        isConfigurationStep: true,
      }),
      { cwd: tmpDir }
    );
    const lf = await readLockfile(tmpDir);
    expect(lf?.lastConfigFailure?.failureClass).toBe('network');
    expect(lf?.lastConfigFailure?.remediation).toContain(
      'MCP server could not be reached'
    );
    const at = Date.parse(lf!.lastConfigFailure!.failedAt);
    expect(at).toBeGreaterThanOrEqual(before);
  });
});

describe('R-003-7 resume guard surfaces half-state failure', () => {
  test('getResumeState returns lastConfigFailure when populated', async () => {
    await writeLockfile(
      {
        version: 1,
        lastStep: 'register',
        lastStepTimestamp: '2026-05-13T00:00:00.000Z',
        lastConfigFailure: {
          failedToolId: 'register_rollout',
          failureClass: 'server_5xx',
          failedAt: '2026-05-13T01:00:00.000Z',
          remediation: 'r',
        },
      },
      tmpDir
    );
    const lf = await readLockfile(tmpDir);
    const resume = getResumeState(lf);
    expect(resume.lastStep).toBe('register');
    expect(resume.lastConfigFailure).toBeDefined();
    expect(resume.lastConfigFailure?.failedToolId).toBe('register_rollout');
  });

  test('getResumeState omits lastConfigFailure when not populated', async () => {
    await writeLockfile(
      {
        version: 1,
        lastStep: 'discovery',
        lastStepTimestamp: '2026-05-13T00:00:00.000Z',
      },
      tmpDir
    );
    const lf = await readLockfile(tmpDir);
    const resume = getResumeState(lf);
    expect(resume.lastStep).toBe('discovery');
    expect(resume.lastConfigFailure).toBeUndefined();
  });

  test('getResumeState on null lockfile returns no-resume sentinel', () => {
    const resume = getResumeState(null);
    expect(resume.lastStep).toBeUndefined();
    expect(resume.lastConfigFailure).toBeUndefined();
  });
});

describe('R-003-8 POLICY_TABLE drives the wrapper', () => {
  const ALL_CLASSES: readonly PolicyClass[] = [
    'ok',
    'network',
    'timeout',
    'client_4xx',
    'server_5xx',
    'schema_drift',
    'tool_not_found',
    'config_tool_failure',
    'confirmation_missing',
    'manifest_mismatch',
  ];

  test('every (class, isConfigurationStep) cell has a defined entry', () => {
    for (const cls of ALL_CLASSES) {
      for (const cfg of [false, true]) {
        const entry = getRemediation(cls, cfg);
        expect(entry).toBeDefined();
        expect(typeof entry.retryBudget).toBe('number');
        expect(typeof entry.remediation).toBe('string');
      }
    }
  });

  test('POLICY_TABLE is frozen', () => {
    expect(Object.isFrozen(POLICY_TABLE)).toBe(true);
  });

  test('every configuration-step cell has retryBudget 0 (v1 disabled)', () => {
    for (const cls of ALL_CLASSES) {
      expect(getRemediation(cls, true).retryBudget).toBe(0);
    }
  });

  test('every non-configuration-step cell has retryBudget 0 (v1 disabled)', () => {
    for (const cls of ALL_CLASSES) {
      expect(getRemediation(cls, false).retryBudget).toBe(0);
    }
  });

  test('remediation strings reflect the §Tool-Failure Classification Table', () => {
    expect(getRemediation('network', false).remediation).toContain(
      'MCP server could not be reached'
    );
    expect(getRemediation('timeout', false).remediation).toContain(
      '30 seconds'
    );
    expect(getRemediation('client_4xx', false).remediation).toContain(
      'fw doctor'
    );
    expect(getRemediation('server_5xx', false).remediation).toMatch(
      /status\.fireweave\.cloud/
    );
    expect(getRemediation('schema_drift', false).remediation).toMatch(
      /response shape/i
    );
    expect(getRemediation('tool_not_found', false).remediation).toMatch(
      /manifest/i
    );
    expect(getRemediation('manifest_mismatch', false).remediation).toMatch(
      /inventory|manifest/i
    );
    expect(getRemediation('ok', false).remediation).toBe('proceed');
  });

  test('config_tool_failure cell appends the half-state warning', () => {
    expect(getRemediation('config_tool_failure', true).remediation).toContain(
      'half-created'
    );
  });
});

describe('R-003-10 retry plumbing is table-driven (disabled in v1)', () => {
  test('wrapper invokes dispatch exactly once when retryBudget is 0', async () => {
    let invocations = 0;
    const dispatch = dispatchTableWith({
      list_projects: async () => {
        invocations++;
        const err = new Error('HTTP 503: transient') as Error & {
          httpStatus?: number;
        };
        err.httpStatus = 503;
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    await guarded(baseInput(), { cwd: tmpDir });
    expect(invocations).toBe(1);
  });
});

describe('R-003-3 expectedResponseSchema uses safeParse (no instanceof hazard)', () => {
  test('schema with optional fields tolerates extra fields not in registry', async () => {
    // The handler must validate against `RegisterRolloutResult`'s narrow
    // shape but reject only when REQUIRED fields are absent — extra
    // unknown fields should not by themselves trigger drift.
    const dispatch = dispatchTableWith({
      register_rollout: async () => ({
        rolloutId: 'roll_1',
        state: 'drafting',
        extraField: 'tolerated',
      }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        expectedResponseSchema: 'RegisterRolloutResult',
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(true);
  });

  test('unknown registered schema name → SCHEMA_DRIFT (defensive)', async () => {
    const dispatch = dispatchTableWith({
      register_rollout: async () => ({ rolloutId: 'r', state: 'drafting' }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(
      baseInput({
        toolName: 'register_rollout',
        expectedResponseSchema: 'NonexistentSchema',
      }),
      { cwd: tmpDir }
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.code).toBe('SCHEMA_DRIFT');
  });
});

describe('R-003-2 HTTP 4xx propagates as client_4xx (not synthesised to CONFIG_TOOL_FAILURE on non-config)', () => {
  test('HTTP 401 + isConfigurationStep:false → client_4xx', async () => {
    const dispatch = dispatchTableWith({
      list_projects: async () => {
        const err = new Error('HTTP 401: unauthorized') as Error & {
          httpStatus?: number;
        };
        err.httpStatus = 401;
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(baseInput(), { cwd: tmpDir });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.failureClass).toBe('client_4xx');
  });
});

describe('dispatched timeout signal → timeout class', () => {
  test('dispatcher reports timedOut → timeout', async () => {
    const dispatch = dispatchTableWith({
      list_projects: async () => {
        const err = new Error('aborted') as Error & { timedOut?: boolean };
        err.timedOut = true;
        throw err;
      },
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    const out = await guarded(baseInput(), { cwd: tmpDir });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('expected non-ok');
    expect(out.error.failureClass).toBe('timeout');
  });
});

describe('schema registry contract — RegisterRolloutResult', () => {
  test('zod safeParse against the registered schema rejects wrong state enum', () => {
    // Spec: the handler registers exactly one Zod schema for v1.
    // We re-derive the schema shape from the public registry's behaviour
    // via the dispatch path; this test asserts that an invalid state enum
    // produces SCHEMA_DRIFT through the wrapper.
    const dispatch = dispatchTableWith({
      register_rollout: async () => ({
        rolloutId: 'r',
        state: 'totally-invalid',
      }),
    });
    const guarded = createGuardedCall({ dispatchTable: dispatch });
    return guarded(
      baseInput({
        toolName: 'register_rollout',
        expectedResponseSchema: 'RegisterRolloutResult',
      }),
      { cwd: tmpDir }
    ).then((out) => {
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('expected non-ok');
      expect(out.error.code).toBe('SCHEMA_DRIFT');
    });
  });
});

// Suppress unused-import warning when this `z` is unused outside symbol presence.
void z;
