---
name: "fw_migrate_harness"
description: "Move an app's feature-flag reads onto the FireWeave control-points v1 SDK — the code half of migrating to FireWeave-managed flags. Handles three source shapes — a direct PostHog SDK, an OpenFeature-era FireWeave harness, and residue of the dissolved `@fireweaveai/deploy-sdk` (boot beacon + FireWeave-wired telemetry). Rewrites provider wiring to `initFireweave` from `@fireweaveai/server-sdk` / `@fireweaveai/web-sdk`, maps identity calls to target registration, and moves a generated FireWeave harness (scaffold) onto the SDK 3.0.0 start profile (package surfaces, one `start` call plus a control-points file; Sources D–J for ts-server, web, Python, Go, Java, Rust and Swift), reporting per-environment mode changes first. It re-aligns the repo contract `initialise` owns (`fireweave.md`, `.env.example`, `PROVIDERS.md`, `agent-instructions.md`, `surfaces[].metricsClient`), and reports the result to fw-server. Use when the user asks to \"migrate to FireWeave flags\", \"move off PostHog\", \"switch to the FireWeave SDK\", \"upgrade to control points\", \"remove the deploy-sdk / boot beacon\", \"move to the start profile\", \"drop the generated harness\", \"upgrade to SDK 3\", or invokes `/fireweave:migrate-harness`. `--check` reports what would change without writing."
---
> Interaction: gate each decision with `request_user_input` (single-choice; "(Recommended)" first). If interactive prompting is unavailable (non-interactive run), present numbered options inline and wait.

# Migrate harness (move flag reads onto FireWeave)

Moving a project onto FireWeave control points is a change to **the app's own
repository**: its flag reads go through fw-server. That is this skill. The
server side needs no migration: every environment's control points are served
by FireWeave from creation, and flags are not imported from the customer's own
PostHog (docs/archive/fw-latest/09-control-points.md §3, §6 a).

The dangerous outcome is a rollout FireWeave ramps while the running app still
reads the old provider: the FireWeave UI shows it progressing and **no real
user sees anything change**. Nothing server-side can detect that, which is why
step 6 reports back.

## HARD ORDER

1. **Detect** — find every direct provider read, and every deploy-sdk residue.
2. **Confirm** — show the plan; never rewrite without the user seeing it.
3. **Rewrite** — provider wiring, then identity, then call sites, then anchors, then the tracker unification, then the deploy-sdk strip, then the upgrade notice. A scaffold moving to the start profile (Sources D–J) takes §3h in place of 3a–3c and 3e.
4. **Re-align the repo contract** — the artifacts `initialise` owns and this skill has never touched: the telemetry inventory, the env contract, `PROVIDERS.md`, and `agent-instructions.md`. For a surface that moved to the start profile, also re-key it and re-author its manifests (§4f) and move its credentials (§4g).
5. **Verify** — typecheck/build; a migration that does not compile is not done.
6. **Report** — `POST /v1/projects/:projectId/harness-migration`.

Do not skip 6. An unreported migration reads as "never happened", and the
project page will keep warning that control points moved without the code.

Do not skip 4 either, and for a less obvious reason. Steps 1–3 move the code;
step 4 moves what every FUTURE change reads before touching that code. A repo
that passes 5 and skips 4 compiles, ships, and then hands the next agent a
telemetry contract describing a client the repo does not have — see §4.

## 1. Detect

**There are THREE source shapes, and they need different rewrites.** Detect which
you have before planning anything — a repo can contain more than one, on
different surfaces.

A and B are alternatives: they describe where a surface's flag reads come from
today. **C is orthogonal to both** — it describes a retired SDK the harness
still links against, and a repo whose flag reads are ALREADY correct can carry
it. Check for C even when A and B both come up empty.

Sources D–J are a separate **family**, not a fourth shape: a repo already on a
FireWeave-generated harness (a "scaffold") moving onto the SDK 3.0.0 start
profile (a "package" surface). Their detection is below Source C; their
rewrite is §3h.

### Source A — a direct PostHog SDK

- imports of `posthog-js`, `posthog-node`, `PostHog`
- `posthog.isFeatureEnabled` / `getFeatureFlag` / `getFeatureFlagPayload`
- `posthog.identify` / `posthog.reset`
- OpenFeature providers bound to a PostHog adapter
- `POSTHOG_*` / `NEXT_PUBLIC_POSTHOG_*` / `VITE_POSTHOG_*` env reads

### Source B — an OpenFeature-era FireWeave harness

A repo initialised before the control-points v1 cutover. It is already on
FireWeave, so nothing is _wrong_ with it today — but it is on a surface the
SDKs no longer ship, so it cannot take SDK updates.

- imports of `@fireweaveai/sdk` (the RETIRED npm name — v1 is
  `@fireweaveai/server-sdk`), or `fireweave[openfeature]` /
  `ai.fireweave:fireweave-openfeature`
- any `@openfeature/server-sdk` / `@openfeature/web-sdk` import in
  `fireweave/fw-providers.*` or `fireweave/fw-harness.*`
- `FireweaveProvider`, `FireweaveWebProvider`, `makeFireweaveLocalProvider`,
  `FireweaveLocalProvider.create`, `make_fireweave_local_provider`
- `OpenFeature.setProviderAndWait(...)` in the harness
- hand-constructed `new FireweaveRuntime(new FireweaveRemoteAdapter(...))`
- a manifest whose harness `api` is `"openfeature"` (`harness.flags.api` in schemas 1–2, `harness.controlPoints.api` in schema 3)

**What Source B must NOT touch.** This is a provider-wiring migration only:
leave `// @fireweave-controlpoint` anchors, `FW_STAMPS` in the tracker, and every
rollout-ready manifest exactly as they are. Anchors and stamps are the change
identity that `reconcile` and the dev-checklist gates read out of the committed
tree; rewriting them here would look like feature work that never happened. The
manifest's harness `api` may stay `"openfeature"` — the schema accepts both values
forever, and a manifest rewrite is a server round-trip
(`upsert_rollout_manifest`) that this skill has no reason to make. Set
`"control-points"` only if you are already re-authoring that manifest for
another reason.

### Source C — deploy-sdk residue

A repo scaffolded before `@fireweaveai/deploy-sdk` was dissolved. Its harness
links a package that no longer has a successor, and the boot beacon it wired up
no longer exists on either end.

**This is the shape the other two miss.** A and B key on how flags are READ, so
a repo whose reads were already migrated matches neither — and the residue then
scans as clean while `fw-harness.*` still imports the retired SDK. That is not
hypothetical: it is what a Source-B migration leaves behind today, because §3a
below has only ever named `fw-providers.*` as the file to rewrite.

- any import from `@fireweaveai/deploy-sdk` (including the `/attest` and
  `/flags/web` subpaths), or the package in `package.json` / `pyproject.toml`
- `initFwTelemetry`, `initFwAttestation`, `resolveBootBeaconFromEnv`, or a
  `FW_SURFACES` const in a harness file
- a python harness defining `_init_console_telemetry`
- `FW_ATTEST_URL` / `PUBLIC_FW_ATTEST_URL` / `VITE_FW_ATTEST_URL`, or any
  `*_OO_OTLP_*` name, in `.env.example` or an env template
- `deploy-beacon.env.local` in `.fireweave/.gitignore`
- a `.fireweave/PROVIDERS.md` with a **Boot beacon** column

Grep the harness FILES, not just the dependency manifest: a dependency can be
dropped while the imports stay, and imports can survive a dependency that was
already removed. Both fail at different times.

### Sources D–J — a FireWeave scaffold moving to the start profile (scaffold → package)

A repo `initialise` scaffolded before the start profile carries a generated
harness per surface: `fw-harness.*` (the init call and the read accessor),
`fw-providers.*` (the `FW_ENV_PROFILES` tier map, credential wiring, the
dev-tier seeds, target registration) and `fw-tracker.*` (`FW_STAMPS`). The SDK
3.0.0 start profile replaces all of it with one `start` call, first in the
entrypoint, and a control-points file. That move is scaffold → package.

Nothing is wrong with a scaffold today: it reads through FireWeave. Offer this
family when the user asks for it, or when a scaffold surface's language has an
SDK 3.0.0 release (§3h step 1 decides that, not you).

A surface is a scaffold when ALL of these hold:

- its `.fireweave/project.json` `surfaces[]` entry has no `harnessKind` (absent
  means scaffold; `harnessKind: 'package'` means it already moved — skip it), and
  its `path` names a harness module rather than the app entrypoint;
- the files in the table below exist, generated from the initialise skill's
  `harness/<surface>/` templates (§3a resolves that directory);
- the entrypoint calls the scaffold's init function.

