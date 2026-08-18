package fireweave; // REPLACED at init: `<app base package>.fireweave` — must match FwHarness.

/*
 * FwProviders.java — scaffolded by `/fireweave:initialise` (JAVA surface).
 *
 * `makeConnectedVendorProvider()` is the prod flag provider with a CONCRETE
 * body: it binds the `ai.fireweave` SDK's remote adapter (fw-server
 * POST /v1/flags/evaluate, `Authorization: Bearer <FW_PROJECT_API_KEY>`).
 * Unlike the node/python SDKs, the Java SDK reads NO environment itself, so
 * THIS file resolves `FW_API_URL` + `FW_PROJECT_API_KEY` and refuses loudly
 * when either is missing — a loud prod misconfiguration rather than a silent
 * all-defaults evaluation. Apps do NOT embed PostHog keys — Seal provisions
 * flags on FireWeave-managed PostHog server-side (the Java PostHog adapter is
 * a test seam only; `PostHogAdapter.create` throws by design).
 *
 * `makeDevProvider()` is the FireWeave LOCAL provider from the SAME SDK,
 * served through the same OpenFeature surface as prod. Never substitute a
 * stock OpenFeature InMemoryProvider here: it answers from a different code
 * path than the one prod uses, which is how a flag behaves one way on a
 * laptop and another way in production.
 *
 * `registerFwTarget()` is the OTHER half of targeting. Rules match on two
 * kinds of property and you need both:
 *
 *   - DURABLE — registered here, once per login / device provisioning: plan,
 *     beta membership, region. Stored server-side, so rules keep matching
 *     without the app resending anything.
 *   - PER-REQUEST — the OpenFeature evaluation context: page, session,
 *     experiment context. Overrides the registered value for that one call.
 *
 * A rule targeting a property that is never registered AND never sent matches
 * nobody, silently. Register the durable facts at sign-in.
 *
 * Requires `ai.fireweave:fireweave-sdk` + `ai.fireweave:fireweave-openfeature`
 * on the classpath (the OpenFeature SDK arrives transitively).
 *
 * Ejecting strips this file's imports and leaves the call-sites on raw
 * OpenFeature, so removing FireWeave leaves no app-code lock-in. The file
 * itself is yours to delete once nothing imports it.
 */

import ai.fireweave.openfeature.FireweaveLocalProvider;
import ai.fireweave.openfeature.FireweaveProvider;
import ai.fireweave.sdk.FireweaveConfig;
import ai.fireweave.sdk.FireweaveRemoteAdapter;
import ai.fireweave.sdk.FireweaveRuntime;
import ai.fireweave.sdk.JsonValue;
import ai.fireweave.sdk.RegisterTargetOptions;
import ai.fireweave.sdk.RegisterTargetResult;
import ai.fireweave.sdk.TargetKind;
import dev.openfeature.sdk.FeatureProvider;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class FwProviders {

    /** Retained so registerFwTarget reaches the same runtime the provider uses. */
    private static volatile FireweaveRuntime fwRuntime;

    /** PROD: Fireweave remote provider -> fw-server POST /v1/flags/evaluate. */
    public static FeatureProvider makeConnectedVendorProvider() {
        String apiUrl = trimEnv("FW_API_URL");
        String apiKey = trimEnv("FW_PROJECT_API_KEY");
        if (apiUrl.isEmpty() || apiKey.isEmpty()) {
            throw new IllegalStateException(
                    "[fireweave] prod flags require FW_API_URL and FW_PROJECT_API_KEY "
                            + "in this environment's runtime env");
        }
        FireweaveConfig config = FireweaveConfig.builder()
                .host(apiUrl)
                .projectApiKey(apiKey)
                .build();
        FireweaveRuntime runtime = new FireweaveRuntime(config, new FireweaveRemoteAdapter());
        fwRuntime = runtime;
        // AUTOMATIC: OpenFeature's setProviderAndWait drives runtime.initialize();
        // a Configuration failure surfaces as OpenFeature PROVIDER_FATAL rather
        // than a silent all-defaults evaluation.
        return new FireweaveProvider(runtime, FireweaveProvider.InitMode.AUTOMATIC);
    }

    /** DEV: FireWeave local provider (echo + devFlags), same SDK as prod. */
    public static FeatureProvider makeDevProvider() {
        // Call-site / manifest defaults stay false (RAMP-1). To dogfood a flag
        // ON locally, list it here — never `fwFlag(key, true, ...)` (that same
        // `true` is the prod fallback when the provider flag is missing):
        //
        //     devFlags.put("<feature-slug>", true);
        Map<String, Boolean> devFlags = new LinkedHashMap<>();
        return FireweaveLocalProvider.create(
                FireweaveLocalProvider.Options.builder()
                        .devFlags(devFlags)
                        .echo(true)
                        .build());
    }

    /**
     * Register a user or device for DURABLE targeting.
     *
     * Call once from your auth filter / sign-in handler, then pass the SAME id
     * as the targeting key in the OpenFeature evaluation context:
     *
     *     registerFwTarget(user.id(), Map.of("plan", JsonValue.of(user.plan())));
     *
     * Never throws — an analytics call must not break sign-in. On the dev tier
     * there is no remote runtime, so this reports false rather than pretending
     * to have registered anything.
     */
    public static boolean registerFwTarget(String targetingKey, Map<String, JsonValue> properties) {
        FireweaveRuntime runtime = fwRuntime;
        if (runtime == null) {
            return false;
        }
        RegisterTargetResult result = runtime.registerTarget(targetingKey,
                RegisterTargetOptions.builder()
                        .kind(TargetKind.USER)
                        .properties(properties == null ? Collections.emptyMap() : properties)
                        .build());
        return result.ok();
    }

    private static String trimEnv(String name) {
        String v = System.getenv(name);
        return v == null ? "" : v.trim();
    }

    private FwProviders() {
    }
}
