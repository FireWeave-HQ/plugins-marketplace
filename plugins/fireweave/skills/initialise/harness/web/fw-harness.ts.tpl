/**
 * fw-harness.ts — scaffolded by `/fireweave:initialise` (WEB / browser surface).
 *
 * The web peer of the server harness: same "promote, not wrap" shape and the same
 * environment-keyed `FW_ENV_PROFILES` selector, but the web SDK is SYNCHRONOUS —
 * flag READS at the call-sites carry NO `await` (the web invariant the eject
 * codemod depends on). The harness BOOT is still async (it awaits provider
 * readiness once at start). On the web the running environment is resolved from
 * the BUILD-BAKED `import.meta.env` (`VITE_FW_ENV` → Vite `MODE`), so `staging`
 * builds bind the connected vendor as a first-class prod-tier surface.
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

type FwEnvTier = 'dev' | 'prod';

/**
 * Per-environment harness profile — the environment-keyed selector (D26).
 * `/fireweave:initialise` REGENERATES this map from `list_project_environments`.
 * Add a row (or run `--reinit`) when you add an environment so the harness
 * classifies it EXPLICITLY. `FW_DEFAULT_ENV` is the `defaultEnvironment`.
 */
const FW_DEFAULT_ENV = 'development';
const FW_ENV_PROFILES: Record<string, { tier: FwEnvTier }> = {
  development: { tier: 'dev' },
  staging: { tier: 'prod' },
  production: { tier: 'prod' },
};

/**
 * Resolve the running environment NAME from the build-baked Vite env.
 * `VITE_FW_ENV` is the canonical selector; Vite `MODE` is the fallback; else the
 * project default. (The boot beacon still scopes off SSR `FW_ENV` — set both.)
 */
function resolveFwEnvName(env: Record<string, string | undefined> | undefined): string {
  return env?.VITE_FW_ENV ?? env?.MODE ?? FW_DEFAULT_ENV;
}

export async function initFwHarness(): Promise<void> {
  const viteEnv = import.meta.env as Record<string, string | undefined> | undefined;
  const fwEnvName = resolveFwEnvName(viteEnv);
  const profile = FW_ENV_PROFILES[fwEnvName];
  // Unknown environment is NOT silently folded — fall back to the isProd() tier
  // probe and WARN so the operator adds an explicit profile row.
  const prod = profile ? profile.tier === 'prod' : isProd(viteEnv);
  if (!profile) {
    console.warn(
      `[fireweave] environment '${fwEnvName}' has no FW_ENV_PROFILES entry; ` +
        `classified as '${prod ? 'prod' : 'dev'}' via isProd() fallback. ` +
        `Run /fireweave:initialise --reinit or add it to FW_ENV_PROFILES.`
    );
  }

  // Telemetry: dev-tier → console; prod-tier → per-signal OTLP DIRECT to the
  // vendor (OTLP-over-fetch works in the browser). The boot is async; reads sync.
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