| Source | Surface   | Scaffold files                                                                                                                                            | Exported scaffold identifiers to look for                                                                                                                                                                                                                         |
| ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D      | ts-server | `fireweave/fw-harness.ts`, `fireweave/fw-providers.ts`, `fireweave/fw-tracker.ts` (or a legacy `fw-tracker/index.ts`) importing `@fireweaveai/server-sdk` | `initFwHarness`, `fw`, `getFwClient`, `isProd`, `makeConnectedVendorProvider`, `makeDevProvider`, `registerFwTarget`, `resolveInstanceTargetingKey`, `FW_STAMPS`; the retired `fw.flag` alias                                                                     |
| E      | web       | the same three file names, importing `@fireweaveai/web-sdk`                                                                                               | `initFwHarness`, `fw`, `getFwClient`, `isProd`, `makeConnectedVendorProvider`, `makeDevProvider`, `syncFireweaveUser`, `reloadFireweaveFlags`, `FW_STAMPS`; `PUBLIC_FW_PROJECT_API_KEY` / `VITE_FW_PROJECT_API_KEY`                                               |
| F      | python    | `fw_harness.py`, `fw_providers.py`, `fw_tracker.py` in `fireweave_harness/` (current) **or** `fireweave/` with an `__init__.py` (older)                   | `init_fw_harness`, `fw_control_points`, `get_fw_client`, `is_prod`, `resolve_fw_env_name`, `make_connected_vendor_provider`, `make_dev_provider`, `register_fw_target`, `FW_STAMPS`; the retired `fw_flag`                                                        |
| G      | go        | `fireweave/fw_harness.go`, `fw_providers.go`, `fw_tracker.go` (`package fireweave`) importing `.../sdks/go/v2/fireweave` or the unsuffixed module         | `InitFwHarness`, `GetFwClient`, `IsProd`, `ResolveFwEnvName`, `MakeConnectedVendorProvider`, `MakeDevProvider`, `RegisterFwTarget`, `FW_STAMPS`                                                                                                                   |
| H      | java      | `FwHarness.java`, `FwProviders.java`, `FwTracker.java` in `<base package>.fireweave`                                                                      | `FwHarness.initFwHarness`, `FwProviders.getFwClient`, `isProd`, `resolveFwEnvName`, `makeConnectedVendorProvider`, `makeDevProvider`, `registerFwTarget`, `FwTracker.FW_STAMPS`; the older generation's `fwFlag`                                                  |
| I      | rust      | `fireweave/fw_harness.rs`, `fw_providers.rs`, `fw_tracker.rs`                                                                                             | `init_fw_harness`, `get_fw_client`, `is_prod`, `resolve_fw_env_name`, `make_connected_vendor_provider`, `make_dev_provider`, `register_fw_target`, `FW_STAMPS`; a `mod fireweave;` in the binary                                                                  |
| J      | swift     | `FwHarness.swift`, `FwProviders.swift`, `FwTracker.swift` importing `Fireweave`                                                                           | `FwHarness.initFwHarness`, `FwProviders.getFwClient`, `isProd`, `resolveFwEnvName`, `makeConnectedVendorProvider`, `makeDevProvider`, `syncFireweaveUser`, `FwTracker.FW_STAMPS`; the retired `fwFlag`; Info.plist `FWProjectApiKey`, `FWApiUrl`, `FWEnvironment` |

**Dart has no Source.** `initialise` never shipped a Dart scaffold, so no
customer depends on one and there is nothing to move: a Dart surface starts on
the start profile through `/fireweave:initialise`. If Dart files look like a
FireWeave harness, someone hand-wrote them; stop and say so rather than
guessing at a mapping.

A scaffold surface can also match B (an OpenFeature-era harness) or C
(deploy-sdk residue). B may go straight to its D–J Source: the package
rewrite replaces the whole harness, so the OpenFeature wiring goes with it, and
§3a's dependency removal still applies. C's §3f dependency removal and §4c
purge still run.

Group by **surface** (server, web, worker, mobile). Surfaces migrate
independently and the report records which ones actually moved.

If nothing is found — no A, no B, no C, and no scaffold the user wants on the
start profile — stop and say so. Do not scaffold a harness; that is
`/fireweave:initialise`. **A repo with only C still has work**: skip to §3f and
§4, and report the surfaces you touched there.

## 2. Confirm

Show: the files to change, the surfaces covered, and anything you are NOT
migrating and why. Get explicit agreement before writing.

For every surface a D–J Source would move, the plan also carries **the
mode-change report** (see `--check`): per environment, the mode the app runs in
today and the mode it will run in after the move. It is shown before anything is
written, and a surface with a row the user has not acknowledged is not
rewritten.

## 3. Rewrite

### 3a. Provider wiring

**Both FLAG source shapes — A and B — converge on the same target.** (Source C
is not a flag path and is handled by §3f. Sources D–J do not pass through here:
they leave `initFireweave` behind entirely, see §3h.) From Source A you are
replacing a PostHog provider; from Source B you are replacing an OpenFeature
provider **and deleting the OpenFeature dependency** — v1 bans an OpenFeature
provider outright, so there is nothing left to wrap. Either way the result is
one `initFireweave` call whose `mode` selects the tier.

`mode` is REQUIRED and never inferred. That is the point of the shape: with
inference, a missing credential in production silently becomes local
evaluation, every control point serves its default, and the boot log stays
green — a feature that never ramps, indistinguishable from a rollout nobody
started. Do NOT hand-construct the runtime/adapter/client; that compiles and
runs while bypassing the validation which makes a bad credential fail loudly.

Server:

```ts
import { initFireweave } from '@fireweaveai/server-sdk';

// FW_ATTEST_URL is the legacy spelling, still read and never written. Saying
// so once is what makes the fallback temporary: a silent one is kept forever,
// because nothing ever tells the deploy environment it is out of date.
if (!process.env.FW_API_URL && process.env.FW_ATTEST_URL) {
  console.warn(
    '[fireweave] FW_ATTEST_URL is a legacy name for the fw-server base URL. ' +
      'Rename it to FW_API_URL — the value does not change. See fireweave.md.'
  );
}
const apiUrl = (
  process.env.FW_API_URL ??
  process.env.FW_ATTEST_URL ??
  ''
).replace(/\/+$/, '');
const fireweave = await initFireweave({
  mode: 'remote',
  apiUrl,
  apiKey: process.env.FW_PROJECT_API_KEY!,
  // REQUIRED for a self-hosted fw-server: omitted, the SDK validates apiUrl
  // against a canonical *.fireweave.ai + loopback allowlist and init fails with
  // a bare `Configuration` error that names nothing.
  allowedHosts: [new URL(apiUrl).hostname, 'localhost', '127.0.0.1'],
});

const on = await fireweave.controlPoints.getBooleanValue('key', false, {
  targetingKey: user.id,
});
```

Web (browser) — control points come from `@fireweaveai/web-sdk`, and reads stay
SYNCHRONOUS. `PUBLIC_FW_*` is a build convention (the bundler inlines it), not a
wire concern; the SDK reads no environment, so the harness passes it in:

```ts
import { initFireweave } from '@fireweaveai/web-sdk';

const apiUrl = import.meta.env.PUBLIC_FW_API_URL;
const fireweave = await initFireweave({
  mode: 'remote',
  apiUrl,
  apiKey: import.meta.env.PUBLIC_FW_PROJECT_API_KEY,
  allowedHosts: [new URL(apiUrl).hostname, 'localhost', '127.0.0.1'],
  context: { targetingKey: anonymousDeviceId },
});

// No await — safe inside render.
const on = fireweave.controlPoints.getBooleanValue('key', false);
```

**Remove the OpenFeature dependency after the rewrite** (Source B): drop
`@openfeature/server-sdk` / `@openfeature/web-sdk` from `package.json`, the
`[openfeature]` extra from the python install, and
`ai.fireweave:fireweave-openfeature` from the java build file. Leaving them
installed leaves a second, now-unwired flag path in the graph.

**Local/dev tier.** The same `initFireweave` call with `mode: 'local'` and
`local: { controlPoints: {} }` — no credentials, no network. Seed a key there to
dogfood a feature ON locally; never by passing `true` as a call-site default.

The app must end up holding **no PostHog key**. Flags are evaluated by
fw-server, which holds the managed credentials. Remove the now-unused
`POSTHOG_*` env vars from the app's config and deployment.

Reference implementation — read the **shipped templates**, not another customer's
repo. They live in the initialise skill's own directory, beside its `SKILL.md`.
Resolve that path relative to the initialise skill's directory in this same
bundle — `<dir of this SKILL.md>/../` plus whatever this host names it
(`initialise`, `fw-initialise` on Cursor, `fw_initialise` on Codex).

**Read BOTH files for every surface you touch**, not just the providers one:

| surface     | providers                               | harness                               |
| ----------- | --------------------------------------- | ------------------------------------- |
| `ts-server` | `harness/ts-server/fw-providers.ts.tpl` | `harness/ts-server/fw-harness.ts.tpl` |
| `web`       | `harness/web/fw-providers.ts.tpl`       | `harness/web/fw-harness.ts.tpl`       |
| `python`    | `harness/python/fw_providers.py.tpl`    | `harness/python/fw_harness.py.tpl`    |

The harness column is the one this skill used to omit, and the omission has a
name: **`fw-harness.*` is where the deploy-sdk residue lives.** A migration that
reads only the providers template rewrites the file that was already fine and
leaves the file that still imports a dissolved package — §3f exists because that
is what happened. The shipped harness templates import nothing but
`./fw-providers`, and `harness/harness-templates.test.ts` pins that absence, so
the target shape is checkable rather than remembered.

