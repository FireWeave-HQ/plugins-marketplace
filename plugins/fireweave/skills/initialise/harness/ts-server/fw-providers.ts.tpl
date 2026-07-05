/**
 * fw-providers.ts — scaffolded by `/fireweave:initialise` (TS-server surface).
 *
 * `makeConnectedVendorProvider()` is the prod flag provider with a CONCRETE body
 * (§11.1/§11.3): it reads the customer's own vendor key from the prod env var
 * (`POSTHOG_PROJECT_API_KEY` + `POSTHOG_HOST`) and binds the connected PostHog
 * OpenFeature provider. There is NO FireWeave-native prod provider — prod is
 * always the connected third-party (the firehose stays out of FireWeave's data
 * path). The dev provider is the FireWeave local in-memory provider.
 *
 * `fw eject` DELETES this file — the call-sites read raw OpenFeature, so removing
 * FireWeave leaves no app-code lock-in.
 */
import {
  makePostHogServerProvider,
  FireweaveLocalProvider,
} from '@fireweaveai/deploy-sdk/flags';
import type { Provider } from '@openfeature/server-sdk';

/** PROD: the connected vendor's real provider, reading the prod credential env. */
export function makeConnectedVendorProvider(): Provider {
  // resolvePostHogServerCredentials (called inside) reads POSTHOG_PROJECT_API_KEY
  // + POSTHOG_HOST from process.env — throws loudly if the key is absent.
  return makePostHogServerProvider(process.env);
}

/** DEV: the FireWeave local in-memory provider (FW_DUMP capture + devFlags). */
export function makeDevProvider(): Provider {
  return new FireweaveLocalProvider({ echo: true });
}
