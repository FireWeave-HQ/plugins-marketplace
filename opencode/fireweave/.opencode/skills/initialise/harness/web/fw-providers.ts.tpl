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

/** PROD: the connected PostHog web provider over the build-baked public key. */
export function makeConnectedVendorProvider(): Provider {
  // PUBLIC_* env is inlined into the browser bundle at build time.
  const creds = resolvePostHogWebCredentials(
    import.meta.env as Record<string, string | undefined>
  );
  posthog.init(creds.apiKey, { api_host: creds.host });
  return makePostHogWebProvider({ client: posthog, posthogProjectId: creds.posthogProjectId });
}

/** DEV: the FireWeave local WEB provider (sync, FW_DUMP capture + devFlags). */
export function makeDevProvider(): Provider {
  return new FireweaveLocalWebProvider({ echo: true });
}
