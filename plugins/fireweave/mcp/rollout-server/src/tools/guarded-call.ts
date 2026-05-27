/**
 * `guarded_call` — wraps any downstream tool call, classifies the response
 * into one of the canonical failure classes per pitch 026 §Tool-Failure
 * Classification Table, and writes `lastConfigFailure` to the lockfile
 * when `isConfigurationStep: true` and the class is non-`ok`.
 *
 * Architecture: `createGuardedCall(deps)` is a factory that returns a
 * handler bound to an injected `dispatchTable`. Production wires the
 * dispatch table from the server's registered tool handlers; tests
 * inject a stub map with controllable behaviour. This mirrors the
 * dependency-injection-friendly export pattern used by
 * `_receipt-guard.ts`.
 *
 * The classifier is pure and lives at `_failure-classifier.ts`; the
 * remediation strings live at `_remediation-table.ts`. This file is the
 * wrapper that adds dispatch + schema validation + lockfile I/O.
 *
 * R-IDs: R-003-1, R-003-2, R-003-3, R-003-4, R-003-5, R-003-7, R-003-8, R-003-10
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  FailureClass,
  LastConfigFailure,
} from '@fireweaveai/fw-rollout-types';
import {
  classifyResponse,
  type ClassifierInput,
  type ClassifierResult,
} from './_failure-classifier';
import { getRemediation } from './_remediation-table';
import { writeLastConfigFailure } from './lockfile';

export type ServerPrefix =
  | 'mcp__rollout-server__'
  | 'mcp__fireweave-server-proxy__';

export interface GuardedCallInput {
  serverPrefix: ServerPrefix;
  toolName: string;
  args: Record<string, unknown>;
  isConfigurationStep: boolean;
  timeoutMs?: number;
  expectedResponseSchema?: string;
}

export type GuardedCallErrorCode =
  | 'CONFIG_TOOL_FAILURE'
  | 'SCHEMA_DRIFT'
  | 'TOOL_NOT_FOUND'
  | 'CONFIRMATION_MISSING'
  | 'MANIFEST_MISMATCH';

export interface GuardedCallError {
  code: GuardedCallErrorCode;
  failureClass: FailureClass;
  remediation: string;
  classifierInput?: Record<string, unknown>;
}

export type GuardedCallResult =
  | { ok: true; result: unknown }
  | { ok: false; error: GuardedCallError };

export type DispatchTable = Map<string, (args: unknown) => Promise<unknown>>;

export interface CreateGuardedCallDeps {
  dispatchTable: DispatchTable;
}

/**
 * Schema registry for `expectedResponseSchema` lookups. For v1 we ship
 * exactly one entry as a demonstration — `RegisterRolloutResult`. The
 * registry is intentionally small; further schemas land via additive
 * extension, not by re-architecting the wrapper.
 *
 * The schemas are constructed in this file (not imported from
 * `@fireweaveai/fw-rollout-types`) because pitch 026 §Solution scopes
 * cross-workspace Zod-instance hazards to the lockfile schema. We use
 * `safeParse` (never `parse + instanceof ZodError`) so a mismatched zod
 * resolution at runtime would not blow up; it would simply mark the
 * response as schema_drift.
 */
const RESPONSE_SCHEMA_REGISTRY: Record<string, z.ZodTypeAny> = {
  RegisterRolloutResult: z.object({
    rolloutId: z.string(),
    state: z.enum([
      'drafting',
      'wrapping',
      'sealed',
      'deploying',
      'ramping',
      'finished',
    ]),
  }),
};

/**
 * Extract HTTP status from an error or result. Errors may carry it
 * directly as a numeric `httpStatus` field; messages of the form
 * `HTTP NNN: ...` are also recognised as a fallback. Result-side
 * detection covers JSON envelopes where the upstream tool surfaces the
 * status in the body.
 */
function extractHttpStatus(
  error: Error | undefined,
  result: unknown
): number | undefined {
  if (error) {
    const errWithStatus = error as unknown as { httpStatus?: unknown };
    if (typeof errWithStatus.httpStatus === 'number') {
      return errWithStatus.httpStatus;
    }
    const match = /^HTTP (\d{3})/i.exec(error.message);
    if (match) return Number.parseInt(match[1]!, 10);
  }
  if (
    typeof result === 'object' &&
    result !== null &&
    'httpStatus' in result &&
    typeof (result as { httpStatus: unknown }).httpStatus === 'number'
  ) {
    return (result as { httpStatus: number }).httpStatus;
  }
  return undefined;
}

