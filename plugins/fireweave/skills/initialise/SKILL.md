---
name: initialise
description: One-time per-repo setup for FireWeave Rollouts. Detects coding agents + language + deploy targets, runs the capability/connection resolver to wire the right SDKs per function (PostHog OpenFeature provider for flags, direct OTLP exporter for telemetry), scaffolds the isProd() harness + fw-tracker + config, wires the harness into the app entrypoint, installs standing instructions + Cursor dev-loop rules/hooks (so feature work keeps rollout-ready manifests/anchors/stamps in sync), and writes agent links. Use when the user asks to "set up FireWeave rollouts", "initialise rollout-ready", "instrument this repo", or invokes `/fireweave:initialise`. `--reinit` / `--remove`.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-initialise
  cline: fw-initialise
  codex: fw_initialise
---

# Initialise (one-time rollout-ready setup)

Run **once** per repo. This front-loads the rollout structure so later shipping is
a **promote, not a wrap** (D26): it scaffolds a harness with BOTH branches present
(dev in-memory provider + console exporter; prod connected-vendor provider + OTLP),
wires it into the app entrypoint, and installs the **dev loop** (standing
instructions + Cursor rules/hooks) so every feature change keeps
`// @fireweave-flag` anchors, `.fireweave/rollout-ready/<feature>.json`, and
`fw-tracker` stamps aligned before `/fireweave:safe-rollout-fast`. It does NOT
wrap existing code.

**Environment-keyed, not dev/prod-binary (D26).** The harness selects its branch
from the **running environment NAME** — the project's `defaultEnvironment` plus
every environment declared in FireWeave (`list_project_environments`) — via a
generated `FW_ENV_PROFILES` map, NOT a bare `NODE_ENV` boolean. Each environment
is classified into a **tier** (`dev` → local provider + console; `prod` → connected
vendor + OTLP + boot beacon). `staging` is a **first-class prod-tier** environment,
never silently folded into dev or prod. `isProd()` remains only as the classifier
for the tier and the token `verify_prod_path` greps for — it is no longer the
switch. The default environment is the row that runs when nothing is set at runtime,
and it determines which capability bindings the **dev** branch reflects; the **prod**
branch is wired from the **prod-tier** environment's bindings (Step 3).

V1 prod scope is **TS-server + web on PostHog**. For a surface with no vendor
provider (Go/Rust/Flutter), it scaffolds dev-only console wiring and prints an
explicit "prod deferred" notice — it never emits a half-wired prod branch that
would false-green `mcp__rollout-server__verify_prod_path`. Likewise, a project with
**no prod-tier environment** (dev-only) gets the dev branch scaffolded and prod
secrets **deferred with an explicit notice** — Step 3 never forces a prod-run
question when there is no prod-tier environment to attest.

## Step 0 — Auth precondition

Run `mcp__rollout-server__ensure_auth` (authenticated profile + bound project).
On failure → `fw login` then `fw init` / `mcp__rollout-server__select_project`,
and PARK. Then run the Step 0.1b tool-manifest check via
`mcp__rollout-server__list_registered_tools`.

## Steps

