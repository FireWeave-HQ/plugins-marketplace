/**
 * fw-providers.ts — scaffolded by `/fireweave:initialise` (WEB / browser surface).
 *
 * `makeConnectedVendorProvider()` binds `@fireweaveai/web-sdk`'s remote WEB
 * adapter behind a `FireweaveWebRuntime`, prefetching decisions from fw-server
 * (`POST /v1/flags/evaluate`) with build-baked `PUBLIC_FW_PROJECT_API_KEY` +
 * `PUBLIC_FW_API_URL`. The SDK reads no environment at all — credentials are
 * resolved by deploy-sdk (`PUBLIC_FW_*` is a build convention, not a wire
 * concern) and passed in. No direct vendor SDK for flags; reads stay
 * SYNCHRONOUS against the prefetched cache.
 *
 * After auth, call `syncFireweaveUser(userId, props)` — ONE `client.identify`
 * call that registers the user for DURABLE targeting AND re-prefetches the
 * flag cache under the new id, so sticky % ramps bucket on a stable user id.
 *
 * Two kinds of property feed a rule and you need both:
 *   - DURABLE — registered once at sign-in (plan, beta membership, region).
 *     Stored server-side; rules keep matching without the app resending them.
 *   - PER-REQUEST — the OpenFeature evaluation context. Overrides the registered
 *     value for that one evaluation.
 * A rule targeting a property that is never registered AND never sent matches
 * nobody, silently.
 *
 * Ejecting strips this file's imports and leaves the web call-sites on raw
 * `@openfeature/web-sdk`; the file itself is yours to delete afterwards.
 */
import {
  FireweaveLocalWebAdapter,
  FireweaveRemoteWebAdapter,
  FireweaveWebClient,
  FireweaveWebProvider,
  FireweaveWebRuntime,
} from '@fireweaveai/web-sdk';
import { resolveFireweaveWebCredentials } from '@fireweaveai/deploy-sdk/flags/web';
import type { Provider } from '@openfeature/web-sdk';

/** Retained so auth wiring can identify / re-prefetch after sign-in. */
let fwWebRuntime: FireweaveWebRuntime | null = null;
let fwWebClient: FireweaveWebClient | null = null;

function bindRuntime(runtime: FireweaveWebRuntime): FireweaveWebRuntime {
  fwWebRuntime = runtime;
  fwWebClient = new FireweaveWebClient(runtime);
  return runtime;
}

/** Prefetch / refresh flags for a targeting key (call after sign-in). */
export async function reloadFireweaveFlags(targetingKey: string): Promise<void> {
  await fwWebRuntime?.setContext({ targetingKey });
}

/**
 * Sign-in hook: ONE call (`client.identify`) that registers the user's durable
 * targeting properties AND reloads flags under that id:
 *
 *   await syncFireweaveUser(user.id, { plan: user.plan, beta: user.inBeta });
 *
 * Never throws — an analytics call must not break sign-in. On the dev tier the
 * local adapter cannot register targets, so identify reports `ok: false`
 * rather than pretending to have registered anything.
 */
export async function syncFireweaveUser(
  targetingKey: string,
  properties: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  await fwWebClient?.identify(targetingKey, {
    kind: 'user',
    properties,
  });
}

/** PROD: Fireweave remote web provider over build-baked PUBLIC_FW_* credentials. */
export function makeConnectedVendorProvider(): Provider {
  // PUBLIC_* env is inlined into the browser bundle at build time.
  const creds = resolveFireweaveWebCredentials(
    import.meta.env as Record<string, string | undefined>
  );
  const runtime = bindRuntime(
    new FireweaveWebRuntime(new FireweaveRemoteWebAdapter(creds), {
      globalContext: { targetingKey: 'anonymous' },
    })
  );
  return new FireweaveWebProvider(runtime);
}

/**
 * DEV: FireWeave local WEB adapter (sync devFlags) behind the SAME runtime and
 * provider as prod — dev and prod share lifecycle gating and context
 * canonicalization, so the harness cannot skew between tiers.
 *
 * Call-site / manifest defaults stay `false` (RAMP-1). To dogfood a flag ON
 * locally, list it here — never `fw.flag(key, true)` (that same `true` is the
 * prod fallback when the provider flag is missing).
 *
 *   new FireweaveLocalWebAdapter({
 *     devFlags: { '<feature-slug>': true },
 *   });
 */
export function makeDevProvider(): Provider {
  const runtime = bindRuntime(
    new FireweaveWebRuntime(new FireweaveLocalWebAdapter(), {
      globalContext: { targetingKey: 'anonymous' },
    })
  );
  return new FireweaveWebProvider(runtime);
}
