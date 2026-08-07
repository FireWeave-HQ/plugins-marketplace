/**
 * fw-providers.ts — scaffolded by `/fireweave:initialise` (WEB / browser surface).
 *
 * `makeConnectedVendorProvider()` binds the Fireweave remote WEB provider, which
 * prefetches flags from fw-server (`POST /v1/flags/evaluate`) using build-baked
 * `PUBLIC_FW_PROJECT_API_KEY` + `PUBLIC_FW_API_URL`. No direct vendor SDK for flags.
 *
 * After auth, call `syncFireweaveUser(userId, props)` — it registers the user for
 * DURABLE targeting and refreshes the flag cache so sticky % ramps bucket on a
 * stable user id.
 *
 * Two kinds of property feed a rule and you need both:
 *   - DURABLE — registered once at sign-in (plan, beta membership, region).
 *     Stored server-side; rules keep matching without the app resending them.
 *   - PER-REQUEST — the OpenFeature evaluation context. Overrides the registered
 *     value for that one evaluation.
 * A rule targeting a property that is never registered AND never sent matches
 * nobody, silently.
 *
 * `fw eject` deletes this file; the web call-sites read raw `@openfeature/web-sdk`.
 */
import {
  makeFireweaveRemoteWebProvider,
  FireweaveLocalWebProvider,
  fireweaveRegisterTarget,
  resolveFireweaveWebCredentials,
  type FireweaveRemoteWebProvider,
} from '@fireweaveai/deploy-sdk/flags/web';
import type { Provider } from '@openfeature/web-sdk';

/** Retained so auth wiring can refresh the sync flag cache after identify. */
let remoteWebProvider: FireweaveRemoteWebProvider | null = null;

/** Prefetch / refresh flags for a targeting key (call after sign-in). */
export async function reloadFireweaveFlags(targetingKey: string): Promise<void> {
  await remoteWebProvider?.reloadFlags(targetingKey);
}

/**
 * Sign-in hook: register the user's durable targeting properties, then reload
 * flags under that id. Call from your auth effect / session listener:
 *
 *   await syncFireweaveUser(user.id, { plan: user.plan, beta: user.inBeta });
 *
 * Never throws — an analytics call must not break sign-in.
 */
export async function syncFireweaveUser(
  targetingKey: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  const creds = resolveFireweaveWebCredentials(
    import.meta.env as Record<string, string | undefined>
  );
  await fireweaveRegisterTarget(creds, {
    targetingKey,
    kind: 'user',
    properties,
  });
  await reloadFireweaveFlags(targetingKey);
}

/** PROD: Fireweave remote web provider over build-baked PUBLIC_FW_* credentials. */
export function makeConnectedVendorProvider(): Provider {
  // PUBLIC_* env is inlined into the browser bundle at build time.
  const creds = resolveFireweaveWebCredentials(
    import.meta.env as Record<string, string | undefined>
  );
  remoteWebProvider = makeFireweaveRemoteWebProvider({
    ...creds,
    defaultTargetingKey: 'anonymous',
  });
  return remoteWebProvider;
}

/**
 * DEV: FireWeave local WEB provider (sync, FW_DUMP capture + devFlags).
 *
 * Call-site / manifest defaults stay `false` (RAMP-1). To dogfood a flag ON
 * locally, list it here — never `fw.flag(key, true)` (that same `true` is the
 * prod fallback when the provider flag is missing).
 *
 *   return new FireweaveLocalWebProvider({
 *     echo: true,
 *     devFlags: { '<feature-slug>': true },
 *   });
 */
export function makeDevProvider(): Provider {
  return new FireweaveLocalWebProvider({ echo: true });
}