`apps/api/src/fireweave/fw-providers.ts` in the pulse-folio repo is one instance
of that template, not the source of truth, and is not readable from here.

### 3b. Identity — the part that is easy to get wrong

`posthog.identify(id, props)` does **two** jobs:

1. declares who the current user is, and
2. **stores** those properties as a person profile.

The FireWeave equivalent is also two calls, and emitting only the first is the
common mistake:

```ts
// durable: stored server-side; rules keep matching without the app resending.
// Resolves rather than throwing — this runs in sign-in paths, where a targeting
// concern must not break authentication. LOG `ok: false`: a silently
// unregistered target is exactly how a rule ends up matching nobody.
const res = await fireweave.registerTarget(user.id, {
  kind: 'user',
  properties: { plan: user.plan, beta: user.inBeta },
});

// per-request: overrides the stored properties for this evaluation only
const on = await fireweave.controlPoints.getBooleanValue('key', false, {
  targetingKey: user.id,
  ...perRequestState,
});
```

On the **web** surface these collapse into one call — `fireweave.identify(id,
{ kind: 'user', properties })` registers the durable facts AND re-prefetches the
decision cache under the new id, so a percentage ramp buckets on the real user
rather than the anonymous placeholder every signed-out visitor shares.

Emit **both**. Context alone makes every rule only as good as what the app
remembers to send on each request — a rule targeting `plan` matches nobody if
one surface forgets it, silently and with no error.

Split the properties deliberately:

- **durable** (register): plan, beta membership, region, device model
- **per-request** (context): page, session, experiment context

`posthog.reset()` on logout becomes a re-prefetch under the anonymous id (web:
`identify(anonymousId, …)`; server: simply pass the anonymous key as
`targetingKey` on subsequent reads). Do NOT "unregister" the target — the stored
profile is still correct, the user simply stopped being the current one.

### 3c. Call sites

Flag reads become **control-point reads**: `controlPoints.getBooleanValue(key,
false, ctx)` — async on the server SDK, synchronous on the web SDK.

**Rewrite the retired `flag` alias too.** A repo scaffolded before ADR-022 reads
through a harness alias — `fw.flag(key, false, ctx)` on TS/web, `fw_flag(...)` in
python, `fwFlag(...)` in java/swift. Convert every one of them to the
control-points call. The alias existed partly so the `eject` codemod could
recognise and rewrite it; eject is retired and FireWeave is not eject-able, so
the alias now buys nothing and costs a name to learn.

Per surface, the target spelling:

| surface   | from                           | to                                                               |
| --------- | ------------------------------ | ---------------------------------------------------------------- |
| ts-server | `await fw.flag(k, false, ctx)` | `await fw.controlPoints.getBooleanValue(k, false, ctx)`          |
| web       | `fw.flag(k, false)`            | `fw.controlPoints.getBooleanValue(k, false)` — still no `await`  |
| python    | `fw_flag(k, False, ctx)`       | `fw_control_points().get_boolean_value(k, False, ctx)`           |
| java      | `fwFlag(k, false, id)`         | `FwProviders.getFwClient().controlPoints().getBooleanValue(...)` |
| swift     | `fwFlag(k, default: false)`    | `FwProviders.getFwClient().controlPoints.getBooleanValue(...)`   |

Do NOT invent a wrapper of your own. The RAMP-1 eval-site check keys on the
CALLEE name (`flag` / `getBooleanValue` / `getBooleanDetails`, plus python's
snake_case `get_boolean_value` / `get_boolean_details`); a bespoke name makes
every call site invisible to it, and an invisible call site is worse than a
wrong one — the file scans as having no evaluations at all, which is
indistinguishable from one that is genuinely safe.

If the surface still scaffolds a harness accessor (`fw.controlPoints` on TS/web,
`fw_control_points()` in python), route through it. java and swift have none by
design — their SDKs expose no importable `ControlPoints` type to name — so call
`getFwClient().controlPoints…` directly there.

**Reads never throw.** Every failure resolves to the default you passed, with
the reason on the `Decision` — so drop any try/catch that existed only to guard
a flag read, and reach for `getBooleanDetails` (same arguments) when you need to
see why a value came back.

Keep the same flag keys — a control point is addressed by the key anchored in
code, so renaming here would orphan every rollout that already names it.

### 3d. Rewrite anchors to the control-points marker

Anchors written before the rename read `// @fireweave-flag <key>`. New ones read
`// @fireweave-controlpoint <key>`. Rewrite them.

**This is safe to do, and safe NOT to do.** Every scanner accepts both markers
permanently — the old spelling is never removed from the accepted set, because
these anchors live in the customer's own source files and dropping it would take
detection to zero repo-wide rather than degrading it. So this step converges a
repo on one vocabulary; nothing breaks if it is skipped or partially applied.

Rewrite the **marker only**:

```diff
-// @fireweave-flag checkout-v2
+// @fireweave-controlpoint checkout-v2
```

**Do not touch the key.** The key is the join between the anchor, the manifest
and the rollout — renaming it orphans all three.

Scope it to real anchors:

- Match `@fireweave-flag` followed by whitespace and a key. A bare mention in
  prose or a changelog entry is not an anchor and must stay as written.
- Every comment leader is in scope — `//`, `#`, `<!-- -->` — because the marker
  is matched independently of the leader.
- Skip `node_modules`, build output, and anything outside the repo's
  `sourceRoots`.

**Verify by scan, not by diff.** After rewriting, run
`mcp__rollout_server__detect_rollout_ready` and confirm the anchor count is
**unchanged**. A drop means a rewrite ate a key or broke a line; the count is
the only check that catches that mechanically.

Mixed markers in one repo are fine and expected mid-migration.

### 3e. Unify the tracker and drop the legacy pair

Two changes to how a repo records its `FW_STAMPS` trackers. Both apply to
**every** initialised repo, including one that needed no call-site rewrite.

**(a) Move a TypeScript tracker beside its harness.** Repos initialised before
the unification keep a `fw-tracker/` DIRECTORY somewhere in the tree
(`src/fw-tracker/index.ts`, `apps/api/src/fw-tracker/index.ts`, …) while every
other language keeps a single module next to the harness. Collapse it:

```
src/fw-tracker/index.ts   →   fireweave/fw-tracker.ts
```

Move the file with its contents intact — **the `FW_STAMPS` entries are the
record; never regenerate them empty.** Delete the now-empty `fw-tracker/`
directory. If the directory holds anything other than `index.ts`, stop and say
so rather than guessing: nothing in FireWeave writes a second file there, so its
presence means something else owns it.

**(b) Record per-surface, then delete the legacy pair.** Write each tracker onto
its own surface entry, then remove `rolloutReady.trackerPath` and
`rolloutReady.webTrackerPath` outright:

```jsonc
{
  "surfaces": [
    {
      "surfaceId": "sfc_…",
      "path": "fireweave/fw-harness.ts",
      "trackerPath": "fireweave/fw-tracker.ts",
    }, // ts-server
    {
      "surfaceId": "sfc_…",
      "path": "api/fireweave_harness/fw_harness.py",
      "trackerPath": "api/fireweave_harness/fw_tracker.py",
    }, // python
    {
      "surfaceId": "sfc_…",
      "path": "svc/fireweave/fw_harness.go",
      "trackerPath": "svc/fireweave/fw_tracker.go",
    }, // go
  ],
  // rolloutReady.trackerPath / webTrackerPath: REMOVED
}
```

The pair modelled exactly two surfaces and is now a second source of truth that
drifts — move a tracker, update one place, and the other keeps pointing at the
old path while still looking authoritative. Nothing server-side needs it:
fw-server stores tracker paths per surface and reconstructs the pair from its
own rows on the way out.

**Order matters.** Record every per-surface path and confirm each file exists
BEFORE deleting the pair. Deleting first leaves a window where a surface has no
tracker recorded at all.

**Do not invent a path.** Record only a tracker that actually resolves — a
recorded path that does not exist is worse than an absent one, because the gate
stops falling back to its conventional locations. If a surface has no tracker
module, scaffold one from the initialise skill's `harness/<surface>/fw*tracker*`
template first.

### 3f. Strip the dissolved deploy-sdk

Applies to every surface matching **Source C**, whether or not that surface
needed any other rewrite.

`@fireweaveai/deploy-sdk` was dissolved. There is no successor package and no
replacement call — the boot beacon it posted has no endpoint on the other end,
and its telemetry initialiser wired an exporter FireWeave never owned. So this
step deletes; it does not translate.

**Delete from the harness file** (`fireweave/fw-harness.ts`, `fw_harness.py`, …):

