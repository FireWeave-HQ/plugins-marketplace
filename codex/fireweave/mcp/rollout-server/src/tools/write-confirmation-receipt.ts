/**
 * `write_confirmation_receipt` — persist a per-gate confirmation receipt
 * into `lockfile.userConfirmations[gateId]` atomically.
 *
 * The skill calls this immediately after each gate's `AskUserQuestion`,
 * passing `{ gateId, questionHash, selectedOption, stepNumber }`. The tool:
 *   1. Validates the gate ID against the static GATE_INVENTORY plus the two
 *      dynamic-suffix patterns (`GATE-5-COHORT-KEY-<symbol>`,
 *      `GATE-6-ACCEPT-METRIC-<name>`).
 *   2. Reads the current lockfile (initializing a minimal one if absent).
 *   3. Stamps `recordedAt` with the current ISO timestamp — the TOOL is
 *      authoritative for the time so the skill can't backdate a receipt.
 *   4. Merges the receipt at `lockfile.userConfirmations[gateId]`.
 *   5. Writes back via the existing atomic `.tmp + rename` `writeLockfile`.
 *
 * The Zod validation inside `writeLockfile` catches malformed receipt fields
 * (bad stepNumber enum, missing required keys) by throwing — we surface that
 * as `{ error: { code: 'INVALID_RECEIPT', message } }` via the catch block.
 *
 * R-IDs: R-002-1, R-002-2
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ConfirmationReceipt,
  LockfileState,
} from '@fireweaveai/fw-rollout-types';
import { ConfirmationStepNumberSchema } from '@fireweaveai/fw-rollout-types';
import { readLockfile, writeLockfile } from './lockfile';
import { GATE_INVENTORY } from './gate-inventory';

export interface WriteConfirmationReceiptInput {
  gateId: string;
  questionHash: string;
  selectedOption: string;
  selectedNotes?: string;
  stepNumber:
    | '0'
    | '0.1'
    | '0.2'
    | '1'
    | '2'
    | '3'
    | '4'
    | '5'
    | '6'
    | '7'
    | '8'
    | '8.5'
    | '9';
}

export type WriteConfirmationReceiptResult =
  | { written: true }
  | {
      error: {
        code: 'INVALID_GATE_ID' | 'INVALID_RECEIPT';
        message: string;
        remediation: string;
      };
    };

const STATIC_GATE_IDS: ReadonlySet<string> = new Set(
  GATE_INVENTORY.map((g) => g.gateId)
);

const DYNAMIC_GATE_PATTERNS: readonly RegExp[] = [
  /^GATE-5-COHORT-KEY-.+$/,
  /^GATE-6-ACCEPT-METRIC-.+$/,
];

export const DYNAMIC_GATE_PREFIXES: readonly string[] = Object.freeze([
  'GATE-5-COHORT-KEY-',
  'GATE-6-ACCEPT-METRIC-',
]);

function isKnownGateId(gateId: string): boolean {
  if (STATIC_GATE_IDS.has(gateId)) return true;
  return DYNAMIC_GATE_PATTERNS.some((re) => re.test(gateId));
}

function invalidGateIdError(gateId: string): WriteConfirmationReceiptResult {
  return {
    error: {
      code: 'INVALID_GATE_ID',
      message:
        `Unknown gateId "${gateId}". Must be a static gate from ` +
        `GATE_INVENTORY or a dynamic-suffix gate matching ` +
        `GATE-5-COHORT-KEY-<symbol> or GATE-6-ACCEPT-METRIC-<name>.`,
      remediation:
        'Verify the gateId against the GATE_INVENTORY export. Static ' +
        'gates have fixed IDs; dynamic gates require a non-empty suffix ' +
        'after the prefix.',
    },
  };
}

export async function writeConfirmationReceipt(
  input: WriteConfirmationReceiptInput,
  cwd?: string
): Promise<WriteConfirmationReceiptResult> {
  if (!isKnownGateId(input.gateId)) {
    return invalidGateIdError(input.gateId);
  }

  const receipt: ConfirmationReceipt = {
    questionHash: input.questionHash,
    selectedOption: input.selectedOption,
    recordedAt: new Date().toISOString(),
    stepNumber: input.stepNumber,
    ...(input.selectedNotes !== undefined && {
      selectedNotes: input.selectedNotes,
    }),
  };

  const existing = await readLockfile(cwd);
  const base: LockfileState = existing ?? {
    version: 1,
    lastStep: 'discovery',
    lastStepTimestamp: new Date().toISOString(),
  };

  const next: LockfileState = {
    ...base,
    userConfirmations: {
      ...(base.userConfirmations ?? {}),
      [input.gateId]: receipt,
    },
  };

  try {
    await writeLockfile(next, cwd);
    return { written: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        code: 'INVALID_RECEIPT',
        message,
        remediation:
          'Receipt failed schema validation. Verify questionHash is a ' +
          'string, selectedOption is non-empty, and stepNumber is one of ' +
          'the canonical step values.',
      },
    };
  }
}

// ─── MCP tool registration ─────────────────────────────────────────────

const WriteConfirmationReceiptInputSchema = {
  gateId: z
    .string()
    .min(1)
    .describe(
      'Stable gate identifier (e.g. "GATE-2-TYPE"). Must be a static gate ' +
        'from GATE_INVENTORY or a dynamic-suffix gate.'
    ),
  questionHash: z
    .string()
    .min(1)
    .describe(
      'SHA-256 hex digest of the canonical question + answer-options, ' +
        'computed via the same algorithm as `computeQuestionHash`.'
    ),
  selectedOption: z
    .string()
    .min(1)
    .describe('The option the user selected (verbatim).'),
  selectedNotes: z
    .string()
    .optional()
    .describe('Optional free-form notes captured alongside the selection.'),
  stepNumber: ConfirmationStepNumberSchema.describe(
    'Numeric step the receipt belongs to (matches the gate prefix).'
  ),
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory for .fireweave/.cache/.lockfile (defaults to process.cwd()).'
    ),
};

export const writeConfirmationReceiptTool = {
  registerWith(server: McpServer) {
    server.registerTool(
      'write_confirmation_receipt',
      {
        title: 'Write Confirmation Receipt',
        description:
          'Persists a confirmation receipt for a gate into ' +
          '`.fireweave/.cache/.lockfile`. Atomic write via .tmp + rename. ' +
          'Idempotent on gateId — re-invocation overwrites the prior ' +
          'receipt. Returns `{ written: true }` on success or ' +
          '`{ error: { code: "INVALID_GATE_ID" | "INVALID_RECEIPT", … } }` ' +
          'on failure.',
        inputSchema: WriteConfirmationReceiptInputSchema,
      },
      async (args) => {
        const typedArgs = args as WriteConfirmationReceiptInput & {
          cwd?: string;
        };
        const result = await writeConfirmationReceipt(
          {
            gateId: typedArgs.gateId,
            questionHash: typedArgs.questionHash,
            selectedOption: typedArgs.selectedOption,
            ...(typedArgs.selectedNotes !== undefined && {
              selectedNotes: typedArgs.selectedNotes,
            }),
            stepNumber: typedArgs.stepNumber,
          },
          typedArgs.cwd
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }
    );
  },
};
