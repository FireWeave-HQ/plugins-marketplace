/**
 * fw-providers.ts — scaffolded by `/fireweave:initialise` (WEB / browser surface).
 *
 * `makeConnectedVendorProvider()` hands build-baked `PUBLIC_FW_PROJECT_API_KEY`
 * + `PUBLIC_FW_API_URL` to `initFireweave()` from `@fireweaveai/web-sdk`, which
 * prefetches a decision cache from fw-server (`POST /v1/flags/evaluate`) once
 * per context. Reads afterwards are a pure in-memory lookup and stay
 * SYNCHRONOUS — safe inside a render path.
 *
 * **The SDK reads no environment at all** (spec/modes.md) — credentials are
 * resolved by `resolveFireweaveWebCredentials` below (`PUBLIC_FW_*` is a BUILD
 * convention, Vite inlines it at bundle time; it is not a wire contract) and
 * passed in explicitly. The key is a Fireweave PROJECT key, public by
 * construction — never a secret. No direct vendor SDK for control points.
 *
 * `mode` is REQUIRED and never inferred (spec/modes.md): a missing credential
 * fails loudly at boot rather than silently degrading to local evaluation.
 *
 * After auth, call `syncFireweaveUser(userId, props)` — ONE `client.identify`
 * call that registers the user for DURABLE targeting AND re-prefetches the
 * decision cache under the new id, so sticky % ramps bucket on a stable id.
 *
 * Two kinds of property feed a rule and you need both:
 *   - DURABLE — registered once at sign-in (plan, beta membership, region).
 *     Stored server-side; rules keep matching without the app resending them.
 *   - PER-REQUEST — the per-call evaluation context. Overrides the registered
 *     value for that one evaluation.
 * A rule targeting a property that is never registered AND never sent matches
 * nobody, silently.
 *
 * Observability is NOT wired here. FireWeave does not take responsibility for
 * wiring an observability SDK into a repo that has not chosen one.
 */
import {
  initFireweave,
  type FireweaveWebClient,
  type RegisterTargetResult,
} from '@fireweaveai/web-sdk';

/**
 * PERSISTED device identity — the targeting key for a visitor who has not
 * signed in.
 *
 * spec/control-points.md forbids the SDK from inventing a targeting key, and it
 * is right to: a CONSTANT key hashes every caller into one bucket, so a
 * percentage ramp serves either everybody or nobody while looking perfectly
 * healthy. The HARNESS is the correct place to solve it, because identity is
 * the app's concern and only the app knows where it may persist one.
 *
 * The id is minted once and kept in `localStorage`, so the same browser lands
 * in the same bucket across reloads and sessions — which is what makes a 10%
 * ramp actually mean 10% of visitors, and what stops a visitor flipping between
 * variants on every page load.
 *
 * At sign-in, `syncFireweaveUser()` re-prefetches under the real user id, so
 * bucketing follows the person across their devices from that point on.
 */
const FW_DEVICE_ID_STORAGE_KEY = 'fireweave.device-id';

/** Session fallback, used only when persistent storage is unavailable. */
let fwSessionDeviceId: string | null = null;

