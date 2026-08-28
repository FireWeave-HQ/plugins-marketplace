/**
 * fw-harness.ts — scaffolded by `/fireweave:initialise` (TS-server surface).
 *
 * This file is deliberately small: it is the one FireWeave writes into your
 * repo that you should actually read. It answers two questions and nothing
 * else — which tier is this process, and how do I read a control point. The
 * machinery it delegates to (the environment-profile map, credential wiring,
 * instance identity) lives in `fw-providers.ts`.
 *
 * The "promote, not wrap" model (D26): BOTH branches are present and the
 * RUNNING ENVIRONMENT — resolved by NAME in `fw-providers.ts`, not a bare
 * boolean — selects which one is live. Nothing is swapped at promotion;
 * `safe-rollout` ramps via `flag.control` and never mutates this file.
 *
 * `initFwHarness()` MUST be the FIRST awaited statement in the app entrypoint
 * (§11.6) so control points are live before any read runs. `verify_prod_path`
 * asserts exactly that, and also asserts that the tier decision below stays
 * visible HERE rather than disappearing into a helper.
 *
 * Reads go through the control-points API directly — there is no FireWeave
 * alias to learn, and no codemod to translate it back out (ADR-022). They never
 * throw: every failure resolves to the default you passed, with the reason on
 * the `Decision` (spec/control-points.md "Return discipline"). Swap
 * `getBooleanValue` for `getBooleanDetails` — same arguments — to see the reason.
 *
 *   // @fireweave-controlpoint <feature-slug>
 *   if (await fw.controlPoints.getBooleanValue('<feature-slug>', false, {
 *     targetingKey: user.id,
 *   })) { … }
 *
 * `defaultValue` MUST be `false` at every call site (RAMP-1): the ramp turns a
 * feature on, the default never does. To dogfood ON locally, seed the key in
 * `makeDevProvider()`'s `local.controlPoints` — never by passing `true` here,
 * because that same `true` is what prod serves when the key is missing.
 *
 * Always pass a `targetingKey`; a percentage ramp buckets on it. Omit it and the
 * evaluation reports `InvalidContext` and you get your default. Pass a CONSTANT
 * one and every caller hashes into a single bucket, which makes the ramp
 * meaningless while looking healthy (spec/control-points.md "Context").
 */
import {
  getFwClient,
  isProd,
  makeConnectedVendorProvider,
  makeDevProvider,
} from './fw-providers';

/** Bring the SDK up for THIS environment. First awaited statement in the entrypoint. */
export async function initFwHarness(): Promise<void> {
  if (isProd()) {
    await makeConnectedVendorProvider();
  } else {
    await makeDevProvider();
  }
}

/** Control points. `fw.controlPoints.getBooleanValue(key, false, ctx)`. */
export const fw = {
  get controlPoints() {
    return getFwClient().controlPoints;
  },
};