```diff
-import { initFwTelemetry } from '@fireweaveai/deploy-sdk/flags/web';
-import { initFwAttestation } from '@fireweaveai/deploy-sdk';
-import { resolveBootBeaconFromEnv } from '@fireweaveai/deploy-sdk/attest';
 import {
   getFwClient,
   isProd,
   makeConnectedVendorProvider,
   makeDevProvider,
 } from './fw-providers';
-import { FW_STAMPS } from './fw-tracker';
-
-const FW_SURFACES = [{ surfaceId: 'sfc_…', stamps: FW_STAMPS }];

 export async function initFwHarness(): Promise<void> {
   if (isProd()) {
     await makeConnectedVendorProvider();
   } else {
     await makeDevProvider();
   }
-
-  const ooUrl = (viteEnv?.VITE_OO_OTLP_ENDPOINT ?? …).replace(/\/$/, '');
-  const ooAuth = viteEnv?.VITE_OO_OTLP_AUTH ?? …;
-  initFwTelemetry(prod ? 'rollout' : 'dev', { serviceName: …, signals: { … } });
-
-  initFwAttestation({
-    stamps: FW_STAMPS,
-    surfaces: FW_SURFACES,
-    ...resolveBootBeaconFromEnv({ env: process.env, prod, environment: … }),
-  });
 }
```

Python: delete `_init_console_telemetry` and its call from `init_fw_harness`.
The current `harness/python/fw_harness.py.tpl` scaffolds no telemetry at all —
compare against it rather than against what the file currently does.

**Then remove the dependency** — `@fireweaveai/deploy-sdk` from every
`package.json` in the repo, and the equivalent from `pyproject.toml`. Leaving it
installed leaves a package nothing imports and a lockfile entry that reads as a
supported dependency.

**What this step must NOT touch.** `FW_STAMPS` and the `fw-tracker` module stay
exactly as they are, and so does every anchor and manifest. The harness stops
IMPORTING `FW_STAMPS` because `initFwAttestation` was its only consumer — that
is a dropped import, not a dropped record. Deleting the stamps themselves would
erase the change identity `reconcile` and the dev-checklist read out of the
committed tree; `/fw-cleanup` is the only thing that retires a stamp.

**Verify by grep, not by eye.** After the edit, `@fireweaveai/deploy-sdk` must
match **zero** times across the repo, including lockfiles once dependencies are
reinstalled. Then re-run `mcp__rollout_server__detect_rollout_ready` and confirm
the anchor count is unchanged, exactly as §3d requires — an edit that reached
into a tracker or an anchor shows up there and nowhere else.

### 3g. Tell the team to upgrade

This migration moves the repo onto shapes older tooling does not read: the
unified tracker location, per-surface tracker paths, and the
`@fireweave-controlpoint` anchor. A teammate on an older `fw` CLI or an older
installed plugin bundle will not fail loudly — their gates will simply find
less, which is the failure mode this whole area exists to prevent.

FireWeave cannot detect their version from here, so **print this in the session
summary and put it in the PR description**:

> This repo has been migrated to FireWeave control points. Before your next
> feature, upgrade both:
>
> ```
> fw self-update
> ```
>
> …and update the FireWeave plugin bundle in your agent (re-run
> `/fireweave:adopt` after upgrading). Older versions read the previous tracker
> layout and will under-report rollout state rather than erroring.

Say it plainly — an upgrade notice buried in a commit body is one nobody reads.

### 3h. Scaffold → package (Sources D–J)

Applies to every surface §1 matched to a D–J Source and the user agreed to move.
It replaces 3a–3c and 3e for that surface; 3d (anchor markers), 3f (deploy-sdk
strip) and 3g (upgrade notice) still apply.

The target shape is the one `/fireweave:initialise` writes for a new package
surface. Read its per-language "Content initialise writes" from the initialise
skill's `SKILL.md` (the path §3a resolves) when a step below needs a framework
detail this skill does not repeat: the web render gate per framework, the Python
test-settings recipe, a Go functions-framework handler.

**No Source writes a key value.** Not into code, a control-points or start
file, `.env.example`, a developer `.env`, Info.plist, an xcconfig that is
tracked, a commit, a log line or the session summary. Sources move variable
NAMES; values move in the user's secret stores (§4g). The one key this skill
ever holds is a new browser key from `issue_browser_key`, and it goes only to the
build destination the user picked.

#### The shared steps, in order, per surface

1. **SDK ≥ 3.0.0.** Call `mcp__rollout_server__resolve_sdk_install` with
   `{ cwd, surface, harnessKind: 'package' }` (plus `startProfile` for a Swift
   surface, which ships both profiles). It applies the 3.0.0 floor for the
   channel, preflights the start entry and records `surfaces[].sdk`. Run the
   command it returns. If it finds no 3.0.0 release for the surface (Swift
   before a SwiftPM-resolvable release), **stop this surface**: it keeps its
   scaffold, which still reads through FireWeave, and the summary says why.
   The channel it picks **is** the endpoint the app will call. The command
   takes the channel's latest build and records a range, never an exact
   version (initialise's **SDK installs never pin an exact version**). Its
   limit 1 applies here too: `go.mod`, and a Rust or Dart staging git tag,
   record the exact version resolved, by design.
2. **Control-points file from the seeds.** Every key the scaffold seeds for the
   dev tier (`makeDevProvider()` and its per-language spellings, in the
   providers file) moves to the language's control-points file with **the same
   key and the same value**: a seeded `false` stays `false`. Never add a key the
   scaffold did not seed, and never drop one. An empty seed map becomes an empty
   control-points file. The file carries local values only; production values
   come from FireWeave.
3. **Start first.** Replace the scaffold's init call with the language's start
   call, first in every process entrypoint that called the init (the file that
   called it is the entrypoint `path` §4f records). Exactly one start per
   process; never a second setup file.
4. **Reads and identity**, per the Source's map below. Keys, `false` defaults and
   `// @fireweave-controlpoint` anchors stay exactly as they are.
5. **Stamps.** Move every `FW_STAMPS` entry verbatim into the stamps file
   (`.fireweave/stamps.ts` for ts-server and web, `.fireweave/stamps.py` for
   Python, `.fireweave/stamps.json` for Go, Java, Rust and Swift), in the shape
   the initialise skill's Step 5 writes for a package surface. **The entries are
   the record; never regenerate them empty.** Record the new path as the
   surface's `trackerPath` in §4f.
6. **Delete the scaffold files** — the harness, the providers and the tracker
   module, after step 5. Keep every other file in the scaffold's directory: it
   is the customer's. Before deleting, grep for callers OUTSIDE the scaffold of
   its tier and client helpers (`isProd`, `IsProd`, `is_prod`,
   `resolveFwEnvName`, `getFwClient`, `get_fw_client`, `makeDevProvider`, …).
   A caller that uses `isProd()` for the app's own branching has no FireWeave
   replacement: show it to the user and let them decide; never invent a tier
   function to keep it compiling.
7. **No replica of the tier map.** `FW_ENV_PROFILES`, `FW_DEFAULT_ENV`,
   `FW_ENV_ALIASES` and the generated `readEnvSignal` go with the providers
   file. If `readEnvSignal` read the app's OWN environment variable (one the
   SDK does not read, see `--check`), pass it as the start call's `environment`
   option. Never pass an app-side default such as `"dev"`, and never rebuild the
   map in the app.

#### Source D — ts-server scaffold → package

| Scaffold                                                                                                       | Package                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makeDevProvider()` → `local: { controlPoints: { 'k': true } }`                                                | `src/fireweave/control-points.ts`: `export const controlPoints = defineControlPoints({ 'k': { local: true } })` from `@fireweaveai/server-sdk/start` |
| `await initFwHarness()` in the entrypoint                                                                      | deleted; `src/fireweave/start.ts` calls `start({ controlPoints })`, and `import './fireweave/start';` is the entrypoint's **first** import           |
| `import { fw } from './fireweave/fw-harness'` (any relative path)                                              | `import { fw } from '@fireweaveai/server-sdk/start'`                                                                                                 |
| `fw.controlPoints.getBooleanValue(k, false, ctx)` / `getFwClient().controlPoints.…` / `fw.flag(k, false, ctx)` | `fw.controlPoints.getBooleanValue(k, false, ctx)` — same context, still awaited                                                                      |
| `registerFwTarget(id, { properties })` / `getFwClient().registerTarget(id, { kind, properties })`              | `await fw.identify(id, properties)` — the second argument is the properties map itself                                                               |
| `resolveInstanceTargetingKey()`                                                                                | `fw.instanceKey()` (server-subject reads only)                                                                                                       |
| `FW_STAMPS` in `fireweave/fw-tracker.ts`                                                                       | `.fireweave/stamps.ts`                                                                                                                               |
| `readEnvSignal` reading a variable other than `NODE_ENV` / `APP_ENV` / `FIREWEAVE_ENV`                         | `start({ controlPoints, environment: process.env.<THAT_VAR> })`                                                                                      |

Delete `fw-harness.ts`, `fw-providers.ts` and `fw-tracker.ts`, and the build-script
step initialise added to copy compiled harness artifacts (the `.mjs` API Docker
build), if there is one. The instance id is no longer persisted in
`.fireweave/instance-id`: `fw.instanceKey()` is a hash of the host name, or
`FIREWEAVE_INSTANCE_ID`. A server-subject ramp in flight re-buckets once;
setting `FIREWEAVE_INSTANCE_ID` to the old id in that environment avoids it.

#### Source E — web scaffold → package

| Scaffold                                                                      | Package                                                                                                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makeDevProvider()` → `local: { controlPoints: { 'k': true } }`               | `src/fireweave/control-points.ts`: `defineControlPoints({ 'k': { local: true } })` from `@fireweaveai/web-sdk/start`                                  |
| `await initFwHarness()` before render                                         | `import { ready } from './fireweave/start';` **first** in the entry module, and the first render gated on `ready` (`ready.then(render)`)              |
| (no build step)                                                               | `fireweave()` from `@fireweaveai/web-sdk/vite` in the Vite-family build config; other bundlers `fireweaveDefine()` from `@fireweaveai/web-sdk/define` |
| `getFwClient().controlPoints.getBooleanValue(k, false)` / `fw.flag(k, false)` | `fw.controlPoints.getBooleanValue(k, false)` from `@fireweaveai/web-sdk/start` — still synchronous                                                    |
| a per-call `{ targetingKey }` argument                                        | removed: decisions follow `fw.identify`                                                                                                               |
| `syncFireweaveUser(id, props)`                                                | `await fw.identify(id, props)` at sign-in **and** at session restore                                                                                  |
| `reloadFireweaveFlags(anonId)`, or an app-minted anonymous id passed back in  | `await fw.reset()` at sign-out                                                                                                                        |
| `FW_STAMPS` in `fireweave/fw-tracker.ts`                                      | `.fireweave/stamps.ts` (one file shared with a ts-server surface, entries tagged per surface)                                                         |
| `PUBLIC_FW_PROJECT_API_KEY` / `VITE_FW_PROJECT_API_KEY` in build destinations | a NEW browser key as `FIREWEAVE_BROWSER_KEY`, a build variable only (§4g)                                                                             |
| `PUBLIC_FW_API_URL` / `VITE_FW_API_URL` / `*_FW_ATTEST_URL`                   | `FIREWEAVE_URL` only for a custom fw-server or a same-origin proxy (`/fw`); otherwise deleted                                                         |
| an `envPrefix` that exposes `FIREWEAVE_KEY` or `FW_PROJECT_API_KEY`           | removed — the build fails on it                                                                                                                       |