function mintDeviceId(): string {
  // `crypto.randomUUID` needs a secure context; a plain-http preview or an old
  // browser lands in the catch, and a weaker id is still far better than a
  // shared constant.
  try {
    return `dev_${crypto.randomUUID()}`;
  } catch {
    return `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function resolveDeviceTargetingKey(): string {
  try {
    const existing = localStorage.getItem(FW_DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const minted = mintDeviceId();
    localStorage.setItem(FW_DEVICE_ID_STORAGE_KEY, minted);
    return minted;
  } catch {
    // Private mode, disabled storage, or a sandboxed iframe. Fall back to ONE
    // id per page session rather than re-minting per call: a key that changed
    // between reads would re-bucket the visitor mid-session, which is worse
    // than a bucket that resets on reload.
    fwSessionDeviceId ??= mintDeviceId();
    return fwSessionDeviceId;
  }
}

/**
 * Resolve the browser-side FireWeave credentials from build-baked env.
 *
 * `PUBLIC_FW_*` is a BUILD convention (Vite inlines it at bundle time), not a
 * wire contract — the `VITE_`-prefixed and bare names are accepted as fallbacks
 * so an app that already standardised on one of them keeps working.
 *
 * The API-URL default is the production fw-server. `/fireweave:initialise`
 * writes the explicit value per environment, so the default only applies to a
 * repo that has not been initialised against a non-prod host.
 */
function resolveFireweaveWebCredentials(env: Record<string, string | undefined>): {
  apiKey: string;
  apiUrl: string;
} {
  const apiKey =
    env.PUBLIC_FW_PROJECT_API_KEY?.trim() ||
    env.VITE_FW_PROJECT_API_KEY?.trim() ||
    env.FW_PROJECT_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'PUBLIC_FW_PROJECT_API_KEY is required to evaluate control points via ' +
        'Fireweave in the browser (Fireweave project-api-key_… → fw-server ' +
        '/v1/flags/evaluate).'
    );
  }
  // The legacy `*_ATTEST_URL` spellings are still read, and reading one says
  // so — once. A silent fallback never clears itself; the deploy environment
  // keeps the old variable forever because nothing tells anyone it is old.
  const current =
    env.PUBLIC_FW_API_URL ?? env.VITE_FW_API_URL ?? env.FW_API_URL;
  const legacy =
    env.PUBLIC_FW_ATTEST_URL ?? env.VITE_FW_ATTEST_URL ?? env.FW_ATTEST_URL;
  if (!current && legacy) {
    console.warn(
      '[fireweave] PUBLIC_FW_ATTEST_URL is a legacy name for the fw-server base ' +
        'URL. Rename it to PUBLIC_FW_API_URL in this environment — the value ' +
        'does not change. See fireweave.md.'
    );
  }
  const apiUrl = (current ?? legacy ?? 'https://app-server.fireweave.ai')
    .trim()
    .replace(/\/+$/, '');
  if (!apiUrl) {
    throw new Error(
      'PUBLIC_FW_API_URL (or PUBLIC_FW_ATTEST_URL) is required to evaluate ' +
        'control points via Fireweave in the browser.'
    );
  }
  return { apiKey, apiUrl };
}

/**
 * Hosts the SDK is permitted to talk to, derived from the URL you configured.
 *
 * REQUIRED for a self-hosted fw-server, not optional hardening. `initFireweave`
 * validates `apiUrl` against a CANONICAL allowlist (the fireweave.ai hosts plus
 * loopback) when `allowedHosts` is omitted, so a customer-run fw-server on any
 * other hostname fails initialisation with a bare `Configuration` error that
 * names nothing. Passing the configured host explicitly is what makes
 * self-hosting work; it is still an allowlist, so it stays an SSRF guard.
 */
function allowedHostsFor(apiUrl: string): string[] {
  try {
    return [new URL(apiUrl).hostname, 'localhost', '127.0.0.1'];
  } catch {
    return ['localhost', '127.0.0.1'];
  }
}

/** Set by whichever factory below `initFwHarness()` calls — dev and prod both go through it. */
let fwClient: FireweaveWebClient | null = null;

// ── Environment-keyed tier model (D26) — GENERATED by `/fireweave:initialise` ──
// This lives here, not in fw-harness.ts, so the file you review stays about ten
// lines. `initialise` REGENERATES this map from `list_project_environments`.
// Add a row (or run `--reinit`) when you add an environment so the harness
// classifies it EXPLICITLY. `staging` is a FIRST-CLASS prod-tier environment —
// it is NEVER silently folded into dev.
const FW_DEFAULT_ENV = 'development';
const FW_ENV_PROFILES: Record<string, { tier: 'dev' | 'prod' }> = {
  development: { tier: 'dev' },
  staging: { tier: 'prod' },
  production: { tier: 'prod' },
};

// FireWeave reads THIS app's OWN build-baked env signal — you do NOT need to add
// a FireWeave-specific `PUBLIC_FW_ENV` / `VITE_FW_ENV`. `/fireweave:initialise`
// asks how this app determines its environment and generates `readEnvSignal`
// below to read YOUR signal (Vite `MODE`, a `PUBLIC_*` / `VITE_*` app var, etc.).
// `PUBLIC_FW_ENV` / `VITE_FW_ENV` are retained ONLY as an optional override.
// Regenerated on `--reinit` — edit via the skill.
// fw:env-source
function readEnvSignal(
  env: Record<string, string | undefined> | undefined
): string | undefined {
  return env?.MODE ?? env?.PUBLIC_FW_ENV ?? env?.VITE_FW_ENV;
}

// Map a raw signal value → a FireWeave environment NAME (a key of
// FW_ENV_PROFILES). Vite MODE is often 'production'/'development'; alias to your
// FireWeave names (e.g. { production: 'prod' }) when they differ.
const FW_ENV_ALIASES: Record<string, string> = {};

/** Resolve the running environment NAME from the app's own build-baked signal. */
function resolveFwEnvName(
  env: Record<string, string | undefined> | undefined
): string {
  const raw = (readEnvSignal(env) ?? FW_DEFAULT_ENV).trim();
  return FW_ENV_ALIASES[raw] ?? raw;
}

const PROD_FW_ENV = new Set(['prod', 'production', 'rollout']);
const NON_PROD_FW_ENV = new Set(['dev', 'development', 'test', 'local']);

/** Last-resort tier probe for an environment with no FW_ENV_PROFILES row. */
function isProdFallback(
  env: Record<string, string | undefined> | undefined
): boolean {
  const fw = (env?.PUBLIC_FW_ENV ?? env?.VITE_FW_ENV)?.toLowerCase();
  if (fw) {
    if (PROD_FW_ENV.has(fw)) return true;
    if (NON_PROD_FW_ENV.has(fw)) return false;
  }
  return env?.MODE?.toLowerCase() === 'production';
}

/**
 * Is this build a prod-tier environment? The tier decision `fw-harness.ts`
 * branches on. An UNKNOWN environment is never silently folded into dev or
 * prod — it falls back to the probe above and WARNS, so the operator adds an
 * explicit row rather than discovering the classification from behaviour.
 */
export function isProd(
  env: Record<string, string | undefined> | undefined = import.meta.env as
    | Record<string, string | undefined>
    | undefined
): boolean {
  const name = resolveFwEnvName(env);
  const profile = FW_ENV_PROFILES[name];
  if (profile) return profile.tier === 'prod';
  const prod = isProdFallback(env);
  console.warn(
    `[fireweave] environment '${name}' has no FW_ENV_PROFILES entry; ` +
      `classified as '${prod ? 'prod' : 'dev'}' via the fallback probe. ` +
      `Run /fireweave:initialise --reinit or add it to FW_ENV_PROFILES.`
  );
  return prod;
}

/** PROD: Fireweave remote mode over build-baked PUBLIC_FW_* credentials. */
export async function makeConnectedVendorProvider(): Promise<FireweaveWebClient> {
  // PUBLIC_* env is inlined into the browser bundle at build time.
  const creds = resolveFireweaveWebCredentials(
    import.meta.env as Record<string, string | undefined>
  );
  fwClient = await initFireweave({
    mode: 'remote',
    apiKey: creds.apiKey,
    apiUrl: creds.apiUrl,
    allowedHosts: allowedHostsFor(creds.apiUrl),
    context: { targetingKey: resolveDeviceTargetingKey() },
  });
  // Register the device so a rule can target device-level facts before sign-in.
  // Resolves rather than throwing; `kind: 'device'` is what lets a rule tell a
  // pre-auth visitor from a signed-in user.
  await fwClient.registerTarget(resolveDeviceTargetingKey(), { kind: 'device' });
  return fwClient;
}

/**
 * DEV: the SDK's local mode — an in-process seeded map, no network, no
 * credentials. Same `initFireweave()` entry point as prod, so the two tiers
 * share validation, lifecycle gating and context canonicalization and the
 * harness cannot skew.
 *
 * Call-site / manifest defaults stay `false` (RAMP-1). To dogfood a control
 * point ON locally, seed it here — never `fw.flag(key, true)` (that same `true`
 * is the prod fallback when the key is missing from the backend):
 *
 *   local: { controlPoints: { '<feature-slug>': true } },
 */
export async function makeDevProvider(): Promise<FireweaveWebClient> {
  fwClient = await initFireweave({
    mode: 'local',
    local: { controlPoints: {} },
    context: { targetingKey: resolveDeviceTargetingKey() },
  });
  return fwClient;
}

/** Prefetch / refresh control points for a targeting key (call after sign-in). */
export async function reloadFireweaveFlags(targetingKey: string): Promise<void> {
  await fwClient?.runtime.setContext({ targetingKey });
}

/**
 * Sign-in hook: ONE call (`client.identify`) that registers the user's durable
 * targeting properties AND re-prefetches control points under that id:
 *
 *   await syncFireweaveUser(user.id, { plan: user.plan, beta: user.inBeta });
 *
 * Resolves rather than throwing — it runs in sign-in paths, where a targeting
 * concern must not break authentication. Both tiers route through the SAME
 * client: prod sends it to fw-server; local records it in-process and traces one
 * `[fireweave:local]` line saying nothing was sent (spec/modes.md). Log
 * `ok: false` — a silently unregistered target is exactly how targeting rules
 * end up matching nobody.
 */
export async function syncFireweaveUser(
  targetingKey: string,
  properties: Record<string, string | number | boolean | null> = {}
): Promise<RegisterTargetResult> {
  if (!fwClient) return { ok: false };
  return fwClient.identify(targetingKey, { kind: 'user', properties });
}

/** The client `initFwHarness()` brought up — call-sites read control points through this. */
export function getFwClient(): FireweaveWebClient {
  if (!fwClient) {
    throw new Error(
      '[fireweave] getFwClient() called before initFwHarness() finished — await it first.'
    );
  }
  return fwClient;
}