| Step | Action |
|---|---|
| **1 — Repo gate** | `AskUserQuestion`: *"Let FireWeave manage rollouts in this repo?"* **No → exit, touch nothing.** |
| **2 — Detect agents + language + deploy targets** | Detect coding agents (`CLAUDE.md`/`.claude/`, `.cursor/`, `.clinerules/`, `AGENTS.md`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`; default `AGENTS.md` + `CLAUDE.md`). Detect surface(s) → tier + harness profile. Detect deploy targets → the stamp-beacon tier. Record which agents are present (`cursor`, `claude`, `cline`, …) for Step 7–8. |
| **3 — Environment map + provider/connection resolution (capability-driven, D-PROVISION)** | **3a — Enumerate environments.** Via `mcp__rollout-server__guarded_call` → `list_project_environments` (fall back to `.fireweave/project.json`), read the full environment list and `defaultEnvironment`. Classify each environment into a **tier**: use the API's `tier`/`kind` field when present; otherwise treat `defaultEnvironment` as `dev` and confirm the **prod-tier set** with one `AskUserQuestion` (multi-select the environments that run real user traffic — e.g. `staging`, `production`). Build the env→tier **profile map** (this becomes the harness `FW_ENV_PROFILES` in Step 4) and persist it as `rolloutReady.environments` alongside `defaultEnvironment` in `.fireweave/project.json`. **3b — Resolve capabilities per tier (do NOT wire prod from the dev env).** For the **dev branch** the FireWeave local provider needs no vendor binding. For the **prod branch**, call `get_project_capabilities` with `{ projectId, environment: <prod-tier env> }` — the connected-vendor descriptor (`flag.control.posthogProjectId`, observability `{ vendor, otlpEndpoint, credentialEnvName }`) MUST come from the **prod-tier** environment, never the default/dev one. When multiple prod-tier environments exist, resolve each and record its `posthogProjectId` per environment (manifest `harness.posthogProjectId` = the promotion target env; `verify_prod_path` accepts `targetEnvironment`). Persist the resolved `posthogProjectId` into `.fireweave/project.json` / manifest `harness.posthogProjectId`. **Flags:** if a prod-tier env's `feature-flags.flag.control` is not bound, hand off to the fw-webapp **OAuth connect** screen (browser-redirect, no CLI path) and PARK until bound. **Telemetry:** scaffold a **direct** app→vendor OTLP exporter from the prod-tier descriptor — NEVER an `observability.ingest` proxy through FireWeave. Always offer the FireWeave local dev provider for the dev tier. **3c — Boot beacon (BLOCKING when a prod-tier env exists).** If the profile map has **no prod-tier environment** (dev-only project), SKIP beacon provisioning, print an explicit **"prod deferred — no prod-tier environment configured"** notice, and continue to Step 4. Otherwise call `mcp__rollout-server__provision_deploy_beacon_env` with `{ apiSurface: true, webSurface: true }` when both ts-server + web harnesses exist; `{ apiSurface: true }` for API-only; `{ webSurface: true, apiSurface: false }` for web-only. **On `{ ok: false }` or missing tool → PARK.** **After success, verify on disk:** `.fireweave/deploy-beacon.env.local` contains both `FW_ATTEST_URL` + `FW_PROJECT_API_KEY`, and `.fireweave/.gitignore` lists `deploy-beacon.env.local`. Record both paths in `installedInto[]`. Then `AskUserQuestion`: **for the prod-tier environment(s)**, where does each run? Offer ONLY the destinations the tool's `cloudSecretDestinations` returns for THIS repo's detected deploy targets (Step 2) — do not hardcode a fixed list. State plainly that the default environment (`<defaultEnvironment>`, dev-tier) needs NO beacon secrets; these vars are set only where the prod-tier env runs. Show the matching `cloudSecretDestinations` copy-paste block and PARK until the user confirms secrets are set. **The skill takes the user's confirmation on trust — there is no tool that reads back a remote secret store; the real gate is the deploy-time attestation failing if they are absent.** |
| **4 — Scaffold harness (environment-keyed, both branches, D26)** | Generate `fireweave/fw-harness.<ext>` from the surface template. Emit the `FW_ENV_PROFILES` map + `FW_DEFAULT_ENV` from Step 3a's env→tier profile (do NOT ship the template's placeholder rows unchanged — regenerate them from the project's environments). The harness resolves the running environment NAME (`resolveFwEnvName`), looks up its tier, and selects: `dev` → in-memory OpenFeature provider + OTel console exporter; `prod` → the connected vendor's real provider + direct OTLP. `isProd()` is retained ONLY as the unknown-env tier fallback and the token `verify_prod_path` greps for. The harness imports `fw-tracker/index`, imports `resolveBootBeaconFromEnv` from `@fireweaveai/deploy-sdk/attest`, and calls `initFwAttestation({ stamps: FW_STAMPS, ...resolveBootBeaconFromEnv({ env: process.env, prod }) })` via PLAIN static imports (no glob/embed/build script). Because the beacon scopes off `FW_ENV`, document that **`FW_ENV` must be set per environment** (staging → `FW_ENV=staging`) so classification and attestation agree. **TS-server `.mjs` harness:** patch the API package `build` script to copy compiled harness artifacts — see **API Docker build** below. |
| **5 — Scaffold `fw-tracker/` + `.fireweave/`** | Empty `fw-tracker/` const tree at the idiomatic path; `.fireweave/changelog/` + `_archive/`, `.fireweave/rollout-ready/` (manifests), `PROVIDERS.md`, `config.json`. Ensure `.fireweave/.gitignore` contains `deploy-beacon.env.local` (the provision tool writes this — re-check if missing). Also write `.fireweave/hooks/rollout-build-gate.mjs` (see **Build-gate script** below) and `.fireweave/hooks/rollout-build-gate.sh` wrapper. |
| **6 — Wire the harness into the app entrypoint** | Inject `await initFwHarness()` as the FIRST awaited statement in the detected entrypoint, and record the location in `project.json.rolloutReady.harnessEntrypoint`. `mcp__rollout-server__verify_prod_path` asserts this. |
| **7 — Standing instructions + agent links** | Write `.fireweave/agent-instructions.md` (see **Agent instructions template** below). Link it from every detected agent file (`AGENTS.md`, `CLAUDE.md`, …). **Do not** rely on a one-line link alone: Step 7b is mandatory when `.cursor/` exists, Step 7c is mandatory when `.claude/` exists. Each host needs its always-on standing surface, not just a link. |
| **7b — Cursor dev loop (when `.cursor/` exists)** | Write `.cursor/rules/fireweave-rollout-ready.mdc` (always-on rule; see template). **HARD — Cursor plugin MCP only:** do **NOT** write or merge `.cursor/mcp.json`, do **NOT** copy `mcp/rollout-server/` into the repo, do **NOT** download `bin/server-*`. Confirm `list_registered_tools` works via the Cursor FireWeave plugin (`plugin-fireweave-rollout-server`). Set `rolloutReady.mcp.mode = "cursor-plugin"`. If repo-local `mcp/rollout-server/launcher.sh` already exists → delete it (and empty workspace `.cursor/mcp.json` that points at it). Ensure the four FireWeave skills exist under `.cursor/skills/` (copy from the installed plugin bundle only). Record every path in `installedInto[]` — never include `mcp/`. |
| **7c — Claude Code dev loop (when `.claude/` exists)** | Symmetric with 7b — the standing rule for Claude Code is the always-loaded `CLAUDE.md` block (Claude has no `alwaysApply` rule file; `CLAUDE.md` IS the always-on surface). **Mandatory when `.claude/` exists:** upsert the **FireWeave rollout-ready HARD ORDER block** into `CLAUDE.md` (see **CLAUDE.md rollout-ready block** template) — a full HARD ORDER, not the one-line pointer. The one-line link alone is NOT sufficient for Claude Code (it under-triggers on large feature prompts). Record `CLAUDE.md` in `installedInto[]`. |
| **8 — Hooks** | **Cursor** (when `.cursor/` exists): write `.cursor/hooks.json` + executable scripts under `.cursor/hooks/` (see **Cursor hooks**). **Claude Code** (when `.claude/` exists — MANDATORY, not optional): write executable `.claude/hooks/rollout-intent-gate.sh` (see **Claude Code hook**) and wire `UserPromptSubmit` + `SessionStart` in `.claude/settings.json` using a **fail-open guarded command** so a missing script can never error the hook. **Commit both `.claude/settings.json` AND the hook script** — settings without the script is the drift that silently no-ops the reminder on fresh checkouts/branches. Non-Cursor hosts that need an install-time launcher use `fw mcp install` (`mcp.mode: "cli-install"` / `"plugin-launcher"`) — never Cursor's happy path. |
| **9 — Record + verify** | Write `project.json.rolloutReady` (`initialized`, `language`, `strategy`, `sourceRoots`, `scanExclude`, `mcp.mode` (`cursor-plugin` when Cursor; else `plugin-launcher`/`cli-install`), `sdkDev`, `deploySdkVersion`, `trackerPath`, `changelogPath`, `harnessPath`, `harnessEntrypoint`, `rolloutCredentialEnv`, `webRolloutCredentialEnv` when web surface, `attestUrl`, `defaultEnvironment`, `promotionEnvironment` (the prod-tier env whose PostHog id is wired into the harness — ask if multiple prod-tier envs), `environments` (env→`{ tier, posthogProjectId }` from Step 3a), `posthogProjectId` (promotion env's id), `installedInto[]`). Keep `environments` in sync with the harness `FW_ENV_PROFILES`. **Reconcile manifest credential env:** for each `.fireweave/rollout-ready/*.json`, set `harness.rolloutCredentialEnv` from surface — `ts-server` → `POSTHOG_PROJECT_API_KEY`, `web` → `PUBLIC_POSTHOG_KEY` (see **Credential env canon**). Run `mcp__rollout-server__detect_rollout_ready` (anchor scan works). Run `mcp__rollout-server__reconcile` with `phase: "build"` (must pass when no orphan anchors exist under `sourceRoots`). **Smoke:** run `mcp__rollout-server__verify_prod_path` on one manifest per surface present with `{ feature, projectId }` only — **do not pass `targetEnvironment`** (tool matches `harness.posthogProjectId` / `promotionEnvironment`); fix any **fail** before declaring done. Confirm `.fireweave/deploy-beacon.env.local` still exists. **Hard assert (Cursor):** `mcp/` must not exist under the repo when `mcp.mode` is `cursor-plugin`. **Hard assert (Claude Code) — when `.claude/` exists:** (a) `CLAUDE.md` contains the rollout-ready HARD ORDER block (not just the one-line link); (b) `.claude/hooks/rollout-intent-gate.sh` exists AND is executable (`chmod +x`); (c) `.claude/settings.json` references it under `UserPromptSubmit` and `SessionStart` with the fail-open guarded command; (d) `git check-ignore` does NOT match the hook script or `CLAUDE.md` (they MUST be committable — an ignored/uncommitted hook is the drift that no-ops on fresh checkouts). Fix any miss before declaring done. **Reload notice — gate on the agents actually installed into (Step 2 / `installedInto[]`), never hardcode Cursor:** if Cursor artifacts were written (`.cursor/` present), tell the user to reload Cursor (Developer → Reload Window) so its rules/hooks/MCP reload; if Claude Code artifacts were written (`.claude/settings.json` hooks), tell them the `SessionStart`/`UserPromptSubmit` hooks apply on the next Claude Code session. Name only the agents present. |

**`--reinit`** re-detects agent/language **and re-enumerates environments** (regenerates the env→tier profile map / harness `FW_ENV_PROFILES` from `list_project_environments`); re-resolves the prod-tier capability bindings; **always re-runs** `provision_deploy_beacon_env` when a prod-tier env exists (rotates key if needed); refreshes harness/tracker/strategy, manifest credential-env fields, API build script, **and the dev-loop artifacts for every installed agent — Cursor (rule/hooks) AND Claude Code (`CLAUDE.md` block + `.claude/hooks/rollout-intent-gate.sh` + `.claude/settings.json` wiring)**. Reinit MUST re-create a missing/ignored Claude hook script and re-assert the `CLAUDE.md` block (do not skip on "settings entry already present" — verify the script file itself exists and is executable). Never loses `.fireweave/changelog/`. **`--remove`** reads `installedInto[]` and reverses precisely (rule, hooks, hook scripts, agent links, harness wiring recorded in `installedInto`) in one command.

Every clarification uses `AskUserQuestion`.

---

## Boot beacon env (Step 3 — URL + key, same treatment)

`FW_ATTEST_URL` and `FW_PROJECT_API_KEY` are a **pair**. Initialise provisions and documents them together — never one without the other.

| Artifact | Purpose |
|---|---|
| `.fireweave/deploy-beacon.env.local` | Gitignored local copy of **both** values for dev reference |
| `.env.example` | Names only (`FW_ATTEST_URL=`, `FW_PROJECT_API_KEY=`; add `VITE_FW_*` when web surface) |
| `project.json.rolloutReady.attestUrl` | Committed fw-server base URL (not secret) |
| Cloud deploy secrets | User copies **both** vars into **each prod-tier environment's** runtime (see `cloudSecretDestinations`) |

**Prod-tier only.** The beacon secrets belong wherever a **prod-tier** environment runs — never in the default/dev environment. If the project has no prod-tier environment, Step 3c defers the beacon entirely (no key, no question). When a prod-tier env exists, set the pair once per prod-tier environment's runtime (a `staging` service and a `production` service each need their own copy, scoped by `FW_ENV`).

**Tool:** `mcp__rollout-server__provision_deploy_beacon_env` — calls `POST /v1/projects/:projectId/deploy-beacon-keys` via `fw api` (CLI bearer token). The session-gated `/api/projects/:id/ingest-keys` route is for the web control plane only.

**After the tool returns:** `AskUserQuestion` — *"Where does each prod-tier environment run?"* Offer ONLY the destinations `cloudSecretDestinations` returns for this repo's detected deploy targets (Render dashboard, GitHub Actions secrets, docker-compose, VM/process env, …) — **do not hardcode the option list**; it is derived from Step 2 detection. Paste the matching block from `cloudSecretDestinations`. **Verification is on trust:** no tool reads back a remote secret store, so the skill accepts the user's confirmation; the enforcing gate is the deploy-time attestation failing if the pair is absent. PARK until the user confirms both secrets are set in that destination.

**Local dev (optional):** if the repo uses `.env.local`, pass `{ mergeRootEnvLocal: true }` to also merge both vars there.

**Never commit** `FW_PROJECT_API_KEY` or write it into tracked files other than the gitignored local env file.

---

## Credential env canon (Step 3 + Step 9)

PostHog credential env names differ by harness surface. Initialise must keep **`.env.example`**, **`project.json`**, and **each manifest's `harness.rolloutCredentialEnv`** aligned.

| Surface | `harness.rolloutCredentialEnv` | Host env | `project.json` field |
|---|---|---|---|
| `ts-server` | `POSTHOG_PROJECT_API_KEY` | `POSTHOG_HOST` | `rolloutReady.rolloutCredentialEnv` |
| `web` | `PUBLIC_POSTHOG_KEY` | `PUBLIC_POSTHOG_HOST` | `rolloutReady.webRolloutCredentialEnv` |

`provision_deploy_beacon_env` appends all required names to `.env.example` when `apiSurface` / `webSurface` are set. **Do not** use a single env name across both surfaces — `verify_prod_path` checks the manifest's surface-specific name.

On `--reinit`, patch every existing `.fireweave/rollout-ready/*.json` where `harness.rolloutCredentialEnv` does not match the surface row above.

---

## API Docker build (Step 4 — ts-server `.mjs` harness)

When the API harness lives under `src/fireweave/*.mjs` (compiled from TypeScript), the package `build` script must copy those files into `dist/` after `tsc`. Without this, Docker images ship without the harness.

Patch `packages/api/package.json` (or the detected API package) `scripts.build`:

```json
"build": "tsc && mkdir -p dist/fireweave && cp src/fireweave/*.mjs dist/fireweave/"
```

Record the patched `package.json` path in `installedInto[]` when changed.

---

## Agent instructions template

Write `.fireweave/agent-instructions.md` using repo-specific paths from Step 4–6. It MUST include these sections:

### Rollout-ready layout

Table of harness paths, `fw-tracker`, `.fireweave/rollout-ready/`, `.fireweave/changelog/`, `PROVIDERS.md`.

### Every feature change (dev — before `/fw-rollout-fast`) — HARD ORDER

**Backfill after coding is NOT the client path.** If you implement first and add the
manifest later, `/fw-rollout-fast` and clients cannot rely on promote-not-wrap.

1. **FIRST** — create or update `.fireweave/rollout-ready/<feature>.json` (copy the **Manifest contract** below). Mint `chg_<ULID>` + `stmp_<ULID>` (the `chg_`/`stmp_` prefixes are hard-enforced by `build_register_rollout_from_manifest` at ship time; a date-slug fails registration). Append the stamp to every surface `FW_STAMPS`.
2. Gate behavior behind OpenFeature via the harness — not legacy direct vendor SDK calls. Add `// @fireweave-flag <key>` at every evaluation site **while writing code**.
3. **BEFORE calling the task done** — run `mcp__rollout-server__assert_dev_checklist` with `{ feature }`. **PARK on any block.** Checklist hard-fails if `telemetry.metrics[].name` entries are declared without emit sites in wrap-point files (dummy / registry-only metrics are forbidden). Also run `detect_rollout_ready` + `reconcile` phase `build`.
4. Do NOT open a PR / declare done until `assert_dev_checklist.pass === true`.

### Do not

- Swap providers at promotion time.
- Route telemetry through FireWeave (OTLP direct to bound vendor).
- Delete `fw-tracker` stamps without `/fw-cleanup`.
- Write repo-local `mcp/rollout-server/` when using the Cursor FireWeave plugin.
- Finish feature code without a matching rollout-ready package (no backfill).


### Manifest contract (the committed ship contract — copy, don't invent)

`.fireweave/rollout-ready/<feature>.json` must match this exact shape (validated by `RolloutReadyManifestSchema`; `safe-rollout-fast` reads it to build the `RolloutSpec`). Every field below is load-bearing — start from this and swap the values. Invariants the schema enforces: every `wrapPoints[].flagKey` and `telemetry.metrics[].guards` must be a declared `flags[].key`; `telemetry.dimensions` must equal `context.dimensions` (the cohort seam); a `guardrail` metric needs an OTLP-metrics-capable destination (Grafana/Datadog — **PostHog cannot ingest OTLP metrics**), so keep adoption metrics as `role: "adoption"` unless you wire a metrics vendor.

```json
{
  "schema": 1,
  "feature": "<feature-slug>",
  "changeType": "new-feature",
  "userFacing": true,
  "change": {
    "id": "chg_<ULID>",
    "stampId": "stmp_<ULID>",
    "title": "<human title>",
    "description": "<what changes, one line>",
    "author": "<you@org>",
    "createdAt": "2026-07-06T00:00:00.000Z",
    "branch": "<dev-branch>",
    "backwardCompatible": "required",
    "supersedes": [],
    "supersededBy": [],
    "status": "in-progress",
    "migration": "<path/to/migration.sql or omit>"
  },
  "flagTelemetryProvider": "connected:posthog",
  "flags": [
    {
      "key": "<feature-slug>",
      "default": false,
      "cohortKey": "userId",
      "userFacing": true,
      "description": "Off: <today's behavior>. On: <new behavior>.",
      "tags": ["<area>"]
    }
  ],
  "wrapPoints": [
    {
      "file": "packages/api/src/application/use-cases/<UseCase>.ts",
      "symbol": "<UseCase>.execute",
      "wrapStyle": "method-guard",
      "flagKey": "<feature-slug>"
    }
  ],
  "context": { "targetingKey": "userId", "dimensions": [] },
  "telemetry": {
    "metrics": [
      { "name": "feature.<feature-slug>.adopted", "role": "adoption", "direction": "up-good", "guards": "<feature-slug>" },
      { "name": "feature.<feature-slug>.error", "role": "adoption", "direction": "up-bad", "guards": "<feature-slug>" }
    ],
    "logs": [],
    "traces": [],
    "dimensions": []
  },
  "harness": {
    "surface": "ts-server",
    "path": "packages/api/src/fireweave/fw-harness.<ext>",
    "rolloutCredentialEnv": "POSTHOG_PROJECT_API_KEY",
    "attestUrlEnv": "FW_ATTEST_URL",
    "attestCredentialEnv": "FW_PROJECT_API_KEY",
    "posthogProjectId": "<prod-tier env's PostHog projectId>",
    "flags": { "api": "openfeature", "sdk": "server", "devProvider": "in-memory", "rolloutProvider": "connected:posthog" },
    "telemetry": { "api": "otel", "devExporter": "console", "rolloutTransport": "otlp", "semconv": "fireweave/rollout-otel-semconv-v1", "signals": {} }
  }
}
```

For a **web** surface use `harness.surface: "web"`, `flags.sdk: "web"`, `rolloutCredentialEnv: "PUBLIC_POSTHOG_KEY"`, and the web harness path. `harness.posthogProjectId` is the **prod-tier** environment's project id (the phantom-ramp guard compares it to what `flag.control` ramps — see **Credential env canon** and `project.json.rolloutReady.environments`).

### Ship

Run `/fw-rollout-fast` only after `assert_dev_checklist` passes — it **promotes** rollout-ready work; it does not wrap code.

---

## Cursor rule template (Step 7b)

Write `.cursor/rules/fireweave-rollout-ready.mdc`:

```markdown
---
description: FireWeave rollout-ready — mandatory conventions for every feature change in an initialised repo
alwaysApply: true
---

# FireWeave rollout-ready (promote-not-wrap)

Read [.fireweave/agent-instructions.md](.fireweave/agent-instructions.md).

## HARD ORDER — every user-facing or flag-gated feature

1. **FIRST** create/update `.fireweave/rollout-ready/<feature>.json` (Manifest contract in agent-instructions) + mint `chg_`/`stmp_` + append stamp to `FW_STAMPS`.
2. Implement behind the harness OpenFeature provider with `// @fireweave-flag <key>` at each evaluation site.
3. **BEFORE done** call `mcp__rollout-server__assert_dev_checklist` with `{ feature }` — PARK on any block (includes dummy metrics with no emit sites). Also `reconcile` phase `build`.
4. Backfill after coding is forbidden. Do not write repo-local `mcp/`.

## Ship path

`/fw-rollout-fast` promotes existing rollout-ready work only. If `assert_dev_checklist` fails, finish the package first — do not use `/fw-rollout` unless explicitly migrating legacy code.
```

---

## CLAUDE.md rollout-ready block (Step 7c)

Claude Code has no `alwaysApply` rule file — `CLAUDE.md` is the only always-loaded surface, so the standing rule must live IN it as a full HARD ORDER (a one-line link under-triggers on large feature prompts, which is how a whole feature can get built with zero rollout-ready discipline until the user notices). Upsert this block near the top of `CLAUDE.md` (replace any prior one-line FireWeave pointer). Do not merely link `.fireweave/agent-instructions.md` — inline the order:

```markdown
## 🔴 FireWeave rollout-ready — HARD ORDER (this repo is initialised)

This repo is FireWeave rollout-ready ("promote, not wrap"). For **every user-facing
OR flag-gated OR behavior-changing** change — including internal/ops/observability
wiring — the rollout-ready package comes **FIRST, while you write code**, never as a
backfill after the feature is built. Backfill breaks promote-not-wrap and is forbidden.

1. **FIRST** — create/update `.fireweave/rollout-ready/<feature>.json` (Manifest
   contract in [.fireweave/agent-instructions.md](.fireweave/agent-instructions.md)),
   mint `chg_<ULID>` + `stmp_<ULID>`, and append the stamp to every surface `FW_STAMPS`.
2. Gate the new behavior behind the harness OpenFeature provider and add
   `// @fireweave-flag <key>` at each evaluation site **as you write it**.
3. **BEFORE calling the task done** — run `mcp__rollout-server__assert_dev_checklist`
   `{ feature }` (PARK on any block) + `detect_rollout_ready` + `reconcile` phase `build`.
4. Do **not** open a PR / declare done until `assert_dev_checklist.pass === true`.
   Ship only via `/fireweave:safe-rollout-fast` (promotes; never wraps).

If a request looks like feature work and you have NOT done step 1, stop and do it
first. If you are unsure whether a change qualifies, it does — err toward wrapping.
```

The `🔴` and "HARD ORDER" framing are deliberate — they raise the block's salience above ordinary CLAUDE.md guidance so it survives a big, distracting feature prompt. Keep the "including internal/ops/observability wiring" clause: the most common miss is an agent deciding an ops/observability change "isn't a feature" and skipping the package.

---

## MCP wiring (Step 7b) — Cursor plugin only

When `.cursor/` exists (Cursor host):

1. **HARD:** Use the **Cursor FireWeave plugin MCP** (`plugin-fireweave-rollout-server`). Confirm via `mcp__rollout-server__list_registered_tools`.
2. **Do NOT** create `mcp/rollout-server/` in the customer repo. **Do NOT** download `bin/server-*`. **Do NOT** write `.cursor/mcp.json` that points at `${workspaceFolder}/mcp/...`.
3. If `mcp/rollout-server/launcher.sh` or a workspace `.cursor/mcp.json` rollout-server launcher entry already exists → **delete them** and set `rolloutReady.mcp.mode = "cursor-plugin"`.
4. **Never** walk parents for `fireweaveai-platform`, **never** write `packages/fw-plugins/.../dist/server.js`, **never** inject `packages/fw-cli/bin` into `PATH`, and **never** set `rolloutMcpPlatformPath` in `project.json`.
5. Platform-engineer MCP dev (monorepo `dist/server.js`) is **out of scope** for `/initialise` — use `bun run dev:install` in `packages/fw-plugins`.

Non-Cursor hosts (Claude Code / Codex / Cline) may use `fw mcp install` (`mcp.mode: "plugin-launcher"` or `"cli-install"`). That path must never be used for Cursor customer/dogfood initialise.

When copying FireWeave skills into `.cursor/skills/`, copy from the **installed plugin bundle only** — never from `packages/fw-plugins/` platform source.

---

## Scan scope (Step 5 + Step 9)

Persist `rolloutReady.sourceRoots` and `rolloutReady.scanExclude` in `.fireweave/project.json`. **`@fireweaveai/deploy-sdk` defaults are customer-generic** (`**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**` only) — it does **not** embed monorepo paths.

During **Step 2**, if this repo is the FireWeave platform monorepo (`packages/deploy-sdk` and `packages/fw-plugins` both present), **write** these dogfood values into `project.json` (do not rely on runtime auto-detection):

| Field | Platform dogfood value |
|---|---|
| `sourceRoots` | One repo-relative root per application surface detected in Step 2 (server API package + web UI package) |
| `scanExclude` | `**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**`, `packages/deploy-sdk/**`, `packages/fw-plugins/**`, `packages/contracts/**` |

Customer repos: leave `sourceRoots` empty (scan whole repo) unless the app layout needs narrowing; `scanExclude` can stay at generic test patterns.

`reconcile`, `detect_rollout_ready`, and the build gate read **only** `project.json` via `resolveRolloutScanOptions` in `@fireweaveai/deploy-sdk/flags`.

**deploy-sdk dependency:** `bun add @fireweaveai/deploy-sdk@^0.1.0` (semver from npm). Record `rolloutReady.deploySdkVersion`. Only when the user explicitly opts into SDK co-development (`rolloutReady.sdkDev: true` or `FIREWEAVE_SDK_DEV=1`) use `workspace:*`.

---

## Build-gate script (Step 5)

Copy from the **installed plugin bundle** (same tree as `/add-plugin`):

- `hooks/rollout-build-gate.mjs` → `.fireweave/hooks/rollout-build-gate.mjs`
- `hooks/rollout-build-gate.sh` → `.fireweave/hooks/rollout-build-gate.sh` (`chmod +x`)

Do **not** copy from a monorepo checkout path (`packages/fw-plugins/...`). The gate prints JSON `{ pass, findings[] }` to stdout:

- Read `.fireweave/project.json` → `rolloutReady.sourceRoots` + `rolloutReady.scanExclude` (generic test-pattern fallbacks when unset).
- Read all `.fireweave/rollout-ready/*.json` → collect manifest flag keys (parse `flags[].key`; skip invalid files with a block finding).
- Walk the repo for anchors under `sourceRoots`, honouring `scanExclude` — same rules as `detect_rollout_ready` / `reconcile`.
- Match `@fireweave-flag <key>` in any comment leader (line, block, hash) — same regex as deploy-sdk.
- **block** if anchor key has no manifest entry.
- **block** if manifest flag has no anchor.
- **warn** if manifests exist but `FW_STAMPS` in `project.json.rolloutReady.trackerPath` (fallback: recorded tracker path) is empty.
- Exit `0` when `pass: true`, else `1`.

Write `.fireweave/hooks/rollout-build-gate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
if [[ ! -f "$proj" ]]; then exit 0; fi
initialized="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(j.rolloutReady?.initialized ? 'yes' : 'no');
" "$proj")" || {
  echo "rollout-build-gate: cannot read $proj" >&2
  exit 1
}
[[ "$initialized" == "yes" ]] || exit 0
node "$root/.fireweave/hooks/rollout-build-gate.mjs"
```

`chmod +x` the `.sh` file. Do **not** swallow probe errors (`2>/dev/null` + exit 0) — invalid `project.json` on an initialised repo must fail closed.

---

## Cursor hooks (Step 8)

**Merge** FireWeave hooks into `.cursor/hooks.json` — **never replace** the whole file. Existing events (`beforeMCPExecution`, `afterFileEdit`, …) must survive.

1. Read existing `.cursor/hooks.json`, or start with `{ "version": 1, "hooks": {} }`.
2. Under `hooks.sessionStart`, append (if not already present by `command`):
   `{ "command": ".cursor/hooks/fireweave-rollout-session.sh" }`
3. Under `hooks.stop`, append (if not already present by `command`):
   `{ "command": ".cursor/hooks/fireweave-rollout-stop.sh" }`
4. Write the merged JSON back. Do **not** paste a hooks.json that contains only FireWeave entries.

Write `.cursor/hooks/fireweave-rollout-session.sh` (executable):

```bash
#!/usr/bin/env bash
# Inject rollout-ready context when this repo is initialised.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
inst="$root/.fireweave/agent-instructions.md"
if [[ ! -f "$proj" ]]; then exit 0; fi
initialized="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(j.rolloutReady?.initialized ? 'yes' : 'no');
" "$proj")" || exit 1
[[ "$initialized" == "yes" ]] || exit 0
summary="FireWeave rollout-ready repo: follow .fireweave/agent-instructions.md on every feature change (anchor + manifest + stamp before /fw-rollout-fast)."
if [[ -f "$inst" ]]; then
  summary="$summary See agent-instructions for harness paths and dev checklist."
fi
printf '%s\n' "{\"additional_context\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$summary")}"
```

Write `.cursor/hooks/fireweave-rollout-stop.sh` (executable):

```bash
#!/usr/bin/env bash
# After agent work, nudge when rollout-ready artifacts drift.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
gate="$root/.fireweave/hooks/rollout-build-gate.sh"
if [[ ! -x "$gate" ]]; then exit 0; fi
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if "$gate" >"$out" 2>/dev/null; then exit 0; fi
findings="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log((j.findings||[]).map(f=>f.message).join('; '))" "$out" 2>/dev/null || echo 'rollout-ready drift detected')"
msg="FireWeave rollout-ready drift: ${findings}. Complete anchor + manifest + fw-tracker stamp per .fireweave/agent-instructions.md, then run reconcile phase build."
printf '%s\n' "{\"followup_message\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$msg")}"
```

Record `.cursor/hooks.json`, `.cursor/hooks/fireweave-rollout-session.sh`, `.cursor/hooks/fireweave-rollout-stop.sh`, `.cursor/rules/fireweave-rollout-ready.mdc`, `.fireweave/hooks/rollout-build-gate.mjs`, `.fireweave/hooks/rollout-build-gate.sh` in `installedInto[]`.

---

## Claude Code hook (Step 8, when `.claude/` exists)

Two artifacts, both **required and committed** (this is symmetric with the Cursor Step 7b/8 pair — Claude Code is NOT a second-class host):

**1. The hook script** — `.claude/hooks/rollout-intent-gate.sh` (executable, `chmod +x`). It MUST:
- Emit Claude Code's injection JSON — `{ "hookSpecificOutput": { "hookEventName": <event>, "additionalContext": <reminder> } }` — a **bare `echo` is not reliably injected**; use the JSON form (mirror the guarded `PreToolUse` graphify hook already in `settings.json`).
- Fire on **SessionStart** (empty prompt → surface the standing reminder unconditionally) and **UserPromptSubmit** (narrow to feature-intent keywords: `add|implement|feature|feat|fix|ship|build|wrap|change|refactor|rollout|flag`).
- Be **fail-open** — `set -uo pipefail` (not `-e`), guard every `node`/`cd`, and `exit 0` on any error. A missing dependency must never block a prompt.
- Read `.fireweave/project.json` → `rolloutReady.initialized`; no-op when not initialised.

```bash
#!/usr/bin/env bash
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
proj="$root/.fireweave/project.json"
[[ -f "$proj" ]] || exit 0
initialized="$(node -e "try{const j=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(j.rolloutReady?.initialized?'yes':'no')}catch{process.stdout.write('no')}" "$proj" 2>/dev/null)" || exit 0
[[ "$initialized" == "yes" ]] || exit 0
prompt="${1:-${CLAUDE_USER_PROMPT:-}}"
msg="FireWeave rollout-ready repo (promote-not-wrap): for every user-facing, flag-gated, or behavior-changing task the rollout-ready package comes FIRST — create .fireweave/rollout-ready/<feature>.json + mint chg_/stmp_ + append stamp to FW_STAMPS, add // @fireweave-flag <key> as you code, then assert_dev_checklist + reconcile(build) before done. No backfill. Ship via /fireweave:safe-rollout-fast. See .fireweave/agent-instructions.md."
if [[ -n "$prompt" ]] && ! echo "$prompt" | grep -qiE '\b(add|implement|feature|feat|fix|ship|build|wrap|change|refactor|rollout|flag)\b'; then exit 0; fi
node -e "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:process.argv[2]||'UserPromptSubmit',additionalContext:process.argv[1]}}))" "$msg" "${HOOK_EVENT:-}" 2>/dev/null || printf '%s\n' "$msg"
exit 0
```

**2. The settings wiring** — merge (never replace) into `.claude/settings.json`. Use a **fail-open guarded command** so a missing script cannot error the hook (this is the fix for the `rollout-intent-gate.sh: No such file or directory` non-blocking error that silently kills the reminder):

```json
"SessionStart": [
  { "hooks": [ { "type": "command",
    "command": "[ -f .claude/hooks/rollout-intent-gate.sh ] && HOOK_EVENT=SessionStart bash .claude/hooks/rollout-intent-gate.sh || true" } ] }
],
"UserPromptSubmit": [
  { "hooks": [ { "type": "command",
    "command": "[ -f .claude/hooks/rollout-intent-gate.sh ] && HOOK_EVENT=UserPromptSubmit bash .claude/hooks/rollout-intent-gate.sh || true" } ] }
]
```

Record `.claude/hooks/rollout-intent-gate.sh` and `.claude/settings.json` in `installedInto[]`. The hook is a **backstop** that re-asserts the reminder each turn; the always-loaded `CLAUDE.md` block (Step 7c) is the primary standing surface. Claude Code needs BOTH — the hook is execution-dependent and can drift; the `CLAUDE.md` block is plain text that always loads.

---

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure_auth", "server": "rollout-server" },
    { "name": "select_project", "server": "rollout-server" },
    { "name": "list_registered_tools", "server": "rollout-server" },
    { "name": "guarded_call", "server": "rollout-server" },
    { "name": "provision_deploy_beacon_env", "server": "rollout-server" },
    { "name": "detect_rollout_ready", "server": "rollout-server" },
    { "name": "reconcile", "server": "rollout-server" },
    { "name": "verify_prod_path", "server": "rollout-server" },
    { "name": "assert_dev_checklist", "server": "rollout-server" }
  ]
}
```
