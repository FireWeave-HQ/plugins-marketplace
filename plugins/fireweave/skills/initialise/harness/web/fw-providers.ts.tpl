/**
 * fw-providers.ts — scaffolded by `/fireweave:initialise` (WEB / browser surface).
 *
 * `makeConnectedVendorProvider()` binds the connected PostHog provider over the
 * already-initialized `posthog-js` singleton, reading the BUILD-BAKED public
 * credential (`PUBLIC_POSTHOG_KEY`, public-safe). The web provider implements
 * the SYNCHRONOUS `@openfeature/web-sdk` API — a first-class peer, NOT a copy of
 * the server provider. The dev provider is the FireWeave local WEB provider.
 *
 * `fw eject` deletes this file; the web call-sites read raw `@openfeature/web-sdk`.
 */
import {
  makePostHogWebProvider,
  FireweaveLocalWebProvider,
  resolvePostHogWebCredentials,
} from '@fireweaveai/deploy-sdk/flags/web';
import posthog from 'posthog-js';
import type { Provider } from '@openfeature/web-sdk';

/** True after `posthog.init` in this tab (prod-tier connected path). */
let posthogBrowserReady = false;

/** Whether the browser PostHog singleton was initialized for this page load. */
export function isPostHogBrowserClientReady(): boolean {
  return posthogBrowserReady;
}

/** PROD: the connected PostHog web provider over the build-baked public key. */
export function makeConnectedVendorProvider(): Provider {
  // PUBLIC_* env is inlined into the browser bundle at build time.
  const creds = resolvePostHogWebCredentials(
    import.meta.env as Record<string, string | undefined>
  );
  posthog.init(creds.apiKey, {
    api_host: creds.host,
    // Persons only after identify(userId) — stops anonymous UUID spam that
    // breaks sticky % rollout bucketing. Wire auth → bindPostHogUser(user).
    person_profiles: 'identified_only',
    persistence: 'localStorage+cookie',
  });
  posthogBrowserReady = true;
  return makePostHogWebProvider({ client: posthog, posthogProjectId: creds.posthogProjectId });
}

/** DEV: the FireWeave local WEB provider (sync, FW_DUMP capture + devFlags). */
export function makeDevProvider(): Provider {
  return new FireweaveLocalWebProvider({ echo: true });
}
