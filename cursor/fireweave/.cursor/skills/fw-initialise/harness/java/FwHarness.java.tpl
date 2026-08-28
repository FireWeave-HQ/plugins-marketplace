package fireweave; // REPLACED at init: `<app base package>.fireweave` — the file
// lives in the matching source directory (Java requires dir == package).

/*
 * FwHarness.java — scaffolded by `/fireweave:initialise` (JAVA surface).
 *
 * This file is deliberately small: it is the one FireWeave writes into your
 * repo that you should actually read. It answers one question — which tier is
 * this process — and hands you the client. The machinery it delegates to (the
 * environment-profile map, credential wiring) lives in `FwProviders.java`.
 *
 * The "promote, not wrap" model (D26): BOTH branches are present and the
 * RUNNING ENVIRONMENT — resolved by NAME in `FwProviders`, not a bare boolean —
 * selects which one is live. Nothing is swapped at promotion; `safe-rollout`
 * ramps via `flag.control` and never mutates this file.
 *
 * `initFwHarness()` MUST be called FIRST in the app entrypoint, before any
 * read. `verify_prod_path` asserts that, and asserts the tier decision below
 * stays visible HERE rather than disappearing into a helper.
 *
 * Reads go through the control-points API directly — there is no FireWeave
 * alias to learn, and no codemod to translate it back out (ADR-022). They never
 * throw: every failure resolves to the default you passed, with the reason on
 * the `Decision` (spec/control-points.md "Return discipline"). Swap
 * `getBooleanValue` for `getBooleanDetails` — same arguments — to see it:
 *
 *   // @fireweave-controlpoint <feature-slug>
 *   if (FwProviders.getFwClient().controlPoints().getBooleanValue(
 *           "<feature-slug>", false,
 *           EvaluationContext.builder().targetingKey(userId).build())) { ... }
 *
 * `defaultValue` MUST be `false` at every call site (RAMP-1): the ramp turns a
 * feature on, the default never does. To dogfood ON locally, seed the key in
 * `FwProviders.makeDevProvider()`'s controlPoints map — never by passing `true`
 * here, because that same `true` is what prod serves when the key is missing.
 *
 * Always pass a `targetingKey`; a percentage ramp buckets on it. Omit it and the
 * evaluation reports InvalidContext and you get your default. Pass a CONSTANT
 * one and every caller hashes into a single bucket, which makes the ramp
 * meaningless while looking healthy (spec/control-points.md "Context").
 *
 * TELEMETRY: the `ai.fireweave` SDK carries no OpenTelemetry dependency. Wire
 * `io.opentelemetry` yourself if this app exports spans — never a half-wired
 * exporter (empty endpoint / placeholder creds), which looks configured and
 * silently drops every span.
 */

import ai.fireweave.sdk.domain.FireweaveException;

public final class FwHarness {

    private static volatile boolean ready;

    /** Idempotent boot — call FIRST in the app entrypoint, before any read. */
    public static synchronized void initFwHarness() throws FireweaveException {
        if (ready) {
            return;
        }
        ready = true;

        if (FwProviders.isProd()) {
            FwProviders.makeConnectedVendorProvider();
        } else {
            FwProviders.makeDevProvider();
        }

        Runtime.getRuntime().addShutdownHook(
                new Thread(() -> FwProviders.getFwClient().close()));
    }

    private FwHarness() {
    }
}
