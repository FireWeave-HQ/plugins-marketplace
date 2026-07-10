/**
 * fw-harness.ts — scaffolded by `/fireweave:initialise` (TS-server surface).
 *
 * The "promote, not wrap" harness (D26): BOTH branches are present and the
 * RUNNING ENVIRONMENT — resolved by NAME, not a bare boolean — selects which one
 * is live. Nothing is swapped at promotion — `safe-rollout-fast` runs
 * `verify_prod_path` and ramps via `flag.control`; it never mutates this file.
 *
 * Environment-keyed model (D26): `FW_ENV_PROFILES` maps every environment the
 * project declares in FireWeave (`list_project_environments`) — the default
 * `development` plus `staging`, `production`, … — to a TIER. `dev`-tier binds the
 * in-memory FireWeave local provider + console exporters; `prod`-tier binds the
 * connected vendor's real provider + direct OTLP + the boot beacon. `staging` is a
 * FIRST-CLASS prod-tier environment — it is NEVER silently folded into dev or prod.
 * `/fireweave:initialise --reinit` regenerates this map from the environment list.
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

type FwEnvTier = 'dev' | 'prod';

/**
 * Per-environment harness profile — the environment-keyed selector (D26).
 * `/fireweave:initialise` REGENERATES this map from `list_project_environments`
 * so it mirrors the environments configured in FireWeave. Add a row here (or run
 * `--reinit`) when you add an environment so the harness classifies it EXPLICITLY
 * instead of guessing. `FW_DEFAULT_ENV` is the project's `defaultEnvironment` —
 * the row used when nothing is set at runtime.
 */
const FW_DEFAULT_ENV = 'development';
const FW_ENV_PROFILES: Record<string, { tier: FwEnvTier }> = {
  development: { tier: 'dev' },
  staging: { tier: 'prod' },
  production: { tier: 'prod' },
};

/**
 * Resolve the running environment NAME. `FW_ENV` is the canonical selector — it
 * ALSO scopes the boot beacon (`resolveBootBeaconFromEnv` reads it), so keep them
 * aligned per environment. `NODE_ENV` is the fallback; else the project default.
 */
function resolveFwEnvName(env: Record<string, string | undefined>): string {
  return env.FW_ENV ?? env.NODE_ENV ?? FW_DEFAULT_ENV;
}

export async function initFwHarness(): Promise<void> {
  const fwEnvName = resolveFwEnvName(process.env);
  const profile = FW_ENV_PROFILES[fwEnvName];
  // Unknown environment is NOT silently folded into dev/prod — fall back to the
  // isProd() tier probe and WARN so the operator adds an explicit profile row.
  const prod = profile ? profile.tier === 'prod' : isProd(process.env);
  if (!profile) {
    console.warn(
      `[fireweave] environment '${fwEnvName}' has no FW_ENV_PROFILES entry; ` +
        `classified as '${prod ? 'prod' : 'dev'}' via isProd() fallback. ` +
        `Run /fireweave:initialise --reinit or add it to FW_ENV_PROFILES.`
    );
  }

  // 1. Telemetry: dev-tier → console exporters; prod-tier → per-signal OTLP DIRECT
  //    to the vendor (traces + logs to PostHog; metrics to a metrics-capable dest).
  initFwTelemetry(prod ? 'rollout' : 'dev', {
    serviceName: 'fireweave-app',
    // In prod the initialise step fills `signals` from the observability
    // connection descriptor { vendor, otlpEndpoint, credentialEnvName }.
  });
  registerFwFlagHooks();

  // 2. Flags: prod-tier → connected vendor provider (reads THIS environment's
  //    credentials from process.env); dev-tier → FireWeave local provider.
  const provider = prod ? makeConnectedVendorProvider() : makeDevProvider();
  await OpenFeature.setProviderAndWait(provider);

  // 3. Boot beacon: attest active change stamps to the customer's own fw-server,
  //    scoped by `FW_ENV` (staging attests as 'staging', production as 'production').
  //    Requires FW_ATTEST_URL + FW_PROJECT_API_KEY in the prod-tier runtime env.
  initFwAttestation({
    stamps: FW_STAMPS,
    ...resolveBootBeaconFromEnv({ env: process.env, prod }),
  });
}
