/**
 * `read_confirmation_receipts` — return the lockfile's userConfirmations map.
 *
 * Returns `{ receipts: {} }` when the lockfile is absent or has no
 * userConfirmations field — the absence of receipts is not an error,
 * the skill simply has no receipts to enforce yet.
 *
 * When `checkAgainst` is supplied, the tool recomputes each receipt's
 * expected hash from the inventory's current `canonicalQuestion` and marks
 * `{ stale: true }` for any receipt whose stored hash differs. Receipts
 * whose gateId is NOT present in `checkAgainst` (e.g. dynamic-suffix gates
 * not enumerated in GATE_INVENTORY) are returned as-is without a stale
 * annotation.
 *
 * R-IDs: R-002-3, R-002-6
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConfirmationReceipt } from '@fireweaveai/fw-rollout-types';
import { readLockfile } from './lockfile';
import { computeQuestionHash } from './question-hash';
import type { GateInventoryEntry } from './gate-inventory';

export type AnnotatedReceipt = ConfirmationReceipt & { stale?: boolean };

export interface ReadConfirmationReceiptsInput {
  checkAgainst?: readonly GateInventoryEntry[];
}

export interface ReadConfirmationReceiptsResult {
  receipts: Record<string, AnnotatedReceipt>;
}

export async function readConfirmationReceipts(
  input: ReadConfirmationReceiptsInput,
  cwd?: string
): Promise<ReadConfirmationReceiptsResult> {
  const lf = await readLockfile(cwd);
  const raw = lf?.userConfirmations ?? {};

  if (!input.checkAgainst) {
    return { receipts: { ...raw } };
  }

  const inventoryByGateId = new Map<string, GateInventoryEntry>();
  for (const entry of input.checkAgainst) {
    inventoryByGateId.set(entry.gateId, entry);
  }

  const annotated: Record<string, AnnotatedReceipt> = {};
  for (const [gateId, receipt] of Object.entries(raw)) {
    const inventoryEntry = inventoryByGateId.get(gateId);
    if (!inventoryEntry) {
      annotated[gateId] = receipt;
      continue;
    }
    const expectedHash = computeQuestionHash({
      gateId: inventoryEntry.gateId,
      questionText: inventoryEntry.canonicalQuestion,
      // Options are not part of GateInventoryEntry today — caller passes a
      // bare inventory; the hash uses an empty option list for static gates.
      // The skill, which has full option lists in SKILL.md, calls
      // `computeQuestionHash` with the same `optionsSorted: []` when it
      // writes the receipt.
      optionsSorted: [],
    });
    annotated[gateId] =
      receipt.questionHash === expectedHash
        ? receipt
        : { ...receipt, stale: true };
  }
  return { receipts: annotated };
}

// ─── MCP tool registration ─────────────────────────────────────────────

// Note: the `checkAgainst` MCP parameter is OMITTED from the public input
// schema — passing a full GATE_INVENTORY array over the wire on every read
// would be redundant since the server already has the static inventory
// imported. The MCP-side tool always uses the local GATE_INVENTORY when a
// staleness check is requested (via `checkStale: true`).
const readConfirmationReceiptsInputSchema = {
  checkStale: z
    .boolean()
    .optional()
    .describe(
      "When true, recompute each receipt's expected hash against the " +
        'local GATE_INVENTORY and annotate `stale: true` on mismatch.'
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory for .fireweave/.cache/.lockfile (defaults to process.cwd()).'
    ),
};

export const readConfirmationReceiptsTool = {
  registerWith(server: McpServer) {
    // Lazy import to keep the module graph at registration time minimal.
    // (GATE_INVENTORY is small and synchronous, but this matches the
    // pattern used by `read_lockfile` for consistency.)
    server.registerTool(
      'read_confirmation_receipts',
      {
        title: 'Read Confirmation Receipts',
        description:
          'Returns the lockfile.userConfirmations map. Optionally ' +
          'annotates each receipt with `stale: true` when its stored ' +
          'questionHash diverges from the current GATE_INVENTORY ' +
          'canonical-question hash.',
        inputSchema: readConfirmationReceiptsInputSchema,
      },
      async (args) => {
        const typedArgs = args as {
          checkStale?: boolean;
          cwd?: string;
        };
        // Import inside handler to avoid module-load cycles in the
        // tooling tree. GATE_INVENTORY is a const array.
        const { GATE_INVENTORY } = await import('./gate-inventory');
        const result = await readConfirmationReceipts(
          {
            ...(typedArgs.checkStale && { checkAgainst: GATE_INVENTORY }),
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
