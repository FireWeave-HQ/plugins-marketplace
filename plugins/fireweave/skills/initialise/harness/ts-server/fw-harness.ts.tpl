/**
 * fw-harness.ts — scaffolded by `/fireweave:initialise` (TS-server surface).
 *
 * The "promote, not wrap" harness (D26): BOTH branches are present and a runtime
 * `isProd()` selects. Nothing is swapped at promotion — `safe-rollout-fast` runs
 * `verify_prod_path` and ramps via `flag.control`; it never mutates this file.
 *
 * `initFwHarness()` MUST be the FIRST awaited statement in the app entrypoint
 * (§11.6) so the provider + OTel + the stamp beacon are live before any flag
 * read or instrumented path runs. `verify_prod_path` asserts exactly that.
 *
 * `fw eject` deletes this file + fw-providers.ts and rewrites the optional
 * `fw.flag(...)` sugar to raw `await OpenFeature.getClient().getBooleanValue(...)`.
 */
import { OpenFeature } from '@openfeature/server-sdk';
import {
  isProd,
  initFwTelemetry,
  registerFwFlagHooks,
} from '@fireweaveai/deploy-sdk/flags';
import { initFwAttestation } from '@fireweaveai/deploy-sdk';
import { resolveBootBeaconFromEnv } from '@fireweaveai/deploy-sdk/attest';
import { makeConnectedVendorProvider, makeDevProvider } from './fw-providers';
// Plain static value import — no glob/embed/build script. `FW_STAMPS` is the
// generated const tree; it is USED (passed to initFwAttestation) so DCE can't
// drop it (the "plain-import-ships" gate).
import { FW_STAMPS } from './fw-tracker';

export async function initFwHarness(): Promise<void> {
  const prod = isProd(process.env);

  // 1. Telemetry: dev → console exporters; prod → per-signal OTLP DIRECT to the
  //    vendor (traces + logs to PostHog; metrics to a metrics-capable dest).
  initFwTelemetry(prod ? 'rollout' : 'dev', {
    serviceName: 'fireweave-app',
    // In prod the initialise step fills `signals` from the observability
    // connection descriptor { vendor, otlpEndpoint, credentialEnvName }.
  });
  registerFwFlagHooks();

  // 2. Flags: prod → connected vendor provider; dev → FireWeave local provider.
  const provider = prod ? makeConnectedVendorProvider() : makeDevProvider();
  await OpenFeature.setProviderAndWait(provider);

  // 3. Boot beacon: attest active change stamps to the customer's own fw-server.
  //    Requires FW_ATTEST_URL + FW_PROJECT_API_KEY in prod runtime env (issued at initialise).
  initFwAttestation({
    stamps: FW_STAMPS,
    ...resolveBootBeaconFromEnv({ env: process.env, prod }),
  });
}