The device id is unchanged — `localStorage` key `fireweave.device-id`, `dev_`
prefix — so returning visitors keep their buckets. Pass `deviceId` only when the
app already had its own anonymous id. Delete the web `fw-harness.ts`,
`fw-providers.ts` and `fw-tracker.ts`.

#### Source F — Python scaffold → package

Recognise BOTH layouts: the current scaffold lives in `fireweave_harness/`, an
older one in `fireweave/` (with an `__init__.py`). Migrate whichever exists.

| Scaffold                                                                                                               | Package                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make_dev_provider()` → `local={"control_points": {"k": True}}`                                                        | `fireweave_setup/control_points.py` (or `src/fireweave_setup/`): `control_points = define_control_points({"k": {"local": True}})` from `fireweave.start`                           |
| `init_fw_harness()`                                                                                                    | `start(control_points=control_points)` FIRST in every process entrypoint: `main.py`, `wsgi.py` and `asgi.py`, `create_app()`, the Celery app module, a multiprocessing initializer |
| `fw_control_points().get_boolean_value(k, False, ctx)` / `get_fw_client().control_points.…` / `fw_flag(k, False, ctx)` | `fw.control_points.get_boolean_value(k, False, EvaluationContext(user_id))` (`from fireweave.start import fw`, `from fireweave import EvaluationContext`)                          |
| `get_integer_value(…)`                                                                                                 | `get_number_value(…)`                                                                                                                                                              |
| `register_fw_target(id, properties={...})` (returns a bool)                                                            | `fw.identify(id, {...}).ok` — log a `False`; never pass an unguarded `str(user.id)` (Django's `AnonymousUser.id` is `None`)                                                        |
| a read inside `async def`                                                                                              | `await asyncio.to_thread(lambda: fw.control_points.get_boolean_value(...))`                                                                                                        |
| `FW_STAMPS` in `fw_tracker.py`                                                                                         | `.fireweave/stamps.py`                                                                                                                                                             |
| `_read_env_signal` reading `ENVIRONMENT` / `ENV` / `FW_ENV`                                                            | not read by the SDK (it reads `FIREWEAVE_ENV`, then `APP_ENV`): pass `environment=` from the app's own setting, or set `FIREWEAVE_ENV`                                             |

Delete `fw_harness.py`, `fw_providers.py` and `fw_tracker.py` from whichever
scaffold directory exists, then the directory's `__init__.py` once nothing else
is in it. **An old `fireweave/` directory must go**: it shadows the PyPI
`fireweave` package, so `from fireweave.start import …` imports the app's own
directory, and `verify_prod_path` fails it as `no-shadowing-package`. If it
holds customer modules, stop and ask the user where they move (for example
`fireweave_setup/`) before touching their imports. Drop the `[openfeature]`
extra if it is still installed.

#### Source G — Go scaffold → package

| Scaffold                                                                                                              | Package                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v2` (or the unsuffixed module)                                 | `resolve_sdk_install`'s `go get github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3@latest && go mod tidy` (staging: the highest `v3.0.0-rc.N`; + `go mod vendor` when vendored); `go.mod` records that exact version by design (limit 1); no local `replace` |
| import `.../sdks/go/v2/fireweave`                                                                                     | import `.../sdks/go/v3/fw`                                                                                                                                                                                                                                 |
| `MakeDevProvider()` → `ControlPoints: map[string]bool{"k": true}`                                                     | `internal/fireweave/control_points.go`: `var ControlPoints = fw.DefineControlPoints(fw.LocalControlPoints{"k": {Local: true}})`                                                                                                                            |
| `fireweave.InitFwHarness()` in `main`                                                                                 | `fw.Start(fw.Options{ControlPoints: appfw.ControlPoints})` (or `fw.MustStart`) in the serving path, after the app's own config loading, with `defer fw.Shutdown(context.Background())`                                                                     |
| `ec := fwsdk.NewEvaluationContext(id, nil)`; `fireweave.GetFwClient().ControlPoints().GetBooleanValue(k, false, &ec)` | `fw.ControlPoints().GetBooleanValue(k, false, fw.For(id))`                                                                                                                                                                                                 |
| `RegisterFwTarget(id, &fwsdk.RegisterTargetOptions{…})`                                                               | `go func() { if err := fw.Identify(context.Background(), id, props); err != nil { log.Printf("fireweave: identify: %v", err) } }()` at the sign-in seam, off the request path                                                                              |
| `IsProd`, `ResolveFwEnvName`, `MakeConnectedVendorProvider`, `fwEnvProfiles`, `readEnvSignal`, `fwEnvAliases`         | deleted (step 6 and 7)                                                                                                                                                                                                                                     |
| `FW_STAMPS` in `fw_tracker.go`                                                                                        | `.fireweave/stamps.json`                                                                                                                                                                                                                                   |
| `readEnvSignal` reading `ENVIRONMENT` / `ENV` / `FW_ENV`                                                              | not read by the SDK: `Environment: cfg.<Stage>` from the app's own config, or `FIREWEAVE_ENV`                                                                                                                                                              |

Delete `fw_harness.go`, `fw_providers.go` and `fw_tracker.go`. Keep any other
file in the customer's `fireweave/` package, and its package name. `go build`,
`go vet` and `go test` must pass before §4f.

#### Source H — Java scaffold → package

Both shipped harness generations map here: the control-points one and the
older one whose call sites use `fwFlag(...)`.

| Scaffold                                                                                            | Package                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FwProviders.makeDevProvider()` → `controlPoints.put("k", true)`                                    | `FireweaveControlPoints.java`: `public static final LocalControlPoints CONTROL_POINTS = Fw.defineControlPoints(Map.of("k", LocalControlPoint.local(true)));`                                                                                                        |
| `FwHarness.initFwHarness()`                                                                         | `Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build());` first in `main` after config loading; Spring Boot: first line of `main`, before `SpringApplication.run`; servlet apps: `ServletContextListener.contextInitialized` |
| the scaffold's shutdown hook (`getFwClient().close()`)                                              | none is registered: `Fw.shutdown()` where the app stops (servlet: `contextDestroyed`), never `client().close()`                                                                                                                                                     |
| `FwProviders.getFwClient().controlPoints().getBooleanValue(k, false, ctx)` / `fwFlag(k, false, id)` | `Fw.controlPoints().getBooleanValue(k, false, EvaluationContext.builder().targetingKey(id).build())`                                                                                                                                                                |
| `FwProviders.registerFwTarget(id, properties)`                                                      | `Fw.identify(id, Map.of(...))` (it never throws)                                                                                                                                                                                                                    |
| `FwTracker.FW_STAMPS`                                                                               | `.fireweave/stamps.json`                                                                                                                                                                                                                                            |
| `ai.fireweave:fireweave-openfeature`                                                                | removed; `ai.fireweave:fireweave-sdk` at ≥ 3.0.0 from `resolve_sdk_install`'s snippet                                                                                                                                                                               |

The start API is in `ai.fireweave.sdk.start` (`Fw`, `StartOptions`,
`LocalControlPoint`, `LocalControlPoints`). Delete `FwHarness.java`,
`FwProviders.java` and `FwTracker.java`; keep the customer's other classes in
`<base package>.fireweave`.

#### Source I — Rust scaffold → package

| Scaffold                                                                 | Package                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make_dev_provider()` → a `HashMap<String, bool>` seeded `"k" → true`    | `src/fireweave_control_points.rs`: `define_control_points([("k", LocalControlPoint::local(true))])` from `fireweave::start`                                                               |
| `init_fw_harness()?` in `main`                                           | `fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() })?;` first in each server binary's `main`, after config loading |
| `get_fw_client().control_points.get_boolean_value(k, false, Some(&ctx))` | `fireweave::start::control_points().get_boolean_value(k, false, Some(&ctx))`                                                                                                              |
| `register_fw_target(id, Some(&options))`                                 | `fireweave::start::identify(&id, [("plan", plan)])`; log an `Err` rather than dropping it                                                                                                 |
| a read or identify inside an async handler                               | `tokio::task::spawn_blocking` (reads are blocking HTTP calls)                                                                                                                             |
| `mod fireweave;` in the binary                                           | removed: a local module named `fireweave` shadows the crate. Rename it (for example `mod fireweave_app;`) if it keeps customer code                                                       |
| `FW_STAMPS` in `fw_tracker.rs`                                           | `.fireweave/stamps.json`                                                                                                                                                                  |
| dev runs relying on the scaffold's default environment                   | `.cargo/config.toml` `[env] FIREWEAVE_ENV = "development"` at the workspace root, or the app's `.env` loader called before `start`                                                        |

