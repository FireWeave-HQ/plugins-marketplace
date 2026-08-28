/**
 * fw-tracker.ts — active rollout change stamps.
 *
 * `/fireweave:initialise` scaffolds this empty. Per the dev loop, each feature
 * change appends its `stmp_<ULID>` id here (the same id written to the manifest
 * `change.stampId`) so `reconcile` and the dev-checklist gates can see the stamp
 * in the committed tree.
 *
 * This is a DISK artifact, not a runtime import: nothing in the harness reads
 * it. `reconcile` and `assert_dev_checklist` read it out of the repo.
 *
 * It sits beside `fw-harness.ts` and `fw-providers.ts`, one module per surface —
 * the same shape every other language uses. Repos initialised before that
 * unification keep a `fw-tracker/index.ts` DIRECTORY elsewhere in the tree;
 * both are still read, and `/fireweave:migrate-harness` moves the old one here.
 */

/** The committed stamp record. Append one entry per feature change. */
export const FW_STAMPS: Array<{ stampId: string }> = [];
