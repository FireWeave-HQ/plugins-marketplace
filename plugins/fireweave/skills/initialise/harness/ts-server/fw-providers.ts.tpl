/**
 * fw-providers.ts — scaffolded by `/fireweave:initialise` (TS-server surface).
 *
 * `makeConnectedVendorProvider()` is the prod flag provider with a CONCRETE body:
 * it reads `FW_PROJECT_API_KEY` + `FW_API_URL` (falls back to the legacy-named
 * `FW_ATTEST_URL`, which older provisioning wrote — same fw-server base URL) and
 * binds `@fireweaveai/sdk`'s remote adapter (fw-server `POST /v1/flags/evaluate`).
 * Apps do NOT embed PostHog keys — Seal still provisions flags on
 * FireWeave-managed PostHog server-side. (OTel stays on deploy-sdk.)
 *
 * `registerFwTarget()` is the OTHER half of targeting. Rules match on two kinds
 * of property and you need both:
 *   - DURABLE — registered here, once per login / device provisioning: plan,
 *     beta membership, region, device model. Stored server-side, so rules keep
 *     matching without the app resending anything, and backend systems can set
 *     facts the client never knows.
 *   - PER-REQUEST — the OpenFeature evaluation context: page, session,
 *     experiment context. Overrides the registered value for that one call.
 * A rule targeting a property that is never registered AND never sent matches
 * nobody, silently. Register the durable facts at sign-in.
 *
 * Ejecting strips this file's imports and leaves the call-sites on raw
 * OpenFeature, so removing FireWeave leaves no app-code lock-in. The file itself
 * is yours to delete once nothing imports it.
 */
import {
  FireweaveProvider,
  FireweaveRemoteAdapter,
  FireweaveRuntime,
  makeFireweaveLocalProvider,
  type RegisterTargetOptions,
  type RegisterTargetResult,
} from '@fireweaveai/sdk';
import type { Provider } from '@openfeature/server-sdk';

/** Retained so `registerFwTarget` reaches the same runtime the provider uses. */
let fwRuntime: FireweaveRuntime | null = null;

function resolveFwApiUrl(env: Record<string, string | undefined>): string {
  return (env.FW_API_URL ?? env.FW_ATTEST_URL ?? '').replace(/\/+$/, '');
}

/** PROD: Fireweave remote provider → fw-server /v1/flags/evaluate. */
export function makeConnectedVendorProvider(): Provider {
  const apiUrl = resolveFwApiUrl(process.env);
  const apiKey = process.env.FW_PROJECT_API_KEY?.trim() ?? '';
  if (!apiUrl || !apiKey) {
    throw new Error(
      '[fireweave] prod flags require FW_PROJECT_API_KEY and FW_API_URL (or FW_ATTEST_URL)'
    );
  }
  const adapter = new FireweaveRemoteAdapter({ apiUrl, apiKey });
  fwRuntime = new FireweaveRuntime(adapter);
  return new FireweaveProvider(fwRuntime, { lazyReady: false });
}

/**
 * Register a user or device for DURABLE targeting. Call once from your auth
 * middleware / sign-in handler, then pass the SAME id as `targetingKey` in the
 * OpenFeature evaluation context:
 *
 *   await registerFwTarget(user.id, {
 *     properties: { plan: user.plan, beta: user.inBeta },
 *   });
 *
 * Never throws — an analytics call must not break sign-in. On the dev tier there
 * is no remote runtime, so this reports `ok: false` rather than pretending to
 * have registered anything.
 */
export async function registerFwTarget(
  targetingKey: string,
  options: RegisterTargetOptions = {}
): Promise<RegisterTargetResult> {
  if (!fwRuntime) return { ok: false };
  return fwRuntime.registerTarget(targetingKey, options);
}

/**
 * DEV: FireWeave local in-memory provider (FW_DUMP capture + devFlags), served
 * through the same `FireweaveRuntime` as prod — dev and prod share lifecycle
 * gating and context canonicalization, so the harness cannot skew between
 * tiers.
 *
 * Call-site / manifest defaults stay `false` (RAMP-1). To dogfood a flag ON
 * locally, list it here — never `fw.flag(key, true)` (that same `true` is the
 * prod fallback when the provider flag is missing).
 *
 *   return makeFireweaveLocalProvider({
 *     echo: true,
 *     devFlags: { '<feature-slug>': true },
 *   });
 */
export function makeDevProvider(): Provider {
  return makeFireweaveLocalProvider({ echo: true });
}