`cargo add 'fireweave@3'` (the requirement `"3"`, the latest 3.x) comes from
`resolve_sdk_install`; a staging surface gets the highest `rust/v3.0.0-rc.N` git
tag instead (limit 1). A
client-shipped Rust target (Tauri `src-tauri`, a Leptos `hydrate` build) has no
start profile to move to and must never get a server key: stop that surface and
say so.

#### Source J — Swift scaffold → package

Only once a Swift 3.0.0 release resolves through SwiftPM (step 1 stops the
surface otherwise).

| Scaffold                                                                                                   | Package                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makeDevProvider()` → `controlPoints: ["k": true]`                                                         | `FireweaveLocalControlPoints.swift`: `let appControlPoints = defineControlPoints(["k": .local(true)])`                                                                                                                                                                |
| `try await FwHarness.initFwHarness()`                                                                      | app: `startFireweave(controlPoints: appControlPoints)` in SwiftUI `App.init()` or the first line of `didFinishLaunching` (never throws); server: `try startFireweave(FireweaveStartOptions(controlPoints: appControlPoints))` in `configure`, then `await fw.ready()` |
| `import Fireweave`                                                                                         | `import FireweaveStart` (the `FireweaveStart` product)                                                                                                                                                                                                                |
| `FwProviders.getFwClient().controlPoints.getBooleanValue(k, default: false)` / `fwFlag(k, default: false)` | `fw.controlPoints.getBooleanValue(k, default: false)`                                                                                                                                                                                                                 |
| `FwProviders.syncFireweaveUser(id, properties: …)`                                                         | `await fw.identify(id, properties: …)` at sign-in and session restore; `await fw.reset()` at sign-out                                                                                                                                                                 |
| Info.plist `FWProjectApiKey` / `FWApiUrl` / `FWEnvironment`                                                | app: Info.plist `FIREWEAVE_BROWSER_KEY` = `$(FIREWEAVE_BROWSER_KEY)` from an untracked xcconfig or CI (a NEW browser key, §4g), `FIREWEAVE_URL` only for a custom fw-server, `FIREWEAVE_ENV`; server: `FIREWEAVE_KEY` in the process environment                      |
| `FwTracker.FW_STAMPS`                                                                                      | `.fireweave/stamps.json`                                                                                                                                                                                                                                              |

The UserDefaults key `fireweave.device-id` is unchanged, so installs keep their
buckets; keep the default persistence. Delete `FwHarness.swift`,
`FwProviders.swift` and `FwTracker.swift`.

## 4. Re-align the repo contract

Steps 1–3 moved the code. This step moves what every FUTURE change reads
**before** touching that code: the telemetry inventory, the environment
contract, `PROVIDERS.md`, and `agent-instructions.md`.

`initialise` writes those four once, at scaffold time, from what the repo looked
like then. This skill is the only other thing that changes what a surface's flag
and telemetry story IS. Skip this step and the repo keeps an initialise-era
contract describing code you just deleted — and the next agent believes it,
because believing it is exactly what those files are for.

**`--reinit` is not a substitute, and cannot be made into one.**
`record_rollout_env_contract` appends names to `.env.example` and has no prune
path, and `--reinit` re-declares surfaces without touching `.env.example`,
`.fireweave/.gitignore`, `PROVIDERS.md`, or any harness file. Nothing else in
the system will ever remove a stale name. That is why this step lives here.

### 4a. Take the telemetry inventory — per surface

**Derived by READING the repo.** Not from `PROVIDERS.md` — that is the file most
likely to be lying, since it was written before the rewrite you just did. Not by
asking the user, and not by assuming a convention.

Two questions per surface, one read:

1. **Is a metrics client initialised at all?** Look for the provider/client
   CONSTRUCTION — an OTel `MeterProvider`, a vendor SDK client, a StatsD
   connection — not call sites. A dependency in the manifest is not an answer:
   check that something builds a meter from it.
2. **What does this surface already emit?** Inventory the metric names in use,
   where each is emitted, and what it measures.

The second question has no other source. Every observability query capability
(`observability.metric.query`, …) takes a metric NAME; nothing lists what exists, so the repo is the
only place to learn it, and this is the only pass that reads the repo for this
purpose.

**Never PARK on an empty answer.** `initialise` PARKs a surface with no metrics
client, and it is right to: it is deciding whether the repo is rollout-capable
at all, and a hole there is a decision the user has not made yet. This skill is
repairing a repo that already ships. Record `"none"`, say which surface in the
session summary, and continue — a migration that stops halfway leaves the harness
rewritten and the contract stale, which is strictly the worse of the two states.

**`"none"` and absent are different findings.** `"none"` says someone looked and
this surface emits nothing; absent says nobody looked. Never write one meaning
the other. If the pre-migration `PROVIDERS.md` claimed a client the repo does not
have, say so explicitly in the session summary — a fabricated telemetry row is a
finding worth naming, not a typo to quietly overwrite.

### 4b. Write the env contract

```
mcp__rollout_server__record_rollout_env_contract { cwd, apiSurface, webSurface, webappUrl? }
```

It writes the committed `fireweave.md` at the repo root, appends the required
NAMES to `.env.example`, and **mints nothing** — no key endpoint is called and no
credential is returned. Pass `apiSurface: true` when a `ts-server`, `python` or
`java` surface exists, `webSurface: true` when a `web` surface does, and
`webappUrl` when you know it so the operator gets a clickable link.

`cwd` is the same absolute workspace root the rest of this skill uses.

**A surface that moved to the start profile (§3h)** is passed in
`packageSurfaces: [{ surfaceId, surface, startProfile?, buildDestinations? }]`
instead of through `apiSurface` / `webSurface`. A server surface then gets
`FIREWEAVE_KEY=` in `.env.example` (plus `FIREWEAVE_URL=` only for a custom
fw-server); a client surface (web, a Swift app) gets `FIREWEAVE_BROWSER_KEY` as
a BUILD variable with no `.env` entry, and the tool echoes its build destinations
back for §4g. Pass `apiSurface` / `webSurface` only for scaffold surfaces that
remain.

**On a missing tool → soft-continue**, naming the gap. An older bundle without
it leaves a worse-documented repo, not a broken one; do not PARK and do not
hand-write `fireweave.md` from memory.

### 4c. Purge the beacon and FW-telemetry env contract

**Runs AFTER 4b, deliberately.** The writer only appends, so purging first lets
it re-add nothing; purging last removes exactly the names it will never own.

**`.env.example`** — delete:

- `FW_ATTEST_URL`, `PUBLIC_FW_ATTEST_URL`, `VITE_FW_ATTEST_URL`
- every `*_OO_OTLP_*` name
- the `# Boot beacon (deploy gate)` header and any comment describing a beacon

Keep an OTLP name **only** when 4a found a real exporter in this repo reading it.
An env name that reaches nothing is not documentation — it is an instruction to
set a variable that will be ignored, and the next operator has no way to tell.

**`.fireweave/.gitignore`** — remove `deploy-beacon.env.local`. The file it
ignores is never written any more.

**`.fireweave/PROVIDERS.md`** — rewrite to the tier-keyed shape and delete the
**Boot beacon** column outright:

```markdown
# FireWeave providers (this repo)

| Tier                               | Control-points path                                                                      | Telemetry                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **dev** (`<env signal>` = `dev`)   | SDK **local** mode — in-memory `controlPoints` map in each surface's `makeDevProvider()` | <the app's own client, from 4a — or "none initialised"> |
| **prod** (`<env signal>` = `prod`) | SDK **remote** mode → fw-server `/v1/control-points/evaluate` via `FW_*` / `PUBLIC_FW_*` | <same, and where it exports to>                         |

- Control points (prod): managed PostHog project `<id>` via FireWeave.
- Env signal: `<the project's own variable>`.
- Credentials: see `fireweave.md`. FireWeave mints nothing.
```

**Telemetry is the app's own, and goes direct to the bound vendor.** FireWeave
does not carry it, proxy it, or provision its credentials. Describe what 4a
actually found; when 4a found nothing, write that, and do not name an endpoint
variable to compensate.

**Package surfaces (§3h).** The scaffold's names go once no scaffold surface
still reads them: `FW_PROJECT_API_KEY`, `FW_API_URL`, `FW_ENV`,
`PUBLIC_FW_PROJECT_API_KEY`, `PUBLIC_FW_API_URL`, `VITE_FW_PROJECT_API_KEY` and
`VITE_FW_API_URL` leave `.env.example`, and a migrated surface's row leaves
`PROVIDERS.md`. `fireweave.md` and `PROVIDERS.md` document the generated
harness; when every surface is a package surface, delete both and say so in
the session summary — the start profile's configuration lives in the
agent-instructions section 4d writes.

**Hard assert before moving on:** no file under the workspace contains a
`project-api-key_` / `fw_public_` / `fw_ingest_pub_` prefix followed by key
material. This skill mints nothing, so a match means a credential was pasted in —
stop, tell the user to move it to the deploy environment, and rotate it.

### 4d. Regenerate `.fireweave/agent-instructions.md`

Rewrite it to the current template. **Read that template from the initialise
skill's `SKILL.md` — the section titled `Agent instructions template`** — at the
path §3a already resolves (`<dir of this SKILL.md>/../` plus this host's name for
it). Do not reconstruct it from the file already in the repo, and do not copy the
template's prose into this skill: two skills carrying one template is how the two
drift, and the version in the repo is by definition the stale one.

Every section it lists is required. The ones a migrated repo is most often
missing entirely:

- **How to emit a metric — one section PER SURFACE**, filled from 4a: the client,
  the exact import line as it appears in this repo, the counter and histogram
  call shapes, where the instrument comes from, one REAL example with its file
  path cited, any local wrapper the codebase prefers, and the label convention.
  Plus the inventory half — what this surface already emits — which is what makes
  `provenance: "existing"` reachable at change time.
- the header naming project, `projectId` and server URL
- the **Surfaces** table (`surfaceId`, credential env, entrypoint)
- **Does this task qualify?** — the change / inquiry / brainstorm / infra-only rubric
- the signals step in the dev-loop HARD ORDER (decide reuse / add / park at each
  control point, then amend the manifest)
- `context.targetingKey` and the telemetry `provenance` rule in the manifest contract
- for every surface §3h moved, the template's **FireWeave SDK: configuration and
  overrides** section for that language, with its placeholders filled from §3h

Take repo-specific paths from what steps 3 and 4 actually produced, not from the
old file.

### 4e. Record the metrics client

Write `metricsClient` onto each surface in `.fireweave/project.json`
`surfaces[]`, and send the same value with
`mcp__rollout_server__update_repo_state`:

```jsonc
{
  "surfaces": [
    {
      "surfaceId": "sfc_…",
      "surface": "ts-server",
      "metricsClient": "otel-meter",
    },
    { "surfaceId": "sfc_…", "surface": "web", "metricsClient": "none" },
  ],
}
```

Use the name 4a resolved. **Absent is not `"none"`** — leaving the field off says
nobody looked, and the next change re-derives the answer badly from whichever
files it happened to touch.

Do not mint or edit a `surfaceId` here. This step adds one field to surfaces that
already exist; a surface with no id is a `fw repo declare-surfaces` problem, not
something to paper over.

### 4f. Re-key the surface and re-author its manifests (package surfaces)

Only for surfaces §3h moved, and only once that surface builds (run §5's build
for it first). The surface registry is shared state: a surface re-keyed while
its code still holds the scaffold sends every gate down the wrong check set.

**Re-key: the SAME surfaceId, re-declared as a package.** One call carrying
every moved surface:

```
fw repo declare-surfaces --project {projectId} --json --surfaces '[{"surface":"ts-server","surfaceId":"sfc_…","path":"src/main.ts","entrypoint":"src/main.ts","rolloutCredentialEnv":"FIREWEAVE_KEY","harnessKind":"package"}]'
```

- `surfaceId` is the one already in `project.json`. **Never omit it**: an id-less
  declare with the entrypoint path mints a second row for the same surface.
- `path` and `entrypoint` are the entrypoint that now starts FireWeave;
  `harnessKind: 'package'`; `rolloutCredentialEnv` is `FIREWEAVE_KEY` for a
  server surface and `FIREWEAVE_BROWSER_KEY` for a client one.
- The server allows exactly one transition on an id: scaffold → package.
  Expect `already-registered`.
- A non-zero exit or `conflict` is a stop for that surface, never a reason to
  mint. The usual cause is an `fw` binary or an fw-server older than package
  surfaces (an old CLI drops `harnessKind`, so the server sees a path change and
  answers 409): tell the user to run `fw self-update`, and name the surface. Do
  not commit a surface whose re-key failed — the code, the registry and
  `project.json` move together.

**Then `project.json` `surfaces[]`**, for each re-keyed surface: `path` and
`entrypoint` = the entrypoint, `harnessKind: 'package'`, `startProfile`
(`server` | `client`) when the surface is not plain server, `trackerPath` = the
§3h stamps file, `rolloutCredentialEnv` as above. Keep `surfaceId` and
`metricsClient`. `sdk` is written by `resolve_sdk_install`; do not hand-write it.

**Then the manifests.** Every feature manifest whose `harness.surface` is a
moved surface is re-authored — resolve it through the seam and write it with
`mcp__rollout_server__upsert_rollout_manifest`, passing the resolved
`contentHash` as `baseContentHash` (on `conflict`, re-apply on top of `current`
and retry with its hash). Never edit a manifest file in place. Change the
harness block only:

- `harness.kind: 'package'`
- `harness.path`: the entrypoint
- `harness.controlPoints.devProvider: 'control-points-file'` (and `api:
'control-points'`)
- `harness.rolloutCredentialEnv`: `FIREWEAVE_KEY` (server) or
  `FIREWEAVE_BROWSER_KEY` (client)
- drop `attestUrlEnv` and `attestCredentialEnv`: they name the scaffold's
  `FW_API_URL` / `FW_PROJECT_API_KEY`

The change block, keys and anchors stay exactly as they are.

### 4g. Move the credentials (package surfaces)

Names move here; values never pass through this skill (§3h: no Source writes a
key value).

**Server surfaces keep the same project key under a new name.** The key is the
project key (`project-api-key_…`); the start profile reads it as
`FIREWEAVE_KEY`, and still reads the legacy `FW_PROJECT_API_KEY` with a warning,
so the order is safe either way — but the rename is not optional, because that
warning is the only thing that would ever retire the old name. List every
destination that holds `FW_PROJECT_API_KEY` (deploy environment, CI secrets, a
Kubernetes Secret reference, compose, IaC). In committed config, rename the NAME
(`FW_PROJECT_API_KEY` → `FIREWEAVE_KEY`); in each secret store, the user copies
the value to `FIREWEAVE_KEY` and removes the old name once the migrated build is
live. `FW_API_URL` / `FW_ATTEST_URL` are deleted everywhere unless the project
runs its own fw-server (`server.kind === 'custom'`), where they become
`FIREWEAVE_URL`. `FW_ENV` is no longer read; an environment that needs a name
for local mode sets `FIREWEAVE_ENV`.

**Client surfaces (web, a Swift app) need a NEW browser key.** The scaffold's web
key was server-family (`project-api-key_…`), which the start profile refuses, so
this is a new key, not a rename. Call
`mcp__rollout_server__issue_browser_key { projectId, surfaceId, label: "fireweave-init:<surfaceId>" }`:

- `issued` — the key is returned once. It goes to exactly one place: the build
  destination the user picked (CI, the hosting build environment, an untracked
  xcconfig), through that destination's own secret command or pasted by the
  user. Never into a developer `.env` (it would make `vite dev` remote), a
  tracked file, a log line or the summary.
- `exists` — an active browser key for this surface already exists and its
  secret cannot be read back. Ask whether the destinations already hold it;
  re-issue with `rotate: true` only if the user says so.
- `fallback-portal` — send the user to the portal's Browser keys panel with the
  reason the tool gave.

Then remove `PUBLIC_FW_PROJECT_API_KEY` / `VITE_FW_PROJECT_API_KEY` (web) or the
Info.plist `FWProjectApiKey` (Swift) from every build destination. **Ask the user
to revoke the old key if it ever shipped in a bundle** — a web scaffold's
production build inlined it by construction, and anything in an app bundle can
be read by whoever downloads it. If the same project key also serves a server
surface, that server needs a new project key from the portal before the old one
is revoked.

## 5. Verify

Run the project's typecheck/build and its tests. Report failures; do not
proceed to step 6 with a broken build — a migration that does not compile is
not migrated, and reporting it as such makes the project page lie.

For a surface §3h moved, also:

- `mcp__rollout_server__verify_prod_path` with `{ feature }` on one manifest per
  moved surface. The package check set must pass — `sdk-floor`, `start-first`,
  `one-start`, `no-hand-rolled-init`, `key-family`, `start-profile` and the
  language's own checks (`no-shadowing-package` for Python, `module-path` and
  `no-local-replace` for Go, `no-shadowing-mod` for Rust, …). `warn` is
  advisory; a `fail` is fixed before step 6.
- `mcp__rollout_server__detect_rollout_ready`: the anchor count is unchanged.
- One local boot in the development run configuration: the `[fireweave:local]`
  line appears and a seeded control point reads its seeded value.

## 6. Report

Send the report **over the CLI profile**, not the project API key.

`{projectId}` comes from the repo's FireWeave pointer — read `projectId` from
`.fireweave/project.json`, or call `mcp__rollout_server__select_project` if the
pointer is absent. Do not invent it and do not use the project _name_.

```
fw api POST /v1/projects/{projectId}/harness-migration --body '{
  "status": "migrated",
  "sdkVersion": "<installed @fireweaveai/server-sdk version>",
  "surfaces": ["server", "web"],
  "notes": "go surface still reads PostHog directly"
}'
```

**Substitute every value before sending.** The fields above are a worked
example, not a template to paste: `sdkVersion` must be the version actually in
`package.json`, `surfaces` the surfaces you actually rewrote, `notes` real prose
or omitted entirely. The server accepts any string, so a pasted placeholder is
stored verbatim and rendered on the project page — `sdkVersion` appears in the
migration badge exactly as sent. Omit `notes` rather than sending filler.

`status` is one of `migrated` | `partial` | `failed`.

**Scaffold → package is recorded on the same route.** The body has no field for
it, so it goes in the fields that exist: `sdkVersion` is the 3.x version
`resolve_sdk_install` recorded (one language: that SDK; several: the one
`surfaces` lists first, the rest in `notes`), `surfaces` lists the surfaces
that moved, and `notes` says what moved, for example
`"scaffold → package (start profile): ts-server, web; go kept its scaffold
(no 3.0.0 release yet)"`. A moved surface whose re-key (§4f) failed has not
moved: say so in `notes`. A surface that kept its scaffold still reads through
FireWeave, so it does not on its own make the report `partial`.

