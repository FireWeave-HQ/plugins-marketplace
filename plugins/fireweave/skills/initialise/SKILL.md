---
name: initialise
description: One-time per-repo setup for FireWeave Rollouts. Detects coding agents + language + deploy targets, runs the capability/connection resolver to wire the FireWeave control-points SDK for flags (telemetry is the app's own — initialise DETECTS it, never wires it), scaffolds the isProd() harness + fw-tracker + config, wires the harness into the app entrypoint, installs standing instructions + Cursor dev-loop rules/hooks (so feature work keeps rollout-ready manifests/anchors/stamps in sync), and writes agent links. Use when the user asks to "set up FireWeave rollouts", "initialise rollout-ready", "instrument this repo", or invokes `/fireweave:initialise`. `--reinit` / `--remove`.
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
a **promote, not a wrap** (D26): it scaffolds a harness with BOTH flag branches present
(dev in-memory provider; prod connected-vendor provider) — and **no telemetry
wiring in either**, because the app's observability SDK is the app's own —
wires it into the app entrypoint, and installs the **dev loop** (standing
instructions + Cursor rules/hooks) so every feature change keeps
`// @fireweave-controlpoint` anchors, the **server-owned rollout-ready manifest**, and
`fw-tracker` stamps aligned before `/fireweave:safe-rollout`. It does NOT
wrap existing code.

## What initialise puts in git — and what it does not (ADR-019)

Rollout state is **server-owned**. Initialise writes a small, permanent, committed
surface and pushes everything else to fw-server:

| Committed to git (written once, never by feature work)                                                  | Owned by fw-server (never scaffolded as a directory)                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.fireweave/project.json` — the **pointer**: `orgId`, `projectId` (or a `projects{}` map), `server.url` | Rollout-ready manifests → `repo_manifests`, authored via `mcp__rollout-server__upsert_rollout_manifest`       |
| `.fireweave/agent-instructions.md`                                                                      | Change stamps → `change_stamps` (D-D). `FW_STAMPS` in `fw-tracker` stays the one git-visible per-feature line |
| `.fireweave/PROVIDERS.md`                                                                               | Repo-scoped config → `repo_state`, written via `mcp__rollout-server__update_repo_state`                       |
| `.fireweave/hooks/` (build gate + wrapper)                                                              | Project×env + surface config → already server-side                                                            |
| `.fireweave/.gitignore`                                                                                 |                                                                                                               |

**Do not create `.fireweave/rollout-ready/`, `.fireweave/changelog/`, or an
`_archive/` directory.** They have no successor directory — archival is a `status`
on a server row. **`config.json` is dropped**: it is inert and read by nothing;
creating it on a fresh init only gives a future reader a second place to look.

**Ownership is a POSITIVE marker, never the absence of a block.** `fw init` writes
`repoState: "server"` into the pointer; that is what says fw-server owns this repo's
state. There is no "shape" to read any more — `repoShapeOf` answered from the
ABSENCE of a `rolloutReady` block, which is also exactly what `select_project`
leaves behind, so it could never tell _migrated_ from _never initialised_ and every
gate keyed on it decided from a field nobody had written. It is deleted. **`version`
stays `2`** — `ProjectBindingSchema` accepts only `1 | 2`, so writing `version: 3`
makes the pointer fail to parse and every reader treats the repo as _unbound_,
which is strictly worse than not migrating. Never branch on `version` either: it is
advisory and has been observed wrong in both directions.

Gitignored, per-worktree, and **never committed**: `.fireweave/.cache/` (a
disposable projection, rebuildable with `fw sync`), `.fireweave/.queue/` (unsynced
author state — _not_ a cache, no cache-clear remediation may delete it),
`.fireweave/.lock`, `.fireweave/local.json`.

`.fireweave/deploy-beacon.env.local` is **gone** — initialise no longer mints a
credential or writes one to disk. Both key families are issued by the operator in
the portal; `fireweave.md` (repo root, **committed**) names the variables. A repo
scaffolded before this change may still carry the old file: it is inert, and
deleting it is safe once the deploy environment has the values.

**Environment-keyed, not dev/prod-binary (D26).** The harness selects its branch
from the **running environment NAME** — the project's `defaultEnvironment` plus
every environment declared in FireWeave (`list_project_environments`) — via a
generated `FW_ENV_PROFILES` map, NOT a bare `NODE_ENV` boolean. Each environment
is classified into a **tier** (`dev` → local provider + console; `prod` → connected
vendor + OTLP). `staging` is a **first-class prod-tier** environment,
never silently folded into dev or prod. `isProd()` remains only as the classifier
for the tier and the token `verify_prod_path` greps for — it is no longer the
switch. The default environment is the row that runs when nothing is set at runtime,
and it determines which capability bindings the **dev** branch reflects; the **prod**
branch is wired from the **prod-tier** environment's bindings (Step 3).

Current prod scope is **TS-server + web + Python + Java on the Fireweave remote
mode**. For a surface with no installable SDK release yet (Go, Rust,
Flutter/`dart`, and Swift — see **Swift surface**), it scaffolds the dev tier
only (the SDK's LOCAL mode, in-process and credential-free, in the surface's own
idiom) and prints an explicit "prod deferred" notice — it never emits a half-wired prod
branch that would false-green `mcp__rollout-server__verify_prod_path` (which skips
these surfaces as a recorded gap; see the rollout-server `SURFACE_REGISTRY`). Likewise, a project with
**no prod-tier environment** (dev-only) gets the dev branch scaffolded and prod
secrets **deferred with an explicit notice** — Step 3 never forces a prod-run
question when there is no prod-tier environment to run against.

## Step 0 — Auth + create-permission + repo-bind precondition (fail closed)

**SCN-16 — hard PARK writes nothing.** Reserve the word **PARK** for
precondition failures the user must fix outside this run. On any hard PARK,
leave FireWeave **scaffold / ship artifacts** unchanged this run (no harness /
hooks / lockfile / beacon / `.fireweave/.cache/**` / `rollout-ready` writes from
Steps 1–9). Interactive waits _after_ an intentional commit-point are
**awaiting-user** (soft continue) — never labeled PARK. **Bind carve-out:**
Step 0c may call `select_project` or `fw init` — those remedies write
`.fireweave/project.json` **and** `.fireweave/local.json` as **bind artifacts
in full** (precondition for the rest of init; `fw init` also persists `server` /
`defaultEnvironment` / `cli.initVersion` into them as part of the atomic bind).
Those two paths are **never** tracked in `sessionWrote[]`, **never** rolled
back / deleted on hard PARK, and on `orgMatch: false` rebind **never** restored
to the stale pre-bind content (trade: bind+later PARK may leave bind files;
idempotent for the next run — SCN-16 scopes scaffold/ship orphans, not the
bind). Standalone paths those remedies may also touch (repo-root `.gitignore`,
`.fireweave/rollouts/`, `.fireweave/.cache/**`, etc.) **remain** scaffold/ship —
track them in `sessionWrote[]` and roll back on hard PARK. Gate order: every
**scaffold/ship** hard gate runs before the first scaffold write batch
(Step 3e). If a scaffold/ship tool still writes before a hard stop (crash /
partial provision), track **those** paths in session-only `sessionWrote[]` and
delete **new** scaffold/ship paths on hard PARK (prefer restoring git-clean
modified _scaffold_ files — never the Step-0 bind files). When 3e has patched
`project.json` with env/`teamAgents` fields and then hard-PARKs, rollback
restores **pre-3e content with the bind intact** — do not delete the file and
do not revert to a stale `orgMatch: false` bind. Do **not** invent a resume
lockfile for init.

**0a — Profile.** Run `mcp__rollout-server__ensure_auth` with
`{ cwd: <absolute open-workspace root> }` (the directory the user opened —
MCP process cwd is often `$HOME` or the plugin bundle, so `cwd` is required
when known). On `ok: false` (no profile) → instruct `fw login` (then `fw init`)
and PARK. `ok: true` only proves a CLI profile (user/org) exists — it does
**NOT** mean this repo is bound to a project.

**0b — Create permission (SCN-14, flag-aware, before any disk write).** Read
**`create_permission_park.required`** from the same `ensure_auth` result. When it
is `true`, PARK — **write nothing** (no `select_project`, scaffold, package tree,
lockfile, or register) and report `create_permission_park.reason`.

The tool computes that decision; do **not** re-derive it from the
`allowed` × `cause` × `enforced` matrix. It is `true` when:

- `create_permission.cause === "auth"` → instruct `fw login` / `fw whoami --force`
  (expired token is an auth problem, not a permissions problem); or
- `create_permission.allowed === false` **and** `create_permission.enforced === true`
  (hard-block flag on) → use `create_permission.reason` / contact an org admin; or
- `allowed === false` with role `viewer` and no `enforced` field (older server); or
- `allowed: "unknown"` **and** `enforced === true` — the block is live but the
  answer is indeterminate, so scaffolding now would meet the server's **503**
  after writing and leave orphan `.fireweave/` artifacts (SCN-16).

Do **not** PARK on `allowed: "unknown"` with `cause` `unsupported` or `unreachable`
when `enforced !== true` — continue; a late register **403** / `PERMISSION_DENIED`
is the authoritative refuse. Do **not** PARK when `enforced === false` (flag off).
On an older MCP server that omits `create_permission_park`, fall back to the
bullets above.

**0c — Repo binding (fail closed, allowlist).** Read `repo_binding`
from the same `ensure_auth` result. Continue **ONLY** when
`repo_binding.bound === true` **and** `repo_binding.orgMatch !== false`.
Missing / undefined `repo_binding` (older MCP server) or missing fields →
treat as unbound and PARK.

On PARK:

- Auth (`cause: auth`) → `fw login` / `fw whoami --force`. Do **not** scaffold.
- Create denied or indeterminate-while-enforced → use
  `create_permission_park.reason` (or: _You don't have permission to create
  rollouts in this org — contact an org admin to grant member access, or switch
  to a profile that can_). Do **not** scaffold and do **not** run
  `select_project`.
- `bound: false` / incomplete bind → `mcp__rollout-server__select_project`
  with the same `{ cwd }` (or `fw init`) for **this** workspace — only after
  create permission is clear.
- `orgMatch: false` → ask: wrong active profile, or stale/copied bind?
  Wrong profile → `fw profile use <alias>` (do **not** rebind). Stale bind →
  `select_project` with `{ cwd }`.

**Do not scaffold or write any FireWeave file while unbound or unauthorized.**
Pass the same `{ cwd }` to `record_rollout_env_contract` and other bind/write tools.

**Do not scaffold or write FireWeave scaffold/ship artifacts while unbound or
unauthorized.** The sole exception is the Step 0c bind remedy
(`select_project` / `fw init`) after create permission is clear — its
`.fireweave/project.json` + `.fireweave/local.json` writes are the bind
carve-out above (whole-file per remedy; there is no field-level rollback).
Other writes those remedies may perform (repo-root `.gitignore`,
`.fireweave/rollouts/`, machine-local pointers outside `local.json`, etc.)
remain scaffold/ship — track them in `sessionWrote[]` and roll back on hard
PARK. Pass the same `{ cwd }` to `record_rollout_env_contract` and other
bind/write tools.

Then run the Step 0.1b tool-manifest check via
`mcp__rollout-server__list_registered_tools`.

## Steps

| Step | Action |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Repo gate** | `AskUserQuestion`: _"Let FireWeave manage rollouts in this repo?"_ **No → exit, touch nothing.** |
| **2 — Detect agents + language + deploy targets** | Detect coding-agent markers on disk (`CLAUDE.md`/`.claude/`, `.cursor/`, `.clinerules/`, `AGENTS.md`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`). Detect surface(s) → tier + harness profile. Detect deploy targets → the secret destinations Step 3c offers. **Then ask the team (mandatory on first init):** one `AskUserQuestion` multi-select — _"Which coding agents will the team use in this repo?"_ **V1 full-materialize options:** `cursor`, `claude` only (HARD ORDER + hooks). Other hosts (`cline`, `codex`/`opencode`, `copilot`, `gemini`, `windsurf`) are **link-only experimental** — offer them only as an optional second question, never as a substitute for Cursor/Claude standing loops. Pre-select disk-detected `cursor`/`claude`. The user may add an agent **not** installed on this machine (e.g. Cursor laptop + teammates on Claude). Install set for Steps 7–8 = selection (not disk-only). **Hold** the selection in memory as `teamAgents` — **do not** persist to `project.json` yet (SCN-16; first **scaffold** write batch is Step 3e — Step 0c bind may already have written `project.json`). **Empty / cancelled selection:** re-ask once; if still empty → use **detected `cursor`/`claude` only** — never invent `["cursor","claude"]` when neither was detected and the user declined. Teammates who join later on an agent missing from `teamAgents` run `/fireweave:adopt` (harness-skipping). `--reinit` remains available for harness/env/credential refresh and may also restore agent loops — do not block it. |
| **3 — Environment map + provider/connection resolution (capability-driven, D-PROVISION; SCN-16 gate-before-write)** | **Hard gates first — no disk.** **3a — Enumerate environments (in memory).** Via `mcp__rollout-server__guarded_call` → `list_project_environments` (fall back to reading `.fireweave/project.json`), read the full environment list and `defaultEnvironment`. Classify each environment into a **tier**: use the API's `tier`/`kind` field when present; otherwise treat `defaultEnvironment` as `dev` and confirm the **prod-tier set** with one `AskUserQuestion` (multi-select the environments that run real user traffic — e.g. `staging`, `production`). Build the env→tier **profile map** (becomes harness `FW_ENV_PROFILES` in Step 4) **in memory only** — **do not** persist `rolloutReady.environments` yet. **3b — Resolve capabilities per tier (do NOT wire prod from the dev env; still no disk).** **Read `automation` off the same `get_project_capabilities` result before anything else in this step** — `{ autoRampEnabled, … }`, the project-scoped release-automation settings. They are what decides whether an OPTIONAL capability is actually required here: `observability.query.metrics` iff `autoRampEnabled`. It defaults OFF, so on a fresh project the honest answer is usually "this addon is optional". **An unreadable `automation` block is a hard PARK — write nothing.** Absent (an fw-server that predates the optional-automation feature), a transport or auth failure, or a malformed block all mean _we could not ask_, and that is NOT the same answer as _the operator turned it off_. Never synthesize `{ autoRampEnabled: false }` from a failed read: that fabricates permission to skip an addon the project may genuinely require. Say which read failed, tell the user to restore connectivity or upgrade fw-server, and stop. For the **dev branch** the FireWeave local provider needs no vendor binding. For the **prod branch**, call `get_project_capabilities` with `{ projectId, environment: <prod-tier env> }` — the connected-vendor descriptor (`flag.control.posthogProjectId`, observability `{ vendor, connectionId }` (the QUERY leg — there is no OTLP target in it; see (2))) MUST come from the **prod-tier** environment, never the default/dev one. When multiple prod-tier environments exist, resolve each and hold each `posthogProjectId` in memory (manifest `harness.posthogProjectId` = the promotion target env; `verify_prod_path` accepts `targetEnvironment`). **Capability XOR (SCN-8 / INIT-B11 / FIR-290) — classify before writing anything.** After `get_project_capabilities`, per prod-tier env: (1) **Flags ready?** Do **not** trust `capabilities['feature-flags.flag.control']` alone — unbound feature-flags.\* are filled with managed `fireweave-posthog`. Observe **`config['feature-flags.flag.control'].posthogProjectId`** (env-level): missing/empty → flags **not ready**. (2) **Observability ready? — classify on the VENDOR, never on an endpoint.** FireWeave's observability binding is its **query leg**: how fw-server reads guardrail metrics back out of the vendor (`connectionId`). It does **not** carry the app's OTLP ingest target and never will — `otlpEndpoint` / `credentialEnvName` are not fields any capability descriptor produces (`packages/integration-openobserve/src/manifest.ts` declares `observability.query.*` and no ingest capability). The app's **export leg** — a direct app→vendor OTLP exporter — is **deployment config the operator supplies**, exactly like `FW_ATTEST_URL` / `FW_PROJECT_API_KEY`. So: any non-null `capabilities['observability.query.metrics' \| 'observability.query.traces' \| …]` → observability **bound** (read its `vendor`); **no** `observability.query.*` capability at all → **unbound**. **Matrix:** flags-not-ready (any obs) → hand off to fw-webapp **OAuth / flag connect** (browser-redirect, no CLI path) and **hard PARK — write nothing**. flags-ready + **obs-bound** → **detect how this repo already emits, per surface. Do NOT scaffold an exporter.** FireWeave does not own telemetry initialisation: a repo that has not chosen an observability SDK has not asked FireWeave to choose one for it, and an exporter FireWeave writes is one the team never reviewed and does not maintain. NEVER an `observability.ingest` proxy through FireWeave either. And **never** defer telemetry merely because the descriptor carries no endpoint: it never does, for anyone — that is the expected shape, not a gap (**FIR-354**).

**What to detect, per surface — two answers from one read:**

1. **Is telemetry initialised at all?** Look for the provider/client construction itself, not call sites — an OTel `MeterProvider`, a vendor SDK client, a StatsD connection, whatever this repo actually chose. **None found → tell the user which surface, and PARK.** Say plainly that without an initialised metrics client a rollout on that surface can only ramp manually, because there is nothing for the soak to query. Do not fill the hole.
2. **What does it already emit?** Inventory the metric names this surface emits today, where, and what each measures. This is what makes REUSE possible at change time, and it has no other source — every `observability.query.*` capability takes a metric NAME, so nothing can list what exists. The repo is the only place to learn it.

Both answers go into `.fireweave/agent-instructions.md` at Step 7 (**How to emit a metric**), and the resolved client is recorded as `surfaces[].metricsClient`. flags-ready + obs-unbound (**INIT-B11**) → print **"observability deferred — no observability vendor bound"**; `AskUserQuestion`: bind observability in the portal **now**, or **continue with deferred telemetry**. **What a refusal costs depends on `autoRampEnabled` (3b).** With auto-ramp **off**, observability is a genuinely optional capability and a deferral is the _expected_ outcome, not a failure — **soft-continue** (awaiting-user, never PARK), record the deferral in the session summary, and carry on. With auto-ramp **on**, the soak observer is what automatic advancement trusts, so an unbound metrics vendor is a broken promise rather than a preference: name auto-ramp as the reason it is required, and **Refuse/cancel → hard PARK — write nothing**. Never PARK a project for declining an addon it never enabled. On continue, write **no telemetry at all** — the harness never carried any and does not gain any here; **never** emit a half-wired OTLP exporter (empty endpoint, placeholder creds, or ingest proxy). Record the deferral in the session summary, naming what it costs: no bound metrics provider means no guardrail can be read back, so every rollout on this project ramps manually. Neither ready → same as flags-not-ready (connect flags first). Always offer the FireWeave local (in-memory + console) provider for the **dev** tier. **3c — Where the credentials will go (no secret is minted anywhere in this skill).** If the profile map has **no prod-tier environment** (dev-only), SKIP this question, print **"prod deferred — no prod-tier environment configured"**, and continue to **3d** (still no disk). Otherwise the **prod flags path** needs the runtime credential pair in every prod-tier deploy destination: `FW_API_URL` (the fw-server base URL) and `FW_PROJECT_API_KEY` (the bearer the harness sends to fw-server `/v1/flags/evaluate`) — plus the `PUBLIC_FW_*` pair when a web surface exists, whose key comes from a DIFFERENT panel. **Initialise issues neither.** Both come from the portal's **Project settings → API keys** page: `project-api-key_…` from **Project API keys** (server), `fw_public_…` from **Browser keys** (web). `AskUserQuestion`: for each prod-tier environment, where will it run? Offer only destination **kinds** from the tool union `github_actions`\|`vm_env`\|`docker_compose`\|`other` (map Step 2 labels such as Render → `other`/`vm_env` as appropriate). Default/dev-tier needs NO prod secrets. Confirm the user will set the pair in that destination after issuing the keys. **When 3b classified the env obs-bound**, the same destination also needs the OTLP **endpoint** + **credential** vars the Step 4 harness reads (FireWeave never holds these — the export leg is the operator's, see (2)); name them explicitly in the same question so the operator sets one set of secrets, once. **Refuse → soft-continue (awaiting-user, never PARK):** still call `record_rollout_env_contract` (it writes no secret — only `fireweave.md` and `.env.example` NAMES, which are exactly what an undecided operator needs later), keep every other scaffold, and record in the session summary that the prod branch will refuse to boot until the pair is set — the harness fails loudly, never silently, on missing prod credentials. **3d — Environment source (project-native, confirm-first; still no disk).** Determine how the harness learns the running environment NAME — see **Environment source** below. Prefer the project's existing env signal; only fall back to `FW_ENV`/`PUBLIC_FW_ENV`if the user opts in. Always`AskUserQuestion`before scaffolding. **3e — First scaffold write batch (commit-point; only after 3a–3d pass).** Track **scaffold/ship** paths in session-only`sessionWrote[]`(include`.fireweave/.cache/**` when present) — **never** the Step-0 bind `project.json`. (1) Call `mcp__rollout-server__record_rollout_env_contract` — it records the env contract, writes the committed `fireweave.md`, appends `.env.example` NAMES, and **mints nothing** — with `{ cwd: <same absolute workspace root as Step 0>, apiSurface: true, webSurface: true }` when both ts-server + web harnesses exist; `{ cwd, apiSurface: true }` for API-only (a `java` or `python` surface counts as API here); `{ cwd, webSurface: true, apiSurface: false }` for web-only. Pass `webappUrl` when known, so the operator gets a clickable link instead of a path. Call it **whether or not** a prod-tier env exists and whether or not 3c was declined: it is documentation, not provisioning. **On a missing tool → soft-continue**, naming the gap — a missing readme is a worse-documented repo, not a broken one. (There is no `{ ok: false }` PARK here any more: the call that could fail was the key mint, and it is gone.) (2) Then persist in-memory `rolloutReady.environments`, `defaultEnvironment`, resolved `posthogProjectId` fields, and Step 2 `teamAgents` into `.fireweave/project.json` (bind fields stay; do not rewrite org/project ids). **On success, verify on disk:** `fireweave.md` exists at the repo root, names every variable the DETECTED surfaces need, and contains **no** value matching a key prefix. Record it in `installedInto[]` — it is committed, not gitignored. Show the tool's `userPrompt`, which names the portal page, which panel issues which key, and the variables for this repo's surfaces. Then \*\*soft-continue (awaiting-user — not PARK)\*\* until the user confirms secrets are set — confirmation is on trust; the prod boot failing loudly on a missing pair is the real gate. |
| **3f-pre — Detect surfaces, then let the user SELECT** | Run `mcp__rollout-server__detect_surfaces` with `{ cwd }` — and on a re-init also `{ declared: <project.json surfaces[]> }`. It is the deterministic replacement for the old "detect surface(s)" prose: topology -> language -> deployability -> app-vs-library via the dependency graph. **It PROPOSES; it never declares.** Every row carries a NAMED verdict and the evidence behind it. **Show the user every row, then ask** (one `AskUserQuestion` multi-select, gate `GATE-3F-SURFACE-SELECTION`): pre-tick exactly the rows with `preselect: true`, and leave `ambiguous`, `undecidable` and every library unticked but VISIBLE and selectable — a library the user knows is deployed must be choosable, and an ambiguous row is a question, not a guess. For an `ambiguous` row also show `alternatives` so the user can pick WHICH surface it is. **`unreadable` is not an error channel — print it.** A zone that could not be read contributes no surfaces, which looks exactly like a zone that has none; silently dropping it is how a whole package goes uninstrumented with a green run. If `unreadable` is non-empty, name each path and its reason before asking. **Never auto-declare on a weak verdict** and never declare a row the user did not tick. Record the selection with `write_confirmation_receipt` so the choice is auditable and a re-run is idempotent. **Re-init drift (`drift.needsReview === true`):** a surface that was declared before and is not detected now is **FLAGGED, never auto-retired** (gate `GATE-3F-VANISHED-SURFACES`). It has two indistinguishable causes — genuinely deleted, or invisible this run (moved directory, unreadable manifest, glob that stopped matching, missing submodule) — and the costs are asymmetric: a stale declaration is noise, a wrongly-retired one destroys an `sfc_` id the server issued and a committed harness still references, and it fails at SHIP, not here. Ask; do not decide. A moved surface appears as vanished + added rather than a silent rebind, which is deliberate — the `(surface, path)` pair is the same key the server matches a re-declare on. **Detection is advisory, not a gate:** if the tool is unavailable (older bundle), say so and fall back to asking the user to name the surfaces directly — never PARK on it, and never skip the ASK. |
| **3f — Declare surfaces (server mints the IDs)** | **The server mints every `sfc_` id. You never do.** Run **exactly one** `fw repo declare-surfaces --project {projectId} --json --surfaces '[{"surface":"<ts-server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | web                          | python                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | go  | rust | dart | java>","path":"<harness module path>","entrypoint":"<app entrypoint>","rolloutCredentialEnv":"<FW_PROJECT_API_KEY | PUBLIC*FW_PROJECT_API_KEY>"}]'`carrying EVERY surface detected in Step 2 — **ONE call carrying EVERY surface**, never one call per surface (the server resolves them against one snapshot and refuses the whole set if any collides; two calls would let the first half land and the second conflict). Pass`surfaceId`only for a surface that already carries one in`project.json`— omit it and the server mints. Read the returned`surfaces[].surfaceId` and carry it into Step 4. **`path`must be the exact path Step 4 will write** — it is half the key the server matches a re-declare on, and both writers treat it as fill-only, so a predicted path that Step 4 then contradicts is sticky: the next`--reinit` declaring the real path misses the key and mints a SECOND id. If Step 4 ends up writing elsewhere, re-run this step with the real path before recording anything. **`outcome`per surface:**`minted`(new),`existing`(already on file for this project at this harness path — the healthy answer for a repo whose pointer was lost),`adopted`(your id, newly claimed),`already-registered`(your id, already ours). **Non-zero exit → PARK.** The command fails closed on an unreachable server, a 5xx, and on`conflict`(a`sfc*`id homed under another project — 409, and NOTHING was declared). There is no local-mint fallback and you must not invent one: an id the server never issued is exactly the unclaimed id this step exists to abolish, and it fails at ship instead, as`SURFACE_PROJECT_CONFLICT`. On `conflict`, name the colliding surface and its incumbent project to the user; the usual cause is a harness copied from another repo. When the failure is **`error: unknown command 'declare-surfaces'`** (exit 1), the repo holds a `fw`binary older than this command — the skill bundle and the CLI ship on independent release paths, so a current bundle with a stale binary is the ordinary case, not an exotic one. Tell the user to run`fw self-update` and re-run; do **not** read that error as a conflict, and do **not** work around it by minting an id locally. This call is also the first server-side evidence that initialise ran against this repository (it records the declaring repo), so it happens BEFORE any harness is written, not after. |
| **4 — Scaffold harness (environment-keyed, both branches, D26)** | **Read the surface's templates from `harness/<surface>/` — resolved relative to THIS `SKILL.md`'s own directory, not the target repo — and generate EVERY file the surface's row lists**, never just one: a `ts-server` / `web` surface emits `fireweave/fw-harness.ts` **and** `fireweave/fw-providers.ts` (the harness imports `makeConnectedVendorProvider` / `makeDevProvider` from `./fw-providers` — a single-file harness does not resolve); a `python` surface emits three snake_case modules; a `java` surface emits the three `Fw*.java` classes into the app's `<base package>.fireweave` package (directory must match the package — rewrite the templates' `package fireweave;` line accordingly). Never hand-author a harness from this row's prose; see **Harness templates — where they live (Step 4)** below for the surface→dir map, the substitution list, and what to do when the templates are missing. Emit the `FW_ENV_PROFILES` map + `FW_DEFAULT_ENV` from Step 3a's env→tier profile (do NOT ship the template's placeholder rows unchanged — regenerate them from the project's environments). The harness resolves the running environment NAME (`resolveFwEnvName`), looks up its tier, and selects the flag provider: `dev` → the SDK's in-memory local mode; `prod` → the connected vendor's real provider. **The harness wires NO telemetry, in either tier.** FireWeave does not initialise an observability SDK in a repo — the templates carry none and `harness-templates.test.ts` asserts they never gain any. Step 3b's observability descriptor is the QUERY leg (how fw-server reads a guardrail metric back during a ramp), not an exporter for FireWeave to write; whether the app emits anything at all is DETECTED at Step 3b, never scaffolded. `isProd()` is retained ONLY as the unknown-env tier fallback and the token `verify_prod_path` greps for. The surface ids Step 3f's `fw repo declare-surfaces` returned are recorded in `project.json` `surfaces[].surfaceId` ONLY (Step 9 / see the `--reinit` surfaces section) — the harness carries no surface-ID block and no attestation wiring (deploy attestation is retired; merge attestation supersedes the boot beacon). **Never mint an `sfc_` id yourself** — not by hand, not with an inline script. The server owns `sfc_` identity (`surface_registry.surface_id` is a global primary key), and a locally-invented id is unclaimed and collides later as `SURFACE_PROJECT_CONFLICT`. The harness resolves `fwEnvName` from **the project's own env signal** — the generated `readEnvSignal()` + `FW_ENV_ALIASES` block (see **Environment source** below / Step 3d) — so **no FireWeave-specific `FW_ENV` / `PUBLIC_FW_ENV` is required**. Do NOT instruct the user to set `FW_ENV` per environment unless they explicitly chose the FireWeave-var option in Step 3d; `FW_ENV` is an optional override only. **TS-server `.mjs` harness:** patch the API package `build` script to copy compiled harness artifacts — see **API Docker build** below. |
| **5 — Scaffold the tracker + `.fireweave/`** | **Every surface gets ONE tracker MODULE beside its harness in `fireweave/`, generated in Step 4 from that surface's own template** — `ts-server` / `web` → `fw-tracker.ts.tpl`, `python` → `fw_tracker.py.tpl`, `java` → `FwTracker.java.tpl`, `swift` → `FwTracker.swift.tpl`, `go` → `fw_tracker.go.tpl`, `rust` → `fw_tracker.rs.tpl`. One shape for every language: do NOT create the old `fw-tracker/` DIRECTORY anywhere. **Record each tracker on its surface's own entry — `surfaces[].trackerPath`** (or `rolloutReady.harnesses[].trackerPath`). **Do NOT write the legacy `rolloutReady.trackerPath` / `webTrackerPath`** — they are a two-surface model, superseded, and writing them creates a second source of truth that drifts. An unrecorded tracker downgrades a stamp BLOCK to a warn in `assert_dev_checklist` check 4. `.fireweave/PROVIDERS.md`. **Create NO `rollout-ready/`, NO `changelog/`, NO `_archive/`, and NO `config.json`** — see _What initialise puts in git_ above; manifests and stamps are server-owned and an empty directory is just a second place a future reader looks. Ensure `.fireweave/.gitignore` covers `local.json`, `.cache/`, `.queue/`, `.lock` (the queue tools write these lines — re-check if missing; **never** add an ignore rule that would let a `git clean` sweep `.queue/` unremarked, and never tell a user to delete `.queue/` as a cache remedy). Also write `.fireweave/hooks/rollout-build-gate.mjs` (see **Build-gate script** below) and `.fireweave/hooks/rollout-build-gate.sh` wrapper. |
| **6 — Wire the harness into the app entrypoint** | Inject `await initFwHarness()` as the FIRST awaited statement in the detected entrypoint, and record the location in `project.json.rolloutReady.harnessEntrypoint`. `mcp__rollout-server__verify_prod_path` asserts this. |
| **6b — Cohort identity wiring (always-on, INIT-S8)** | Locate (or, with the user's confirmation, wire) the identity bind for each surface — see **Cohort identity wiring** below. The bind runs **unconditionally** on auth / sign-out: never inside a flag branch, never behind a `// @fireweave-controlpoint` anchor. Record the identity module in `installedInto[]` when initialise writes it. |
| **7 — Standing instructions + agent links** | Write `.fireweave/agent-instructions.md` (see **Agent instructions template** below). Link / upsert standing surfaces for **every agent in Step 2 `teamAgents`**, not only folders present on this machine. **Do not** rely on a one-line link alone: Step 7b is mandatory when `cursor` ∈ `teamAgents`, Step 7c is mandatory when `claude` ∈ `teamAgents`. Each selected host needs its always-on standing surface, not just a link. |
| **7b — Cursor dev loop (when `cursor` ∈ `teamAgents`)** | Write `.cursor/rules/fireweave-rollout-ready.mdc` (always-on rule; see template) — create `.cursor/rules/` if missing. **HARD — Cursor plugin MCP only when this host is Cursor:** do **NOT** write or merge `.cursor/mcp.json`, do **NOT** copy `mcp/rollout-server/` into the repo, do **NOT** download `bin/server-*`. Confirm `list_registered_tools` via the Cursor FireWeave plugin **only when the current host is Cursor**. If initialise runs on a non-Cursor host but `cursor` was selected for teammates, still write the rule/hooks/skills artifacts so they are committed — that does **not** change MCP transport. **`mcp.mode` is host-scoped, not teamAgents-scoped:** set `rolloutReady.mcp.mode = "cursor-plugin"` **only when this host is Cursor**; otherwise set `plugin-launcher` / `cli-install` (and tell non-Cursor hosts to run `fw mcp install`). Never set `cursor-plugin` merely because `cursor` ∈ `teamAgents` for absent teammates. If repo-local `mcp/rollout-server/launcher.sh` already exists on a Cursor host → delete it (and empty workspace `.cursor/mcp.json` that points at it). Ensure the FireWeave skills exist under `.cursor/skills/` (copy from the installed plugin bundle only — includes `adopt` + `feedback`). **Copy each skill's WHOLE directory, never `SKILL.md` alone** — initialise's `harness/**` templates live beside it and Step 4 cannot run without them (C27). Record every path in `installedInto[]` — never include `mcp/`. |
| **7c — Claude Code dev loop (when `claude` ∈ `teamAgents`)** | Symmetric with 7b — the standing rule for Claude Code is the always-loaded `CLAUDE.md` block (Claude has no `alwaysApply` rule file; `CLAUDE.md` IS the always-on surface). **Mandatory when Claude is selected — even if `.claude/` is absent on this laptop:** create `.claude/hooks/` as needed; upsert the **FireWeave rollout-ready HARD ORDER block** into `CLAUDE.md` (see **CLAUDE.md rollout-ready block** template) — a full HARD ORDER, not the one-line pointer. The one-line link alone is NOT sufficient for Claude Code (it under-triggers on large feature prompts). Record `CLAUDE.md` in `installedInto[]`. |
| **8 — Hooks** | **Cursor** (when `cursor` ∈ `teamAgents`): write `.cursor/hooks.json` + executable scripts under `.cursor/hooks/` (see **Cursor hooks**). **Claude Code** (when `claude` ∈ `teamAgents` — MANDATORY, not optional, even if `.claude/` was missing before this run): write executable `.claude/hooks/rollout-intent-gate.sh` (see **Claude Code hook**) and wire `UserPromptSubmit` + `SessionStart` in `.claude/settings.json` using a **fail-open guarded command** so a missing script can never error the hook. **Commit both `.claude/settings.json` AND the hook script** — settings without the script is the drift that silently no-ops the reminder on fresh checkouts/branches. Non-Cursor hosts that need an install-time launcher use `fw mcp install` (`mcp.mode: "cli-install"` / `"plugin-launcher"`) — never Cursor's happy path. |
| **9 — Record + verify** | **Repo-scoped config goes to the server, not into the file.** Make ONE `mcp__rollout-server__update_repo_state` call carrying every field that surface owns — `sourceRoots`, `scanExclude`, `teamAgents` (Step 2), `installedInto[]`, `language`, `strategy`, `mcp.mode` (**host transport only** — `cursor-plugin` when this host is Cursor; else `plugin-launcher`/`cli-install` — never derived solely from `teamAgents`), `sdkDev`, `deploySdkVersion`. **Never hand-write those nine into `project.json`:** one writer, one merge policy. Set fields UNION (so two concurrent `--reinit`s cannot clobber each other) and the FIRST write materialises the full derived set — which is why a partial first call is a one-way door for anchor-scan scope. The write is **online-only and fails closed** (a queued field merge would union against a row that moved underneath it); on `outcome: 'refused'` → PARK, do not fall back to editing the file. The tool writes **no file at all** — the nine fields live only in the server row, so do not look for them in `project.json` afterwards and do not hand-write them there when they are absent. **The pointer keeps only what has no server home:** identity (`select_project` owns `orgId`/`projectId`/`projectName`/`projects{}`), `server.url`, top-level `surfaces[]` (the `sfc_` ids Step 3f's server declaration returned + per-surface `path`/`entrypoint`/`rolloutCredentialEnv`), `defaultEnvironment`, and the residual `rolloutReady` keys listed under **Pointer residue** below. **Add nothing else to `rolloutReady`.** Keep `environments` in sync with the harness `FW_ENV_PROFILES`. **Reconcile manifest credential env:** resolve each feature's manifest through the seam and re-author it with `mcp__rollout-server__upsert_rollout_manifest` when `harness.rolloutCredentialEnv` does not match the surface — `ts-server` → `FW_PROJECT_API_KEY`, `web` → `PUBLIC_FW_PROJECT_API_KEY`, `python`/`java` → `FW_PROJECT_API_KEY` (see **Credential env canon**); never edit a manifest file in place. Run `mcp__rollout-server__detect_rollout_ready` (anchor scan works). Run `mcp__rollout-server__reconcile` with `phase: "build"` (must pass when no orphan anchors exist under `sourceRoots`). **Smoke:** run `mcp__rollout-server__verify_prod_path` on one manifest per surface present with `{ feature, projectId }` only — **do not pass `targetEnvironment`** (tool matches `harness.posthogProjectId` / `promotionEnvironment`); fix any **fail** before declaring done. **Hard assert (no credential on disk):** `fireweave.md` exists at the repo root and no file under the workspace contains a `project-api-key_` / `fw_public_` / `fw_ingest_pub_` prefix followed by key material. Initialise mints nothing, so a match means a credential was pasted into the repo — stop and tell the user to move it to the deploy environment and rotate. **Hard assert (surface IDs are the server's):** every `surfaceId` in `project.json` `surfaces[]` MUST appear in Step 3f's declare output (harnesses carry no surface-ID block — the pointer is the only local record). Fix by re-running `fw repo declare-surfaces` and using what it returns — **never by minting an id** to make the grep pass. **Hard assert (identity never flag-gated — INIT-S8):** no identity call (`identify` / `reset` / `setContext({ targetingKey })` / `reloadFeatureFlags` / `reload*Flags` / `bind*User`) may sit inside a flag branch or under a `// @fireweave-controlpoint` anchor. `mcp__rollout-server__assert_dev_checklist` enforces this on every feature; at init, spot-check the surface's auth path — a flag cannot gate the targeting-key bind it depends on. Fix by hoisting the bind out of the branch before declaring done. The gate ships with the FireWeave plugin publish — standing `.cursor/skills` copies refresh via adopt/`--reinit` from the installed bundle. **Hard assert (Cursor):** `mcp/` must not exist under the repo when `mcp.mode` is `cursor-plugin`. **Hard assert (feedback reachable):** the `feedback` skill exists in the installed set for every agent in `teamAgents`. It is the only path a user has to report that FireWeave itself misbehaved, so a repo that initialises without it is a repo whose failures are invisible. **Hard assert (Claude Code) — when `claude` ∈ `teamAgents`:** (a) `CLAUDE.md` contains the rollout-ready HARD ORDER block (not just the one-line link); (b) `.claude/hooks/rollout-intent-gate.sh` exists AND is executable (`chmod +x`); (c) `.claude/settings.json` references it under `UserPromptSubmit` and `SessionStart` with the fail-open guarded command; (d) `git check-ignore` does NOT match the hook script or `CLAUDE.md` (they MUST be committable — an ignored/uncommitted hook is the drift that no-ops on fresh checkouts). Fix any miss before declaring done. **Report the harness — FIR-359:** once the smoke above passes, send the report **over the CLI profile**, not the project API key: `fw api POST /v1/projects/{projectId}/harness-migration --body '{"status":"migrated","sdkVersion":"<@fireweaveai/server-sdk version installed>","surfaces":[<every surface wired this run>]}'`. Use `fw api` (authenticated by the Step-0 profile) rather than a raw `Authorization: Bearer {FW_PROJECT_API_KEY}` POST — `FW_PROJECT_API_KEY` is the runtime ingest plane, and this endpoint does not accept it (`migrate-harness` reports the same way) — **a dev-only project never gets that key.** Initialise never holds `FW_PROJECT_API_KEY` at all — the operator issues it in the portal — so a key-bearing POST has nothing to authenticate with; the profile is always present because Step 0 gated on it. This is not optional bookkeeping: the project page pairs this report against the flag binding, and auto-bind puts every new environment on managed PostHog, so a project that never reports sits permanently in "FireWeave ramps flags the running app does not read" with no action that clears it. Report `partial` — naming the gap in `notes` — when any detected surface was left reading its provider directly (e.g. a Go surface, whose prod path is still deferred); report `migrated` only when every surface wired this run reads through FireWeave. **Never report `migrated` to make the page green** — the page exists to show when the two halves disagree. On a non-2xx, say so in the session summary and name the project page as still-warning; do NOT PARK (the harness itself is wired and committed — an unreported success is a stale page, not a broken repo). **Reload notice — INIT-A4:** name **only** the agents whose **reloadable standing-loop artifacts were written this run** (derive from paths appended to `installedInto[]` this run — e.g. Cursor rule/hooks → reload Cursor; Claude HARD ORDER + hooks → next Claude session). Do **not** name link-only / experimental hosts that got only a thin agent-instructions link (nothing to reload). Never hardcode Cursor. Mention `/fireweave:adopt` for teammates who later use an agent not in `teamAgents` (`--reinit` may also restore loops — prefer `adopt` for standing-loop-only gaps). |

**`--reinit`** re-detects agent/language **and re-enumerates environments** (regenerates the env→tier profile map / harness `FW_ENV_PROFILES` from `list_project_environments`); re-resolves the prod-tier capability bindings; **always re-runs** `record_rollout_env_contract` when a prod-tier env exists (refreshes `fireweave.md` + `.env.example`; it mints nothing, so there is no key to rotate); refreshes harness/tracker/strategy, manifest credential-env fields, API build script, **and the dev-loop artifacts for the resolved refresh set** — Cursor (rule/hooks) when `cursor` ∈ set AND Claude Code (`CLAUDE.md` block + `.claude/hooks/rollout-intent-gate.sh` + `.claude/settings.json` wiring) when `claude` ∈ set. **Refresh-set resolution (N1 — absent ≠ empty):**

1. If `rolloutReady.teamAgents` is a **present** array (including `[]`) → use it as-is. An explicit empty array means refresh **no** agent loops (intentional post-`--remove`).
2. If `teamAgents` is **absent** (pre-teamAgents initialisation) → **never** treat that as `[]`. Derive the set from (a) agents implied by remaining `installedInto[]` paths (e.g. `.cursor/rules/fireweave-rollout-ready.mdc` / `.cursor/hooks/fireweave-rollout-*.sh` → `cursor`; `CLAUDE.md` / `.claude/hooks/rollout-intent-gate.sh` / `.claude/settings.json` → `claude`) and (b) disk markers that already carry FireWeave standing-loop artifacts (HARD ORDER block / FireWeave rule / intent-gate — **not** bare `.cursor/` or `.claude/` alone). Write the resolved sorted set back as `teamAgents`, then refresh that set.

Reinit MUST re-create a missing/ignored Claude hook script and re-assert the `CLAUDE.md` block when `claude` ∈ the resolved set (do not skip on "settings entry already present" — verify the script file itself exists and is executable). Reinit **also mints surface IDs and writes the canonical top-level `surfaces[]`** into `project.json` — see **`--reinit` — mint surface IDs + write `surfaces[]`** below. **Reinit MUST refresh the copied FireWeave skill directories** — see **Skill copies are copies (C27)** below; a repo whose data migrated while its skill copies stayed stale is the worst failure mode this skill has. Reinit **never touches change stamps or manifests**: both are server-owned, `--reinit` is a harness/loop refresh, and re-authoring a manifest it did not author would displace a contract.

**`--reinit` is idempotent, and there is only one path.** It used to branch on whether the pointer carried a `rolloutReady` block — writing the repo-scoped config back into the file in one case and not the other. `update_repo_state` writes **no file at all** now, in any repo, so there is nothing to discriminate: it sends the delta, fw-server merges it, and `fw sync` is how this worktree sees the result. **Never write `version: 3`** — `ProjectBindingSchema` accepts only `1 | 2`, so a `3` makes the pointer unparseable and every reader treats the repo as unbound. A second `--reinit` changes nothing but re-minted-nothing surface ids and refreshed loop artifacts.

**`--remove`** reads `installedInto[]` and reverses precisely (rule, hooks, hook scripts, agent links, harness wiring recorded in `installedInto`) in one command.

**C28 — `--remove` must have an OFFLINE answer.** `installedInto[]` is repo-scoped
server state now, and reversing an install is _exactly_ the moment you may be
disconnected — an unreachable server is not a reason to leave an uninstall
half-done. Resolve it in this order and **say which one answered**:

1. **fw-server** (`update_repo_state`'s read leg / `fw sync`) — authoritative. Use it.
2. **`.fireweave/.cache/` projection** — use it as a fallback, and **warn explicitly**
   that the list is a snapshot: name `_fetchedAt` and the recorded branch, and state
   that anything installed after that snapshot will be left behind. A stale list that
   removes _most_ artifacts is still far better than refusing to uninstall.
3. **Neither can answer** → refuse, and name which leg failed and why (server
   unreachable vs. no projection on disk vs. not authorised for this project). Do
   **not** guess a removal set from disk markers and delete files on that basis:
   `installedInto[]` exists precisely because "looks like ours" is not evidence, and a
   wrong guess deletes a user's own `.cursor/hooks.json` entries or `CLAUDE.md` prose.

Reverse `installedInto` and `teamAgents` server-side with `update_repo_state`'s
`resetSets` — the union merge can never reach a deliberately empty set, so a plain
write would silently re-add everything you just removed. **Also prune `rolloutReady.teamAgents`:** if `teamAgents` is **absent**, first derive the set the same way as `--reinit` rule 2 (from remaining `installedInto[]` + FW standing artifacts on disk), then prune. For each agent host whose standing-loop artifacts were removed (map paths → `cursor` / `claude` / …), drop that id from the (present or just-derived) `teamAgents` array (sorted); when the array empties write **`teamAgents: []`** (present empty — do **not** omit the key), so the next `--reinit` does not re-derive and resurrect removed loops (INIT-C4). Never leave the key absent after a remove that cleared agent loops.

Every clarification uses `AskUserQuestion`.

---

## Pointer residue — the ONLY `rolloutReady` keys initialise may still write

Phase 2 moved the repo-scoped config to `repo_state`. A short list of keys has **no
server column yet**, so they stay in the pointer's `rolloutReady` block and are
written directly. This list is exhaustive — **adding anything else to the block is a
regression**, because a field with two homes is the drift ADR-019 exists to kill.

| Residual key                                                                                                                                    | Why it is still file-only                                                                                                                               | Written by                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `surfaces[].trackerPath` (canonical) · `trackerPath` / `webTrackerPath` (legacy, two-surface)                                                   | Read by `assert_dev_checklist` + `reconcile` to find `FW_STAMPS`. Per-surface is canonical; the legacy pair is a fallback for pre-migration repos.      | Step 5 / 9                    |
| `harnessPath` / `harnessEntrypoint` / `harnesses[]`                                                                                             | Read by `verify_prod_path` and the `normalizeSurfaces` shim; the canonical successor is top-level `surfaces[]`, kept side by side as the rollback path. | Step 4 / 6 / 9                |
| `environments` / `defaultEnvironment` / `promotionEnvironment` / `posthogProjectId`                                                             | Read by `resolve-project-environment` + `verify_prod_path` to pick the prod-tier binding.                                                               | Step 3a / 9                   |
| `attestUrl` (legacy KEY name; the VALUE is the fw-server base URL that feeds `FW_API_URL`) / `rolloutCredentialEnv` / `webRolloutCredentialEnv` | `repo_state` has **no column** for them — `update_repo_state` hard-errors if you try.                                                                   | `record_rollout_env_contract` |

**`initialized` is gone — do not write it back.** It used to head this table, and it
was the field three separate gates read to decide whether to run at all: the
build-gate wrapper, `adopt`'s Step 1, and `assert_dev_checklist` check 1. Because
Step 9 wrote it _last_, any run that PARKed before Step 9 left a repo whose gate was
installed and switched off, with nothing on stdout, stderr, or the exit code to say
so. All three now decide on **project identity** or on the server's `repo_state`
row — facts somebody positively wrote — and the key is deleted from
`RolloutReadyProjectSchema`. Re-adding it re-creates a silent gate.

**The block is residue, not a store.** A freshly-initialised repo carries a
`rolloutReady` block — the keys above have nowhere else to go — and that fact means
nothing beyond those keys. Nothing branches on the block's presence: `repoShapeOf`
is deleted, and every writer that used to consult it now asks
`isServerOwnedRepoState`, the `repoState: "server"` marker `fw init` stamps.

**Do not hand-strip the block.** The fields would simply be gone, and
`verify_prod_path`, `assert_dev_checklist` and the prod credential resolution
would all start failing for a repo that is otherwise healthy. Keys leave this
table when they get server homes, not when an agent deletes them.

**And there is no file store to fall back to.** `update_repo_state` and
`upsert_rollout_manifest` refuse when they cannot reach fw-server, in every repo —
which is exactly why Step 9 is online-only and says **PARK on `refused`, do not fall
back to editing the file**. `upsert_rollout_manifest` will QUEUE a manifest when the
server merely does not answer (`.fireweave/.queue/`, replayed on next contact); it
refuses outright when the write cannot be addressed at all — no profile, no
`projectId`, no `origin`. Neither outcome leaves a manifest on disk.

---

## Skill copies are COPIES, not links (C27) — refresh them on `--reinit`

`.cursor/skills/<skill>/` (and any equivalent host directory) are **real file
copies** taken from the installed plugin bundle. Nothing refreshes them
automatically: they are re-copied only by `/fireweave:initialise --reinit` and
`/fireweave:adopt`.

**Where the installed plugin bundle is:** the directory containing the `SKILL.md`
you are executing right now. This skill runs from the bundle, so the skills root
is its parent — `<dir of this SKILL.md>/..`. Resolve it that way rather than
searching the filesystem, and never substitute the `packages/fw-plugins/` platform
source.

**Copy whole DIRECTORIES, not just `SKILL.md`.** A skill is its directory: this one
ships `harness/**` (the `.tpl` files Step 4 generates from — see **Harness
templates — where they live**), and a copy that took only `SKILL.md` leaves the
next agent executing Step 4 from a copy with no templates to read. That agent
hand-writes a harness. Copy `<skill-dir>/**`, never `<skill-dir>/SKILL.md` alone
— and take `<skill-dir>` from the bundle as it is named there (hosts rename it:
`initialise`, `fw-initialise` on Cursor, `fw_initialise` on Codex).

That makes skill refresh a **required step of migration, not a nicety.** A repo whose
_data_ moves to the server while its _skill copies_ stay on the old instructions has
an agent that should never again author `.fireweave/rollout-ready/<feature>.json` by hand
still doing exactly that — into a tree where the gate no longer reads it, where no teammate and no ramp coordinator
can see it, and where nothing errors to say so. Stale instructions fail silently;
stale readers fail loudly. This is the silent one.

`--reinit` MUST therefore, for every host in the resolved refresh set:

1. Re-copy the whole FireWeave skill set from the **installed plugin bundle** — never
   from `packages/fw-plugins/` platform source — via
   `mcp__rollout-server__refresh_agent_skills` with
   `{ sourceSkillsRoot: <installed bundle>/<host tree>/skills, destSkillsRoot: '.cursor/skills' }`
   (or the host's equivalent). The tool compares by CONTENT (an mtime comparison calls an identical
   tree stale on every fresh clone), replaces rather than merges so a file
   retired upstream stops instructing the agent, and takes the destination names
   **verbatim from the host's own tree** — Cursor's bundle ships `fw-`prefixed
   directories, and copying from another host's tree renames every `/fw-*`
   command the user types. Its `rows[].state` is what the reload notice reports;
   its `installedInto` feeds step 3 below.
   Copy the set, not just the skill you were thinking about: `initialise`, `adopt`,
   `safe-rollout`, `migrate-harness`, `cleanup` move together, and a half-refreshed
   set is a repo where `safe-rollout` reads the seam and `cleanup` still deletes
   files.
2. Re-assert the standing-rule templates in the same run (`.cursor/rules/fireweave-rollout-ready.mdc`,
   the `CLAUDE.md` HARD ORDER block, the intent-gate hook) — they restate the same
   instruction and drift the same way.
3. Record every refreshed path in `installedInto[]`.
4. **Report the refresh in the reload notice.** A user who is told "reinit done" but
   not "your agent's copied skills changed" has no reason to reload, and the stale
   copy stays live in the current session.

`/fireweave:adopt` performs the same copy for the host it is attaching. If you are
adding an agent to a repo that migrated, `adopt` is the cheaper path — it does not
rotate beacon keys.

---

## `--reinit` — declare surfaces + write `surfaces[]` (project.json stays `version: 2`)

`--reinit` lazily upgrades `.fireweave/project.json` to the canonical top-level
**`surfaces[]`** shape while leaving every legacy `rolloutReady` field in place.
The shape is discriminated by **key presence** (`surfaces[]` = canonical), never
by a version number — **`version` STAYS `2`; do NOT write `version: 3`.**

1. Read the current `project.json` and run it through `normalizeSurfaces()` (the
   shim in `mcp/rollout-server/src/tools/project-harnesses.ts`) to get the surface
   list. That one seam reads the new `surfaces[]`, the branch
   `rolloutReady.harnesses[]`, OR the legacy singular fields, so reinit works from
   any prior shape.
2. Declare the whole list to the server in ONE call —
   `fw repo declare-surfaces --project {projectId} --json --surfaces '<the normalized list>'`.
   Pass each entry's existing `surfaceId` where it has one and omit it where it
   does not; **the server mints, you never do.** Take every id from the response.
   Entries that already carry a `surfaceId` come back `already-registered` and keep
   it unchanged — that is what makes reinit idempotent, and it is now checked
   against the registry rather than merely against the file.

   An entry that comes back **`existing`** carried no id in the file but the
   server already had one for that `(surface, path)` in this project: adopt the
   returned id. That is the pointer-was-lost case, and adopting is what stops a
   second registry row shadowing the first forever.

   **Non-zero exit → PARK, write nothing.** A `conflict` means a `sfc_` id in this
   `project.json` is homed under a different project (409; nothing was declared) —
   usually a `project.json` or harness copied from another repo. Report the
   colliding surface and its incumbent project; do NOT "fix" it by minting a
   replacement id.

3. Write the result as the top-level **`surfaces[]`** array, still under
   **`version: 2`**.
4. **Leave the legacy `rolloutReady` fields UNTOUCHED** (`harnessPath`,
   `harnessEntrypoint`, `rolloutCredentialEnv`, `webRolloutCredentialEnv`,
   `harnesses[]`, `environments`, …). They are the **rollback path** and the
   golden backward-compat fixtures still read them — `surfaces[]` is additive,
   never a replacement.
5. Every id in `surfaces[]` must be an id step 2's declaration returned —
   the pointer is the only local record (harnesses carry no surface-ID block).

Example `project.json` after a `--reinit` on a ts-server + web repo —
canonical `surfaces[]` and the **untouched** legacy `rolloutReady`, side by side,
all under `version: 2`:

```json
{
  "version": 2,
  "surfaces": [
    {
      "surface": "ts-server",
      "surfaceId": "sfc_01J8ZQ7M4E5X6Y7Z8A9B0C1D2E",
      "path": "packages/api/src/fireweave/fw-harness.ts",
      "entrypoint": "packages/api/src/main.ts",
      "rolloutCredentialEnv": "FW_PROJECT_API_KEY",
      "metricsClient": "otel-sdk"
    },
    {
      "surface": "web",
      "surfaceId": "sfc_01J8ZQ7M4E5X6Y7Z8A9B0C1D2F",
      "path": "apps/web/src/fireweave/fw-harness.ts",
      "rolloutCredentialEnv": "PUBLIC_FW_PROJECT_API_KEY",
      "metricsClient": "posthog"
    }
  ],
  "rolloutReady": {
    "harnessPath": "packages/api/src/fireweave/fw-harness.ts",
    "harnessEntrypoint": "packages/api/src/main.ts",
    "rolloutCredentialEnv": "FW_PROJECT_API_KEY",
    "webRolloutCredentialEnv": "PUBLIC_FW_PROJECT_API_KEY",
    "environments": {
      "development": { "tier": "dev" },
      "production": { "tier": "prod", "posthogProjectId": "12345" }
    }
  }
}
```

After writing `surfaces[]`, run `mcp__rollout-server__verify_rollout_config_schema`
against the repo (a `--reinit` dry-run) and confirm it **passes** — it validates
the `surfaceId` format and the `surfaces[]` / legacy `rolloutReady` coexistence.
Fix any schema finding before declaring the reinit done. **Hard assert (surface
IDs are the server's):** every `surfaceId` written into `surfaces[]` MUST be one
step 2's declaration returned — never a hand-minted value that satisfies the
schema's shape while naming an id the server never issued.

---

## Prod runtime credentials (Step 3 — URL + key, same treatment)

`FW_API_URL` (the fw-server base URL) and `FW_PROJECT_API_KEY` (the bearer the prod flags path sends to fw-server `/v1/flags/evaluate`, `/v1/capture`, `/v1/targets/register`) are a **pair**. Initialise documents them together — never one without the other. Nothing about this pair is attestation: it is how the PROD FLAGS branch authenticates.

**Initialise mints nothing and writes no secret.** Both key families are issued by the operator in the portal, on one page — **Project settings → API keys** (`/projects/<projectId>/settings?tab=api-keys`) — which carries a panel for each:

| Panel                | Issues              | Variable                    | Where it may go                                                            |
| -------------------- | ------------------- | --------------------------- | -------------------------------------------------------------------------- |
| **Project API keys** | `project-api-key_…` | `FW_PROJECT_API_KEY`        | Server-side only — never a browser bundle, never a commit                  |
| **Browser keys**     | `fw_public_…`       | `PUBLIC_FW_PROJECT_API_KEY` | Designed to ship in a web bundle; scoped `flags:evaluate` + `events:write` |

**The two are not interchangeable and never share a key.** A web surface takes the browser key; putting the attest-family key in a bundle hands out an unscoped credential. `runtime-proxy/AUTH.md` is the source of truth for the families.

A key that is never written cannot be committed, cannot rot in a stale gitignored file, and never passes through an agent's context window.

| Artifact                              | Purpose                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `fireweave.md` (repo root)            | **Committed.** Names every variable per surface, which panel issues which key, and why a missing credential is a boot failure. No values. |
| `.env.example`                        | Names only (`FW_API_URL=`, `FW_PROJECT_API_KEY=`; `PUBLIC_FW_*` when web surface)                                                         |
| `project.json.rolloutReady.attestUrl` | Committed fw-server base URL (not secret; legacy KEY name, current VALUE)                                                                 |
| Cloud deploy secrets                  | Operator sets both vars in **each prod-tier environment's** runtime, from the portal                                                      |

**Order (SCN-16, relaxed):** Step **3c** still asks where each prod-tier environment runs, so the operator knows where the pair goes — but it is no longer gating a secret write, because there is no secret write. Step **3e** calls `record_rollout_env_contract` after the capability gates, **before** persisting env/`teamAgents` into `project.json`.

**Tool:** `mcp__rollout-server__record_rollout_env_contract` — records the env contract only. It calls no key endpoint and returns no credential. (`provision_deploy_beacon_env` is a deprecated alias for one release, running the same handler, so an older skill copy cannot get the old side effects.) Pass `webappUrl` when the dashboard origin is known: a webapp host **cannot be derived from an API host** (fw-cli records the same limitation in `login.ts`), so without it the tool emits the PATH rather than guessing a URL.

**After the tool returns (soft continue, not PARK):** show its `userPrompt` — it names the portal page, the panel per key, and the variables for the surfaces this repo actually has — and point the user at `fireweave.md` for the full list. **Verification is on trust:** no tool reads back a remote secret store; the enforcing gate is the prod harness refusing to boot when the pair is absent. Await user confirmation as **awaiting-user** — do not label this wait PARK (disk was intentionally written at the commit-point).

**Prod-tier only.** The pair belongs wherever a **prod-tier** environment runs — never in the default/dev environment. If the project has no prod-tier environment, Step 3c skips the destination question entirely (nothing to set yet); `fireweave.md` is still written, because it is the record of what a future prod environment will need. When a prod-tier env exists, set the pair once per prod-tier environment's runtime (a `staging` service and a `production` service each need their own copy). Each service is scoped by **the project's own env signal** (Step 3d) — a separate `FW_ENV` is not required unless the user opted into the FireWeave-var source.

**Local dev needs neither variable.** The dev tier runs the FireWeave local provider in-memory. There is no `mergeRootEnvLocal` option any more — writing a live credential into a repo-root `.env.local` was the thing this change removed.

**Never commit** `FW_PROJECT_API_KEY`, and never write it into any file. The operator holds it from the portal to their deploy environment; nothing in the repo is a staging post for it.

---

## Environment source (Step 3d — the project's own env signal, never a mandated `FW_ENV`)

The harness must learn the running environment NAME from **whatever this repo / its
CI-CD platform already uses** — it must NOT force the developer to introduce a
FireWeave-specific `FW_ENV` (server) / `PUBLIC_FW_ENV` (web) var just so our SDK can
tell environments apart. The generated harness owns detection via a `readEnvSignal()`

- `FW_ENV_ALIASES` block (the `// fw:env-source` region of the template), and uses
  the resolved name (`fwEnvName`) to select the tier.
  `FW_ENV` / `PUBLIC_FW_ENV` remain an **optional override only** (highest precedence
  inside the SDK, but the harness need not read them).

**Always confirm the source with `AskUserQuestion` before scaffolding** — do not
silently pick FireWeave's var. Offer, tailored to the Step-2 deploy-target detection:

| Option                                                       | Generated `readEnvSignal()` reads                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **My app's standard var** (recommended when present)         | `NODE_ENV` (ts-server) / `import.meta.env.MODE` (web)                                                                                            |
| **A platform var**                                           | the detected platform's var — e.g. `VERCEL_ENV`, `RAILWAY_ENVIRONMENT`, `RENDER` / `RENDER_SERVICE_NAME`, `FLY_APP_NAME`, a K8s downward-API var |
| **A function/module in my repo**                             | import + call the user-named resolver (e.g. `getEnvironment()`)                                                                                  |
| **FireWeave's `FW_ENV` / `PUBLIC_FW_ENV`** (opt-in fallback) | the FireWeave var — only when the user has no existing signal                                                                                    |

Then reconcile the source's **raw values** with the `FW_ENV_PROFILES` keys from Step 3a.
When they differ (e.g. the platform emits `production`/`preview` but FireWeave names the
environments `prod`/`uat`), `AskUserQuestion` to confirm the mapping and emit it as
`FW_ENV_ALIASES` (e.g. `{ production: 'prod', preview: 'uat' }`). When they already match,
leave `FW_ENV_ALIASES` empty (identity). Unknown values still fall through to the
`FW_ENV_PROFILES` miss → `isProd()` fallback + warn (unchanged).

On `--reinit`, re-confirm the source and regenerate the `// fw:env-source` block; never
overwrite a user-customised `readEnvSignal()` without surfacing the diff.

---

## Harness templates — where they live (Step 4)

**The harness is generated FROM FILES THAT SHIP WITH THIS SKILL. Read them; do
not write a harness from this prose.** The prose below tells you what to
_substitute_ into a template — it is not a description you can reconstruct a
harness from. Every harness this skill has ever shipped exists as a `.tpl` file
next to this `SKILL.md`.

**Resolve `harness/…` relative to the directory containing THIS `SKILL.md`** —
never relative to the target repo, and never relative to process cwd (which is
often `$HOME` or the plugin-bundle root, the same hazard `ensure_auth` carries a
`cwd` argument for). The `harness/` tree ships next to `SKILL.md` — it is part of
the skill, not a platform-source file you have to go find in
`packages/fw-plugins/`. Look there first, and if it is absent take the STOP below
rather than hunting: a bundle built before the asset-copy fix, or a copy taken at
file granularity, genuinely does not have it.

**This anchor covers the skill's OWN assets (`harness/**`) — not every path in
this document.** Plugin-level artifacts sit a level up, beside the skills dir,
not inside it: `hooks/rollout-build-gate.mjs` (see **Build-gate script**) is at
the PLUGIN root, so it resolves as `<dir of this SKILL.md>/../../hooks/`, and
each host relocates it again. Do not apply the skill-relative rule to it.

**Do not hardcode this skill's directory NAME.** Hosts rename it from the
frontmatter aliases — `initialise` on Claude Code and OpenCode, `fw-initialise`
on Cursor, `fw_initialise` on Codex. Use the directory you were loaded from;
where this document writes `initialise/` for readability, read it as "this
skill's own directory, whatever this host calls it".

| Surface     | Template dir         | Read → write (into the repo's `fireweave/` dir)                                                                                                                   |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `harness/ts-server/` | `fw-harness.ts.tpl` → `fireweave/fw-harness.ts`; `fw-providers.ts.tpl` → `fireweave/fw-providers.ts`; `fw-tracker.ts.tpl` → `fireweave/fw-tracker.ts`             |
| `web`       | `harness/web/`       | `fw-harness.ts.tpl` → `fireweave/fw-harness.ts`; `fw-providers.ts.tpl` → `fireweave/fw-providers.ts`; `fw-tracker.ts.tpl` → `fireweave/fw-tracker.ts`             |
| `python`    | `harness/python/`    | `fw_harness.py.tpl` → `fireweave/fw_harness.py`; `fw_providers.py.tpl` → `fireweave/fw_providers.py`; `fw_tracker.py.tpl` → `fireweave/fw_tracker.py`             |
| `java`      | `harness/java/`      | `FwHarness.java.tpl` → `fireweave/FwHarness.java`; `FwProviders.java.tpl` → `fireweave/FwProviders.java`; `FwTracker.java.tpl` → `fireweave/FwTracker.java`       |
| `swift`     | `harness/swift/`     | `FwHarness.swift.tpl` → `fireweave/FwHarness.swift`; `FwProviders.swift.tpl` → `fireweave/FwProviders.swift`; `FwTracker.swift.tpl` → `fireweave/FwTracker.swift` |
| `go`        | `harness/go/`        | `fw_harness.go.tpl` → `fireweave/fw_harness.go`; `fw_providers.go.tpl` → `fireweave/fw_providers.go`; `fw_tracker.go.tpl` → `fireweave/fw_tracker.go`             |
| `rust`      | `harness/rust/`      | `fw_harness.rs.tpl` → `fireweave/fw_harness.rs`; `fw_providers.rs.tpl` → `fireweave/fw_providers.rs`; `fw_tracker.rs.tpl` → `fireweave/fw_tracker.rs`             |

`.tpl` is stripped on write; the basename is otherwise preserved (Python's
snake_case and Java's PascalCase names are already correct in the template
filenames — see the **Python surface** / **Java surface** sections below; for
Java, `fireweave/` is the `<base package>.fireweave` package directory and the
templates' `package fireweave;` line is rewritten to match). Two files have
**no** template and are authored by their own
step: `fireweave/__init__.py` for Python, and the `fw-tracker` const tree for
`ts-server` / `web` (Step 5 — an empty tree, not a copy of the Python tracker).

**HARD — the split is two files per TS surface, not one.** `fw-harness.ts`
imports `makeConnectedVendorProvider` and `makeDevProvider` from
`./fw-providers`; a harness written as a single file does not resolve its own
imports. That is the whole reason — do not reach for others. A platform-source test pins
the split for both TS surfaces (it does not ship in any host bundle, so do not go
looking for it here) — if you are about to write one file for a `ts-server` or
`web` surface, you have skipped the template.

**Read every `.tpl` you are about to emit, in full, BEFORE writing the first
file.** Then substitute — and substitute only. **The placeholders below live in
the `fw-harness` templates only**; `fw-providers.*` and `fw_tracker.py` carry
none and are written through unchanged, so "nothing to substitute" is the
expected outcome for those files, not a sign you are reading the wrong one:

- `FW_ENV_PROFILES` rows + `FW_DEFAULT_ENV` — regenerate from Step 3a's env→tier
  profile. The template's `development`/`staging`/`production` rows are
  placeholders; shipping them unchanged is a wrong-environment harness.
- the `// fw:env-source` region (`# fw:env-source` in Python; `// fw:env-source`
  in Java) — `readEnvSignal()`
  - `FW_ENV_ALIASES` from the Step 3d answer.
- Java only: the `package fireweave;` line — rewrite to the app's
  `<base package>.fireweave` and place the files in the matching directory.
- the prod branch, per Step 3b: the connected vendor's flag provider. **This one
  has no placeholder token** — it lives inside `makeConnectedVendorProvider()` in
  the providers template, so there is nothing to grep for.
  **Telemetry is NOT part of this substitution.** FireWeave does not wire an
  observability SDK into a repo, so there is no exporter branch to hand-wire and
  no `signals` to fill: the templates carry no telemetry initialisation at all,
  and `harness-templates.test.ts` asserts they never gain any. What Step 3b's
  observability descriptor is for is the QUERY leg — how fw-server reads a
  guardrail metric back out during a ramp — not an export FireWeave writes.

Everything else in the template — the `isProd()` fallback and
`makeConnectedVendorProvider()` — is load-bearing and pinned by tests. Do not re-derive, re-order, or "tidy" it, and
do not add attestation/beacon wiring: the templates are deliberately free of it
(deploy attestation is retired) and the template tests assert its absence.

**If `harness/` is missing or lacks the surface you need, STOP and say so.** That
is a stale or partial skill copy (C27), not a licence to improvise: a hand-written
harness passes no template test and drifts from every other repo the fleet
initialised. Ask the user to refresh the skill copies (`--reinit`, or re-copy from
the installed plugin bundle) and re-run.

---

## Python surface (Step 2 / 4 / 6 — flags prod-capable)

**Detect (Step 2).** A Python surface is present when the repo has `pyproject.toml`,
`setup.py`/`setup.cfg`, `requirements*.txt`, or a package of `*.py` under the source
root. Classify it as surface `python` — **prod-capable for flags** (`SURFACE_REGISTRY`
lists it with the `fireweave` vendor).

**Scaffold (Step 4).** Generate from `harness/python/` (all three `.tpl` files;
path resolved as in **Harness templates — where they live**) into a `fireweave/` package at
the idiomatic source root, using **snake_case module names** (Python cannot import
hyphenated modules): `fireweave/fw_harness.py`, `fireweave/fw_providers.py`,
`fireweave/fw_tracker.py`, plus `fireweave/__init__.py`. Regenerate `FW_ENV_PROFILES`

- `FW_DEFAULT_ENV` from Step 3a and the `# fw:env-source` block from Step 3d (Python
  reads `os.environ`; default `_read_env_signal` prefers `APP_ENV`/`ENVIRONMENT`/`ENV`,
  FW_ENV last). **Both branches are real and both come from the `fireweave` PyPI
  SDK:** dev binds `make_fireweave_local_provider(echo=True)`, prod binds
  `FireweaveProvider(FireweaveRuntime(FireweaveRemoteAdapter()))`. The adapter reads
  `FW_API_URL` + `FW_PROJECT_API_KEY` from `os.environ` itself, so there is nothing to
  plumb. Telemetry stays **console** on both tiers unless the operator wires a real
  OTLP exporter — a half-wired exporter looks configured and silently drops every
  span, which is worse than console.

**Wire the entrypoint (Step 6).** Inject `init_fw_harness()` as the FIRST statement
of the app's entrypoint — top of `if __name__ == "__main__":` for a script, or the
ASGI/WSGI **app factory** (e.g. `create_app()` before returning) / the module that
constructs the FastAPI/Flask/Django app. It is synchronous (no `await`). Record the
location in `project.json` `rolloutReady` (see harnesses[] below).

**Record (Step 9) — write the `harnesses[]` shape.** Persist this surface into
`project.json` `rolloutReady.harnesses[]` (the surface-keyed list read by the
`normalizeHarnesses` shim), e.g. `{ "surface": "python", "path":
"fireweave/fw_harness.py", "entrypoint": "<detected entrypoint>" }`. Keep writing the
legacy singular `harnessEntrypoint`/`webHarnessEntrypoint` fields for a ts-server/web
surface too until the contract phase; on `--reinit`, lazily upgrade an existing legacy
`project.json` to include `harnesses[]` (never drop the legacy fields — the shim and
the golden backward-compat test depend on them).

---

## Java surface (Step 2 / 4 / 6 — flags prod-capable)

**Detect (Step 2).** A Java surface is present when the repo has `pom.xml`,
`build.gradle`/`build.gradle.kts`/`settings.gradle*`, or `*.java` sources under
`src/main/java/`. Classify it as surface `java` — **prod-capable for flags**
(`SURFACE_REGISTRY` lists it with the `fireweave` vendor, on the `ai.fireweave`
Maven SDK). Kotlin (`.kt`/`.kts`) is NOT this surface — it stays an ungoverned
scan extension pending its own surface decision.

**Scaffold (Step 4).** Generate from `harness/java/` (all three `.tpl` files;
path resolved as in **Harness templates — where they live**) into the app's
`<base package>.fireweave` package: `FwHarness.java`, `FwProviders.java`,
`FwTracker.java` — **PascalCase class-per-file names** (Java requires the public
class name to match the filename, and the directory to match the package;
rewrite the templates' `package fireweave;` line to the real package).
Regenerate `FW_ENV_PROFILES` + `FW_DEFAULT_ENV` from Step 3a and the
`// fw:env-source` block from Step 3d (default `readEnvSignal()` prefers
`APP_ENV`/`ENVIRONMENT`/`ENV`, `FW_ENV` last; a Spring app usually reads
`SPRING_PROFILES_ACTIVE`). **Both branches are real and both go through ONE
entry point:** `Fireweave.init(InitOptions.builder(Mode.LOCAL)…build())` for dev,
`Fireweave.init(InitOptions.builder(Mode.REMOTE)…build())` for prod — same call,
one enum apart, so the tiers cannot skew. **The Java SDK reads no environment itself** — `FwProviders`
resolves `FW_API_URL` + `FW_PROJECT_API_KEY`, refuses loudly when either is
missing, and passes `allowedHosts` derived from the configured URL (without it a
self-hosted fw-server fails init against the canonical allowlist); do not
"simplify" that resolution away. Telemetry: the Java SDK carries no OTel
dependency — console-free by default; wire `io.opentelemetry` only as a real,
fully-configured exporter, never half-wired. Never scaffold
`fireweave-openfeature` or `fireweave-adapter-posthog`: both are pre-v1
coordinates that still resolve from Maven Central forever (artifacts are
immutable) but are gone from the source tree — a build file naming either one
compiles against the retired surface.

**Wire the entrypoint (Step 6).** Call `FwHarness.initFwHarness()` as the FIRST
statement of `main(String[] args)` — or, for Spring Boot, before
`SpringApplication.run(...)` in the bootstrap class — so the provider is bound
before any flag read. It is synchronous (no `await`; `verify_prod_path`'s java
token row greps for the bare call). Anchor flag call sites with
`// @fireweave-controlpoint <key>`.

**Record (Step 9) — write the `harnesses[]` shape.** Persist this surface into
`project.json` `rolloutReady.harnesses[]`, e.g. `{ "surface": "java", "path":
"src/main/java/<base-path>/fireweave/FwHarness.java", "entrypoint": "<main
class path>" }`. Java has NO legacy singular fallback in `harnessEntrypointFor`
— the `harnesses[]` entry is the only place its entrypoint can be recorded.

---

## Swift surface (Step 2 / 4 / 6 — iOS, prod-capable)

**Detect (Step 2).** A Swift surface is present when the repo has
`Package.swift`, an `*.xcodeproj`/`*.xcworkspace`, or `*.swift` sources.
Classify it as surface `swift`.

**Prod-capable** on the Swift SDK's remote adapter → fw-server
`/v1/flags/evaluate`. SwiftPM resolves a git URL + tag directly, so
`swift/v*` on the SDK repo IS the installable release — no package-index entry
is required. Pin it with `.package(url:, from:)` in `Package.swift`, or the
equivalent Xcode package dependency.

**Credentials are BUILD-BAKED, not environment-read.** This is the one thing to
get right on iOS and the reason the surface is not simply "server with different
syntax". A shipped app has no process environment: `ProcessInfo.environment` is
populated by an Xcode _scheme_, so it exists in the simulator and is **empty on
a device**. A harness that resolved its tier from env vars would classify every
TestFlight and App Store build as `development`, bring the SDK up in local mode,
and serve every control point its caller default — with a clean log and a green
launch, indistinguishable from a rollout nobody started.

So the scaffolded harness reads **Info.plist first**, env only as a
dev/simulator override:

| Info.plist key    | Meaning                                   |
| ----------------- | ----------------------------------------- |
| `FWEnvironment`   | environment NAME (keys `FW_ENV_PROFILES`) |
| `FWProjectApiKey` | project ingest key                        |
| `FWApiUrl`        | fw-server base URL                        |

Populate them from your build configuration (`$(FW_ENVIRONMENT)` etc. in an
xcconfig) so each build carries its own tier. `makeConnectedVendorProvider()`
**throws** when either credential is missing — a prod-tier build must fail
loudly rather than degrade to local evaluation.

**Reads are SYNCHRONOUS** (the SDK prefetches a decision cache at boot), so they
are safe on the main actor. `initFwHarness()` is async — await it from a `Task`
in your bootstrap before the first read.

### Go surface

**Prod-capable** on the Go SDK's remote adapter → fw-server
`/v1/flags/evaluate`. Go modules resolve from VCS tags rather than a registry,
so `sdks/go/v*` on the SDK repo IS the installable release — `go get
github.com/FireWeave-HQ/fireweave-sdk/sdks/go@<tag>` resolves through
proxy.golang.org. Only prerelease tags exist today; pin the exact one and let
the sdk-channel record it as a prerelease rather than rounding it to `stable`.

**Scaffold (Step 4).** Generate from `harness/go/` (all three `.tpl` files) into the
repo's `fireweave/` package directory. Go exports are initial-capital, so the
harness spells the tier decision `IsProd()` / `MakeConnectedVendorProvider()` —
`verify_prod_path` greps those capitalised tokens, not the TS ones. Reads:

```go
// @fireweave-controlpoint <feature-slug>
if GetFwClient().ControlPoints().GetBooleanValue(
    "<feature-slug>", false, fireweave.NewEvaluationContext(userID, nil)) {
}
```

`InitFwHarness()` is synchronous — call it first in `main()` and fail the
process on a non-nil error.

### Rust surface

**Prod-capable** on the `fireweave` crate's remote adapter. **Release gate: the
crate is not on crates.io yet.** The surface may be scaffolded and verified now,
and MUST NOT ship to a customer until the crate is genuinely installable —
treat it exactly like the fw-plugins bundle gate.

**Scaffold (Step 4).** Generate from `harness/rust/` (all three `.tpl` files) into the
crate's `fireweave/` module. Rust is snake_case like python: `is_prod()`,
`make_connected_vendor_provider()`, `init_fw_harness()`. Reads:

```rust
// @fireweave-controlpoint <feature-slug>
if get_fw_client().control_points.get_boolean_value("<feature-slug>", false, Some(&ctx)) {
}
```

`init_fw_harness()` is synchronous and returns `Result<(), FireweaveError>` —
call it first in `main()` and propagate the error.

**Scaffold (Step 4).** Generate from `harness/swift/` (all three `.tpl` files)
into the app's `fireweave/` directory: `FwHarness.swift`, `FwProviders.swift`,
`FwTracker.swift`. Add the SDK as a SwiftPM dependency on the `Fireweave`
product from the SDK repository, pinned to a **revision** — there is no released
version to pin, which is the same fact that makes this surface dev-only.
Regenerate `FW_ENV_PROFILES` + `FW_DEFAULT_ENV` from Step 3a and the
`// fw:env-source` block from Step 3d. **Only the dev branch is wired:**
`makeDevProvider()` brings the SDK up in local mode through `initFireweave`, and
`makeConnectedVendorProvider()` **throws**. Leave the throw exactly as
scaffolded — a stub that returned a local client instead would false-green any
prod check that reached it, which is strictly worse than a loud refusal. When a
real tagged release lands, flip `SURFACE_REGISTRY.swift.prodProviderVendors` to
`FIREWEAVE_ONLY` and replace that body in the same change.

**Wire the entrypoint (Step 6).** `await FwHarness.initFwHarness()` first in the
app's bootstrap, before the first read — from a `Task { }` where the bootstrap is
not itself async. Reads are SYNCHRONOUS (`FwProviders.getFwClient().controlPoints.getBooleanValue(key, default: false,
targetingKey:)`), safe on the main actor, because the SDK prefetches a decision
cache at boot. Anchor call sites with `// @fireweave-controlpoint <key>`.

**Record (Step 9).** Persist into `project.json` `rolloutReady.harnesses[]`,
e.g. `{ "surface": "swift", "path": "Sources/<Target>/fireweave/FwHarness.swift",
"entrypoint": "<app entry file>" }`.

---

## Credential env canon (Step 3 + Step 9)

Fireweave remote flag-eval credential env names differ by harness surface (apps call fw-server `/v1/flags/evaluate`, never PostHog directly). Initialise must keep **`.env.example`**, **`project.json`**, and **each manifest's `harness.rolloutCredentialEnv`** aligned. Seal still provisions flags on FireWeave-managed PostHog server-side — keep `flagTelemetryProvider: "connected:posthog"` for control-plane wiring.

| Surface     | `harness.rolloutCredentialEnv` | Host env                                              | `project.json` field                   |
| ----------- | ------------------------------ | ----------------------------------------------------- | -------------------------------------- |
| `ts-server` | `FW_PROJECT_API_KEY`           | `FW_API_URL` (fallback `FW_ATTEST_URL`)               | `rolloutReady.rolloutCredentialEnv`    |
| `web`       | `PUBLIC_FW_PROJECT_API_KEY`    | `PUBLIC_FW_API_URL` (fallback `PUBLIC_FW_ATTEST_URL`) | `rolloutReady.webRolloutCredentialEnv` |
| `python`    | `FW_PROJECT_API_KEY`           | `FW_API_URL`                                          | per-surface entry in `harnesses[]`     |
| `java`      | `FW_PROJECT_API_KEY`           | `FW_API_URL`                                          | per-surface entry in `harnesses[]`     |
| `swift`     | `FW_PROJECT_API_KEY`           | `FW_API_URL`                                          | per-surface entry in `harnesses[]`     |

The `FW_ATTEST_URL` fallbacks are **legacy names, read but never written.**
Nothing emits them any more; harnesses read `FW_API_URL` first and fall back
only for repos scaffolded before the rename, warning once at boot when the
fallback fires so the deploy environment eventually gets renamed. Never scaffold
the legacy spelling into a new repo. `record_rollout_env_contract` appends all required names to `.env.example` when `apiSurface` / `webSurface` are set, and writes them into `fireweave.md`; for a `python` or `java` surface pass `apiSurface: true` (they use the server pair). **Do not** use a single env name across both TS surfaces — `verify_prod_path` checks the manifest's surface-specific name.

On `--reinit`, resolve every feature's manifest **through the seam** and re-author it with `mcp__rollout-server__upsert_rollout_manifest` (passing the resolved `contentHash` as `baseContentHash`) where `harness.rolloutCredentialEnv` does not match the surface row above. Do **not** patch manifest files in place: there is no manifest file — fw-server holds the row, and anything you write into `.fireweave/rollout-ready/` is a contract no gate, no teammate and no ramp coordinator will ever read. A `conflict` result means a teammate moved the row — re-apply on top of `current` and retry with `baseContentHash = currentContentHash`; never retry with a null base.

---

## API Docker build (Step 4 — ts-server `.mjs` harness)

When the API harness lives under `src/fireweave/*.mjs` (compiled from TypeScript), the package `build` script must copy those files into `dist/` after `tsc`. Without this, Docker images ship without the harness.

Patch `packages/api/package.json` (or the detected API package) `scripts.build`:

```json
"build": "tsc && mkdir -p dist/fireweave && cp src/fireweave/*.mjs dist/fireweave/"
```

Record the patched `package.json` path in `installedInto[]` when changed.

---

## Cohort identity wiring (Step 6b) — always-on, never flag-gated

Manifests declare `context.targetingKey: "userId"` and upstream `%` ramps hash that
subject id. The code that supplies it — `identify` on auth, `reset` on sign-out, the
`targetingKey` carried in the evaluation context, and the cache re-prefetch that
follows each — is the **precondition** for flag evaluation, not a feature of it.

**Never place it behind a FireWeave flag (INIT-S8).** It deadlocks: the flag evaluates
with no targeting key, RAMP-1 makes the safe default `false`, the bind never runs, and
the key never arrives. The ramp then shows 0% adoption, so it reads as a product
failure instead of a wiring bug.

At init:

1. **Locate the identity seam.** Run `mcp__rollout-server__detect_surfaces` with
   `{ includeAuthSeams: true }` — it returns candidates per surface with file, line, the
   token that matched (`signIn()`, `onAuthStateChanged`, `req.user`, `better-auth`, …) and
   whether the token implies the client or server plane. It **over-reports on purpose**:
   an extra row costs the user a glance, while a MISSED seam means `syncFireweaveUser` /
   `registerFwTarget` never gets wired and every rule on a durable property matches
   nobody — silently, because a rule matching nobody looks exactly like a rule nobody
   triggered. `truncated: true` means the scan hit its file cap: say so rather than
   reporting "no seam found", which is a different claim. Candidates are a SHORT LIST to
   ask about, never an answer — still ask with `AskUserQuestion`; do not guess.
2. **Assert it is unconditional.** The bind must not sit inside an `if` / `while` / `switch`
   on a flag, a ternary or `&&` on a flag, a `if (!flag) return` guard clause above it, a
   same-file helper whose _call_ is flag-gated, or under a `// @fireweave-controlpoint` anchor.
   `mcp__rollout-server__assert_dev_checklist` blocks these shapes on every feature — fix
   at init rather than leaving it for the first ship. **Known limits (still escapes):**
   cross-file / imported helpers, multi-hop wrappers (`wrap → doIdentify → identify`),
   dynamic/computed callees (`fns[name]()`), object-literal helpers (`const helpers = {
doBind: () => identify() }` — same-file function/arrow/method/class-property helpers
   and one-hop flag helpers _are_ covered), and full Svelte template AST (only `<script>`
   bodies are AST-scanned; `{#if}` / `on:click` handlers get a soft warn when the
   condition looks flag-bound — not a hard block). Non-TS/JS surfaces (Go/Python/Java/
   Dart/Vue/Astro/…) are skipped with an info finding, not silently. Keep identity
   binds direct and same-module.
3. **Never scaffold the anti-pattern.** Any identity code initialise writes is emitted
   unconditionally. Harness templates deliberately contain no flag-gated identity call;
   keep it that way on `--reinit`.
4. **Gate the consumer, not the bind.** A new _identity strategy_ still ships flag-free;
   if you must compare two strategies, flag the feature that reads the identity and keep
   both binds always-on.

Record the identity module in `installedInto[]` when initialise writes or edits it, and
carry the contract into `.fireweave/agent-instructions.md` (**Cohort identity** section
of the template below) so feature agents inherit it.

The INIT-S8 checklist gate ships with the FireWeave plugin publish — standing
`.cursor/skills` copies refresh via `/fireweave:adopt` / `--reinit` from the installed
bundle (dogfood sync on the PR is not a substitute for publish).

---

## Agent instructions template

Write `.fireweave/agent-instructions.md` using repo-specific paths from Step 4–6. It MUST include these sections:

### Rollout-ready layout

Table of harness paths, `fw-tracker` (and its `FW_STAMPS` line), `PROVIDERS.md`, and a
row stating that **rollout-ready manifests and change stamps are server-owned** —
reached through `mcp__rollout-server__upsert_rollout_manifest` and the resolution
seam, with no directory under `.fireweave/` to read or write. List the gitignored
runtime paths (`.cache/` projection, `.queue/` unsynced author state, `.lock`) and
state that `.queue/` must never be deleted to clear a warning.

### How to emit a metric — one section PER SURFACE

**Derived by READING the repo at init.** Not by asking the user, and not by
assuming a convention. For each surface in `surfaces[]`, find how metrics are
already emitted in that codebase and write it down. Record the client you found
as `surfaces[].metricsClient` in the same pass — same investigation, two
outputs, and splitting them means doing the investigation twice.

**The section has TWO halves, and the second is the one that saves work.**

_How to ADD a metric here_ — the syntax, listed below.

_What this surface ALREADY emits_ — an inventory of the metric names in use,
where each is emitted, and what it measures. At change time this is consulted
FIRST: a signal the app already has needs no new code, has months of history
behind it, and can therefore carry a threshold derived from a real baseline
rather than a guess. A metric written fresh has none of that on its first
rollout.

This inventory has no other source. Every `observability.query.*` capability
takes a metric NAME — nothing lists what exists — so the repo is the only place
to learn it, and the only time anyone reads the repo for this purpose is here.
Skip it and every future change re-derives it, badly, from whichever files that
change happened to touch.

This section answers **"how do I emit here"**. It must NOT answer "what should I
measure" — that is the `changeType` rubric in the **Manifest contract** section,
and it needs the change in front of it. Keeping the two apart is the point: an
agent that knows what to measure but not how to write it here still guesses, and
a guess that compiles still produces a metric the ramp cannot query.

Each surface's section carries, in this order:

1. **The client, and the exact import line as it appears in this repo** — copied
   from a real file, not reconstructed from memory of the library.
2. **The call shape for a counter and for a histogram/timing.**
3. **Where the instrument comes from** — a module singleton? injected? a factory
   called per request? This is the part an agent gets wrong most often, because
   the library docs and the repo rarely agree.
4. **One REAL example lifted from the repo, with its file path cited.** Never an
   invented one. A cited example is checkable; a plausible one is not.
5. **Any local wrapper the codebase prefers** over the raw client — if the repo
   has `lib/metrics.ts`, the answer is that, not the vendor SDK underneath it.
6. **The tag / label convention already in use** — including which dimension
   carries the cohort key, since that is what makes a rollout comparison
   possible at all.

**When the repo emits no metrics today, say exactly that.** Name it as a
decision the first feature has to make, and record `"metricsClient": "none"`. Do
NOT invent a convention and do not silently pick a client: a playbook that
confidently describes a pattern the repo does not have is worse than an absent
one, because the agent will follow it. `"none"` is a finding; an ABSENT
`metricsClient` means nobody looked, and the two must not be conflated.

Every feature change reads its surface's section **before writing an emit
call** — the dev-loop HARD ORDER below points at it. It pairs with
`assert_dev_checklist`, which already hard-fails a declared metric with no emit
site: that gate says a metric is missing, and this section is how the agent adds
it correctly instead of guessing at the syntax.

`--reinit` regenerates these sections, and a surface added later gets its own.

### Does this task qualify? — classify BEFORE step 1

A hook fires this reminder on a keyword match (`add|implement|feature|fix|ship|
build|wrap|change|refactor|rollout|flag`). That regex is a cheap outer filter and
it is **not** the decision: it cannot tell `fix the checkout bug` from `how do I
fix this typo in the README`, because both contain `fix`. You can. Classify the
task first, in one line, and say which class you chose:

| Class          | What it looks like                                                              | Run the package?                                  |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| **change**     | you will modify runtime behaviour a user or caller can observe                  | **YES** — steps 1–4 below                         |
| **inquiry**    | explain, locate, summarise, review, "how does X work"                           | no                                                |
| **brainstorm** | weigh options, plan, design — nothing is being written yet                      | no — but re-classify the moment you start writing |
| **infra-only** | CI config, lockfiles, docs, formatting, test-only edits with no behaviour delta | no                                                |

**The two errors are not symmetric, and the rubric is shaped around that.**
Running the package on an inquiry costs a few tool calls and a puzzled user.
Skipping it on a real change ships unflagged behaviour — no manifest, no anchor,
no stamp — and that is invisible until `/fireweave:safe-rollout` has nothing to
promote, or worse, until it promotes something nobody can ramp back. So when the
class is genuinely unclear, **treat it as `change`**; do not ask permission to
skip. Only skip on a class you can name.

Two traps worth naming, because both read as `infra-only` and are not:

- **A test-only edit that changes a default.** Flipping a fixture is infra;
  flipping the value a call site passes is a change wearing a test's clothes.
- **A refactor that moves an evaluation site.** The behaviour is identical and
  the anchor is not — a moved `// @fireweave-controlpoint` still has to travel with its
  manifest, or `reconcile` reports an orphan on the next build.

Re-classify when the task turns. A session that starts as `brainstorm` and ends
with an edit is a `change` from the first line of code, not from the next prompt.

### Every feature change (dev — before `/fw-rollout`) — HARD ORDER

**Backfill after coding is NOT the client path.** If you implement first and author the
manifest later, `/fw-rollout` and clients cannot rely on promote-not-wrap. That applies to
the manifest's IDENTITY — flags and wrap points, which you decide up front and encode as you
write. It does not apply to `telemetry.metrics`: those are a judgement about a branch that
does not exist at step 1, so the set is filled in AT each control point and recorded when the
change is done. `metrics: []` at first author is valid and is the honest state there.

1. **FIRST** — author the rollout-ready manifest with `mcp__rollout-server__upsert_rollout_manifest` `{ feature, manifest, baseContentHash }` (build the manifest from the **Manifest contract** below). **FireWeave stores it — do not write a manifest file yourself.** `baseContentHash` is required and nullable: `null` asserts "no row exists yet"; otherwise pass the `contentHash` of the row you read. There is no omit-the-base path — omitting a base is last-writer-wins, and last-writer-wins silently erases a teammate's guardrail metric. On `outcome: 'conflict'`, re-apply your change on top of the returned `current` and retry with `baseContentHash = currentContentHash`. On `outcome: 'queued'`, fw-server did not answer: the edit is safe in `.fireweave/.queue/` and will replay, but **shipping is blocked until it drains** and no teammate can see it. Mint `chg_<ULID>` + `stmp_<ULID>` (the `chg_`/`stmp_` prefixes are hard-enforced by `build_register_rollout_from_manifest` at ship time; a date-slug fails registration). Apply the stamp policy: per-surface stamps by default (append each stamp ONLY to its own surface's `FW_STAMPS`); one shared stamp is allowed only when the change is single-project and every participating surface's harness is surface-aware. **`FW_STAMPS` is the one line FireWeave still writes into your repo** — the stamp record itself lives in `change_stamps` server-side.

   **Absence has names — only one means _author it now_.** If a read reports no manifest, the tools return an `absence`: `never-authored` (author it), `not-fetched` (run `fw sync` — this worktree has no projection, so absent is not evidence), `not-authorized` (the manifests are **withheld**, not absent — `fw login` or ask an admin), `server-unavailable` (retry), `queued` (you already authored it; drain the queue). **Never author a manifest to clear any of the last four** — you would be displacing a contract you cannot currently see.

2. Gate behavior behind a control point via the harness (`fw.controlPoints.getBooleanValue(key, false, ctx)`) — not legacy direct vendor SDK calls. Add `// @fireweave-controlpoint <key>` at every evaluation site **while writing code**. Eval-site default MUST be `false` (RAMP-1). If you need the feature **on locally** for dogfood, set that key in the surface's `makeDevProvider()` `devFlags` — never `fw.controlPoints.getBooleanValue(key, true)`.
3. **At each control point, as you write it, decide that control point's signals.** Not before — a metric chosen before the branch exists is a guess about how code you have not written will fail. Not after — a separate analysis pass is a pass that gets skipped, and it happens when the context is coldest. At the anchor the knowledge is already in front of you and the decision costs nothing extra.

   **Ask two questions of THIS branch.** _Stability:_ name the failure mode — not "it could break" but "the new cache can serve a stale price" — then name the signal that moves when it does. Prefer errors split by class (a 5xx surge and a 4xx surge mean opposite things), a latency QUANTILE (p95/p99, never a mean — a tail cannot move a mean), and a saturation/throughput signal when the change alters resource shape. _Adoption:_ only when the change is user-observable — reach, or completion of the flow it improves. For a refactor or an infra change **"none" is the right answer**, and a fabricated adoption metric is worse than an absent one because it makes the manifest look complete.

   **Then resolve each signal, one of three ways — and a set is normally a MIX:**
   - **Reuse.** The app already emits something that would move. Declare it with `provenance: "existing"` and **write no code**. This is the preferred answer: it needs no review, and a metric the app has emitted for months has real history behind it, so its threshold can come from an observed baseline rather than a guess.
   - **Add.** Nothing covers it. Write the emit call **in the same edit as the branch it observes**, using this surface's own client — **read this surface's section under _How to emit a metric_ FIRST**; it names the client, the exact import line, and where the instrument comes from, all read out of this repo at init. Do not reconstruct the call shape from library docs: the repo and the docs rarely agree, and a call that compiles against the wrong instrument produces a metric the ramp cannot query. Declare it `provenance: "added"`. A metric written by this change has **no baseline on its first rollout**, so leave `threshold` off and let it be observe-only until it earns one.
   - **Park.** The change can fail, no signal would show it, and none can be added because this surface initialises no telemetry. Say so and stop. Do not invent a metric to fill the field.

   **Every control point owes an answer.** A flag is answered when some metric's `guards` names it, or when `flags[].noSignalNeeded = { reason }` says why none is needed. "Nothing to measure here" is legitimate for a refactor; not having looked is not, and an empty metric list cannot tell them apart.

4. **Amend the manifest with what you decided** — the same `upsert_rollout_manifest`, `baseContentHash` set to the `contentHash` of the row you authored in step 1. A record of decisions already made, not a fresh investigation.
5. **BEFORE calling the task done** — run `mcp__rollout-server__assert_dev_checklist` with `{ feature }`. **PARK on any block.** The checklist hard-fails a declared metric nothing emits: for `provenance: "added"` the name must appear in a wrap-point file; for `"existing"` it must be emitted somewhere under `sourceRoots`. Also run `detect_rollout_ready` + `reconcile` phase `build`.
6. Do NOT open a PR / declare done until `assert_dev_checklist.pass === true`.

### Do not

- Swap providers at promotion time.
- Route telemetry through FireWeave (OTLP direct to bound vendor).
- Delete `fw-tracker` stamps without `/fw-cleanup`.
- Write repo-local `mcp/rollout-server/` when using the Cursor FireWeave plugin.
- Finish feature code without a matching rollout-ready package (no backfill).
- Use `fw.controlPoints.getBooleanValue(key, true)` / `default: true` to make a feature work on your laptop — that same `true` is what prod serves when the provider flag is missing. Local ON → `devFlags` only.
- Gate identity wiring behind a feature flag — `identify` / `reset` / the targeting-key bind are the precondition for flag evaluation, never a feature of it (INIT-S8; `assert_dev_checklist` blocks it).
- Rely on INIT-S8 for full Svelte template AST — only `<script>` bodies are AST-scanned; `{#if}` / `on:click` identity handlers are soft-warn only. Other known limits: cross-file helpers, multi-hop wrappers, dynamic/computed callees, object-literal helpers.

### Cohort identity (always-on — never behind a flag)

State the repo's identity contract per surface, with concrete symbols and call sites from Step 6b:

| Surface    | Contract                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web**    | After auth: bind the subject (`reloadFireweaveFlags(user.id)`, or `identify(user.id)` + reload for a direct-vendor harness). On sign-out / 401: reset + reload so the next person does not inherit the previous bucket. |
| **Server** | Every `fw.controlPoints.getBooleanValue(...)` passes `{ targetingKey }` — the session user when there is one, otherwise a stable fallback. Missing targeting key → the provider returns the safe default (`false`).     |

**The bind is unconditional.** Manifests declare `context.targetingKey: "userId"`, and upstream `%` ramps hash that subject id — if it rotates every visit, every session looks like a new user and no flag ever sticks. Gating the bind on a flag deadlocks: the flag evaluates with no targeting key, RAMP-1 makes the safe default `false`, so the bind never runs and the key never arrives. It fails silently as 0% adoption, which reads as a product problem rather than a wiring bug. Gate the feature that _uses_ the identity; never the bind itself.

### Deriving `telemetry.metrics` — a rubric, not a generator

`assert_dev_checklist` hard-fails a metric declared with no emit site, so the
question is never "what could we measure" but "what will this change actually
move, and what would tell us it moved the wrong way". Derive from the change
type; do not reach for `propose_metrics` — it is a keyword heuristic carrying a
deprecation label, and the wired server really does serve it, so a plausible-
looking answer comes back and gets copied.

| `changeType`  | Adoption — is it being used?                       | Stability — is it hurting?                                                                                |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `new-feature` | reach: distinct subjects that hit the new path     | error rate + latency on the ENCLOSING request, not the new path alone                                     |
| `enhancement` | completion rate of the flow it improves            | the same flow's error rate; the old path's rate as the comparison                                         |
| `bugfix`      | occurrences of the fixed fault (should fall to ~0) | regression signal on the surrounding operation — a fix that trades one fault for another                  |
| `performance` | share of traffic on the fast path                  | the metric you claim to improve **plus** one you might be trading against (latency vs memory, p50 vs p99) |
| `refactor`    | usually NONE — nothing user-visible moves          | error rate + latency on the touched path, unchanged is the success condition                              |
| `infra`       | none                                               | the deploy's own health signal; if you cannot name one, this probably is not a rollout                    |

Two rules that matter more than the table:

**A metric with no baseline is not a guardrail.** "Error rate < 1%" is a wish if
nobody knows today's rate. Either read the current value and set the threshold
against it, or declare the metric as observe-only and say so — a threshold
invented at authoring time fires on normal traffic and trains everyone to ignore
the ramp.

**When there is no prior baseline, compare the two sides instead of the past.**
A new cache has no yesterday to compare to. Do not wait a week for one: emit the
metric dimensioned so the flag's own cohorts are comparable — cache-hit vs
cache-miss latency, new-path vs old-path error rate — and read the DIFFERENCE.
The ramp itself supplies the control group, which is the one thing a
before/after comparison over a deploy boundary can never give you.

**One error rate is rarely enough.** "Errors went up" is not a decision — a
5xx surge and a 4xx surge mean opposite things, and a rollout that rolls back on
the second has rolled back on users being told "no" correctly. Aim for a SET
that can distinguish outcomes, sized to the change:

| Signal                   | What it catches                                                                  | Typical role                        |
| ------------------------ | -------------------------------------------------------------------------------- | ----------------------------------- |
| server errors            | the change is broken                                                             | `guardrail`, `up-bad`, `rollback`   |
| client errors            | the change rejects work it used to accept                                        | `guardrail`, `up-bad`, `pause-ramp` |
| a latency quantile       | the change is slow, not broken — p95/p99, never a mean, which a tail cannot move | `guardrail`, `up-bad`, `pause-ramp` |
| saturation or throughput | the change costs more than it earns — queue depth, CPU, RPS                      | `guardrail`, `up-bad`, `pause-ramp` |
| adoption                 | anyone is actually on the new path                                               | `adoption`, `up-good`               |

Take every name from what the app ALREADY emits — read the codebase, not this
table. A signal you have to invent is a signal nobody is watching today, and
declaring it makes the manifest look better without making the release safer.

**Severity is the decision, not the description.** `page` rolls the release
back; `warn` holds it for a person; `info` is recorded and acted on by nothing.
A guardrail set entirely to `info` reads like a safety net and is decoration —
the ramp will advance straight through it. If a signal is not worth stopping
for, say so by leaving it `adoption`, rather than by giving it a severity that
does nothing.

**`complexity` is yours to set, and nothing gates on it.** `low|medium|high` is
the author's blast-radius judgement, recorded because `changeType` cannot carry
it: a `refactor` touching one template and a `refactor` touching the evaluation
path are the same enum member and very different risks. Omit it when you are not
sure — an absent field is honest, a guessed `low` is not.

### Manifest contract (the committed ship contract — copy, don't invent)

> **`telemetry.metrics` is the one block you must NOT copy.** Everything else
> below is structure; that array is a judgement, and it is made by the rubric
> above with the change in front of you. The single entry shown is a SHAPE —
> `role: "guardrail"`, `direction: "up-bad"`, and a `guard` block — not a
> starting point.
>
> Two things go wrong when it is copied instead of derived:
>
> - **The name.** A metric named for the feature slug exists in no customer's
>   telemetry. `assert_dev_checklist` hard-fails a declared metric with no emit
>   site, so copying one produces either a blocked dev loop or an emit call
>   written purely to satisfy the gate — telemetry that exists because a check
>   asked for it, measuring nothing anyone will read.
> - **The role.** `role: "adoption"` maps to `threshold: "n/a"` and severity
>   `info`. Both are inert: `n/a` is never crossed at any value, and `info` is
>   recorded and then acted on by nothing. An adoption metric is worth
>   declaring — it is what the dashboard charts — but a rollout whose ONLY
>   metrics are adoption cannot ramp unattended, and the readiness gate will
>   put it in manual and say so.

The `manifest` argument you pass to `upsert_rollout_manifest` must match this exact shape (validated by `RolloutReadyManifestSchema` **before** anything reaches the server or disk; `safe-rollout` resolves it to build the `RolloutSpec`). `manifest.feature` must equal the `feature` argument — the row is keyed by it. Every field below is load-bearing — start from this and swap the values. Invariants the schema enforces: every `wrapPoints[].flagKey` and `telemetry.metrics[].guards` must be a declared `flags[].key`; `telemetry.dimensions` must equal `context.dimensions` (the cohort seam); a `guardrail` metric needs an OTLP-metrics-capable destination (Grafana/Datadog — **PostHog cannot ingest OTLP metrics**), so keep adoption metrics as `role: "adoption"` unless you wire a metrics vendor.

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
      {
        "name": "<an error/latency metric this app ALREADY emits>",
        "role": "guardrail",
        "direction": "up-bad",
        "guards": "<feature-slug>",
        "guard": { "breachSeverity": "page", "action": "rollback" }
      }
    ],
    "logs": [],
    "traces": [],
    "dimensions": []
  },
  "harness": {
    "surface": "ts-server",
    "path": "packages/api/src/fireweave/fw-harness.<ext>",
    "rolloutCredentialEnv": "FW_PROJECT_API_KEY",
    "posthogProjectId": "<prod-tier env's PostHog projectId>",
    "flags": {
      "api": "control-points",
      "sdk": "server",
      "devProvider": "in-memory",
      "rolloutProvider": "connected:fireweave"
    },
    "telemetry": {
      "api": "otel",
      "devExporter": "console",
      "rolloutTransport": "otlp",
      "semconv": "fireweave/rollout-otel-semconv-v1",
      "signals": {}
    }
  }
}
```

**`flags.api` is `"control-points"` on every NEW manifest.** The schema accepts
`"openfeature"` too and always will — manifests written before the v1 cutover are
already in the wild and must keep validating — but that value now describes a
harness on the retired surface. It is a widening, never a swap: do not rewrite an
existing manifest's `api` as a drive-by, and do not write `"openfeature"` on
anything new.

For a **web** surface use `harness.surface: "web"`, `flags.sdk: "web"`, `rolloutCredentialEnv: "PUBLIC_FW_PROJECT_API_KEY"`, and the web harness path. `harness.posthogProjectId` is the **prod-tier** environment's project id (the phantom-ramp guard compares it to what `flag.control` ramps — see **Credential env canon** and `project.json.rolloutReady.environments`).

**RAMP-1 — off until ramp:** boolean `flags[].default` MUST be `false`. Eval sites MUST use `fw.controlPoints.getBooleanValue(key, false, …)`. Prod-tier ON is the ramp (or an explicit PostHog kill-switch at 100%), never the call-site default.

**Local vs prod control (standard):** local dogfood ON → that surface's `makeDevProvider()` `devFlags: { '<key>': true }`; prod-tier → connected vendor via FireWeave; eval site + manifest always `false`. Never use `fw.controlPoints.getBooleanValue(key, true)` for "works on my laptop" — that is also the prod fallback when the provider flag is missing. Do not open new `ramp1Exception` entries; remediate legacy inverted kill-switches only via: create PostHog flag at 100% ON → verify serving → flip defaults to `false` → prove kill in staging.

### Ship

Run `/fw-rollout` only after `assert_dev_checklist` passes — it **promotes** rollout-ready work; it does not wrap code.

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

1. **FIRST** author the manifest with `mcp__rollout-server__upsert_rollout_manifest` `{ feature, manifest, baseContentHash }` (Manifest contract in agent-instructions) + mint `chg_`/`stmp_` + apply the stamp policy (per-surface stamps by default — append each stamp to its own surface's `FW_STAMPS`; one shared stamp only when single-project + every surface's harness is surface-aware). **FireWeave stores the manifest — do not write a manifest file yourself.**
2. Implement behind the harness control point (`fw.controlPoints.getBooleanValue(<key>, false, ctx)`) with `// @fireweave-controlpoint <key>` at each evaluation site.
3. **BEFORE done** call `mcp__rollout-server__assert_dev_checklist` with `{ feature }` — PARK on any block (includes dummy metrics with no emit sites). Also `reconcile` phase `build`.
4. Backfill after coding is forbidden. Do not write repo-local `mcp/`.
5. **Absence has names.** `never-authored` is the only one that means author a manifest. `not-fetched` → `fw sync`; `not-authorized` → the manifests are withheld, not absent (`fw login` / ask an admin); `server-unavailable` → retry; `queued` → you already authored it, drain `.fireweave/.queue/`. Never author to clear the last four.

## Ship path

`/fw-rollout` promotes existing rollout-ready work only. If `assert_dev_checklist` fails, finish the package first — there is no wrap-from-scratch path.
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

**Classify the task first, in one line:** `change` (you will modify observable
behaviour) · `inquiry` (explain / locate / review) · `brainstorm` (nothing written
yet) · `infra-only` (config, docs, formatting, no behaviour delta). Only `change`
runs the steps below. A keyword hook surfaced this reminder; it cannot tell
`fix the checkout bug` from `how do I fix this typo` — you can. **When the class
is genuinely unclear, treat it as `change`:** skipping wrongly ships unflagged
behaviour that is invisible until nothing can be promoted or rolled back, while
running wrongly costs a few tool calls. Re-classify the moment a brainstorm
starts writing code.

1. **FIRST** — author the rollout-ready manifest by calling
   `mcp__rollout-server__upsert_rollout_manifest` `{ feature, manifest, baseContentHash }`
   (Manifest contract in [.fireweave/agent-instructions.md](.fireweave/agent-instructions.md)).
   **FireWeave stores the manifest — do not write a manifest file yourself.**
   `baseContentHash` is required and nullable (`null` = "no row yet"); on `conflict`,
   re-apply on top of `current` and retry with `currentContentHash`. Mint
   `chg_<ULID>` + `stmp_<ULID>`, and apply the stamp policy — per-surface stamps by default (append each stamp ONLY to its own surface's `FW_STAMPS`); one shared stamp only when the change is single-project and every participating surface's harness is surface-aware.
2. Gate the new behavior behind the harness control point (`fw.controlPoints.getBooleanValue(<key>, false, ctx)`) and add
   `// @fireweave-controlpoint <key>` at each evaluation site **as you write it**.
3. **BEFORE calling the task done** — run `mcp__rollout-server__assert_dev_checklist`
   `{ feature }` (PARK on any block) + `detect_rollout_ready` + `reconcile` phase `build`.
4. Do **not** open a PR / declare done until `assert_dev_checklist.pass === true`.
   Ship only via `/fireweave:safe-rollout` (promotes; never wraps).
5. **Absence has names — only `never-authored` means author one.** `not-fetched` →
   run `fw sync`. `not-authorized` → the manifests are **withheld, not absent**;
   `fw login` or ask an org admin. `server-unavailable` → retry. `queued` → you
   already authored it and it is waiting in `.fireweave/.queue/`; drain it. Never
   author a manifest to clear any of those four — you would displace a contract you
   cannot currently see.

If a request looks like feature work and you have NOT done step 1, stop and do it
first. If you are unsure whether a change qualifies, it does — err toward wrapping.
```

The `🔴` and "HARD ORDER" framing are deliberate — they raise the block's salience above ordinary CLAUDE.md guidance so it survives a big, distracting feature prompt. Keep the "including internal/ops/observability wiring" clause: the most common miss is an agent deciding an ops/observability change "isn't a feature" and skipping the package.

---

## MCP wiring (Step 7b) — Cursor plugin only

**Host-scoped (same as Step 7b table):** set / clean `rolloutReady.mcp.mode = "cursor-plugin"` **only when this host is Cursor**. Writing Cursor rule/hooks/skills because `cursor` ∈ `teamAgents` on a non-Cursor host does **not** change MCP transport.

When **this host is Cursor**:

1. **HARD:** Use the **Cursor FireWeave plugin MCP** (`plugin-fireweave-rollout-server`). Confirm via `mcp__rollout-server__list_registered_tools`.
2. **Do NOT** create `mcp/rollout-server/` in the customer repo. **Do NOT** download `bin/server-*`. **Do NOT** write `.cursor/mcp.json` that points at `${workspaceFolder}/mcp/...`.
3. If `mcp/rollout-server/launcher.sh` or a workspace `.cursor/mcp.json` rollout-server launcher entry already exists → **delete them** and set `rolloutReady.mcp.mode = "cursor-plugin"`.
4. **Never** walk parents for `fireweaveai-platform`, **never** write `packages/fw-plugins/.../dist/server.js`, **never** inject `packages/fw-cli/bin` into `PATH`, and **never** set `rolloutMcpPlatformPath` in `project.json`.
5. Platform-engineer MCP dev (monorepo `dist/server.js`) is **out of scope** for `/initialise` — use `bun run dev:install` in `packages/fw-plugins`.

When this host is **not** Cursor: do **not** set `cursor-plugin` here. Non-Cursor hosts may use `fw mcp install` (`mcp.mode: "plugin-launcher"` or `"cli-install"`). That path must never be used for Cursor customer/dogfood initialise.

When copying FireWeave skills into `.cursor/skills/` (because `cursor` ∈ `teamAgents`), copy from the **installed plugin bundle only** — never from `packages/fw-plugins/` platform source.

---

## Scan scope (Step 5 + Step 9)

Persist `rolloutReady.sourceRoots` and `rolloutReady.scanExclude` in `.fireweave/project.json`. **The scanner defaults are customer-generic** (`**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**` only) — it does **not** embed monorepo paths.

During **Step 2**, if this repo is the FireWeave platform monorepo (`packages/fw-plugins` and `packages/contracts` both present), **write** these dogfood values into `project.json` (do not rely on runtime auto-detection):

| Field         | Platform dogfood value                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `sourceRoots` | One repo-relative root per application surface detected in Step 2 (server API package + web UI package) |
| `scanExclude` | `**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**`, `packages/fw-plugins/**`, `packages/contracts/**`    |

Customer repos: leave `sourceRoots` empty (scan whole repo) unless the app layout needs narrowing; `scanExclude` can stay at generic test patterns.

`reconcile`, `detect_rollout_ready`, and the build gate read **only** `project.json` via `resolveRolloutScanOptions` in the rollout-server's `scan/` module.

**SDK dependencies: WHAT to install (per surface) × HOW to install it (per repo).** The two axes are independent — resolve them separately and combine. Bare specifiers only.

**What — surface → packages:**

| Surface     | Packages                                                                                               | Why both                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `@fireweaveai/server-sdk`                                                                              | the whole surface — control points, target registration, and both modes the scaffolded providers bring up                         |
| `web`       | `@fireweaveai/web-sdk`                                                                                 | the whole surface — browser control points; credential resolution is inlined into the scaffolded `fw-providers.ts`                |
| `python`    | `fireweave`                                                                                            | the whole surface — control points, runtime, target registration                                                                  |
| `java`      | `ai.fireweave:fireweave-sdk` (Maven Central; resolve the current release — see the java install table) | the whole surface — control points, runtime, target registration                                                                  |
| `swift`     | `Fireweave` (SwiftPM, git URL + tag from the SDK repo)                                                 | control points in local and remote mode; credentials are build-baked via Info.plist, never env-read — see **Swift surface** below |

**The node package was RENAMED, and the rename is a safety feature.** `@fireweaveai/sdk` is still live on npm carrying the pre-v1 OpenFeature surface. v1 ships under the new name `@fireweaveai/server-sdk`, so a repo pinned to the old name can never silently receive the breaking surface. Never install `@fireweaveai/sdk` for a v1 harness.

**The `[openfeature]` python extra is GONE — do not write it.** v1 bans an OpenFeature provider outright, so the `fireweave.openfeature` subpackage that needed the extra no longer exists. Install plain `fireweave`; `'fireweave[openfeature]'` now fails to resolve the extra. (Likewise `ai.fireweave:fireweave-openfeature` on the java side — see below.)

**How — lockfile → package manager.** Detect from the repo, never assume. The command shape differs, the package names do not:

| Detected                  | Install command                                                        |
| ------------------------- | ---------------------------------------------------------------------- |
| `bun.lock` / `bun.lockb`  | `bun add <packages>`                                                   |
| `pnpm-lock.yaml`          | `pnpm add <packages>`                                                  |
| `yarn.lock`               | `yarn add <packages>`                                                  |
| `package-lock.json`       | `npm install <packages>`                                               |
| `deno.lock` / `deno.json` | `deno add npm:<package>` per package (Deno needs the `npm:` specifier) |

A **python** surface uses its own managers — same detection discipline, different table:

| Detected          | Install command                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uv.lock`         | `uv add fireweave`                                                                                                                                                                         |
| `poetry.lock`     | `poetry add fireweave`                                                                                                                                                                     |
| `Pipfile.lock`    | `pipenv install fireweave`                                                                                                                                                                 |
| none of the above | `pip install fireweave` **and** record it in `pyproject.toml` / `requirements.txt` — a bare `pip install` leaves nothing in the repo, so the next checkout has no record of the dependency |

A **java** surface has no "install" verb at all — every path is a build-file
edit, which the repo records by construction:

| Detected                              | Add                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pom.xml`                             | ONE `<dependency>` block — `ai.fireweave:fireweave-sdk:<release>`                        |
| `build.gradle` / `build.gradle.kts`   | `implementation("ai.fireweave:fireweave-sdk:<release>")` — `mavenCentral()` is enough    |
| `gradle/libs.versions.toml` (catalog) | a `fireweave` version entry + the one library coordinate, referenced from the build file |

**The `ai.fireweave` artifacts resolve from Maven Central.** **`<release>` is
resolved at init time, never copied from this document:** Maven has no
dist-tags, so read the current release from Central's metadata —
`https://repo1.maven.org/maven2/ai/fireweave/fireweave-sdk/maven-metadata.xml`,
the `<release>` element — and pin that literal in the build file. A version
baked into this doc would freeze every scaffolded repo at whatever was current
the day it was written — the same trap the npm channel paragraph below records.

**Two `ai.fireweave` artifacts are PERMANENTLY ORPHANED — never scaffold them.**
`fireweave-openfeature` and `fireweave-adapter-posthog` were published to Maven
Central before v1 and are gone from the source tree; Maven artifacts are
immutable, so those coordinates still resolve and will forever. A build file
that lists either one compiles against the retired pre-v1 surface. Only
`fireweave-sdk` is v1. (`fireweave-testing` is optional and
`<scope>test</scope>` only.)

Bun is the default when nothing is detected and the repo is otherwise Node-shaped. **Two or more lockfiles, or none in a repo with no clear shape → `AskUserQuestion`** rather than guessing; installing with the wrong manager writes a second lockfile, which is a mess the user then has to unpick. Every clarification in this skill goes through `AskUserQuestion` — this is not an exception.

**Never write a version range into these commands.** npm's dist-tags are the source of truth for what "current" means, and a literal pinned here freezes every repo the skill scaffolds at whatever line was current the day the sentence was written — a `0.x` caret caps at the next minor, so those repos stop receiving SDK fixes silently and look deliberately pinned. The FIR-359 harness report carries the installed `@fireweaveai/server-sdk` version.

**The channel is DERIVED, never asked.** Call
`mcp__rollout-server__resolve_sdk_install` with `{ cwd, surface }` before
installing anything. It reads the `fw` build driving this run
(`fw status --json` → `cli`) and maps it:

| `fw` build            | SDK channel | Installs                        |
| --------------------- | ----------- | ------------------------------- |
| dev build (unstamped) | `staging`   | `<pkg>@next`                    |
| staging release       | `staging`   | `<pkg>@next`                    |
| stable release        | `stable`    | `<pkg>` bare — no tag, no range |

**Do not ask the user which channel to pin.** That question cost one run 4m20s
of waiting on top of a 1m43s investigation, and its answer was already
determined by the binary they invoked. `releaseBuild` decides first: an
unstamped build reports `channel: 'stable'` because the in-repo
`STAMPED_CHANNEL` is a stamping placeholder, so keying on the channel alone
sends every from-source developer to the stable line.

**The tool PREFLIGHTS the tag and can refuse.** On `{ ok: false }`, show its
`reason` and stop — do not install anyway and do not fall back to another
channel. The npm stable leg is currently unreachable (production npm publishing
is hard-disabled upstream), so a stable-CLI run legitimately fails here with a
message naming that; a staging `fw` is the working path today.

**If the CLI build cannot be read**, the tool refuses rather than defaulting.
Only then ask the user, and record what they chose.

**Run the install through `mcp__rollout-server__run_bounded_install`**, passing
the tool's `command` as `argv`. Never shell out to a bare `bun add` for an SDK:
an unbounded install was **63% of all tool time** in the run this instruction
comes from — one package wedged for its full 180s timeout, then needed a manual
`kill -9` and a retry. The tool bounds each attempt, escalates SIGTERM→SIGKILL,
retries exactly once with `--verbose`, and returns a named failure instead of a
silence you cannot distinguish from slowness.

**The per-surface pin.** Record what each surface actually resolved
into `project.json` `surfaces[].sdk` as `{ name, version?, channel }` — take
`resolvedVersion` from the tool's result rather than re-reading the registry:

| `channel` | Resolves from                         | Use                                                                 |
| --------- | ------------------------------------- | ------------------------------------------------------------------- |
| `stable`  | the registry's default tag (`latest`) | every normal repo — install BARE, no version range (npm: see below) |
| `staging` | the `next` dist-tag                   | dogfooding the next SDK line before it promotes                     |
| `dev`     | a LOCAL path (`workspace:*`)          | SDK co-development only, behind `sdkDev` / `FIREWEAVE_SDK_DEV=1`    |

**The npm dist-tag is `next`. The prerelease identifier is `-staging.N`. The
channel this skill records is `staging`. Three spellings, one line — do not
assume any of them from another.** A staging release is
`<major>.<minor>.<patch>-staging.<N>` — e.g. `2.3.0-staging.1` — published under
the npm dist-tag **`next`**. Install it by TAG, never by version:

```
bun add @fireweaveai/server-sdk@next         # or pnpm/yarn/npm/deno equivalent
```

There is **no `staging` dist-tag** and there never has been. The SDK's own
release workflow explains why the channel does not live in a tag at all:
"a dist-tag is a mutable pointer — the same bytes can be staging today and
production tomorrow … a version suffix puts the channel in the version itself".
npm still requires an explicit `--tag` on every publish, because it defaults
untagged publishes to `latest` even for prereleases, so `--tag next` exists as
"pure syntax to dodge that footgun, not the channel signal"
(`fireweave-sdk/.github/workflows/release.yml`, header and jobs `publish-npm-staging-*`).

Installing by tag matters because the alternative is pinning a literal staging
version, and that is the same freeze trap as pinning a stable one — a repo
dogfooding `2.3.0-staging.1` stops receiving `-staging.2` and looks deliberately
pinned. The tag moves; the version recorded in `surfaces[].sdk` says what it
resolved to on the day.

`-staging.N` is a semver PRERELEASE, so it sorts BELOW `2.3.0` and can never be
mistaken for the release it precedes. That is also why `channelForVersion`
routes any prerelease to the staging channel without needing to recognise the
word.

**npm `stable` is currently UNREACHABLE, and that is a pipeline state, not a
stale registry.** `publish-npm-production` in the SDK's release workflow is
`if: ${{ false }}` — "HARD-DISABLED — second authorization required for dist-tag
latest (server-sdk AND web-sdk)". Nothing can promote to `latest`, so whatever
sits there is pre-v1 residue: at the time of writing
`@fireweaveai/web-sdk@latest` is `2.1.0` and exports no `initFireweave` at all.
A bare install of either npm SDK therefore scaffolds a harness that cannot
compile. Do NOT work around this by pinning a version — verify the tag resolves
to a version carrying the harness entry point BEFORE installing, and say so
plainly when it does not. Reachability is per-registry: PyPI, Maven Central and
the git-tag ecosystems (go, swift) each have a live production line; npm does
not yet.

**Python is the exception, and it is a hard one.** PyPI has no dist-tags, so
there is nothing to name — the staging channel is a DIFFERENT INDEX. A staging
`fireweave` is published to **TestPyPI**
(`repository-url: https://test.pypi.org/legacy/`, job `publish-pypi`), and
production goes to PyPI (`publish-pypi-production`, which — unlike npm — is
enabled). So `pip install --pre fireweave` searches PyPI and will not find a
staging release, no matter how the version is spelled:

```
pip install --pre --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple fireweave
```

The `--extra-index-url` is not optional: TestPyPI does not mirror the
dependency graph, so resolution fails without a fallback to real PyPI.

**The staging VERSION spelling is unresolved upstream — read it, do not assume
it.** PEP 440 admits only `a` / `b` / `rc` prerelease segments plus `.devN`, so
`2.3.0-staging.1` is not a valid PyPI version; but the SDK's `version.sh apply`
writes the computed `X.Y.Z-staging.N` verbatim into `sdks/python/pyproject.toml`
with no PEP 440 translation. Resolve what actually got published by listing the
project on TestPyPI rather than predicting it here. Record the channel as
`staging` either way — the channel is FireWeave's vocabulary, not the
registry's.

`version` is written AFTER install, recording what actually resolved — never
prescribed before it. A literal range written here freezes every scaffolded repo
at whatever line was current the day it was written; the tag is the source of
truth for "current". Omit `version` and the channel's tag decides.

**`dev` is never a fallback, and that is now mechanical.** `verify_prod_path`
carries an `sdk-channel` check that REFUSES a `dev` pin whenever `CI` is set or
the target environment is prod-tier. A local path does not exist on a runner or a
deploy box, so the install either fails loudly — fine — or silently resolves a
STALE copy vendored into the image once, and then the SDK running in production
is whatever happened to be on disk, behind a green build. A repo initialised
before per-surface pins has none; that reports **skip**, never pass, so an
unreadable pin can never masquerade as a verified one.

### The SDK contract — where providers come from

The standalone SDKs (https://github.com/FireWeave-HQ/fireweave-sdk) are REQUIRED by the scaffolded harness, not optional extras. **Every surface binds BOTH its prod and its dev provider from its OWN standalone SDK** — there is no second package in the harness graph.

| Surface     | Package                      | Entry point      | Prod tier        | Dev tier        |
| ----------- | ---------------------------- | ---------------- | ---------------- | --------------- |
| `ts-server` | `@fireweaveai/server-sdk`    | `initFireweave`  | `mode: 'remote'` | `mode: 'local'` |
| `web`       | `@fireweaveai/web-sdk`       | `initFireweave`  | `mode: 'remote'` | `mode: 'local'` |
| `python`    | `fireweave`                  | `init_fireweave` | `mode="remote"`  | `mode="local"`  |
| `java`      | `ai.fireweave:fireweave-sdk` | `Fireweave.init` | `Mode.REMOTE`    | `Mode.LOCAL`    |
| `swift`     | `Fireweave` (SwiftPM)        | `initFireweave`  | `.remote(…)`     | `.local(…)`     |

**One entry point, two modes — not two constructions.** `mode` is REQUIRED and never inferred: with inference, a missing or mistyped credential in production silently becomes local evaluation, every control point serves its default, and the boot log stays green. The observable symptom is a feature that never ramps, which is indistinguishable from a rollout nobody started. Because both tiers are the same call differing by one option, they cannot skew in validation, lifecycle gating or context canonicalization.

**Never hand-construct the runtime/adapter/client** to "simplify" a template. It compiles and runs, and it bypasses the initialisation validation that makes a bad credential fail loudly at boot.

**The SDK reads NO environment variables** — every credential is an explicit option. The HARNESS reads `FW_API_URL` / `FW_PROJECT_API_KEY` (`PUBLIC_FW_*` on web) and passes them in. It also passes `allowedHosts` derived from the configured URL: without it the SDK validates against a canonical `*.fireweave.ai`-plus-loopback allowlist, so a **self-hosted fw-server fails initialisation with a bare `Configuration` error that names nothing**.

**Why this needs a guard and not just this paragraph:** a template that binds a
provider from anywhere other than its own standalone SDK still compiles, runs,
and passes every other test — nothing about a wrong-but-valid provider import is
self-announcing. `harness/sdk-contract.guard.test.ts` reads the templates and
fails on any provider symbol that does not come from the surface's own SDK.

The web template's `resolveFireweaveWebCredentials` is NOT a provider and is not
what the guard bans — it is a local helper defined in `fw-providers.ts` that
reads the build-baked `PUBLIC_FW_*` values and passes them INTO the web SDK's
adapter. It used to be imported from a separate package; it was inlined
when that package was dissolved, so the credentials still resolve exactly the
same way and the SDK still reads no environment of its own.

Only when the user explicitly opts into SDK co-development (`rolloutReady.sdkDev: true` or `FIREWEAVE_SDK_DEV=1`) use `workspace:*` for these packages instead of the registry.

---

## Build-gate script (Step 5)

Copy from the **installed plugin bundle** (same tree as `/add-plugin`):

- `hooks/rollout-build-gate.mjs` → `.fireweave/hooks/rollout-build-gate.mjs`
- `hooks/rollout-build-gate.sh` → `.fireweave/hooks/rollout-build-gate.sh` (`chmod +x`)

Do **not** copy from a monorepo checkout path (`packages/fw-plugins/...`). The gate prints JSON `{ pass, findings[] }` to stdout.

### The gate reads ONE manifest source (D-C — never green on absent evidence)

This is the single most important property of the scaffolded gate, and it is the one
a template most easily ships wrong: **every repo initialised from this skill
scaffolds from here**, so a fail-open template here is a fail-open gate in every new
repo. Manifests are server-owned; "no manifests found" therefore stops being evidence
of anything the moment a repo has no tracked files.

**There is ONE manifest source, and no field presence selects it.** Manifests are
server-owned; the projection (`.fireweave/.cache/rollout-ready/`, unioned with
`.fireweave/.queue/`) is the only store this gate reads, in every repo. Do not add
a `rolloutReady`-present branch that reads the tracked directory.

**Never key this on the `version` number** either — it is advisory, has been
observed wrong in both directions, and a misrouted gate is silent.

| State                                                             | Manifest source                    | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `.fireweave/project.json` at all                               | —                                  | **pass**, no findings. Not a FireWeave repo; a gate that failed here would break every unrelated build.                                                                                                                                                                                                                                                                                                                                |
| `project.json` unreadable / invalid JSON, or carrying no identity | —                                  | **block**, from the wrapper, with the reason on stderr. Do not swallow the parse error and exit 0.                                                                                                                                                                                                                                                                                                                                     |
| **No `.fireweave/.cache/`**                                       | none available                     | **BLOCK — `run: fw sync`.** This is the deliberate behavior change to the committed hook. An empty answer here means _this gate cannot see the contract_, not _there is no contract_; passing would go quiet in exactly the situation the gate exists for.                                                                                                                                                                             |
| **Stale** cache (checksums valid, `meta.json` branch ≠ HEAD)      | `.fireweave/.cache/rollout-ready/` | **Scan, with a warning** naming `_fetchedAt` and both branches. A stale answer beats no answer for a read — but never a silent one.                                                                                                                                                                                                                                                                                                    |
| **Fresh** cache                                                   | `.fireweave/.cache/rollout-ready/` | **Scan normally.**                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Cache present, **`.fireweave/.queue/` non-empty**                 | cache **∪** queue                  | **Scan the union**, and **tag every finding sourced from a queued entry** as unsynced. The queue is the author's newest intent — a queued edit SUPERSEDES the cached row for the same feature, and only entries whose `branch` matches the reader's own count. Excluding it would fail an author's own gate on their own offline work, which is the outcome the queue exists to prevent. Teammates cannot see queued entries — say so. |

A cache whose **checksums do not match** or whose `schemaVersion` this build does not
understand is **absent, not data**: fall through to the no-cache row and block with
`fw sync`. Never treat a corrupt projection as an empty one. A **queue entry this build
cannot read** (bad JSON, a schema version it does not speak) is a **block** in every
pointer row, including the no-cache one — a skipped entry is a manifest edit that
vanished.

The rest of the scan is unchanged:

- Read scan scope — `sourceRoots` + `scanExclude` — from the record that owns it: the cached `repo_state` row (`.fireweave/.cache/repo-state.json`), and nowhere else. The committed pointer is not a second home for these two; a worktree with no projection falls through to generic test-pattern defaults and scans the whole repo, which is wide rather than wrong. Run `fw sync`.
- Collect manifest flag keys from the source chosen above (parse `flags[].key`; an invalid manifest is a **block** finding, never a skip). Skip rows the branch's own draft `_shadowed`, and rows whose status is `archived` / `retiring` — their flags no longer demand an anchor.
- Walk the repo for anchors under `sourceRoots`, honouring `scanExclude` — same rules as `detect_rollout_ready` / `reconcile`.
- Match `@fireweave-controlpoint <key>` in any comment leader (line, block, hash) — same regex as the rollout-server scanner.
- **block** if an anchor key has no manifest entry.
- **block** if a manifest flag has no anchor.
- **block** (`ramp1-default`) if a manifest flag's declared `default` is `true`, or a non-zero number — RAMP-1: the ramp turns a feature on, the default never does. A recorded `ramp1Exception` (legal only alongside `default: true`) downgrades it to **warn**. `false`, `0`, a string variant key, and no declared default at all all pass. This duplicates `assert_dev_checklist` check 3b deliberately: that tool is one an agent chooses to call, while this gate is what both stop hooks actually run — before it, a `default: true` shipped past a green stop hook on every host. The EVAL-SITE half of RAMP-1 stays in `assert_dev_checklist` alone; resolving the second argument of `fw.controlPoints.getBooleanValue(key, default)` needs the TypeScript compiler API, which this standalone `.mjs` cannot import.
- Print `{ pass, findings[] }` on stdout and exit `0` when `pass: true`, else `1`. `pass` is false iff some finding has `severity: "block"`; `warn` / `info` findings carry the staleness and the manifest source without failing the build.

Write `.fireweave/hooks/rollout-build-gate.sh`. The wrapper's job is only to decide
whether the gate runs at all, and it decides on **project identity** — never on
`rolloutReady`. The block is a shape fact (catalog PROJ-3), not a gating one, and
reading `initialized` out of it gave the wrapper two ways to switch the gate off
with nothing on stdout, stderr, or the exit code: a block carrying
`initialized: false`, and a block that never wrote the key at all. A stop hook reads
"exit 0, no output" as a PASS, so both read as a clean gate on every host.

**The contract, in one line: the only silent `exit 0` is a missing
`.fireweave/project.json`.** Every other reason not to run names itself on stderr,
and a `project.json` that is present but unreadable or identity-less fails closed:

```bash
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
# No pointer at all ⇒ not a FireWeave repo. Nothing to gate.
#
# This is the ONLY silent exit 0 in this script, and that is the whole contract:
# a stop hook reads "exit 0, no output" as a PASS, so every other reason not to
# run has to say so. The wrapper used to read `rolloutReady.initialized`, which
# gave two more silent exits — a block that never wrote the key, and a block
# carrying `initialized: false` — and both switched the gate off fleet-wide with
# nothing on stdout, stderr, or the exit code to distinguish them from a clean run.
if [[ ! -f "$proj" ]]; then exit 0; fi
# Bound iff the pointer carries identity. Nothing about the `rolloutReady` block
# is consulted: whether the repo has one is a shape question (catalog PROJ-3),
# never a gating question, and `version` is advisory.
bound="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(j.projectId || j.projects ? 'yes' : 'no');
" "$proj")" || {
  echo "rollout-build-gate: cannot read $proj" >&2
  exit 1
}
# Present but identity-less is a MALFORMED binding, not an ungated repo: every
# writer (`select_project`, `fw init`) puts identity in before anything else.
# Fail closed and name it, exactly as an unparseable pointer does.
if [[ "$bound" != "yes" ]]; then
  echo "rollout-build-gate: $proj carries no project identity (projectId / projects) — refusing to report a pass on a repo this gate cannot scope. Bind the repo with \`fw init\` or /fireweave:initialise." >&2
  exit 1
fi
# The gate itself decides what an absent manifest means (D-C); the wrapper must
# not pre-empt that verdict.
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

Write `.cursor/hooks/fireweave-rollout-session.sh` (executable). Like the
build-gate wrapper, it decides on **project identity** — never on the
`rolloutReady` block. A repo with a block and a repo without one are equally
initialised, and a block that never wrote `initialized` used to drop the standing
reminder with nothing to show for it:

```bash
#!/usr/bin/env bash
# Inject rollout-ready context when this repo is initialised.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
inst="$root/.fireweave/agent-instructions.md"
if [[ ! -f "$proj" ]]; then exit 0; fi
bound="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
// Bound iff the pointer carries identity — the same rule the build-gate wrapper
// uses. Nothing about the \`rolloutReady\` block is consulted: a repo that has one
// and a repo that does not are equally initialised, and a block that never wrote
// \`initialized\` used to drop this reminder with no signal at all.
process.stdout.write(j.projectId || j.projects ? 'yes' : 'no');
" "$proj")" || exit 1
[[ "$bound" == "yes" ]] || exit 0
summary="FireWeave rollout-ready repo: follow .fireweave/agent-instructions.md on every feature change (anchor + manifest + stamp before /fw-rollout)."
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
# No gate ⇒ nothing to run. A gate that is PRESENT but not executable used to
# mean the same thing SILENTLY — a repo that believes it is gated and is not.
# Say so, and run it through bash rather than skipping the check. Likewise never
# discard the gate's stderr: a wrapper that refuses to run explains itself there.
if [[ ! -f "$gate" ]]; then exit 0; fi
if [[ ! -x "$gate" ]]; then
  echo "fireweave-rollout-stop: $gate is not executable — running it via bash. Repair with: chmod +x $gate" >&2
fi
out="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$out" "$err"' EXIT
# Capture the gate's stderr — never discard it. A wrapper that refuses to run
# (unreadable or identity-less pointer) exits non-zero with an explanation there
# and NO JSON on stdout; `2>/dev/null` turned that into the generic
# "drift detected" line, which reads as an ordinary finding rather than as
# "this repo is not being gated".
if bash "$gate" >"$out" 2>"$err"; then exit 0; fi
findings="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log((j.findings||[]).filter(f=>f.severity!=='info').map(f=>f.fix?f.message+' Fix: '+f.fix:f.message).join('; '))" "$out" 2>/dev/null || true)"
if [[ -z "$findings" ]]; then
  findings="the gate produced no verdict: $(tr '\n' ' ' <"$err")"
fi
msg="FireWeave rollout-ready drift: ${findings}. Complete anchor + manifest + fw-tracker stamp per .fireweave/agent-instructions.md, then run reconcile phase build."
printf '%s\n' "{\"followup_message\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$msg")}"
```

Record `.cursor/hooks.json`, `.cursor/hooks/fireweave-rollout-session.sh`, `.cursor/hooks/fireweave-rollout-stop.sh`, `.cursor/rules/fireweave-rollout-ready.mdc`, `.fireweave/hooks/rollout-build-gate.mjs`, `.fireweave/hooks/rollout-build-gate.sh` in `installedInto[]`.

---

## Claude Code hook (Step 8, when `claude` ∈ `teamAgents`)

Three artifacts, all **required and committed** (this is symmetric with the Cursor Step 7b/8 pair — Claude Code is NOT a second-class host). Create `.claude/hooks/` and `.claude/settings.json` when missing — Claude may be selected for teammates even though this laptop only has Cursor.

**1. The hook script** — `.claude/hooks/rollout-intent-gate.sh` (executable, `chmod +x`). It MUST:

- Emit Claude Code's injection JSON — `{ "hookSpecificOutput": { "hookEventName": <event>, "additionalContext": <reminder> } }` — a **bare `echo` is not reliably injected**; use the JSON form.
- Fire on **SessionStart** (empty prompt → surface the standing reminder unconditionally) and **UserPromptSubmit** (narrow to feature-intent keywords: `add|implement|feature|feat|fix|ship|build|wrap|change|refactor|rollout|flag`).
- Be **fail-open** — `set -uo pipefail` (not `-e`), guard every `node`/`cd`, and `exit 0` on any error. A missing dependency must never block a prompt.
- Read `.fireweave/project.json` and decide on **project identity** (`projectId` / `projects`) — the same rule as the build-gate wrapper. Never read the `rolloutReady` block: a block that never wrote `initialized` is indistinguishable from `initialized: false`, and both used to no-op this reminder in silence. No-op only when the pointer carries no identity.
- **Prompt source (HARD):** Claude Code `UserPromptSubmit` sends a JSON payload on **stdin** (not `$1`). Parse stdin first (`prompt` / `user_prompt` / `userPrompt` / `message`); fall back to `$1` then `CLAUDE_USER_PROMPT`. Do **not** rely on argv alone — that silently skips the keyword filter.

```bash
#!/usr/bin/env bash
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
proj="$root/.fireweave/project.json"
[[ -f "$proj" ]] || exit 0
bound="$(node -e "try{const j=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(j.projectId||j.projects?'yes':'no')}catch{process.stdout.write('no')}" "$proj" 2>/dev/null)" || exit 0
[[ "$bound" == "yes" ]] || exit 0
# UserPromptSubmit: JSON on stdin. SessionStart: empty → always remind.
prompt=""
if [[ ! -t 0 ]]; then
  stdin="$(cat 2>/dev/null || true)"
  if [[ -n "$stdin" ]]; then
    prompt="$(node -e "try{const j=JSON.parse(process.argv[1]);const p=j.prompt??j.user_prompt??j.userPrompt??j.message??'';process.stdout.write(typeof p==='string'?p:JSON.stringify(p))}catch{}" "$stdin" 2>/dev/null || true)"
  fi
fi
[[ -z "$prompt" ]] && prompt="${1:-${CLAUDE_USER_PROMPT:-}}"
msg="FireWeave rollout-ready repo (promote-not-wrap). FIRST classify this task in one line — change | inquiry | brainstorm | infra-only — because this reminder fired on a KEYWORD match and the keyword cannot tell 'fix the checkout bug' from 'how do I fix this typo'. Only 'change' runs the package; when genuinely unclear treat it as change (skipping wrongly ships unflagged behaviour, running wrongly costs a few tool calls). For a change task the rollout-ready package comes FIRST — author the manifest via upsert_rollout_manifest (FireWeave stores it; do not write a manifest file yourself) + mint chg_/stmp_ + append each stamp to its own surface's FW_STAMPS (one shared stamp only when single-project + every surface's harness is surface-aware), add // @fireweave-controlpoint <key> as you code, then assert_dev_checklist + reconcile(build) before done. No backfill. Absence has names: only never-authored means author one; not-fetched=fw sync, not-authorized=withheld not absent, queued=drain .fireweave/.queue. Ship via /fireweave:safe-rollout. See .fireweave/agent-instructions.md."
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
],
"Stop": [
  { "hooks": [ { "type": "command",
    "command": "[ -f .claude/hooks/rollout-build-gate-stop.sh ] && bash .claude/hooks/rollout-build-gate-stop.sh || true" } ] }
]
```

**3. The build-gate stop hook** — `.claude/hooks/rollout-build-gate-stop.sh` (executable, `chmod +x`), wired on **Stop**. Without it Claude Code has NO build gate: the intent gate is advisory (it reminds, it never checks), so on a Claude-only host the manifest ⇄ anchor check simply does not happen and nothing says so. Cursor has run this gate on every stop since initialise; this is the parity. It MUST:

- Honour `stop_hook_active` from the stdin payload — blocking twice loops the agent against a gate it may not be able to clear (a `fw sync` finding needs a network the session may not have).
- Emit `{ "decision": "block", "reason": <findings> }` on failure and **nothing at all** on success.
- Filter `severity: "info"` findings out of the reason — the manifest-source line is diagnostics, not drift.
- Be fail-open on everything except a gate that ran and failed. The one fail-open that is now **visible** is a gate present but not executable: that used to skip the check silently, which is a repo that believes it is gated and is not.
- **Never discard the gate's stderr.** The wrapper refuses to run — non-zero, no JSON on stdout — when `project.json` is unreadable or carries no identity, and it says why on stderr. Redirecting that to `/dev/null` collapses "this repo is not being gated" into the same generic sentence as an ordinary drift finding. Capture it and use it as the block reason when stdout carried no verdict.

```bash
#!/usr/bin/env bash
# Claude Code Stop-hook parity for the rollout-ready build gate.
#
# Cursor has run this gate on every stop since initialise. Claude Code ran only
# the ADVISORY intent gate (a reminder on SessionStart / UserPromptSubmit), so a
# Claude-only host had no build gate at all — the manifest ⇄ anchor check simply
# did not happen, and nothing said so. This closes that asymmetry.
#
# Fail-open on everything EXCEPT a gate that ran and failed: a missing node, a
# missing gate, an unreadable temp file must never wedge a session. The one
# fail-open that is now VISIBLE is a gate present but not executable — that used
# to skip the check silently, which is a repo that believes it is gated and is
# not.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
gate="$root/.fireweave/hooks/rollout-build-gate.sh"

# Claude sets `stop_hook_active` once this hook has already blocked. Blocking a
# second time loops the agent against a gate it may not be able to clear (e.g.
# `fw sync` needs a network this session does not have).
payload="$(cat 2>/dev/null || true)"
case "$payload" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac

[ -f "$gate" ] || exit 0
if [ ! -x "$gate" ]; then
  echo "rollout-build-gate-stop: $gate is not executable — running it via bash. Repair with: chmod +x $gate" >&2
fi

out="$(mktemp 2>/dev/null)" || exit 0
err="$(mktemp 2>/dev/null)" || exit 0
trap 'rm -f "$out" "$err"' EXIT
# Capture the gate's stderr — never discard it. A wrapper that refuses to run
# (unreadable or identity-less pointer) exits non-zero with an explanation there
# and NO JSON on stdout; `2>/dev/null` turned that into the generic
# "drift detected" line, which reads as an ordinary finding rather than as
# "this repo is not being gated".
if bash "$gate" >"$out" 2>"$err"; then exit 0; fi

reason="$(node -e "
const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
console.log((j.findings || []).filter((f) => f.severity !== 'info').map((f) => (f.fix ? f.message + ' Fix: ' + f.fix : f.message)).join('; '));
" "$out" 2>/dev/null || true)"
if [ -z "$reason" ]; then
  reason="the gate produced no verdict: $(tr '\n' ' ' <"$err")"
fi
msg="FireWeave rollout-ready build gate FAILED: ${reason} Complete the rollout-ready package per .fireweave/agent-instructions.md — author the manifest via upsert_rollout_manifest, add // @fireweave-controlpoint at each evaluation site, append the stamp to its surface's FW_STAMPS — then re-run the gate. If a finding says \`fw sync\`, this worktree has no server projection and absence is NOT evidence: fetch it rather than authoring over a contract you cannot see."
node -e "console.log(JSON.stringify({ decision: 'block', reason: process.argv[1] }))" "$msg" 2>/dev/null \
  || printf '%s\n' "$msg"
exit 0
```

Record `CLAUDE.md`, `.claude/hooks/rollout-intent-gate.sh`, `.claude/hooks/rollout-build-gate-stop.sh`, and `.claude/settings.json` in `installedInto[]`. The intent gate is a **backstop** that re-asserts the reminder each turn; the always-loaded `CLAUDE.md` block (Step 7c) is the primary standing surface; the stop gate is the only one of the three that actually CHECKS anything. Claude Code needs all three — a reminder is not a gate, and a gate that runs only in Cursor is not a property of the change.

---

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure_auth", "server": "rollout-server" },
    { "name": "select_project", "server": "rollout-server" },
    { "name": "list_registered_tools", "server": "rollout-server" },
    { "name": "guarded_call", "server": "rollout-server" },
    { "name": "record_rollout_env_contract", "server": "rollout-server" },
    { "name": "resolve_sdk_install", "server": "rollout-server" },
    { "name": "run_bounded_install", "server": "rollout-server" },
    { "name": "refresh_agent_skills", "server": "rollout-server" },
    { "name": "detect_surfaces", "server": "rollout-server" },
    { "name": "detect_rollout_ready", "server": "rollout-server" },
    { "name": "reconcile", "server": "rollout-server" },
    { "name": "verify_prod_path", "server": "rollout-server" },
    { "name": "verify_rollout_config_schema", "server": "rollout-server" },
    { "name": "assert_dev_checklist", "server": "rollout-server" },
    { "name": "upsert_rollout_manifest", "server": "rollout-server" },
    { "name": "update_repo_state", "server": "rollout-server" }
  ]
}
```

### Server-owned authoring (ADR-019 Phase 2)

Two write tools replace hand-poking files under `.fireweave/`:

- `mcp__rollout-server__update_repo_state` owns the repo-scoped config —
  `sourceRoots`, `scanExclude`, `teamAgents`, `installedInto`, `language`,
  `strategy`, `mcp.mode`, `sdkDev`, `deploySdkVersion`. Set-valued fields UNION,
  so two concurrent `--reinit` runs cannot clobber each other; `resetSets` is the
  `--remove` reversal. The FIRST write materialises the full derived set, not
  just the fields you name. Pointer identity stays with `select_project`, and
  `attestUrl` (the legacy-named fw-server base-URL field) / the credential-env
  names stay pointer-only.
- `mcp__rollout-server__upsert_rollout_manifest` authors a rollout-ready
  manifest to fw-server under an If-Match (`baseContentHash`, required and
  nullable), and to fw-server ALONE — it no longer writes `.fireweave/rollout-ready/<feature>.json`
  in any repo. When fw-server does not answer the
  edit is queued at `.fireweave/.queue/` and replays with its ORIGINAL base hash
  on the next contact — **shipping is blocked until it drains**. When the write
  cannot be addressed at all (no profile, no `projectId`, no `origin`) it is
  REFUSED, because a manifest on disk is a contract only this worktree can see.
  An absent manifest is reported as _not-authored_ / _not-fetched_ /
  _not-authorized_ / _queued_; never author a replacement to resolve one of the
  last three.