function extractTimedOut(error: Error | undefined): boolean | undefined {
  if (!error) return undefined;
  const errWithTimeout = error as unknown as { timedOut?: unknown };
  if (typeof errWithTimeout.timedOut === 'boolean') {
    return errWithTimeout.timedOut;
  }
  return undefined;
}

/**
 * Map a classifier result to the wrapper error envelope's `code`. `code`
 * is the coarse-grained outer label; `failureClass` carries the precise
 * underlying class. Configuration-step non-ok results synthesise to
 * `CONFIG_TOOL_FAILURE` per pitch 026 §Tool Error Envelope.
 *
 * Outside configuration steps, the outer codes map as follows:
 *   - `tool_not_found`        → TOOL_NOT_FOUND
 *   - `schema_drift`          → SCHEMA_DRIFT
 *   - `manifest_mismatch`     → MANIFEST_MISMATCH
 *   - transport (network / timeout / 4xx / 5xx) → SCHEMA_DRIFT fallback;
 *     callers disambiguate via `failureClass`.
 *
 * `confirmation_missing` is not returned by this classifier — it's
 * surfaced through `_receipt-guard.ts`'s own error envelope — so it does
 * not appear here.
 */
function codeForClass(
  cls: ClassifierResult,
  isConfigurationStep: boolean
): GuardedCallErrorCode {
  if (isConfigurationStep) return 'CONFIG_TOOL_FAILURE';
  if (cls === 'tool_not_found') return 'TOOL_NOT_FOUND';
  if (cls === 'schema_drift') return 'SCHEMA_DRIFT';
  if (cls === 'manifest_mismatch') return 'MANIFEST_MISMATCH';
  return 'SCHEMA_DRIFT';
}

/**
 * Best-effort serialization of classifier input for the error envelope's
 * `classifierInput` debugging field. Errors are converted to their
 * message string so the envelope round-trips through JSON cleanly.
 */
function serialiseClassifierInput(
  input: ClassifierInput
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.httpStatus !== undefined) out.httpStatus = input.httpStatus;
  if (input.timedOut !== undefined) out.timedOut = input.timedOut;
  if (input.toolFound !== undefined) out.toolFound = input.toolFound;
  if (input.schemaValid !== undefined) out.schemaValid = input.schemaValid;
  if (input.error !== undefined) out.error = input.error.message;
  return out;
}

/**
 * Run a single dispatch attempt, capturing the classifier-relevant
 * observables. Pure-ish — only side effects are whatever the dispatched
 * function does.
 */