**Do not send a raw `Authorization: Bearer {FIREWEAVE_KEY}` POST** (nor one
carrying its legacy name, `FW_PROJECT_API_KEY`). That variable holds the project
key — the server key family, `project-api-key_…` — which an app uses to
evaluate control points; the browser key (`fw_public_…`,
`FIREWEAVE_BROWSER_KEY`) is the client family. Neither authenticates this
endpoint: it is on the org plane (CLI access tokens and `fw_org_*` API keys), so
a key-bearing POST 401s. `fw api` carries the CLI profile, which is the
credential this route accepts — and the one plane a repo always has, including
a dev-only project that never gets a project key at all.

**Precondition — check before you send.** Unlike `initialise`, this skill has no
Step 0 that already gated on auth, so establish both here:

- `fw --version` resolves. If not, the report cannot be sent from this session.
- `fw api GET /v1/projects/{projectId}` returns 2xx. This settles the profile,
  the org binding, and `{projectId}` in one call.

If either fails, **do not guess a credential and do not fall back to the
project key** — the endpoint would reject it. Report the harness as migrated in the
session summary, name the project page as still-warning, and say which of the
two checks failed so the operator can run `fw login` / `fw profile use` and
re-send.

On a failure, say so in the session summary and name the project page as
still-warning. Do not PARK: the harness itself is migrated and committed — an
unreported success is a stale page, not a broken repo. Note that a missing or
ambiguous profile fails **before** any HTTP call, so `fw api` prints an error
envelope with no status code — treat "no 2xx observed" as the failure
condition, not "a non-2xx was returned".

Status honestly:

- `migrated` — every detected read now goes through FireWeave.
- `partial` — some surfaces still read the provider directly. Name them in
  `notes`. Partial does **not** count as done: the project page keeps warning,
  which is correct, because those surfaces still bypass FireWeave.
- `failed` — the rewrite did not land. Say why.

Never report `migrated` to make the page green. The page's whole purpose is to
show when the two halves disagree.

## `--check`

Do steps 1–2 and stop. Write nothing, report nothing.

### The mode-change report (shared by Sources D–J)

**Before anything is written — on `--check`, and in §2 of a real run — report,
per environment, how the effective MODE changes.** A scaffold and the start
profile decide the mode by different rules, so the same deploy can come up
differently after the move, and the start profile is the stricter one on
purpose. Nobody should find that out from a failed deploy.

Derive "today" from **the repo's own tier model**, never from defaults: the
surface's `FW_ENV_PROFILES` and `FW_DEFAULT_ENV`, the generated
`readEnvSignal` (which variables it reads, in order), `FW_ENV_ALIASES`, and
`.fireweave/project.json` `rolloutReady.environments`. A `dev` tier is local
mode; a `prod` tier is remote mode, or a boot error when its key is missing.
For each environment, find out from the files you can read (env files, run
configs, CI workflows, deploy manifests — whether a variable is SET, never its
value) which key and environment-name variables it sets.

Derive "after" from the start profile's rule (fireweave-sdk
`spec/start-profile.md` §4):

1. `mode` passed → that mode.
2. A key is present → **remote**. On a server, the legacy `FW_PROJECT_API_KEY`
   counts: it is still read. On a client (web, a Swift app), only
   `FIREWEAVE_BROWSER_KEY` counts, and the old scaffold key never does.
3. No key, and the environment name is `development`, `dev`, `local` or `test`
   → **local**. The name is what the SDK reads, not what the scaffold read:
   `FIREWEAVE_ENV`, then `APP_ENV` (ts-server also `NODE_ENV`; a web build
   `FIREWEAVE_ENV`, `APP_ENV`, `NODE_ENV` outside Vite, and Vite's mode for the
   dev server only; a Swift app's debug build with no name counts as
   development). `ENVIRONMENT`, `ENV`, `FW_ENV`, a platform variable and an
   Info.plist `FWEnvironment` are not read, and `FW_ENV_ALIASES` no longer
   apply: the raw value is compared.
4. Anything else, including no environment name at all → **start fails**,
   naming `FIREWEAVE_KEY` (server) or `FIREWEAVE_BROWSER_KEY` (client: the web
   build fails, a running page or Swift app serves its defaults with status
   failed).

Print one row per environment:

| Environment | Today (scaffold) | After (package) | Why | Fix |
| ----------- | ---------------- | --------------- | --- | --- |

Every row whose mode changes is named; never fold one into "unchanged":

- **local → FAILS** — a dev-tier environment with no key whose name the SDK
  cannot see or does not recognise: no variable set at all (the scaffold
  defaulted to `FW_DEFAULT_ENV`, `development`), a name read from a variable
  the SDK does not read, or an alias (`preview` → `development`). The usual one
  is a deployed preview or CI job that ran the scaffold in local mode.
- **local → remote** — a dev-tier environment where a key is set: a developer
  `.env` or a CI test job holding `FW_PROJECT_API_KEY`. On web, a key in a
  developer `.env` now makes `vite dev` remote.
- **boot error → LOCAL** — a prod-tier environment whose own name is
  `development`, `dev`, `local` or `test` (a QA environment called `test` mapped
  to prod) and has no key. The scaffold refused to boot there; the start
  profile serves local values. Fix it before writing.
- **endpoint** — an environment whose `FW_API_URL` (or `PUBLIC_FW_API_URL`)
  names a host other than the one the resolved SDK channel calls. It keeps that
  host while the legacy name stays set, and moves to the channel's host when
  §4g removes it.
- **Swift app release build** — the scaffold was dev-only and ran local; with no
  browser key, the start profile runs on defaults with status `.failed`.

An environment whose variables you cannot see (a hosting dashboard, a secret
manager) is `unknown`, never `unchanged`.

The fix belongs to the environment, not the code: set `FIREWEAVE_ENV=development`
in a dev run configuration, remove a key from a developer `.env`, set
`FIREWEAVE_KEY` in a deploy that needs remote mode. Pass the start call's
`environment` option only when the app already names its environment in its own
variable — that variable, never an app-side default such as `"dev"`, and never a
rebuilt tier map.

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "select_project", "server": "rollout-server" },
    { "name": "detect_rollout_ready", "server": "rollout-server" },
    { "name": "reconcile", "server": "rollout-server" },
    { "name": "record_rollout_env_contract", "server": "rollout-server" },
    { "name": "update_repo_state", "server": "rollout-server" },
    { "name": "assert_dev_checklist", "server": "rollout-server" },
    { "name": "refresh_agent_skills", "server": "rollout-server" },
    { "name": "resolve_sdk_install", "server": "rollout-server" },
    { "name": "issue_browser_key", "server": "rollout-server" },
    { "name": "upsert_rollout_manifest", "server": "rollout-server" },
    { "name": "verify_prod_path", "server": "rollout-server" }
  ]
}
```

The skill already called the first three in prose while declaring none, so a
host had no way to tell in advance whether its bundle could satisfy this skill.
A tool that is absent degrades the step that uses it — §3d's anchor re-scan and
§4b's env contract both name their own soft-continue — but the manifest is what
lets a host say so BEFORE the rewrite rather than midway through it.
