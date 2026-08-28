/**
 * fw-harness.ts — scaffolded by `/fireweave:initialise` (web surface).
 *
 * This file is deliberately small: it is the one FireWeave writes into your app
 * that you should actually read. It answers two questions and nothing else —
 * which tier is this build, and how do I read a control point. The machinery it
 * delegates to (the environment-profile map, build-baked credentials, device
 * identity) lives in `fw-providers.ts`.
 *
 * The "promote, not wrap" model (D26): BOTH branches are present and the
 * RUNNING ENVIRONMENT — resolved by NAME in `fw-providers.ts`, not a bare
 * boolean — selects which one is live. Nothing is swapped at promotion;
 * `safe-rollout` ramps via `flag.control` and never mutates this file.
 *
 * `initFwHarness()` MUST be awaited before the app renders (§11.6): awaiting it
 * is what prefetches the decision cache the SYNCHRONOUS reads resolve against.
 * `verify_prod_path` asserts that, and asserts the tier decision below stays
 * visible HERE rather than disappearing into a helper.
 *
 * Reads go through the control-points API directly — there is no FireWeave
 * alias to learn, and no codemod to translate it back out (ADR-022). They are
 * SYNCHRONOUS (no `await`, safe inside render) and never throw: every failure
 * resolves to the default you passed, with the reason on the `Decision`. When
 * the initial prefetch loses its race with the ceiling, reads resolve your
 * default with reason `STALE` rather than blocking boot. Swap `getBooleanValue`
 * for `getBooleanDetails` — same arguments — to see the reason.
 *
 *   // @fireweave-controlpoint <feature-slug>
 *   if (fw.controlPoints.getBooleanValue('<feature-slug>', false)) { … }
 *
 * `defaultValue` MUST be `false` at every call site (RAMP-1): the ramp turns a
 * feature on, the default never does. To dogfood ON locally, seed the key in
 * `makeDevProvider()`'s `local.controlPoints` — never by passing `true` here,
 * because that same `true` is what prod serves when the key is missing.
 *
 * The prefetch context carries a PERSISTED per-device targeting key, so a
 * percentage ramp buckets consistently even before sign-in; call
 * `syncFireweaveUser()` at sign-in to re-prefetch under the real user id
 * (spec/control-points.md "Context").
 */
import {
  getFwClient,
  isProd,
  makeConnectedVendorProvider,
  makeDevProvider,
} from './fw-providers';

/** Bring the SDK up for THIS build. Await before render — it prefetches the cache. */
export async function initFwHarness(): Promise<void> {
  if (isProd()) {
    await makeConnectedVendorProvider();
  } else {
    await makeDevProvider();
  }
}

/** Control points. `fw.controlPoints.getBooleanValue(key, false)` — synchronous. */
export const fw = {
  get controlPoints() {
    return getFwClient().controlPoints;
  },
};