async function runDispatch(
  dispatch: (args: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<{ result?: unknown; error?: Error }> {
  try {
    const result = await dispatch(args);
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Validate the dispatched result against a registered Zod schema, if
 * the caller named one. Returns `undefined` when no validation was
 * requested (caller did not pass `expectedResponseSchema`). Returns
 * `true`/`false` when validation ran. Uses `safeParse` exclusively —
 * never `parse + instanceof ZodError` — to avoid the cross-workspace
 * zod-instance hazard (Wave 1 Decision #4).
 */
function validateResponse(
  result: unknown,
  schemaName: string | undefined
): boolean | undefined {
  if (schemaName === undefined) return undefined;
  const schema = RESPONSE_SCHEMA_REGISTRY[schemaName];
  if (schema === undefined) return false;
  return schema.safeParse(result).success;
}

export interface GuardedCallOptions {
  cwd?: string;
}

export function createGuardedCall(deps: CreateGuardedCallDeps) {
  return async function guardedCall(
    input: GuardedCallInput,
    options: GuardedCallOptions = {}
  ): Promise<GuardedCallResult> {
    const dispatch = deps.dispatchTable.get(input.toolName);
    if (dispatch === undefined) {
      return finalise({ toolFound: false }, 'tool_not_found', input, options);
    }

    // R-003-10 — retry plumbing is table-driven via POLICY_TABLE. In v1
    // every cell carries `retryBudget: 0`, so this loop runs exactly once.
    // The plumbing exists so lifting the policy is a one-line table edit
    // rather than a wrapper change.
    let attempt = 0;
    let classifierInput: ClassifierInput;
    let cls: ClassifierResult;
    while (true) {
      const { result, error } = await runDispatch(dispatch, input.args);
      const httpStatus = extractHttpStatus(error, result);
      const timedOut = extractTimedOut(error);
      const schemaValid =
        error === undefined
          ? validateResponse(result, input.expectedResponseSchema)
          : undefined;
      classifierInput = {
        result,
        ...(error !== undefined && { error }),
        ...(httpStatus !== undefined && { httpStatus }),
        ...(timedOut !== undefined && { timedOut }),
        ...(schemaValid !== undefined && { schemaValid }),
        toolFound: true,
      };
      cls = classifyResponse(classifierInput);
      if (cls === 'ok') return { ok: true, result };
      const budget = getRemediation(cls, input.isConfigurationStep).retryBudget;
      if (attempt >= budget) break;
      attempt++;
    }

    return finalise(classifierInput, cls, input, options);
  };
}

async function finalise(
  classifierInput: ClassifierInput,
  cls: Exclude<ClassifierResult, 'ok'>,
  input: GuardedCallInput,
  options: GuardedCallOptions
): Promise<GuardedCallResult> {
  const remediationCell = getRemediation(cls, input.isConfigurationStep);
  const code = codeForClass(cls, input.isConfigurationStep);
  const failureClass: FailureClass = cls;

  if (input.isConfigurationStep) {
    const failure: LastConfigFailure = {
      failedToolId: input.toolName,
      failureClass,
      failedAt: new Date().toISOString(),
      remediation: remediationCell.remediation,
    };
    await writeLastConfigFailure(failure, options.cwd);
  }

  return {
    ok: false,
    error: {
      code,
      failureClass,
      remediation: remediationCell.remediation,
      classifierInput: serialiseClassifierInput(classifierInput),
    },
  };
}

// ─── MCP tool registration ─────────────────────────────────────────────

const guardedCallInputSchema = {
  serverPrefix: z.enum([
    'mcp__rollout-server__',
    'mcp__fireweave-server-proxy__',
  ]),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  isConfigurationStep: z
    .boolean()
    .describe(
      'True if this tool mutates server-side state and a failure must ' +
        'write lastConfigFailure to the lockfile.'
    ),
  timeoutMs: z.number().int().positive().optional(),
  expectedResponseSchema: z
    .string()
    .optional()
    .describe(
      'Optional reference to a registered Zod schema name for ' +
        'schema_drift detection. Currently registered: RegisterRolloutResult.'
    ),
  cwd: z.string().optional(),
};

/**
 * `guardedCallTool` is the MCP-server-facing registration. The
 * dispatchTable injected at registration time is the production map.
 * Today we register the tool with an empty dispatch table — Scope 005
 * wires the SKILL.md prose to route Configuration Tools through this
 * wrapper, and Scope 004's Wave A alias work will populate the table
 * with the cloud-conceptual tools. In v1 the tool is exposed so the
 * skill can call it; an empty dispatch table will report
 * `TOOL_NOT_FOUND` for any toolName, which is the correct fail-closed
 * default for the bootstrap phase.
 */
export const guardedCallTool = {
  registerWith(server: McpServer, dispatchTable: DispatchTable = new Map()) {
    const handler = createGuardedCall({ dispatchTable });
    server.registerTool(
      'guarded_call',
      {
        title: 'Guarded Call',
        description:
          'Wraps any downstream tool call with failure classification + ' +
          'half-state lockfile writes for Configuration Tools. Returns ' +
          '`{ ok: true, result }` on success or ' +
          '`{ ok: false, error: { code, failureClass, remediation, ... } }` ' +
          'on any failure. See pitch 026 §Tool-Failure Classification Table.',
        inputSchema: guardedCallInputSchema,
      },
      async (args) => {
        const typedArgs = args as GuardedCallInput & { cwd?: string };
        const result = await handler(
          {
            serverPrefix: typedArgs.serverPrefix,
            toolName: typedArgs.toolName,
            args: typedArgs.args,
            isConfigurationStep: typedArgs.isConfigurationStep,
            ...(typedArgs.timeoutMs !== undefined && {
              timeoutMs: typedArgs.timeoutMs,
            }),
            ...(typedArgs.expectedResponseSchema !== undefined && {
              expectedResponseSchema: typedArgs.expectedResponseSchema,
            }),
          },
          { ...(typedArgs.cwd !== undefined && { cwd: typedArgs.cwd }) }
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
  },
};
