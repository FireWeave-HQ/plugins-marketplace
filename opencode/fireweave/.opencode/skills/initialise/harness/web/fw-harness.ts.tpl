/**
 * fw-harness.ts — scaffolded by `/fireweave:initialise` (WEB / browser surface).
 *
 * The web peer of the server harness: same "promote, not wrap" shape (BOTH
 * branches + `isProd()`), but the web SDK is SYNCHRONOUS — flag READS at the
 * call-sites carry NO `await` (the web invariant the eject codemod depends on).
 * The harness BOOT is still async (it awaits provider readiness once at start).
 *
 * `initFwHarness()` MUST be awaited first in the app's bootstrap, before the
 * first render that reads a flag. `fw eject` deletes this file + fw-providers.ts
 * and rewrites `fw.flag(...)` to raw sync `OpenFeature.getClient().getBooleanValue(...)`.
 */
import { OpenFeature } from '@openfeature/web-sdk';
import {
  isProd,
  initFwTelemetry,
  registerFwWebFlagHooks,
} from '@fireweaveai/deploy-sdk/flags/web';
import { initFwAttestation } from '@fireweaveai/deploy-sdk';
import { resolveBootBeaconFromEnv } from '@fireweaveai/deploy-sdk/attest';
import { makeConnectedVendorProvider, makeDevProvider } from './fw-providers';
// Plain static value import — USED below so DCE can't drop it.
import { FW_STAMPS } from './fw-tracker';

export async function initFwHarness(): Promise<void> {
  const prod = isProd(import.meta.env?.MODE);

  // Telemetry: dev → console; prod → per-signal OTLP DIRECT to the vendor
  // (OTLP-over-fetch works in the browser). The boot is async; reads are sync.
  initFwTelemetry(prod ? 'rollout' : 'dev', { serviceName: 'fireweave-web-app' });
  registerFwWebFlagHooks();

  const provider = prod ? makeConnectedVendorProvider() : makeDevProvider();
  // Awaits the provider's FIRST flag set so the synchronous reads that follow
  // resolve against real values — the per-call reads themselves are sync.
  await OpenFeature.setProviderAndWait(provider);

  initFwAttestation({
    stamps: FW_STAMPS,
    // Boot beacon runs from Node/SSR bootstrap env — do NOT bundle ingest keys via VITE_*.
    ...(typeof process !== 'undefined'
      ? resolveBootBeaconFromEnv({ env: process.env, prod })
      : {}),
  });
}
