# initialise

> One-time per-repo setup for FireWeave Rollouts. Detects coding agents + language + deploy targets, runs the capability/connection resolver to wire the FireWeave control-points SDK for control points (telemetry is the app's own — initialise DETECTS it, never wires it), wires each NEW surface onto the SDK start profile (one start call first in the entrypoint + a control-points file; existing scaffold surfaces keep their isProd() harness + fw-tracker), installs standing instructions + Cursor dev-loop rules/hooks (so feature work keeps rollout-ready manifests/anchors/stamps in sync), and writes agent links. Use when the user asks to "set up FireWeave rollouts", "initialise rollout-ready", "instrument this repo", or invokes `/fireweave:initialise`. `--reinit` / `--remove`.
>
> _User-triggered (Cline does not auto-activate workflows). Run with `/fw-initialise.md`._

> Interaction: gate each decision with `ask_followup_question` (one question per call; supply an `<options>` array). For multi-question groups, ask sequentially.

# Initialise (one-time rollout-ready setup)

Run **once** per repo. This front-loads the rollout structure so later shipping is
a **promote, not a wrap** (D26): it scaffolds a harness with BOTH control-point branches present
(dev in-memory provider; prod connected-vendor provider) — and **no telemetry
wiring in either**, because the app's observability SDK is the app's own —
wires it into the app entrypoint, and installs the **dev loop** (standing
instructions + Cursor rules/hooks) so every feature change keeps
`// @fireweave-controlpoint` anchors, the **server-owned rollout-ready manifest**, and
`fw-tracker` stamps aligned before `/fireweave:safe-rollout`. It does NOT
wrap existing code.

## Two harness kinds — the start profile for new surfaces, the scaffold for existing ones

Every surface is one of two kinds, recorded as `harnessKind` on its `project.json`
`surfaces[]` entry:

| Kind                                    | When                                                                                               | What initialise writes                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **package** — the SDK **start profile** | **every NEW surface**, all eight languages, SDK ≥ 3.0.0                                            | A control-points file and ONE start call placed first in the entrypoint (see **Start profile — per-language reference**), stamps in `.fireweave/stamps.<ext>`. No harness module, no providers file, no `FW_ENV_PROFILES`.          |
| **scaffold** — `harnessKind` absent     | a surface that ALREADY carries a generated harness (`fw-harness.*`, `FwHarness.*`, `fw_harness.*`) | The generated harness + providers + tracker, calling the core `initFireweave` with an explicit mode. Everything this document says about `FW_ENV_PROFILES`, the env-source interview, templates and `FW_STAMPS` is about this kind. |

**Never convert a scaffold surface here.** `--reinit` refreshes it as a scaffold
surface, unchanged; moving it onto the start profile is `/fireweave:migrate-harness`,
which re-keys the surface on the server. Tell the user so once, naming each scaffold
surface. A fresh initialise never writes `FW_PROJECT_API_KEY`, `FW_API_URL` or
`FW_ENV_PROFILES` for a package surface. Each step below says what a package surface
does where it differs.

## What initialise puts in git — and what it does not (ADR-019)

Rollout state is **server-owned**. Initialise writes a small, permanent, committed
surface and pushes everything else to fw-server:

| Committed to git (written once, never by feature work)                                                  | Owned by fw-server (never scaffolded as a directory)                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.fireweave/project.json` — the **pointer**: `orgId`, `projectId` (or a `projects{}` map), `server.url` | Rollout-ready manifests → `repo_manifests`, authored via `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")`                                                        |
| `.fireweave/agent-instructions.md`                                                                      | Change stamps → `change_stamps` (D-D). `FW_STAMPS` in `fw-tracker` (`.fireweave/stamps.<ext>` on a package surface) stays the one git-visible per-feature line |
| `.fireweave/PROVIDERS.md` (scaffold surfaces only)                                                      | Repo-scoped config → `repo_state`, written via `use_mcp_tool(server_name="rollout-server", tool_name="update_repo_state")`                                                                        |
| `.fireweave/hooks/` (build gate + wrapper)                                                              | Project×env + surface config → already server-side                                                                                                             |
| `.fireweave/.gitignore`                                                                                 |                                                                                                                                                                |

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
credential or writes one to disk. The project key is issued by the operator in the
portal; a package client surface's browser key comes from `issue_browser_key`
(Step 3c). `fireweave.md` (repo root, **committed**) names a scaffold surface's variables. A repo
scaffolded before this change may still carry the old file: it is inert, and
deleting it is safe once the deploy environment has the values.

**Scaffold surfaces are environment-keyed, not dev/prod-binary (D26).** (A package
surface needs none of this: the start profile infers its mode — see **The SDK
contract**.) The harness selects its branch
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

**Surface support (one table, the rollout-server `SURFACE_REGISTRY` agrees).**
Every language — ts-server, web, Python, Go, Java, Rust, Dart and Swift — is
**package-capable at SDK ≥ 3.0.0**, prod included, on the SDK's remote mode. The
gate is `use_mcp_tool(server_name="rollout-server", tool_name="resolve_sdk_install")`: when it cannot resolve a 3.0.0
release for the surface's channel it refuses, and the surface is not wired. Swift is
distributed through the **mirror repository** (SwiftPM resolves the `FireweaveStart`
product from it), never from a `swift/*` tag on the SDK repository. Scaffold
surfaces keep the support they were scaffolded with and are not created any more. A
project with **no prod-tier environment** (dev-only) gets the dev path wired and prod
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

**0a — Profile.** Run `use_mcp_tool(server_name="rollout-server", tool_name="ensure_auth")` with
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
- `bound: false` / incomplete bind → `use_mcp_tool(server_name="rollout-server", tool_name="select_project")`
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

**0d — Setup plan (ADR-028, ONB-D9).** Once the bind holds, ask FireWeave
whether this repository was already analysed and planned in the web app:
`fw api GET /v1/projects/{projectId}/setup-plan?repo={owner/name}` (`projectId`
from `.fireweave/project.json`, `owner/name` from the `origin` remote). Over
the CLI profile, like every Step 0 call — read only, writes nothing.

- **404** (`SETUP_PLAN_NOT_FOUND`) — no plan: proceed exactly as without one.
- **409** (`REPO_CONTEXT_ONLY`) — this project links the repository as
  Context only; FireWeave never sets it up. PARK and name the project that
  manages it (`error.details.managedBy`), or say none does.
- **200** — the response's `plan` answers these gates. For each one, use the
  plan's value instead of asking, and record it with
  `write_confirmation_receipt` exactly as the ask would have, with
  `selectedNotes: "source: webapp (setup plan v<version>)"` so the receipt
  says the answer came from the web app, not this session:

  | Gate                                    | Plan answer                                               |
  | --------------------------------------- | --------------------------------------------------------- |
  | Step 1 "Let FireWeave manage rollouts?" | yes: the repository is Managed in the plan                |
  | Step 2 `teamAgents`                     | `plan.teamAgents`                                         |
  | 3a envs carrying real traffic           | `plan.environments`                                       |
  | 3b INIT-B11 observability unbound       | `plan.automation.autoRampEnabled`                         |
  | 3c where each prod-tier env runs        | `plan.environments[].runsOn`                              |
  | 3d env-source confirm                   | `plan.surfaces[].envSource`                               |
  | FW_ENV_ALIASES confirm                  | `plan.environments[].aliasValues`                         |
  | GATE-3F-SURFACE-SELECTION               | `plan.surfaces[].selected`                                |
  | GATE-3F-VANISHED-SURFACES               | not in the plan: ask as today                             |
  | 6b identity seam                        | `plan.surfaces[].identitySeam` (`pr-todo` → ask as today) |
  | package-manager ambiguity               | `plan.surfaces[].packageManager`                          |
  | channel                                 | `plan.sdkChannel`                                         |

  A plan value that is `null` or missing answers nothing: ask that gate as
  today. Everything not in the table — auth, keys, secrets, the browser key,
  the harness itself — runs exactly as it does without a plan.

  **Re-ask only what drifted (ONB-D9).** The plan was made at
  `plan.analysis.sha`. When `HEAD` is that commit, every row above is
  answered. When it is not, run
  `git diff --name-only <plan.analysis.sha> HEAD`. Then re-ask only the gates
  whose area that diff touches:
  - a surface's own rows: anything under its `path`;
  - environments, where they run, and aliases: deploy config (CI
    workflows, Dockerfiles, compose and IaC files);
  - `teamAgents`: agent config (`.claude/`, `.cursor/`, `AGENTS.md`,
    `CLAUDE.md`).

  A re-asked gate shows the plan's value as the default, and its receipt
  carries the session's answer, not `source: webapp`. When the plan's
  commit is not in this clone's history, the area cannot be known: re-ask
  every row, with the plan's values as defaults.

Then run the Step 0.1b tool-manifest check via
`use_mcp_tool(server_name="rollout-server", tool_name="list_registered_tools")`.

## Steps

| Step | Action |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Repo gate** | `ask_followup_question`: _"Let FireWeave manage rollouts in this repo?"_ **No → exit, touch nothing.** |
| **2 — Detect agents + language + deploy targets** | Detect coding-agent markers on disk (`CLAUDE.md`/`.claude/`, `.cursor/`, `.clinerules/`, `AGENTS.md`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`). Detect surface(s) → tier + harness profile. Detect deploy targets → the secret destinations Step 3c offers. **Then ask the team (mandatory on first init):** one `ask_followup_question` multi-select — _"Which coding agents will the team use in this repo?"_ **V1 full-materialize options:** `cursor`, `claude` only (HARD ORDER + hooks). Other hosts (`cline`, `codex`/`opencode`, `copilot`, `gemini`, `windsurf`) are **link-only experimental** — offer them only as an optional second question, never as a substitute for Cursor/Claude standing loops. Pre-select disk-detected `cursor`/`claude`. The user may add an agent **not** installed on this machine (e.g. Cursor laptop + teammates on Claude). Install set for Steps 7–8 = selection (not disk-only). **Hold** the selection in memory as `teamAgents` — **do not** persist to `project.json` yet (SCN-16; first **scaffold** write batch is Step 3e — Step 0c bind may already have written `project.json`). **Empty / cancelled selection:** re-ask once; if still empty → use **detected `cursor`/`claude` only** — never invent `["cursor","claude"]` when neither was detected and the user declined. Teammates who join later on an agent missing from `teamAgents` run `/fireweave:adopt` (harness-skipping). `--reinit` remains available for harness/env/credential refresh and may also restore agent loops — do not block it. |
| **3 — Environment map + provider/connection resolution (capability-driven, D-PROVISION; SCN-16 gate-before-write)** | **Hard gates first — no disk.** **3a — Enumerate environments (in memory).** Via `use_mcp_tool(server_name="rollout-server", tool_name="guarded_call")` → `list_project_environments` (fall back to reading `.fireweave/project.json`), read the full environment list and `defaultEnvironment`. Classify each environment into a **tier**: use the API's `tier`/`kind` field when present; otherwise treat `defaultEnvironment` as `dev` and confirm the **prod-tier set** with one `ask_followup_question` (multi-select the environments that run real user traffic — e.g. `staging`, `production`). Build the env→tier **profile map** (becomes harness `FW_ENV_PROFILES` in Step 4) **in memory only** — **do not** persist `rolloutReady.environments` yet. **A package surface gets no profile map:** the start profile infers its own mode, so nothing is generated from this for it; the tier list still decides which destinations 3c asks about. **3b — Resolve capabilities per tier (do NOT wire prod from the dev env; still no disk).** **Read `automation` off the same `get_project_capabilities` result before anything else in this step** — `{ autoRampEnabled, … }`, the project-scoped release-automation settings. They are what decides whether an OPTIONAL family is actually required here: `observability` iff `autoRampEnabled`. It defaults OFF, so on a fresh project the honest answer is usually "this addon is optional". **An unreadable `automation` block is a hard PARK — write nothing.** Absent (an fw-server that predates the optional-automation feature), a transport or auth failure, or a malformed block all mean _we could not ask_, and that is NOT the same answer as _the operator turned it off_. Never synthesize `{ autoRampEnabled: false }` from a failed read: that fabricates permission to skip an addon the project may genuinely require. Say which read failed, tell the user to restore connectivity or upgrade fw-server, and stop. For the **dev branch** the FireWeave local provider needs no vendor binding. For the **prod branch**, call `get_project_capabilities` with `{ projectId, environment: <prod-tier env> }` — the family Binding (`bindings.observability` `{ integrationId, connectionId, state }` — the QUERY leg; there is no OTLP target in it; see (2)) MUST come from the **prod-tier** environment, never the default/dev one. When multiple prod-tier environments exist, resolve each. Do not write `harness.posthogProjectId`: every environment shares FireWeave's managed control-points project, so there is no per-environment PostHog project to record (09 §6 g). **Capability XOR (SCN-8 / INIT-B11 / FIR-290) — classify before writing anything.** After `get_project_capabilities`, per prod-tier env: (1) **Control points are always ready.** Every environment carries its control-points Binding from creation, served by FireWeave; there is nothing to check, connect or wait for, and no hand-off (09 §3, §6 g). (2) **Observability ready? — classify on the VENDOR, never on an endpoint.** FireWeave's observability binding is its **query leg**: how fw-server reads guardrail metrics back out of the vendor (`connectionId`). It does **not** carry the app's OTLP ingest target and never will — `otlpEndpoint` / `credentialEnvName` are not fields any capability descriptor produces (the OpenObserve Integration, `packages/integration-openobserve/src/index.ts`, serves `observability.*.query` capabilities and no ingest capability). The app's **export leg** — a direct app→vendor OTLP exporter — is **deployment config the operator supplies**, exactly like `FW_ATTEST_URL` / `FW_PROJECT_API_KEY`. So: the capabilities response is keyed by family — `bindings.observability.state` (the **Metrics** unit; Logs and Traces are separate units under `bindings.observability.signals`) is `bound` → observability **bound** (read its `integrationId`); `unbound` or `needs-attention` → **unbound**. **Matrix:** **obs-bound** → **detect how this repo already emits, per surface. Do NOT scaffold an exporter.** FireWeave does not own telemetry initialisation: a repo that has not chosen an observability SDK has not asked FireWeave to choose one for it, and an exporter FireWeave writes is one the team never reviewed and does not maintain. NEVER an `observability.ingest` proxy through FireWeave either. And **never** defer telemetry merely because the descriptor carries no endpoint: it never does, for anyone — that is the expected shape, not a gap (**FIR-354**).

**What to detect, per surface — two answers from one read:**

1. **Is telemetry initialised at all?** Look for the provider/client construction itself, not call sites — an OTel `MeterProvider`, a vendor SDK client, a StatsD connection, whatever this repo actually chose. **None found → tell the user which surface, and PARK.** Say plainly that without an initialised metrics client a rollout on that surface can only ramp manually, because there is nothing for the soak to query. Do not fill the hole.
2. **What does it already emit?** Inventory the metric names this surface emits today, where, and what each measures. This is what makes REUSE possible at change time, and it has no other source — every observability query capability (`observability.metric.query`, …) takes a metric NAME, so nothing can list what exists. The repo is the only place to learn it.

Both answers go into `.fireweave/agent-instructions.md` at Step 7 (**How to emit a metric**), and the resolved client is recorded as `surfaces[].metricsClient`. obs-unbound (**INIT-B11**) → print **"observability deferred — no observability vendor bound"**; `ask_followup_question`: bind observability in the portal **now**, or **continue with deferred telemetry**. **What a refusal costs depends on `autoRampEnabled` (3b).** With auto-ramp **off**, observability is a genuinely optional capability and a deferral is the _expected_ outcome, not a failure — **soft-continue** (awaiting-user, never PARK), record the deferral in the session summary, and carry on. With auto-ramp **on**, the soak observer is what automatic advancement trusts, so an unbound metrics vendor is a broken promise rather than a preference: name auto-ramp as the reason it is required, and **Refuse/cancel → hard PARK — write nothing**. Never PARK a project for declining an addon it never enabled. On continue, write **no telemetry at all** — the harness never carried any and does not gain any here; **never** emit a half-wired OTLP exporter (empty endpoint, placeholder creds, or ingest proxy). Record the deferral in the session summary, naming what it costs: no bound metrics provider means no guardrail can be read back, so every rollout on this project ramps manually. Always offer the FireWeave local (in-memory + console) provider for the **dev** tier. **3c — Where the credentials will go (no secret is minted anywhere in this skill).** If the profile map has **no prod-tier environment** (dev-only), SKIP this question, print **"prod deferred — no prod-tier environment configured"**, and continue to **3d** (still no disk). Otherwise the **prod control-points path** needs the runtime credential pair in every prod-tier deploy destination: `FW_API_URL` (the fw-server base URL) and `FW_PROJECT_API_KEY` (the bearer the harness sends to fw-server `/v1/control-points/evaluate`) — plus the `PUBLIC_FW_*` pair when a web surface exists, whose key comes from a DIFFERENT panel. **Initialise issues neither.** Both come from the portal's **Project settings → API keys** page: `project-api-key_…` from **Project API keys** (server), `fw_public_…` from **Browser keys** (web). `ask_followup_question`: for each prod-tier environment, where will it run? Offer only destination **kinds** from the tool union `github_actions`\|`vm_env`\|`docker_compose`\|`other` (map Step 2 labels such as Render → `other`/`vm_env` as appropriate). Default/dev-tier needs NO prod secrets. Confirm the user will set the pair in that destination after issuing the keys. **When 3b classified the env obs-bound**, the same destination also needs the OTLP **endpoint** + **credential** vars the Step 4 harness reads (FireWeave never holds these — the export leg is the operator's, see (2)); name them explicitly in the same question so the operator sets one set of secrets, once. **Refuse → soft-continue (awaiting-user, never PARK):** still call `record_rollout_env_contract` (it writes no secret — only `fireweave.md` and `.env.example` NAMES, which are exactly what an undecided operator needs later), keep every other scaffold, and record in the session summary that the prod branch will refuse to boot until the pair is set — the harness fails loudly, never silently, on missing prod credentials. **3c for a package surface (K11) — one variable, never a pair.** _Server profile_ (ts-server, Python, Go, Java, Rust, a Dart server, a Swift server): `FIREWEAVE_KEY`, the project key (`project-api-key_…`) — still issued by the operator in the portal's **Project API keys** panel, never by this skill — once per prod-tier destination. No `FW_API_URL`: the endpoint is the SDK channel Step 4's install records. Ask about `FIREWEAVE_URL` **only** when `project.json` `server.kind === 'custom'` (self-hosted or bench); it then goes beside the key, never into code. _Client profile_ (web, a Dart client, a Swift app — `detect_surfaces` reports `clientShipped: true` for them, and a client-shipped surface never gets a server key): `FIREWEAVE_BROWSER_KEY`, a browser key (`fw_public_…`), once per **BUILD** destination — CI, the host's build settings, a Docker build arg; Dart: CI `--dart-define` or a git-ignored `fireweave.env` define file; Swift: Info.plist `$(FIREWEAVE_BROWSER_KEY)` fed from a git-ignored `Fireweave.local.xcconfig` or CI. **Never a developer `.env`:** a key there turns every local run remote. Here, only ask where it goes; the key is issued after Step 3f mints the `surfaceId` it is labelled with (see 3f). **3d — Environment source (project-native, confirm-first; still no disk).** Determine how the harness learns the running environment NAME — see **Environment source** below. Prefer the project's existing env signal; only fall back to `FW_ENV`/`PUBLIC_FW_ENV`if the user opts in. Always`ask_followup_question`before scaffolding. **A package surface gets ONE question instead:** does the app (web, Dart, Swift: the build) already name its environment in a variable other than `FIREWEAVE_ENV` / `APP_ENV` (ts-server: or `NODE_ENV`)? Yes → Step 4 passes it as the start call's `environment` option in that language's spelling (per-language reference), read from the app's own config; never hand the SDK an app-side default such as `"dev"`. No → leave the option out. **3e — First scaffold write batch (commit-point; only after 3a–3d pass).** Track **scaffold/ship** paths in session-only`sessionWrote[]`(include`.fireweave/.cache/**` when present) — **never** the Step-0 bind `project.json`. (1) Call `use_mcp_tool(server_name="rollout-server", tool_name="record_rollout_env_contract")` — it records the env contract, writes the committed `fireweave.md`, appends `.env.example` NAMES, and **mints nothing** — with `{ cwd: <same absolute workspace root as Step 0>, apiSurface: true, webSurface: true }` when both ts-server + web harnesses exist; `{ cwd, apiSurface: true }` for API-only (a `java` or `python` surface counts as API here); `{ cwd, webSurface: true, apiSurface: false }` for web-only. Pass `webappUrl` when known, so the operator gets a clickable link instead of a path. **Package surfaces are not in this call** — they get their own call after Step 3f, which mints the `surfaceId` package mode needs (see 3f); this one covers scaffold surfaces, and a repo with none skips it. Call it **whether or not** a prod-tier env exists and whether or not 3c was declined: it is documentation, not provisioning. **On a missing tool → soft-continue**, naming the gap — a missing readme is a worse-documented repo, not a broken one. (There is no `{ ok: false }` PARK here any more: the call that could fail was the key mint, and it is gone.) (2) Then persist in-memory `rolloutReady.environments`, `defaultEnvironment`, resolved `posthogProjectId` fields, and Step 2 `teamAgents` into `.fireweave/project.json` (bind fields stay; do not rewrite org/project ids). **On success, verify on disk:** when a scaffold surface exists, `fireweave.md` exists at the repo root, names every variable the DETECTED surfaces need, and contains **no** value matching a key prefix. Record it in `installedInto[]` — it is committed, not gitignored. Show the tool's `userPrompt`, which names the portal page, which panel issues which key, and the variables for this repo's surfaces. Then \*\*soft-continue (awaiting-user — not PARK)\*\* until the user confirms secrets are set — confirmation is on trust; the prod boot failing loudly on a missing pair is the real gate. |
| **3f-pre — Detect surfaces, then let the user SELECT** | Run `use_mcp_tool(server_name="rollout-server", tool_name="detect_surfaces")` with `{ cwd }` — and on a re-init also `{ declared: <project.json surfaces[]> }`. It is the deterministic replacement for the old "detect surface(s)" prose: topology -> language -> deployability -> app-vs-library via the dependency graph. **It PROPOSES; it never declares.** Every row carries a NAMED verdict and the evidence behind it. **Show the user every row, then ask** (one `ask_followup_question` multi-select, gate `GATE-3F-SURFACE-SELECTION`): pre-tick exactly the rows with `preselect: true`, and leave `ambiguous`, `undecidable` and every library unticked but VISIBLE and selectable — a library the user knows is deployed must be choosable, and an ambiguous row is a question, not a guess. For an `ambiguous` row also show `alternatives` so the user can pick WHICH surface it is. **`unreadable` is not an error channel — print it.** A zone that could not be read contributes no surfaces, which looks exactly like a zone that has none; silently dropping it is how a whole package goes uninstrumented with a green run. If `unreadable` is non-empty, name each path and its reason before asking. **Never auto-declare on a weak verdict** and never declare a row the user did not tick. Record the selection with `write_confirmation_receipt` so the choice is auditable and a re-run is idempotent. **Re-init drift (`drift.needsReview === true`):** a surface that was declared before and is not detected now is **FLAGGED, never auto-retired** (gate `GATE-3F-VANISHED-SURFACES`). It has two indistinguishable causes — genuinely deleted, or invisible this run (moved directory, unreadable manifest, glob that stopped matching, missing submodule) — and the costs are asymmetric: a stale declaration is noise, a wrongly-retired one destroys an `sfc_` id the server issued and a committed harness still references, and it fails at SHIP, not here. Ask; do not decide. A moved surface appears as vanished + added rather than a silent rebind, which is deliberate — the `(surface, path)` pair is the same key the server matches a re-declare on. **Detection is advisory, not a gate:** if the tool is unavailable (older bundle), say so and fall back to asking the user to name the surfaces directly — never PARK on it, and never skip the ASK. **For the start profile, each row also carries** `startProfile` (the suggested `server` / `client` profile — record it for `dart` and `swift`), `clientShipped` (always present; `true` means never wire a server key), `entrypoints[]` (`{ path, detail, clientShipped }` — where Step 6 puts the start call) and, for an Android module, a `refusal` to show rather than declare. Aggregator modules and client-shipped Go / Java / Rust binaries arrive with `preselect: false`. |
| **3f — Declare surfaces (server mints the IDs)** | **The server mints every `sfc_` id. You never do.** Run **exactly one** `fw repo declare-surfaces --project {projectId} --json --surfaces '[{"surface":"<ts-server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | web                          | python                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | go  | rust | dart | java>","path":"<harness module path>","entrypoint":"<app entrypoint>","rolloutCredentialEnv":"<FW_PROJECT_API_KEY | PUBLIC*FW_PROJECT_API_KEY>"}]'`carrying EVERY surface detected in Step 2 — **ONE call carrying EVERY surface**, never one call per surface (the server resolves them against one snapshot and refuses the whole set if any collides; two calls would let the first half land and the second conflict). Pass`surfaceId`only for a surface that already carries one in`project.json`— omit it and the server mints. Read the returned`surfaces[].surfaceId` and carry it into Step 4. **`path`must be the exact path Step 4 will write** — it is half the key the server matches a re-declare on, and both writers treat it as fill-only, so a predicted path that Step 4 then contradicts is sticky: the next`--reinit` declaring the real path misses the key and mints a SECOND id. If Step 4 ends up writing elsewhere, re-run this step with the real path before recording anything. **`outcome`per surface:**`minted`(new),`existing`(already on file for this project at this harness path — the healthy answer for a repo whose pointer was lost),`adopted`(your id, newly claimed),`already-registered`(your id, already ours). **Non-zero exit → PARK.** The command fails closed on an unreachable server, a 5xx, and on`conflict`(a`sfc*`id homed under another project — 409, and NOTHING was declared). There is no local-mint fallback and you must not invent one: an id the server never issued is exactly the unclaimed id this step exists to abolish, and it fails at ship instead, as`SURFACE_PROJECT_CONFLICT`. On `conflict`, name the colliding surface and its incumbent project to the user; the usual cause is a harness copied from another repo. When the failure is **`error: unknown command 'declare-surfaces'`** (exit 1), the repo holds a `fw`binary older than this command — the skill bundle and the CLI ship on independent release paths, so a current bundle with a stale binary is the ordinary case, not an exotic one. Tell the user to run`fw self-update` and re-run; do **not** read that error as a conflict, and do **not** work around it by minting an id locally. This call is also the first server-side evidence that initialise ran against this repository (it records the declaring repo), so it happens BEFORE any harness is written, not after. **Package surfaces:** add `"harnessKind":"package"` to the entry, and set `path` (and `entrypoint`) to the **entrypoint file that carries the start call** — there is no harness module to name, so this is the exact file Step 6 edits — and `rolloutCredentialEnv` to `FIREWEAVE_KEY` (server profile) or `FIREWEAVE_BROWSER_KEY` (client profile). `startProfile` (`dart`, `swift`: `server` or `client`, from `detect_surfaces`) goes on the `project.json` entry. Existing scaffold surfaces are declared exactly as before, with no `harnessKind`. **Then issue each package client surface's browser key** with `use_mcp_tool(server_name="rollout-server", tool_name="issue_browser_key")` `{ projectId, surfaceId, cwd }`: `issued` → hand `key` straight to the build destination the user named in 3c (offer to set it with that destination's own CLI, only on explicit confirmation), and never echo it into a file, a log or the session summary; `exists` → a key labelled for this surface is already active and its secret cannot be shown again, so the user reuses it from where they stored it, or — on explicit confirmation — re-run with `rotate: true`; `fallback-portal` → print its `reason` and send the user to the portal's **Browser keys** panel. A refusal is a soft-continue, never a PARK; any other tool error is reported as one, never silently replaced by the portal path. **Then record the package surfaces' env contract:** `use_mcp_tool(server_name="rollout-server", tool_name="record_rollout_env_contract")` with `{ cwd, packageSurfaces: [{ surfaceId, surface, startProfile?, buildDestinations? }] }` (`startProfile` is required for `dart` / `swift`; `buildDestinations` are the client profile's 3c answers). A server profile gets `FIREWEAVE_KEY=` (plus `FIREWEAVE_URL=` only when `server.kind === 'custom'`) in `.env.example`; a client profile gets `FIREWEAVE_BROWSER_KEY` as a **build** variable with no `.env` entry; neither gets `fireweave.md`. Show the result's `packageSurfaces[]` (`credentialEnv`, `credentialKind`, `envExampleVars`, `buildVariables`, `buildDestinations`) to the user. It creates no `project.json` surface entry — that is Step 9's. |
| **4 — Scaffold harness (environment-keyed, both branches, D26)** | **Package surface → no template.** Install the SDK (`resolve_sdk_install` with `harnessKind: 'package'`, plus `startProfile` for `dart` / `swift` — the four-step flow under **SDK dependencies**), then write that language's control-points file and start call from **Start profile — per-language reference** (web: also the build helper), with the Step 3d `environment` option when there was one; nothing else in this row applies to it. **Scaffold surface →** **Read the surface's templates from `harness/<surface>/` — resolved relative to THIS `SKILL.md`'s own directory, not the target repo — and generate EVERY file the surface's row lists**, never just one: a `ts-server` / `web` surface emits `fireweave/fw-harness.ts` **and** `fireweave/fw-providers.ts` (the harness imports `makeConnectedVendorProvider` / `makeDevProvider` from `./fw-providers` — a single-file harness does not resolve); a `python` surface emits three snake_case modules; a `java` surface emits the three `Fw*.java` classes into the app's `<base package>.fireweave` package (directory must match the package — rewrite the templates' `package fireweave;` line accordingly). Never hand-author a harness from this row's prose; see **Harness templates — where they live (Step 4)** below for the surface→dir map, the substitution list, and what to do when the templates are missing. Emit the `FW_ENV_PROFILES` map + `FW_DEFAULT_ENV` from Step 3a's env→tier profile (do NOT ship the template's placeholder rows unchanged — regenerate them from the project's environments). The harness resolves the running environment NAME (`resolveFwEnvName`), looks up its tier, and selects the control-point provider: `dev` → the SDK's in-memory local mode; `prod` → the connected vendor's real provider. **The harness wires NO telemetry, in either tier.** FireWeave does not initialise an observability SDK in a repo — the templates carry none and `harness-templates.test.ts` asserts they never gain any. Step 3b's observability descriptor is the QUERY leg (how fw-server reads a guardrail metric back during a ramp), not an exporter for FireWeave to write; whether the app emits anything at all is DETECTED at Step 3b, never scaffolded. `isProd()` is retained ONLY as the unknown-env tier fallback and the token `verify_prod_path` greps for. The surface ids Step 3f's `fw repo declare-surfaces` returned are recorded in `project.json` `surfaces[].surfaceId` ONLY (Step 9 / see the `--reinit` surfaces section) — the harness carries no surface-ID block and no attestation wiring (deploy attestation is retired; merge attestation supersedes the boot beacon). **Never mint an `sfc_` id yourself** — not by hand, not with an inline script. The server owns `sfc_` identity (`surface_registry.surface_id` is a global primary key), and a locally-invented id is unclaimed and collides later as `SURFACE_PROJECT_CONFLICT`. The harness resolves `fwEnvName` from **the project's own env signal** — the generated `readEnvSignal()` + `FW_ENV_ALIASES` block (see **Environment source** below / Step 3d) — so **no FireWeave-specific `FW_ENV` / `PUBLIC_FW_ENV` is required**. Do NOT instruct the user to set `FW_ENV` per environment unless they explicitly chose the FireWeave-var option in Step 3d; `FW_ENV` is an optional override only. **TS-server `.mjs` harness:** patch the API package `build` script to copy compiled harness artifacts — see **API Docker build** below. |
| **5 — Scaffold the tracker + `.fireweave/`** | **Package surface (D7):** create its stamps file empty, in exactly this shape — `.fireweave/stamps.ts` (ts-server, web): `export const FW_STAMPS = [];` with the same entry shape as a scaffold `fw-tracker`, surface-tagged; `.fireweave/stamps.py` (Python): `FW_STAMPS: list[str] = []`; `.fireweave/stamps.json` (Go, Java, Rust, Dart, Swift — a file no build compiles): `{ "FW_STAMPS": [] }`, entries `"stmp_…"`. Two surfaces that map to the same file share it. Record it as that surface's `surfaces[].trackerPath` (top-level `surfaces[]`, which `reconcile` and `assert_dev_checklist` read), and write no tracker module and no `.fireweave/PROVIDERS.md` for it. **Scaffold surface:** **Every surface gets ONE tracker MODULE beside its harness in `fireweave/` (`fireweave_harness/` for Python), generated in Step 4 from that surface's own template** — `ts-server` / `web` → `fw-tracker.ts.tpl`, `python` → `fw_tracker.py.tpl`, `java` → `FwTracker.java.tpl`, `swift` → `FwTracker.swift.tpl`, `go` → `fw_tracker.go.tpl`, `rust` → `fw_tracker.rs.tpl`. One shape for every language: do NOT create the old `fw-tracker/` DIRECTORY anywhere. **Record each tracker on its surface's own entry — `surfaces[].trackerPath`** (or `rolloutReady.harnesses[].trackerPath`). **Do NOT write the legacy `rolloutReady.trackerPath` / `webTrackerPath`** — they are a two-surface model, superseded, and writing them creates a second source of truth that drifts. An unrecorded tracker downgrades a stamp BLOCK to a warn in `assert_dev_checklist` check 4. `.fireweave/PROVIDERS.md`. **Create NO `rollout-ready/`, NO `changelog/`, NO `_archive/`, and NO `config.json`** — see _What initialise puts in git_ above; manifests and stamps are server-owned and an empty directory is just a second place a future reader looks. Ensure `.fireweave/.gitignore` covers `local.json`, `.cache/`, `.queue/`, `.lock` (the queue tools write these lines — re-check if missing; **never** add an ignore rule that would let a `git clean` sweep `.queue/` unremarked, and never tell a user to delete `.queue/` as a cache remedy). Also write `.fireweave/hooks/rollout-build-gate.mjs` (see **Build-gate script** below) and `.fireweave/hooks/rollout-build-gate.sh` wrapper. |
| **6 — Wire the harness into the app entrypoint** | **Package surface:** put the start call FIRST, exactly as the per-language reference's **Start call** column says — exactly one start per process, nothing FireWeave-related before it, never `initFwHarness()`. **Scaffold surface:** Inject `await initFwHarness()` as the FIRST awaited statement in the detected entrypoint, and record the location in `project.json.rolloutReady.harnessEntrypoint`. `use_mcp_tool(server_name="rollout-server", tool_name="verify_prod_path")` asserts this. |
| **6b — Cohort identity wiring (always-on, INIT-S8)** | Locate (or, with the user's confirmation, wire) the identity bind for each surface — see **Cohort identity wiring** below. The bind runs **unconditionally** on auth / sign-out: never inside a control-point branch, never behind a `// @fireweave-controlpoint` anchor. Record the identity module in `installedInto[]` when initialise writes it. A package surface uses its SDK's own call (per-language reference, **Identity** column). |
| **7 — Standing instructions + agent links** | Write `.fireweave/agent-instructions.md` (see **Agent instructions template** below). Link / upsert standing surfaces for **every agent in Step 2 `teamAgents`**, not only folders present on this machine. **Do not** rely on a one-line link alone: Step 7b is mandatory when `cursor` ∈ `teamAgents`, Step 7c is mandatory when `claude` ∈ `teamAgents`. Each selected host needs its always-on standing surface, not just a link. |
| **7b — Cursor dev loop (when `cursor` ∈ `teamAgents`)** | Write `.cursor/rules/fireweave-rollout-ready.mdc` (always-on rule; see template) — create `.cursor/rules/` if missing. **HARD — Cursor plugin MCP only when this host is Cursor:** do **NOT** write or merge `.cursor/mcp.json`, do **NOT** copy `mcp/rollout-server/` into the repo, do **NOT** download `bin/server-*`. Confirm `list_registered_tools` via the Cursor FireWeave plugin **only when the current host is Cursor**. If initialise runs on a non-Cursor host but `cursor` was selected for teammates, still write the rule/hooks/skills artifacts so they are committed — that does **not** change MCP transport. **`mcp.mode` is host-scoped, not teamAgents-scoped:** set `rolloutReady.mcp.mode = "cursor-plugin"` **only when this host is Cursor**; otherwise set `plugin-launcher` / `cli-install` (and tell non-Cursor hosts to run `fw mcp install`). Never set `cursor-plugin` merely because `cursor` ∈ `teamAgents` for absent teammates. If repo-local `mcp/rollout-server/launcher.sh` already exists on a Cursor host → delete it (and empty workspace `.cursor/mcp.json` that points at it). Ensure the FireWeave skills exist under `.cursor/skills/` (copy from the installed plugin bundle only — includes `adopt` + `feedback`). **Copy each skill's WHOLE directory, never `SKILL.md` alone** — initialise's `harness/**` templates live beside it and Step 4 cannot run without them (C27). Record every path in `installedInto[]` — never include `mcp/`. |
| **7c — Claude Code dev loop (when `claude` ∈ `teamAgents`)** | Symmetric with 7b — the standing rule for Claude Code is the always-loaded `CLAUDE.md` block (Claude has no `alwaysApply` rule file; `CLAUDE.md` IS the always-on surface). **Mandatory when Claude is selected — even if `.claude/` is absent on this laptop:** create `.claude/hooks/` as needed; upsert the **FireWeave rollout-ready HARD ORDER block** into `CLAUDE.md` (see **CLAUDE.md rollout-ready block** template) — a full HARD ORDER, not the one-line pointer. The one-line link alone is NOT sufficient for Claude Code (it under-triggers on large feature prompts). Record `CLAUDE.md` in `installedInto[]`. |
| **8 — Hooks** | **Cursor** (when `cursor` ∈ `teamAgents`): write `.cursor/hooks.json` + executable scripts under `.cursor/hooks/` (see **Cursor hooks**). **Claude Code** (when `claude` ∈ `teamAgents` — MANDATORY, not optional, even if `.claude/` was missing before this run): write executable `.claude/hooks/rollout-intent-gate.sh` (see **Claude Code hook**) and wire `UserPromptSubmit` + `SessionStart` in `.claude/settings.json` using a **fail-open guarded command** so a missing script can never error the hook. **Commit both `.claude/settings.json` AND the hook script** — settings without the script is the drift that silently no-ops the reminder on fresh checkouts/branches. Non-Cursor hosts that need an install-time launcher use `fw mcp install` (`mcp.mode: "cli-install"` / `"plugin-launcher"`) — never Cursor's happy path. |
| **9 — Record + verify** | **Repo-scoped config goes to the server, not into the file.** Make ONE `use_mcp_tool(server_name="rollout-server", tool_name="update_repo_state")` call carrying every field that surface owns — `sourceRoots`, `scanExclude`, `teamAgents` (Step 2), `installedInto[]`, `language`, `strategy`, `mcp.mode` (**host transport only** — `cursor-plugin` when this host is Cursor; else `plugin-launcher`/`cli-install` — never derived solely from `teamAgents`), `sdkDev`, `deploySdkVersion`. **Never hand-write those nine into `project.json`:** one writer, one merge policy. Set fields UNION (so two concurrent `--reinit`s cannot clobber each other) and the FIRST write materialises the full derived set — which is why a partial first call is a one-way door for anchor-scan scope. The write is **online-only and fails closed** (a queued field merge would union against a row that moved underneath it); on `outcome: 'refused'` → PARK, do not fall back to editing the file. The tool writes **no file at all** — the nine fields live only in the server row, so do not look for them in `project.json` afterwards and do not hand-write them there when they are absent. **The pointer keeps only what has no server home:** identity (`select_project` owns `orgId`/`projectId`/`projectName`/`projects{}`), `server.url`, top-level `surfaces[]` (the `sfc_` ids Step 3f's server declaration returned + per-surface `path`/`entrypoint`/`rolloutCredentialEnv`), `defaultEnvironment`, and the residual `rolloutReady` keys listed under **Pointer residue** below. **Add nothing else to `rolloutReady`.** Keep `environments` in sync with the harness `FW_ENV_PROFILES` (scaffold surfaces). A package surface's entry carries `harnessKind: 'package'`, `startProfile` (`dart`, `swift`), `sdk: { name, version, channel }` from the install, its stamps file as `trackerPath`, and `rolloutCredentialEnv`. **Reconcile manifest credential env:** resolve each feature's manifest through the seam and re-author it with `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` when `harness.rolloutCredentialEnv` does not match the surface — `ts-server` → `FW_PROJECT_API_KEY`, `web` → `PUBLIC_FW_PROJECT_API_KEY`, `python`/`java` → `FW_PROJECT_API_KEY`; a package surface → `FIREWEAVE_KEY` (server profile) or `FIREWEAVE_BROWSER_KEY` (client profile) (see **Credential env canon**); never edit a manifest file in place. Run `use_mcp_tool(server_name="rollout-server", tool_name="detect_rollout_ready")` (anchor scan works). Run `use_mcp_tool(server_name="rollout-server", tool_name="reconcile")` with `phase: "build"` (must pass when no orphan anchors exist under `sourceRoots`). **Smoke:** run `use_mcp_tool(server_name="rollout-server", tool_name="verify_prod_path")` on one manifest per surface present with `{ feature }`; fix any **fail** before declaring done. A package surface runs the package check set (`sdk-floor`, `start-first`, `one-start`, `no-hand-rolled-init`, `key-family`, `start-profile`, plus its language's own); a `warn` is advisory and is reported, not fixed by force. **Hard assert (no credential on disk):** `fireweave.md` exists at the repo root when a scaffold surface exists, and no tracked or un-ignored file under the workspace contains a `project-api-key_` / `fw_public_` / `fw_ingest_pub_` prefix followed by key material. Initialise never writes a key into the workspace — an issued browser key goes straight to its build destination — so a match means a credential was pasted into the repo — stop and tell the user to move it to the deploy environment and rotate. **Hard assert (surface IDs are the server's):** every `surfaceId` in `project.json` `surfaces[]` MUST appear in Step 3f's declare output (harnesses carry no surface-ID block — the pointer is the only local record). Fix by re-running `fw repo declare-surfaces` and using what it returns — **never by minting an id** to make the grep pass. **Hard assert (identity never control-point-gated — INIT-S8):** no identity call (`identify` / `reset` / `setContext({ targetingKey })` / `reloadFeatureFlags` / `reload*Flags` / `bind*User`) may sit inside a control-point branch or under a `// @fireweave-controlpoint` anchor. `use_mcp_tool(server_name="rollout-server", tool_name="assert_dev_checklist")` enforces this on every feature; at init, spot-check the surface's auth path — a control point cannot gate the targeting-key bind it depends on. Fix by hoisting the bind out of the branch before declaring done. The gate ships with the FireWeave plugin publish — standing `.cursor/skills` copies refresh via adopt/`--reinit` from the installed bundle. **Hard assert (Cursor):** `mcp/` must not exist under the repo when `mcp.mode` is `cursor-plugin`. **Hard assert (feedback reachable):** the `feedback` skill exists in the installed set for every agent in `teamAgents`. It is the only path a user has to report that FireWeave itself misbehaved, so a repo that initialises without it is a repo whose failures are invisible. **Hard assert (Claude Code) — when `claude` ∈ `teamAgents`:** (a) `CLAUDE.md` contains the rollout-ready HARD ORDER block (not just the one-line link); (b) `.claude/hooks/rollout-intent-gate.sh` exists AND is executable (`chmod +x`); (c) `.claude/settings.json` references it under `UserPromptSubmit` and `SessionStart` with the fail-open guarded command; (d) `git check-ignore` does NOT match the hook script or `CLAUDE.md` (they MUST be committable — an ignored/uncommitted hook is the drift that no-ops on fresh checkouts). Fix any miss before declaring done. **Report the harness — FIR-359:** once the smoke above passes, send the report **over the CLI profile**, not the project API key: `fw api POST /v1/projects/{projectId}/harness-migration --body '{"status":"migrated","repo":"<owner/name>","sdkVersion":"<@fireweaveai/server-sdk version installed>","surfaces":[<every surface wired this run>]}'`. `repo` is this repository's `owner/name` (the one Step 0d asked about): the report is per repository, and it is what marks this repository initialised and closes any setup PR FireWeave opened for it. Use `fw api` (authenticated by the Step-0 profile) rather than a raw `Authorization: Bearer {FW_PROJECT_API_KEY}` POST — `FW_PROJECT_API_KEY` is the runtime ingest plane, and this endpoint does not accept it (`migrate-harness` reports the same way) — **a dev-only project never gets that key.** Initialise never holds `FW_PROJECT_API_KEY` at all — the operator issues it in the portal — so a key-bearing POST has nothing to authenticate with; the profile is always present because Step 0 gated on it. This is not optional bookkeeping: the project page pairs this report against the control-points binding, and auto-bind puts every new environment on managed PostHog, so a project that never reports sits permanently in "FireWeave ramps control points the running app does not read" with no action that clears it. Report `partial` — naming the gap in `notes` — when any detected surface was left reading its provider directly (e.g. a surface whose SDK install `resolve_sdk_install` refused); report `migrated` only when every surface wired this run reads through FireWeave. **Never report `migrated` to make the page green** — the page exists to show when the two halves disagree. On a non-2xx, say so in the session summary and name the project page as still-warning; do NOT PARK (the harness itself is wired and committed — an unreported success is a stale page, not a broken repo). **Reload notice — INIT-A4:** name **only** the agents whose **reloadable standing-loop artifacts were written this run** (derive from paths appended to `installedInto[]` this run — e.g. Cursor rule/hooks → reload Cursor; Claude HARD ORDER + hooks → next Claude session). Do **not** name link-only / experimental hosts that got only a thin agent-instructions link (nothing to reload). Never hardcode Cursor. Mention `/fireweave:adopt` for teammates who later use an agent not in `teamAgents` (`--reinit` may also restore loops — prefer `adopt` for standing-loop-only gaps). |

**`--reinit`** re-detects agent/language **and re-enumerates environments** (regenerates the env→tier profile map / harness `FW_ENV_PROFILES` from `list_project_environments`); re-resolves the prod-tier capability bindings; **always re-runs** `record_rollout_env_contract` when a prod-tier env exists (refreshes `fireweave.md` + `.env.example`; it mints nothing, so there is no key to rotate); refreshes harness/tracker/strategy, manifest credential-env fields, API build script, **and the dev-loop artifacts for the resolved refresh set** — Cursor (rule/hooks) when `cursor` ∈ set AND Claude Code (`CLAUDE.md` block + `.claude/hooks/rollout-intent-gate.sh` + `.claude/settings.json` wiring) when `claude` ∈ set. **Refresh-set resolution (N1 — absent ≠ empty):**

1. If `rolloutReady.teamAgents` is a **present** array (including `[]`) → use it as-is. An explicit empty array means refresh **no** agent loops (intentional post-`--remove`).
2. If `teamAgents` is **absent** (pre-teamAgents initialisation) → **never** treat that as `[]`. Derive the set from (a) agents implied by remaining `installedInto[]` paths (e.g. `.cursor/rules/fireweave-rollout-ready.mdc` / `.cursor/hooks/fireweave-rollout-*.sh` → `cursor`; `CLAUDE.md` / `.claude/hooks/rollout-intent-gate.sh` / `.claude/settings.json` → `claude`) and (b) disk markers that already carry FireWeave standing-loop artifacts (HARD ORDER block / FireWeave rule / intent-gate — **not** bare `.cursor/` or `.claude/` alone). Write the resolved sorted set back as `teamAgents`, then refresh that set.

Reinit MUST re-create a missing/ignored Claude hook script and re-assert the `CLAUDE.md` block when `claude` ∈ the resolved set (do not skip on "settings entry already present" — verify the script file itself exists and is executable). Reinit **also mints surface IDs and writes the canonical top-level `surfaces[]`** into `project.json` — see **`--reinit` — mint surface IDs + write `surfaces[]`** below. **Reinit MUST refresh the copied FireWeave skill directories** — see **Skill copies are copies (C27)** below; a repo whose data migrated while its skill copies stayed stale is the worst failure mode this skill has. Reinit **never touches change stamps or manifests**: both are server-owned, `--reinit` is a harness/loop refresh, and re-authoring a manifest it did not author would displace a contract.

**`--reinit` on a package surface** re-runs `resolve_sdk_install` (`harnessKind:
'package'`) for the 3.0.0 floor, re-checks that the start call is still first and
the only one, and re-runs `record_rollout_env_contract` in package mode. It
**never** rewrites the control-points file, the start call's options or the web
build helper's options — they are the user's. It never moves a scaffold surface onto
the start profile; that is `/fireweave:migrate-harness`.

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

Every clarification uses `ask_followup_question`.

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
| `environments` / `defaultEnvironment` / `promotionEnvironment`                                                                                  | Read by `resolve-project-environment` to pick the prod-tier environment.                                                                                | Step 3a / 9                   |
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
   `use_mcp_tool(server_name="rollout-server", tool_name="refresh_agent_skills")` with
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
      "production": { "tier": "prod" }
    }
  }
}
```

After writing `surfaces[]`, run `use_mcp_tool(server_name="rollout-server", tool_name="verify_rollout_config_schema")`
against the repo (a `--reinit` dry-run) and confirm it **passes** — it validates
the `surfaceId` format and the `surfaces[]` / legacy `rolloutReady` coexistence.
Fix any schema finding before declaring the reinit done. **Hard assert (surface
IDs are the server's):** every `surfaceId` written into `surfaces[]` MUST be one
step 2's declaration returned — never a hand-minted value that satisfies the
schema's shape while naming an id the server never issued.

---

## Prod runtime credentials (Step 3 — URL + key, same treatment)

**A package surface needs ONE variable, not a pair (K11).** A server profile reads
`FIREWEAVE_KEY` (the project key, `project-api-key_…`, issued in the portal's
**Project API keys** panel — never by this skill) from the process environment, set
once per prod-tier destination; the endpoint is the SDK channel, so there is no
`FW_API_URL`, and `FIREWEAVE_URL` exists only when `server.kind === 'custom'`. A
client profile (web, a Dart client, a Swift app) is built with
`FIREWEAVE_BROWSER_KEY` (a browser key, `fw_public_…`, from
`use_mcp_tool(server_name="rollout-server", tool_name="issue_browser_key")`, or the **Browser keys** panel when the tool
answers `fallback-portal`), set once per **build** destination and never in a
developer `.env`. The start profile refuses the wrong family at start: a browser key
in a server, a project key in a client. The rest of this section is the scaffold
pair.

`FW_API_URL` (the fw-server base URL) and `FW_PROJECT_API_KEY` (the bearer the prod control-points path sends to fw-server `/v1/control-points/evaluate`, `/v1/capture`, `/v1/targets/register`) are a **pair**. Initialise documents them together — never one without the other. Nothing about this pair is attestation: it is how the PROD CONTROL-POINTS branch authenticates.

**Initialise writes no secret, and mints no project key.** Both key families can be issued by the operator in the portal, on one page — **Project settings → API keys** (`/projects/<projectId>/settings?tab=api-keys`) — which carries a panel for each:

| Panel                | Issues              | Variable                                                                   | Where it may go                                                                       |
| -------------------- | ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Project API keys** | `project-api-key_…` | `FIREWEAVE_KEY` (package) · `FW_PROJECT_API_KEY` (scaffold)                | Server-side only — never a browser bundle, never a commit                             |
| **Browser keys**     | `fw_public_…`       | `FIREWEAVE_BROWSER_KEY` (package) · `PUBLIC_FW_PROJECT_API_KEY` (scaffold) | Designed to ship in a client build; scoped `control-points:evaluate` + `events:write` |

**The two are not interchangeable and never share a key.** A web surface takes the browser key; putting the project key (`project-api-key_…`) in a bundle hands out an unscoped credential. `runtime-proxy/AUTH.md` is the source of truth for the families.

A key that is never written cannot be committed, cannot rot in a stale gitignored file, and never passes through an agent's context window.

| Artifact                              | Purpose                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `fireweave.md` (repo root)            | **Committed.** Names every variable per surface, which panel issues which key, and why a missing credential is a boot failure. No values. |
| `.env.example`                        | Names only (`FW_API_URL=`, `FW_PROJECT_API_KEY=`; `PUBLIC_FW_*` when web surface)                                                         |
| `project.json.rolloutReady.attestUrl` | Committed fw-server base URL (not secret; legacy KEY name, current VALUE)                                                                 |
| Cloud deploy secrets                  | Operator sets both vars in **each prod-tier environment's** runtime, from the portal                                                      |

**Order (SCN-16, relaxed):** Step **3c** still asks where each prod-tier environment runs, so the operator knows where the pair goes — but it is no longer gating a secret write, because there is no secret write. Step **3e** calls `record_rollout_env_contract` after the capability gates, **before** persisting env/`teamAgents` into `project.json`.

**Tool:** `use_mcp_tool(server_name="rollout-server", tool_name="record_rollout_env_contract")` — records the env contract only. It calls no key endpoint and returns no credential. (`provision_deploy_beacon_env` is a deprecated alias for one release, running the same handler, so an older skill copy cannot get the old side effects.) Pass `webappUrl` when the dashboard origin is known: a webapp host **cannot be derived from an API host** (fw-cli records the same limitation in `login.ts`), so without it the tool emits the PATH rather than guessing a URL.

**After the tool returns (soft continue, not PARK):** show its `userPrompt` — it names the portal page, the panel per key, and the variables for the surfaces this repo actually has — and point the user at `fireweave.md` for the full list. **Verification is on trust:** no tool reads back a remote secret store; the enforcing gate is the prod harness refusing to boot when the pair is absent. Await user confirmation as **awaiting-user** — do not label this wait PARK (disk was intentionally written at the commit-point).

**Prod-tier only.** The pair belongs wherever a **prod-tier** environment runs — never in the default/dev environment. If the project has no prod-tier environment, Step 3c skips the destination question entirely (nothing to set yet); `fireweave.md` is still written, because it is the record of what a future prod environment will need. When a prod-tier env exists, set the pair once per prod-tier environment's runtime (a `staging` service and a `production` service each need their own copy). Each service is scoped by **the project's own env signal** (Step 3d) — a separate `FW_ENV` is not required unless the user opted into the FireWeave-var source.

**Local dev needs neither variable.** The dev tier runs the FireWeave local provider in-memory. There is no `mergeRootEnvLocal` option any more — writing a live credential into a repo-root `.env.local` was the thing this change removed.

**Never commit** `FW_PROJECT_API_KEY`, and never write it into any file. The operator holds it from the portal to their deploy environment; nothing in the repo is a staging post for it.

---

## Environment source (Step 3d — the project's own env signal, never a mandated `FW_ENV`)

**Scaffold surfaces only.** A package surface skips this interview: the start
profile reads `FIREWEAVE_ENV` / `APP_ENV` itself, and Step 3d asks it one question.

The harness must learn the running environment NAME from **whatever this repo / its
CI-CD platform already uses** — it must NOT force the developer to introduce a
FireWeave-specific `FW_ENV` (server) / `PUBLIC_FW_ENV` (web) var just so our SDK can
tell environments apart. The generated harness owns detection via a `readEnvSignal()`

- `FW_ENV_ALIASES` block (the `// fw:env-source` region of the template), and uses
  the resolved name (`fwEnvName`) to select the tier.
  `FW_ENV` / `PUBLIC_FW_ENV` remain an **optional override only** (highest precedence
  inside the SDK, but the harness need not read them).

**Always confirm the source with `ask_followup_question` before scaffolding** — do not
silently pick FireWeave's var. Offer, tailored to the Step-2 deploy-target detection:

| Option                                                       | Generated `readEnvSignal()` reads                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **My app's standard var** (recommended when present)         | `NODE_ENV` (ts-server) / `import.meta.env.MODE` (web)                                                                                            |
| **A platform var**                                           | the detected platform's var — e.g. `VERCEL_ENV`, `RAILWAY_ENVIRONMENT`, `RENDER` / `RENDER_SERVICE_NAME`, `FLY_APP_NAME`, a K8s downward-API var |
| **A function/module in my repo**                             | import + call the user-named resolver (e.g. `getEnvironment()`)                                                                                  |
| **FireWeave's `FW_ENV` / `PUBLIC_FW_ENV`** (opt-in fallback) | the FireWeave var — only when the user has no existing signal                                                                                    |

Then reconcile the source's **raw values** with the `FW_ENV_PROFILES` keys from Step 3a.
When they differ (e.g. the platform emits `production`/`preview` but FireWeave names the
environments `prod`/`uat`), `ask_followup_question` to confirm the mapping and emit it as
`FW_ENV_ALIASES` (e.g. `{ production: 'prod', preview: 'uat' }`). When they already match,
leave `FW_ENV_ALIASES` empty (identity). Unknown values still fall through to the
`FW_ENV_PROFILES` miss → `isProd()` fallback + warn (unchanged).

On `--reinit`, re-confirm the source and regenerate the `// fw:env-source` block; never
overwrite a user-customised `readEnvSignal()` without surfacing the diff.

---

## Start profile — per-language reference (package surfaces: Steps 3d, 4, 5, 6, 6b)

One row per language. Step 4 writes the control-points file and the start call
below; Step 6 places the start call FIRST; Step 6b wires the identity call; the
read form is what `.fireweave/agent-instructions.md` teaches. The SDK floor is
3.0.0 everywhere (staging: `3.0.0-rc.N`, Python `3.0.0rcN`), resolved by
`use_mcp_tool(server_name="rollout-server", tool_name="resolve_sdk_install")` with `harnessKind: 'package'` — and, for
`dart` / `swift`, `startProfile` from `detect_surfaces` — which records
`surfaces[].sdk = { name, version, channel }`. That channel **is** the endpoint the app
calls (`staging` → `staging-app-server.fireweave.ai`, `stable` → `app-server.fireweave.ai`);
say so in the install summary.

| Language    | SDK + start entry                                                                                                    | Control-points file                                                     | Start call (placed FIRST)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Identity (unconditional, never behind a control point)                                                                 | Read form (default always `false`, RAMP-1)                                                                                     | Local runs                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `@fireweaveai/server-sdk`, `/start`                                                                                  | `src/fireweave/control-points.ts`                                       | `src/fireweave/start.ts` calls `start({ controlPoints })`; the entrypoint's FIRST import is `import './fireweave/start';`                                                                                                                                                                                                                                                                                                                                                                                                                                       | `await fw.identify(user.id, props)` at sign-in; `fw.instanceKey()` only when the server itself is the subject          | `await fw.controlPoints.getBooleanValue('<key>', false, { targetingKey: user.id })`                                            | `NODE_ENV` (or `APP_ENV`, `FIREWEAVE_ENV`) = `development` — usually already set                                                                                                                        |
| `web`       | `@fireweaveai/web-sdk`, `/start` + `/vite` + `/define`                                                               | `src/fireweave/control-points.ts`                                       | `src/fireweave/start.ts` exports `ready = start({ controlPoints })`; the entry module's FIRST import is `import { ready } from './fireweave/start';` and the first render waits for `ready`. SvelteKit: `src/hooks.client.ts`. Next.js: `instrumentation-client.ts` (Next ≥ 15.3) or a `'use client'` provider re-rendering through `fw.subscribe`. Angular: `start(...).then(() => bootstrapApplication(...))`. Build config: `fireweave()` (Vite, SvelteKit, React Router 7, Nuxt, Astro) or `fireweaveDefine()` (Next.js, webpack, esbuild, Rollup, Angular) | `await fw.identify(user.id, props)` at sign-in AND session restore, `await fw.reset()` at sign-out                     | `fw.controlPoints.getBooleanValue('<key>', false)` — synchronous, never a per-call `targetingKey`                              | `vite dev` and Vitest are local by default; elsewhere `FIREWEAVE_ENV=development` for that run                                                                                                          |
| Python      | `fireweave`, `fireweave.start`                                                                                       | `fireweave_setup/control_points.py` (never a package named `fireweave`) | `start(control_points=control_points)` as the first lines of EVERY process entrypoint — `main.py`, `wsgi.py`, `asgi.py`, `create_app()`, the Celery app module, a multiprocessing initializer; a root `conftest.py` starts local for tests                                                                                                                                                                                                                                                                                                                      | `fw.identify(user_id, props)` at sign-in (async code: `asyncio.to_thread`); guard anonymous users, whose id is `None`  | `fw.control_points.get_boolean_value('<key>', False, EvaluationContext(user_id))`; async: `await asyncio.to_thread(lambda: …)` | python-dotenv / django-environ: `FIREWEAVE_ENV=development` in `.env`; pydantic-settings / decouple / dynaconf: the dev process exports it                                                              |
| Go          | `github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3`, package `/v3/fw`                                                 | `internal/fireweave/control_points.go`                                  | `fw.Start(fw.Options{ControlPoints: appfw.ControlPoints})` (or `fw.MustStart`) in the serving path of each `main`, AFTER the app's own config loading and flag parsing; functions-framework-go: a `sync.Once` start at the top of each handler, never `init()`                                                                                                                                                                                                                                                                                                  | `go func() { _ = fw.Identify(ctx, user.ID, props) }()` at sign-in, off the request path                                | `fw.ControlPoints().GetBooleanValue("<key>", false, fw.For(user.ID))`                                                          | `FIREWEAVE_ENV=development` in the dev run config (Makefile, compose, `.envrc`)                                                                                                                         |
| Java        | `ai.fireweave:fireweave-sdk`, `ai.fireweave.sdk.start.Fw`                                                            | `FireweaveControlPoints.java` (the app's base package)                  | `Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build());` first in `main` after config loading; Spring Boot: before `SpringApplication.run`; servlet apps: `ServletContextListener.contextInitialized`                                                                                                                                                                                                                                                                                                                   | `Fw.identify(userId, Map.of(...))` at sign-in (it never throws)                                                        | `Fw.controlPoints().getBooleanValue("<key>", false, EvaluationContext.builder().targetingKey(userId).build())`                 | `FIREWEAVE_ENV=development` in the run configuration (Maven `exec` / Gradle `run`, IDE, compose); Spring profiles are not read                                                                          |
| Rust        | crate `fireweave`, `fireweave::start`                                                                                | `src/fireweave_control_points.rs` (never a local `mod fireweave`)       | `fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() })?;` first in each server binary's `main`, after config loading                                                                                                                                                                                                                                                                                                                                                                       | `let _ = fireweave::start::identify(&user.id, [...]);` at sign-in (async code: `spawn_blocking`)                       | `fireweave::start::control_points().get_boolean_value("<key>", false, Some(&ctx))` — blocking: `spawn_blocking` in async code  | `.cargo/config.toml` `[env] FIREWEAVE_ENV = "development"` at the workspace root (cargo only)                                                                                                           |
| Dart        | `fireweave`; `package:fireweave/client.dart` (Flutter, Dart web) or `package:fireweave/server.dart` (Dart VM server) | `lib/fireweave/control_points.dart`                                     | `await Fireweave.start(controlPoints: controlPoints);` in `main` before `runApp` (Flutter), before serving (shelf), in `init()` (dart_frog); every isolate that reads must start. Never `server.dart` in a Flutter app                                                                                                                                                                                                                                                                                                                                          | client: `await fw.identify(user.id, properties: {...})` at sign-in and session restore, `await fw.reset()` at sign-out | `fw.controlPoints.getBooleanValue('<key>', false)` — synchronous, safe in `build()`                                            | client: `--dart-define=FIREWEAVE_ENV=development` in DEBUG launch configs only (`.vscode/launch.json`, Android Studio), never a release define file; server: `FIREWEAVE_ENV=development` in the dev run |
| Swift       | product `FireweaveStart`, from the SDK's mirror repository                                                           | `FireweaveLocalControlPoints.swift`                                     | app: `startFireweave(controlPoints: appControlPoints)` in SwiftUI `App.init()` or the first line of `didFinishLaunching` (it never throws); server: `try startFireweave(FireweaveStartOptions(controlPoints: appControlPoints))` then `await fw.ready()` in `configure`                                                                                                                                                                                                                                                                                         | app: `await fw.identify(user.id, properties: [...])` at sign-in and session restore, `await fw.reset()` at sign-out    | `fw.controlPoints.getBooleanValue("<key>", default: false)` — synchronous                                                      | app: nothing — a debug build with no key and no environment name is development; server: `FIREWEAVE_ENV=development` in the scheme or run environment                                                   |

**Files Step 4 writes** (the comments are part of the file; uncomment nothing — the
user seeds control points as features arrive):

```ts
// src/fireweave/control-points.ts — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
import { defineControlPoints } from '@fireweaveai/server-sdk/start'; // web: '@fireweaveai/web-sdk/start'

export const controlPoints = defineControlPoints({
  // 'new-checkout': { local: true },
});
```

```ts
// src/fireweave/start.ts — the app's only FireWeave setup. Imported FIRST by the entrypoint.
import { start } from '@fireweaveai/server-sdk/start';
import { controlPoints } from './control-points';

start({ controlPoints });
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides".
//   mode: 'local' | 'remote'          force a mode
//   environment: process.env.STAGE    your own environment variable for mode inference
//   url: 'https://flags.example.com'  self-hosted fw-server
//   key: secrets.fireweaveKey         key from your own secret store
```

```ts
// src/fireweave/start.ts (web) — the app's only FireWeave setup. Imported FIRST by the entry module.
import { start } from '@fireweaveai/web-sdk/start';
import { controlPoints } from './control-points';

export const ready = start({ controlPoints });
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (web)".
//   mode: 'local' | 'remote'          force a mode
//   environment: 'staging'            environment name for mode inference
//   url: '/fw'                        a same-origin proxy, or a self-hosted fw-server URL
//   persistence: 'memory'             store nothing until consent (then fw.setPersistence('localStorage'))
//   deviceId: analytics.anonymousId() reuse your analytics id as the anonymous key
```

```ts
// vite.config.ts (Nuxt / Astro: the same call under `vite: { plugins: [...] }`)
import { fireweave } from '@fireweaveai/web-sdk/vite';
export default defineConfig({
  plugins: [, /* framework plugin */ fireweave()],
});

// next.config.mjs (and other non-Vite bundlers: the same object through their define plugin)
import { fireweaveDefine } from '@fireweaveai/web-sdk/define';
const fireweave = fireweaveDefine();
export default {
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.DefinePlugin(fireweave));
    return config;
  },
};
```

```python
# fireweave_setup/control_points.py — every control point this app reads, with its LOCAL value.
# Production values come from FireWeave rollouts, never from this file.
from fireweave.start import define_control_points

control_points = define_control_points({
    # "new-checkout": {"local": True},
})

# the entrypoint, FIRST lines (main.py / wsgi.py / asgi.py / create_app() / the Celery app module)
from fireweave.start import start
from fireweave_setup.control_points import control_points

start(control_points=control_points)
# Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Python)".
#   mode="local" | "remote"           force a mode
#   environment=settings.DEPLOY_STAGE your own environment name for mode inference
#   url="https://flags.example.com"   self-hosted fw-server
#   key=secrets["fireweave"]          key from your own secret store
```

```go
// internal/fireweave/control_points.go — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
package fireweave

import "github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3/fw"

var ControlPoints = fw.DefineControlPoints(fw.LocalControlPoints{
	// "new-checkout": {Local: true},
})

// main.go, in the serving path after the app's own config loading
if err := fw.Start(fw.Options{ControlPoints: appfw.ControlPoints}); err != nil {
	log.Fatal(err)
}
defer fw.Shutdown(context.Background())
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Go)".
//   Mode: fw.ModeLocal | fw.ModeRemote   force a mode
//   Environment: cfg.Stage               your own environment name for mode inference
//   URL: "https://flags.example.com"     self-hosted fw-server
//   Key: secrets.FireweaveKey            key from your own secret store
```

```java
// FireweaveControlPoints.java — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
public final class FireweaveControlPoints {
    public static final LocalControlPoints CONTROL_POINTS = Fw.defineControlPoints(Map.of(
            // "new-checkout", LocalControlPoint.local(true)
    ));
    private FireweaveControlPoints() {}
}

// main(), first thing after the app's own config loading
Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build());
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Java)".
//   .mode(Mode.LOCAL | Mode.REMOTE)        force a mode
//   .environment(config.deployStage())      your own environment name for mode inference
//   .url("https://flags.example.com")       self-hosted fw-server
//   .key(secrets.fireweaveKey())            key from your own secret store
```

```rust
// src/fireweave_control_points.rs — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
use fireweave::start::{define_control_points, LocalControlPoint, LocalControlPoints};

pub fn control_points() -> LocalControlPoints {
    define_control_points([
        // ("new-checkout", LocalControlPoint::local(true)),
    ])
}

// src/main.rs, first thing in main after the app's own config loading
fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() })?;
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Rust)".
//   mode: Some(Mode::Local | Mode::Remote)     force a mode
//   environment: Some(cfg.stage.clone())       your own environment name for mode inference
//   url: Some("https://flags.example.com".into())  self-hosted fw-server
//   key: Some(secrets.fireweave_key.clone())   key from your own secret store
```

```dart
// lib/fireweave/control_points.dart — every control point this app reads, with its LOCAL value.
import 'package:fireweave/client.dart'; // server.dart on a Dart server

final controlPoints = defineControlPoints({
  // 'new-checkout': LocalControlPoint.local(true),
});

// lib/main.dart
Future<void> main() async {
  await Fireweave.start(controlPoints: controlPoints); // never throws on the client
  runApp(const App());
}
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Dart)".
//   mode: Mode.local | Mode.remote   force a mode
//   environment: 'staging'           environment name for mode inference
//   url: 'https://flags.example.com' self-hosted fw-server
//   deviceId: analyticsId            reuse your analytics anonymous id (client)
```

```swift
// FireweaveLocalControlPoints.swift — every control point this app reads, with its LOCAL value.
import FireweaveStart

let appControlPoints = defineControlPoints([
  // "new-checkout": .local(true),
])

// App.init() / didFinishLaunching (app) — server: `try startFireweave(FireweaveStartOptions(controlPoints: appControlPoints))` in configure
startFireweave(controlPoints: appControlPoints)
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Swift)".
//   mode: .local | .remote               force a mode
//   environment: "staging"               environment name for mode inference
//   url: "https://flags.example.com"     self-hosted fw-server
//   persistence: .memory                 store nothing until consent (app)
```

When Step 3d found a project-specific environment variable, the `environment`
override is written uncommented, read from the app's own config. A URL is never
written into code: `FIREWEAVE_URL` sits beside the key (Step 3c) when `server.kind
=== 'custom'`.

**Client profiles, three more things.** _Consent:_ if the app has a consent
manager, start with `persistence: 'memory'` (web) / `persistence: .memory` (Swift app)
and wire the stored setting to consent given (`fw.setPersistence('localStorage')` /
`.userDefaults`) and `fw.forget()` to withdrawal; Dart: a `DeviceIdStore` only after
consent, `fw.reset(rotateDeviceId: true)` on withdrawal. Otherwise leave the default.
_Re-render:_ components drawn before the first decisions arrive re-render through
`fw.subscribe(...)` (web), `fw.changes.listen(...)` (Dart) or `fw.updates` /
`await fw.ready()` (Swift). _CSP (web):_ in remote mode the page's `connect-src` must
allow the fw-server origin — add it where initialise can edit the policy
(`index.html` meta, `helmet`, `next.config` headers, SvelteKit `kit.csp`), else name
it to the user; `verify_prod_path` only warns (`csp-connect-src`), since a header set
by a CDN is invisible to it.

**Distributed binaries and client-shipped code never get a server key.**
`detect_surfaces` marks them `clientShipped: true` (Tauri, Leptos `hydrate`,
goreleaser / wails / fyne / gomobile binaries, Flutter apps, Xcode apps): wire them as
a client profile with a browser key, or not at all.

---

## Harness templates — where they live (Step 4)

**Scaffold surfaces only — a package surface uses none of these templates** (its
files are the per-language reference's).

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

| Surface     | Template dir         | Read → write (into the repo's `fireweave/` dir; `fireweave_harness/` for Python)                                                                                              |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `harness/ts-server/` | `fw-harness.ts.tpl` → `fireweave/fw-harness.ts`; `fw-providers.ts.tpl` → `fireweave/fw-providers.ts`; `fw-tracker.ts.tpl` → `fireweave/fw-tracker.ts`                         |
| `web`       | `harness/web/`       | `fw-harness.ts.tpl` → `fireweave/fw-harness.ts`; `fw-providers.ts.tpl` → `fireweave/fw-providers.ts`; `fw-tracker.ts.tpl` → `fireweave/fw-tracker.ts`                         |
| `python`    | `harness/python/`    | `fw_harness.py.tpl` → `fireweave_harness/fw_harness.py`; `fw_providers.py.tpl` → `fireweave_harness/fw_providers.py`; `fw_tracker.py.tpl` → `fireweave_harness/fw_tracker.py` |
| `java`      | `harness/java/`      | `FwHarness.java.tpl` → `fireweave/FwHarness.java`; `FwProviders.java.tpl` → `fireweave/FwProviders.java`; `FwTracker.java.tpl` → `fireweave/FwTracker.java`                   |
| `swift`     | `harness/swift/`     | `FwHarness.swift.tpl` → `fireweave/FwHarness.swift`; `FwProviders.swift.tpl` → `fireweave/FwProviders.swift`; `FwTracker.swift.tpl` → `fireweave/FwTracker.swift`             |
| `go`        | `harness/go/`        | `fw_harness.go.tpl` → `fireweave/fw_harness.go`; `fw_providers.go.tpl` → `fireweave/fw_providers.go`; `fw_tracker.go.tpl` → `fireweave/fw_tracker.go`                         |
| `rust`      | `harness/rust/`      | `fw_harness.rs.tpl` → `fireweave/fw_harness.rs`; `fw_providers.rs.tpl` → `fireweave/fw_providers.rs`; `fw_tracker.rs.tpl` → `fireweave/fw_tracker.rs`                         |

`.tpl` is stripped on write; the basename is otherwise preserved (Python's
snake_case and Java's PascalCase names are already correct in the template
filenames — see the **Python surface** / **Java surface** sections below; for
Java, `fireweave/` is the `<base package>.fireweave` package directory and the
templates' `package fireweave;` line is rewritten to match). Two files have
**no** template and are authored by their own
step: `fireweave_harness/__init__.py` for Python, and the `fw-tracker` const tree for
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
- the prod branch, per Step 3b: the connected vendor's control-point provider. **This one
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

## Python surface (Step 2 / 4 / 6 — control points prod-capable)

**Detect (Step 2).** A Python surface is present when the repo has `pyproject.toml`,
`setup.py`/`setup.cfg`, `requirements*.txt`, or a package of `*.py` under the source
root. Classify it as surface `python` — **prod-capable for control points** (`SURFACE_REGISTRY`
lists it with the `fireweave` vendor).

**Scaffold surfaces only** — a new Python surface is a package surface (`fireweave.start`;
see **Start profile — per-language reference**).

**Scaffold (Step 4).** Generate from `harness/python/` (all three `.tpl` files;
path resolved as in **Harness templates — where they live**) into a `fireweave_harness/`
package at the idiomatic source root — **never `fireweave/`, which shadows the
`fireweave` PyPI SDK in a flat layout** (`from fireweave import init_fireweave` would
import the harness package and fail at boot) — using **snake_case module names**
(Python cannot import hyphenated modules): `fireweave_harness/fw_harness.py`,
`fireweave_harness/fw_providers.py`, `fireweave_harness/fw_tracker.py`, plus
`fireweave_harness/__init__.py`. Regenerate `FW_ENV_PROFILES` + `FW_DEFAULT_ENV` from
Step 3a and the `# fw:env-source` block from Step 3d (Python reads `os.environ`;
default `_read_env_signal` prefers `APP_ENV`/`ENVIRONMENT`/`ENV`, FW_ENV last).
**Both branches are real and go through ONE entry point of the `fireweave` PyPI
SDK:** `init_fireweave(mode="local", …)` for dev and `init_fireweave(mode="remote",
…)` for prod. The SDK reads no environment, so `fw_providers.py` resolves `FW_API_URL`

- `FW_PROJECT_API_KEY` from `os.environ` and passes them as explicit `api_url` /
  `api_key` options, refusing loudly when either is missing. The harness wires no
  telemetry on either tier.

**Wire the entrypoint (Step 6).** Inject `init_fw_harness()` as the FIRST statement
of the app's entrypoint — top of `if __name__ == "__main__":` for a script, or the
ASGI/WSGI **app factory** (e.g. `create_app()` before returning) / the module that
constructs the FastAPI/Flask/Django app. It is synchronous (no `await`). Record the
location in `project.json` `rolloutReady` (see harnesses[] below).

**Record (Step 9) — write the `harnesses[]` shape.** Persist this surface into
`project.json` `rolloutReady.harnesses[]` (the surface-keyed list read by the
`normalizeHarnesses` shim), e.g. `{ "surface": "python", "path":
"fireweave_harness/fw_harness.py", "entrypoint": "<detected entrypoint>" }`. Keep writing the
legacy singular `harnessEntrypoint`/`webHarnessEntrypoint` fields for a ts-server/web
surface too until the contract phase; on `--reinit`, lazily upgrade an existing legacy
`project.json` to include `harnesses[]` (never drop the legacy fields — the shim and
the golden backward-compat test depend on them).

---

## Java surface (Step 2 / 4 / 6 — control points prod-capable)

**Detect (Step 2).** A Java surface is present when the repo has `pom.xml`,
`build.gradle`/`build.gradle.kts`/`settings.gradle*`, or `*.java` sources under
`src/main/java/`. Classify it as surface `java` — **prod-capable for control points**
(`SURFACE_REGISTRY` lists it with the `fireweave` vendor, on the `ai.fireweave`
Maven SDK). Kotlin (`.kt`/`.kts`) is NOT this surface — it stays an ungoverned
scan extension pending its own surface decision.

**Scaffold surfaces only** — a new Java surface is a package surface
(`ai.fireweave.sdk.start.Fw`; see **Start profile — per-language reference**).

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
before any control-point read. It is synchronous (no `await`; `verify_prod_path`'s java
token row greps for the bare call). Anchor control-point call sites with
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

**Scaffold surfaces only** — a new Swift surface is a package surface (the
`FireweaveStart` product, resolved from the SDK's mirror repository; see **Start
profile — per-language reference**). An existing Swift scaffold is **prod-capable**
on the Swift SDK's remote adapter → fw-server `/v1/control-points/evaluate`, through
the `Fireweave` product it already depends on.

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
| `FWProjectApiKey` | project key (`project-api-key_…`)         |
| `FWApiUrl`        | fw-server base URL                        |

Populate them from your build configuration (`$(FW_ENVIRONMENT)` etc. in an
xcconfig) so each build carries its own tier. `makeConnectedVendorProvider()`
**throws** when either credential is missing — a prod-tier build must fail
loudly rather than degrade to local evaluation.

**Reads are SYNCHRONOUS** (the SDK prefetches a decision cache at boot), so they
are safe on the main actor. `initFwHarness()` is async — await it from a `Task`
in your bootstrap before the first read.

### Go surface

**Scaffold surfaces only** — a new Go surface is a package surface (`.../sdks/go/v3/fw`;
see **Start profile — per-language reference**). An existing Go scaffold is
**prod-capable** on the Go SDK's remote adapter → fw-server
`/v1/control-points/evaluate`. Go modules resolve from VCS tags rather than a registry:
`go get github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3@latest` (the newest v3
release, ≥ `v3.0.0`; staging: the highest `v3.0.0-rc.N`). `go.mod` records the exact version `go get`
resolved, by design (limit 1 of **SDK installs never pin an exact version**). The
scaffold always uses the **`/v3`** module path — `/v2` is the retired pre-control-points module, and the unsuffixed `.../sdks/go` module is a different, stale module whose newest tag is
`v0.0.1-staging.2`.

**Scaffold (Step 4).** Generate from `harness/go/` (all three `.tpl` files) into the
repo's `fireweave/` package directory. Go exports are initial-capital, so the
harness spells the tier decision `IsProd()` / `MakeConnectedVendorProvider()` —
`verify_prod_path` greps those capitalised tokens, not the TS ones. Reads:

```go
// fwsdk = "github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3/fireweave"
ec := fwsdk.NewEvaluationContext(userID, nil)
// @fireweave-controlpoint <feature-slug>
if fireweave.GetFwClient().ControlPoints().GetBooleanValue("<feature-slug>", false, &ec) {
}
```

The context is passed by pointer: `GetBooleanValue` takes `*EvaluationContext`.

`InitFwHarness()` is synchronous — call it first in `main()` and fail the
process on a non-nil error.

### Rust surface

**Scaffold surfaces only** — a new Rust surface is a package surface (`fireweave::start`
from the `fireweave` crate at ≥ 3.0.0; see **Start profile — per-language reference**).
An existing Rust scaffold is **prod-capable** on the crate's remote adapter.

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
`FwTracker.swift`, against the `Fireweave` product. Regenerate `FW_ENV_PROFILES` +
`FW_DEFAULT_ENV` from Step 3a and the `// fw:env-source` block from Step 3d. **Both
branches are wired through `initFireweave`:** `makeDevProvider()` brings the SDK up in
local mode, and `makeConnectedVendorProvider()` in remote mode from the Info.plist
credentials above — it **throws** when either is missing, so a prod-tier build fails
loudly instead of degrading to local evaluation. Leave that throw exactly as
scaffolded.

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

FireWeave remote control-point evaluation credential env names differ by harness surface (apps call fw-server `/v1/control-points/evaluate`, never PostHog directly). Initialise must keep **`.env.example`**, **`project.json`**, and **each manifest's `harness.rolloutCredentialEnv`** aligned. Seal still provisions flags on FireWeave-managed PostHog server-side — keep `controlPointTelemetryProvider: "connected:posthog"` for control-plane wiring.

| Surface                                 | `harness.rolloutCredentialEnv`                 | Host env                                                                                     | `project.json` field                   |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ts-server`                             | `FW_PROJECT_API_KEY`                           | `FW_API_URL` (fallback `FW_ATTEST_URL`)                                                      | `rolloutReady.rolloutCredentialEnv`    |
| `web`                                   | `PUBLIC_FW_PROJECT_API_KEY`                    | `PUBLIC_FW_API_URL` (fallback `PUBLIC_FW_ATTEST_URL`)                                        | `rolloutReady.webRolloutCredentialEnv` |
| `python`                                | `FW_PROJECT_API_KEY`                           | `FW_API_URL`                                                                                 | per-surface entry in `harnesses[]`     |
| `java`                                  | `FW_PROJECT_API_KEY`                           | `FW_API_URL`                                                                                 | per-surface entry in `harnesses[]`     |
| `swift`                                 | `FW_PROJECT_API_KEY`                           | `FW_API_URL`                                                                                 | per-surface entry in `harnesses[]`     |
| any **package** surface, server profile | `FIREWEAVE_KEY`                                | none — the SDK channel is the endpoint; `FIREWEAVE_URL` only when `server.kind === 'custom'` | `surfaces[].rolloutCredentialEnv`      |
| any **package** surface, client profile | `FIREWEAVE_BROWSER_KEY` (a **build** variable) | none — as above                                                                              | `surfaces[].rolloutCredentialEnv`      |

The `FW_ATTEST_URL` fallbacks are **legacy names, read but never written.**
Nothing emits them any more; harnesses read `FW_API_URL` first and fall back
only for repos scaffolded before the rename, warning once at boot when the
fallback fires so the deploy environment eventually gets renamed. Never scaffold
the legacy spelling into a new repo. `record_rollout_env_contract` appends all required names to `.env.example` when `apiSurface` / `webSurface` are set, and writes them into `fireweave.md`; for a `python` or `java` surface pass `apiSurface: true` (they use the server pair). **Do not** use a single env name across both TS surfaces — `verify_prod_path` checks the manifest's surface-specific name.

On `--reinit`, resolve every feature's manifest **through the seam** and re-author it with `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` (passing the resolved `contentHash` as `baseContentHash`) where `harness.rolloutCredentialEnv` does not match the surface row above. Do **not** patch manifest files in place: there is no manifest file — fw-server holds the row, and anything you write into `.fireweave/rollout-ready/` is a contract no gate, no teammate and no ramp coordinator will ever read. A `conflict` result means a teammate moved the row — re-apply on top of `current` and retry with `baseContentHash = currentContentHash`; never retry with a null base.

---

## API Docker build (Step 4 — ts-server `.mjs` harness)

When the API harness lives under `src/fireweave/*.mjs` (compiled from TypeScript), the package `build` script must copy those files into `dist/` after `tsc`. Without this, Docker images ship without the harness.

Patch `packages/api/package.json` (or the detected API package) `scripts.build`:

```json
"build": "tsc && mkdir -p dist/fireweave && cp src/fireweave/*.mjs dist/fireweave/"
```

Record the patched `package.json` path in `installedInto[]` when changed.

---

## Cohort identity wiring (Step 6b) — always-on, never control-point-gated

Manifests declare `context.targetingKey: "userId"` and upstream `%` ramps hash that
subject id. The code that supplies it — `identify` on auth, `reset` on sign-out, the
`targetingKey` carried in the evaluation context, and the cache re-prefetch that
follows each — is the **precondition** for control-point evaluation, not a feature of it.

**Never place it behind a FireWeave control point (INIT-S8).** It deadlocks: the control point evaluates
with no targeting key, RAMP-1 makes the safe default `false`, the bind never runs, and
the key never arrives. The ramp then shows 0% adoption, so it reads as a product
failure instead of a wiring bug.

At init:

1. **Locate the identity seam.** Run `use_mcp_tool(server_name="rollout-server", tool_name="detect_surfaces")` with
   `{ includeAuthSeams: true }` — it returns candidates per surface with file, line, the
   token that matched (`signIn()`, `onAuthStateChanged`, `req.user`, `better-auth`, …) and
   whether the token implies the client or server plane. It **over-reports on purpose**:
   an extra row costs the user a glance, while a MISSED seam means `syncFireweaveUser` /
   `registerFwTarget` never gets wired and every rule on a durable property matches
   nobody — silently, because a rule matching nobody looks exactly like a rule nobody
   triggered. `truncated: true` means the scan hit its file cap: say so rather than
   reporting "no seam found", which is a different claim. Candidates are a SHORT LIST to
   ask about, never an answer — still ask with `ask_followup_question`; do not guess.
2. **Assert it is unconditional.** The bind must not sit inside an `if` / `while` / `switch`
   on a control point, a ternary or `&&` on a control point, a `if (!flag) return` guard clause above it, a
   same-file helper whose _call_ is control-point-gated, or under a `// @fireweave-controlpoint` anchor.
   `use_mcp_tool(server_name="rollout-server", tool_name="assert_dev_checklist")` blocks these shapes on every feature — fix
   at init rather than leaving it for the first ship. **Known limits (still escapes):**
   cross-file / imported helpers, multi-hop wrappers (`wrap → doIdentify → identify`),
   dynamic/computed callees (`fns[name]()`), object-literal helpers (`const helpers = {
doBind: () => identify() }` — same-file function/arrow/method/class-property helpers
   and one-hop control-point helpers _are_ covered), and full Svelte template AST (only `<script>`
   bodies are AST-scanned; `{#if}` / `on:click` handlers get a soft warn when the
   condition looks control-point-bound — not a hard block). Non-TS/JS surfaces (Go/Python/Java/
   Dart/Vue/Astro/…) are skipped with an info finding, not silently. Keep identity
   binds direct and same-module.
3. **Never scaffold the anti-pattern.** Any identity code initialise writes is emitted
   unconditionally. Harness templates deliberately contain no control-point-gated identity call;
   keep it that way on `--reinit`.
4. **Gate the consumer, not the bind.** A new _identity strategy_ still ships ungated;
   if you must compare two strategies, gate the feature that reads the identity and keep
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

**`ts-server` and `web` package surfaces: render it, do not write it.** Call
`use_mcp_tool(server_name="rollout-server", tool_name="apply_setup_artifacts")` with those surfaces (paths from Steps 4–6,
each surface's metrics findings) and `parts: ["agent-instructions"]`. It writes the
sections below from this document's own text, with every placeholder filled, so the
file is identical to what FireWeave's cloud setup produces. The same tool writes the
Step 4 control-points and start files (`package-files`, never overwriting existing
ones), the Step 5 stamps file (`stamps`) and the `.fireweave/.gitignore` lines
(`gitignore`). Write the sections by hand only for the other surfaces.

### Rollout-ready layout

One row per surface, by harness kind. **Package surface:** its control-points file,
the file carrying its start call (`src/fireweave/start.ts` and the entrypoint that
imports it first, or the entrypoint itself), web's build config, and its stamps file
(`.fireweave/stamps.ts` / `.stamps.py` / `.stamps.json` with the surface's
`FW_STAMPS` entries) — and the line "no harness module: never add `fw-harness`,
`fw-providers` or a second FireWeave setup file". **Scaffold surface:** harness
paths, `fw-tracker` (and its `FW_STAMPS` line), `PROVIDERS.md`. Then a
row stating that **rollout-ready manifests and change stamps are server-owned** —
reached through `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` and the resolution
seam, with no directory under `.fireweave/` to read or write. List the gitignored
runtime paths (`.cache/` projection, `.queue/` unsynced author state, `.lock`) and
state that `.queue/` must never be deleted to clear a warning.

### FireWeave SDK: configuration and overrides — one section PER PACKAGE SURFACE

For each package surface, write that language's section from **Agent instructions
— SDK configuration sections** below **verbatim**, filling only its `<placeholders>`
from Steps 4–6 (a repo with a ts-server and a web surface gets both sections). These
sections are where a feature agent learns every start option, its environment or
build variable, its default, the mode rule and the do-nots, so do not shorten them.
A scaffold surface gets none. `--reinit` regenerates them; a surface added later gets
its own.

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

This inventory has no other source. Every observability query capability (`observability.metric.query`, …)
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

### Before you add a metric — check once per change whether metrics are connected

Write this section whatever observability looked like at init: metrics are
connected in FireWeave, not in the repo, and that can happen any day after this
file is written. So the decision is made per change, from one read, never from
what this file or `project.json` remembers.

**The check — one call, once per change, before step 3 of the HARD ORDER.**
Read the project's capabilities for a production-tier environment
(`<prod-env>`; `.fireweave/project.json` names the project):

- with the FireWeave plugin: `use_mcp_tool(server_name="rollout-server", tool_name="guarded_call")` →
  `get_project_capabilities` `{ projectId, environment: "<prod-env>" }`;
- otherwise: `fw api GET /v1/projects/<projectId>/capabilities --query '{"environment":"<prod-env>"}'`.

Read `bindings.observability.state` (it means **Metrics**; Logs and Traces are separate units) and act on it — nothing else:

| What the read says                                          | `metricsCheck.state` | What you do                                                                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bound`                                                     | `bound`              | Metrics are connected. Resolve each control point's signals as step 3 says: reuse what the app already emits, add one with this surface's **How to emit a metric**, or park. The ramp can then run on them. |
| `unbound`                                                   | `unbound`            | Nothing can read a metric back. Add **no** metric code and declare no metric for this change. It ramps manually; say so in the PR.                                                                          |
| `needs-attention`                                           | `needs-attention`    | As `unbound`, and tell the user the observability connection needs fixing in FireWeave.                                                                                                                     |
| the call failed — offline, signed out, a timeout, any error | `unknown`            | **Assume not connected**, as `unbound`. Never retry in a loop and never block the change on it.                                                                                                             |

Record the result in the manifest's `metricsCheck` —
`{ state, environment: "<prod-env>", checkedAt: <now, ISO> }` — so the
checklist and the reviewer know why the change has no metrics.

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
the manifest's IDENTITY — control points and wrap points, which you decide up front and encode as you
write. It does not apply to `telemetry.metrics`: those are a judgement about a branch that
does not exist at step 1, so the set is filled in AT each control point and recorded when the
change is done. `metrics: []` at first author is valid and is the honest state there.

1. **FIRST** — author the rollout-ready manifest with `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` `{ feature, manifest, baseContentHash }` (build the manifest from the **Manifest contract** below). **FireWeave stores it — do not write a manifest file yourself.** `baseContentHash` is required and nullable: `null` asserts "no row exists yet"; otherwise pass the `contentHash` of the row you read. There is no omit-the-base path — omitting a base is last-writer-wins, and last-writer-wins silently erases a teammate's guardrail metric. On `outcome: 'conflict'`, re-apply your change on top of the returned `current` and retry with `baseContentHash = currentContentHash`. On `outcome: 'queued'`, fw-server did not answer: the edit is safe in `.fireweave/.queue/` and will replay, but **shipping is blocked until it drains** and no teammate can see it. Mint `chg_<ULID>` + `stmp_<ULID>` (the `chg_`/`stmp_` prefixes are hard-enforced by `build_register_rollout_from_manifest` at ship time; a date-slug fails registration). Apply the stamp policy: per-surface stamps by default (append each stamp ONLY to its own surface's `FW_STAMPS` — in its `fw-tracker` on a scaffold surface, in its `.fireweave/stamps.<ext>` file on a package surface); one shared stamp is allowed only when the change is single-project and every participating surface's harness is surface-aware. **`FW_STAMPS` is the one line FireWeave still writes into your repo** — the stamp record itself lives in `change_stamps` server-side.

   **Absence has names — only one means _author it now_.** If a read reports no manifest, the tools return an `absence`: `never-authored` (author it), `not-fetched` (run `fw sync` — this worktree has no projection, so absent is not evidence), `not-authorized` (the manifests are **withheld**, not absent — `fw login` or ask an admin), `server-unavailable` (retry), `queued` (you already authored it; drain the queue). **Never author a manifest to clear any of the last four** — you would be displacing a contract you cannot currently see.

2. Gate behavior behind a control point — not legacy direct vendor SDK calls. **Package surface:** read through the SDK's `fw` in that language's form (its **FireWeave SDK: configuration and overrides** section above), and seed the key in the surface's control-points file — `'<key>': { local: true }` or the language's equivalent — never anywhere else. **Scaffold surface:** read via the harness (`fw.controlPoints.getBooleanValue(key, false, ctx)`), and seed the key in the surface's `makeDevProvider()` `devFlags`. Add `// @fireweave-controlpoint <key>` at every evaluation site **while writing code**. Eval-site default MUST be `false` (RAMP-1): to see a feature **on locally**, seed it — never `fw.controlPoints.getBooleanValue(key, true)`.
3. **At each control point, as you write it, decide that control point's signals** — when the change's metrics check (**Before you add a metric**, done once per change) says `bound`. Otherwise add no metric code and declare none: the change ramps manually, and its `metricsCheck` says why. Not before — a metric chosen before the branch exists is a guess about how code you have not written will fail. Not after — a separate analysis pass is a pass that gets skipped, and it happens when the context is coldest. At the anchor the knowledge is already in front of you and the decision costs nothing extra.

   **Ask two questions of THIS branch.** _Stability:_ name the failure mode — not "it could break" but "the new cache can serve a stale price" — then name the signal that moves when it does. Prefer errors split by class (a 5xx surge and a 4xx surge mean opposite things), a latency QUANTILE (p95/p99, never a mean — a tail cannot move a mean), and a saturation/throughput signal when the change alters resource shape. _Adoption:_ only when the change is user-observable — reach, or completion of the flow it improves. For a refactor or an infra change **"none" is the right answer**, and a fabricated adoption metric is worse than an absent one because it makes the manifest look complete.

   **Then resolve each signal, one of three ways — and a set is normally a MIX:**
   - **Reuse.** The app already emits something that would move. Declare it with `provenance: "existing"` and **write no code**. This is the preferred answer: it needs no review, and a metric the app has emitted for months has real history behind it, so its threshold can come from an observed baseline rather than a guess.
   - **Add.** Nothing covers it. Write the emit call **in the same edit as the branch it observes**, using this surface's own client — **read this surface's section under _How to emit a metric_ FIRST**; it names the client, the exact import line, and where the instrument comes from, all read out of this repo at init. Do not reconstruct the call shape from library docs: the repo and the docs rarely agree, and a call that compiles against the wrong instrument produces a metric the ramp cannot query. Declare it `provenance: "added"`. A metric written by this change has **no baseline on its first rollout**, so leave `threshold` off and let it be observe-only until it earns one.
   - **Park.** The change can fail, no signal would show it, and none can be added because this surface initialises no telemetry. Say so and stop. Do not invent a metric to fill the field.

   **Every control point owes an answer.** A control point is answered when some metric's `guards` names it, or when `controlPoints[].noSignalNeeded = { reason }` says why none is needed. "Nothing to measure here" is legitimate for a refactor; not having looked is not, and an empty metric list cannot tell them apart.

4. **Amend the manifest with what you decided** — the same `upsert_rollout_manifest`, `baseContentHash` set to the `contentHash` of the row you authored in step 1. A record of decisions already made, not a fresh investigation.
5. **BEFORE calling the task done** — run `use_mcp_tool(server_name="rollout-server", tool_name="assert_dev_checklist")` with `{ feature }`. **PARK on any block.** The checklist hard-fails a declared metric nothing emits: for `provenance: "added"` the name must appear in a wrap-point file; for `"existing"` it must be emitted somewhere under `sourceRoots`. Also run `detect_rollout_ready` + `reconcile` phase `build`.
6. Do NOT open a PR / declare done until `assert_dev_checklist.pass === true`.

### Do not

- Swap providers at promotion time.
- Route telemetry through FireWeave (OTLP direct to bound vendor).
- Delete `fw-tracker` stamps without `/fw-cleanup`.
- Write repo-local `mcp/rollout-server/` when using the Cursor FireWeave plugin.
- Finish feature code without a matching rollout-ready package (no backfill).
- Use `fw.controlPoints.getBooleanValue(key, true)` / `default: true` to make a feature work on your laptop — that same `true` is what prod serves when the control point is missing at the provider. Local ON → the control-points file (package surface) or `devFlags` (scaffold) only.
- Add a second FireWeave setup on a package surface: no `initFireweave`, no second start call, no `fw-harness` / `fw-providers` beside the start profile.
- Gate identity wiring behind a control point — `identify` / `reset` / the targeting-key bind are the precondition for control-point evaluation, never a feature of it (INIT-S8; `assert_dev_checklist` blocks it).
- Rely on INIT-S8 for full Svelte template AST — only `<script>` bodies are AST-scanned; `{#if}` / `on:click` identity handlers are soft-warn only. Other known limits: cross-file helpers, multi-hop wrappers, dynamic/computed callees, object-literal helpers.

### Cohort identity (always-on — never behind a control point)

State the repo's identity contract per surface, with concrete symbols and call sites from Step 6b:

| Surface                                                   | Contract                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web**                                                   | After auth: bind the subject (`reloadFireweaveFlags(user.id)`, or `identify(user.id)` + reload for a direct-vendor harness). On sign-out / 401: reset + reload so the next person does not inherit the previous bucket.           |
| **Server**                                                | Every `fw.controlPoints.getBooleanValue(...)` passes `{ targetingKey }` — the session user when there is one, otherwise a stable fallback. Missing targeting key → the provider returns the safe default (`false`).               |
| **Package, client profile** (web, Dart client, Swift app) | `fw.identify(user.id, props)` at sign-in AND session restore, `fw.reset()` at sign-out, in the language's spelling. Reads take no per-call targeting key: decisions follow `fw.identify`.                                         |
| **Package, server profile**                               | `fw.identify(user.id, props)` at sign-in registers durable properties; every read passes the real user's id (`{ targetingKey }`, `EvaluationContext`, `fw.For`), and the instance key only when the server itself is the subject. |

**The bind is unconditional.** Manifests declare `context.targetingKey: "userId"`, and upstream `%` ramps hash that subject id — if it rotates every visit, every session looks like a new user and no control point ever sticks. Gating the bind on a control point deadlocks: the control point evaluates with no targeting key, RAMP-1 makes the safe default `false`, so the bind never runs and the key never arrives. It fails silently as 0% adoption, which reads as a product problem rather than a wiring bug. Gate the feature that _uses_ the identity; never the bind itself.

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
metric dimensioned so the control point's own cohorts are comparable — cache-hit vs
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

The `manifest` argument you pass to `upsert_rollout_manifest` must match this exact shape (validated by `RolloutReadyManifestSchema` **before** anything reaches the server or disk; `safe-rollout` resolves it to build the `RolloutSpec`). `manifest.feature` must equal the `feature` argument — the row is keyed by it. Every field below is load-bearing — start from this and swap the values. Write **`"schema": 3`**: the control-point names below are the only ones a new manifest uses (schemas 1 and 2 stay readable for manifests already written). Each surface the change touches is one `surfaces[]` entry with its own `stampId`, wrap points, harness and metrics; `controlPoints`, `context` and the cohort-seam `telemetry.dimensions` stay top-level. Invariants the schema enforces: every `surfaces[].wrapPoints[].controlPointKey` and `surfaces[].telemetry.metrics[].guards` must be a declared `controlPoints[].key`; `telemetry.dimensions` must equal `context.dimensions` (the cohort seam); a `guardrail` metric needs an OTLP-metrics-capable destination (Grafana/Datadog — **PostHog cannot ingest OTLP metrics**), so keep adoption metrics as `role: "adoption"` unless you wire a metrics vendor.

```json
{
  "schema": 3,
  "feature": "<feature-slug>",
  "changeType": "new-feature",
  "userFacing": true,
  "change": {
    "id": "chg_<ULID>",
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
  "controlPointTelemetryProvider": "connected:posthog",
  "controlPoints": [
    {
      "key": "<feature-slug>",
      "default": false,
      "cohortKey": "userId",
      "userFacing": true,
      "description": "Off: <today's behavior>. On: <new behavior>.",
      "tags": ["<area>"]
    }
  ],
  "context": { "targetingKey": "userId", "dimensions": [] },
  "telemetry": { "logs": [], "traces": [], "dimensions": [] },
  "surfaces": [
    {
      "stampId": "stmp_<ULID>",
      "wrapPoints": [
        {
          "file": "packages/api/src/application/use-cases/<UseCase>.ts",
          "symbol": "<UseCase>.execute",
          "wrapStyle": "method-guard",
          "controlPointKey": "<feature-slug>"
        }
      ],
      "harness": {
        "surface": "ts-server",
        "path": "packages/api/src/fireweave/fw-harness.<ext>",
        "rolloutCredentialEnv": "FW_PROJECT_API_KEY",
        "controlPoints": {
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
      },
      "telemetry": {
        "metrics": [
          {
            "name": "<an error/latency metric this app ALREADY emits>",
            "role": "guardrail",
            "direction": "up-bad",
            "guards": "<feature-slug>",
            "guard": { "breachSeverity": "page", "action": "rollback" }
          }
        ]
      }
    }
  ],
  "metricsCheck": {
    "state": "bound",
    "environment": "production",
    "checkedAt": "2026-10-07T22:00:00.000Z"
  }
}
```

**`metricsCheck` is the change's one capabilities read** (**Before you add a
metric**): `bound`, `unbound`, `needs-attention`, or `unknown` when the read
failed. Anything but `bound` means no metric was declared on purpose and the
change ramps manually.

**`harness.controlPoints.api` is `"control-points"` on every NEW manifest.** The
schema accepts `"openfeature"` too and always will — manifests written before the
v1 cutover are already in the wild and must keep validating — but that value now
describes a harness on the retired surface. It is a widening, never a swap: do not
rewrite an existing manifest's `api` as a drive-by, and do not write
`"openfeature"` on anything new.

For a **web** surface use `harness.surface: "web"`, `harness.controlPoints.sdk: "web"`, `rolloutCredentialEnv: "PUBLIC_FW_PROJECT_API_KEY"`, and the web harness path.

For a **package** surface the harness block says so: `"kind": "package"`, `path` = the surface's entrypoint (the file carrying the start call), `rolloutCredentialEnv` = `"FIREWEAVE_KEY"` (server profile) or `"FIREWEAVE_BROWSER_KEY"` (client profile), `controlPoints.devProvider: "control-points-file"`, and `controlPoints.sdk` `"server"` or `"web"` (a client profile's synchronous reads).

**RAMP-1 — off until ramp:** boolean `controlPoints[].default` MUST be `false`. Eval sites MUST use `fw.controlPoints.getBooleanValue(key, false, …)`. Prod-tier ON is the ramp (or an explicit PostHog kill-switch at 100%), never the call-site default.

**Local vs prod control (standard):** local dogfood ON → that surface's control-points file (package surface: `'<key>': { local: true }` or the language's equivalent) or `makeDevProvider()` `devFlags: { '<key>': true }` (scaffold surface); prod-tier → connected vendor via FireWeave; eval site + manifest always `false`. Never use `fw.controlPoints.getBooleanValue(key, true)` for "works on my laptop" — that is also the prod fallback when the control point is missing at the provider. Do not open new `ramp1Exception` entries; remediate legacy inverted kill-switches only via: create PostHog flag at 100% ON → verify serving → flip defaults to `false` → prove kill in staging.

### Ship

Run `/fw-rollout` only after `assert_dev_checklist` passes — it **promotes** rollout-ready work; it does not wrap code.

---

## Agent instructions — SDK configuration sections (Step 7, package surfaces)

`.fireweave/agent-instructions.md` gets one of these per package surface present,
**verbatim** — fill the `<placeholders>` from Steps 4–6 and change nothing else. They
carry every option, its environment or build variable, its default, the mode rule
and the agent rules for that SDK. `<control-points-path>` is always the file Step 4
wrote; `<entrypoint>` / `<entry>` / `<entrypoints>` / `<mains>` are the files Step 6
put the start call in.

### ts-server — placeholders `<entrypoint>`, `<control-points-path>`, `<start-path>`

```markdown
## FireWeave SDK: configuration and overrides (ts-server)

This app uses `@fireweaveai/server-sdk/start`. All FireWeave setup is in two files:

| File                                                      | Purpose                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (src/fireweave/control-points.ts) | Every control point the app reads, with the value served in **local mode**.                             |
| `<start-path>` (src/fireweave/start.ts)                   | `start({ controlPoints })` plus optional overrides. Imported as the **first** import of `<entrypoint>`. |

Call sites import `fw` from `@fireweaveai/server-sdk/start`. Never import `initFireweave`, never call
`start()` anywhere else, and never add a second FireWeave setup file.

### Options and overrides

Each value resolves as: `start()` option → env var → legacy name (warns once) → default.
Empty values count as unset.

| Option          | Env var                                          | Default               | Use it when                                                                                                                                                       |
| --------------- | ------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlPoints` | —                                                | `{}`                  | Always: pass the object from `<control-points-path>`.                                                                                                             |
| `mode`          | —                                                | inferred              | You must force `'local'` (no network, values from the control-points file) or `'remote'`. `'remote'` without a key fails at start. `'local'` ignores any key.     |
| `environment`   | `FIREWEAVE_ENV`, then `APP_ENV`, then `NODE_ENV` | —                     | The app names its environment in another variable: `environment: process.env.DEPLOY_STAGE`.                                                                       |
| `url`           | `FIREWEAVE_URL`                                  | from the SDK build    | Only for a self-hosted or local fw-server. A staging SDK build (`x.y.z-rc.N`) calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`. |
| `key`           | `FIREWEAVE_KEY`                                  | —                     | The key comes from your own secret store instead of the environment.                                                                                              |
| `instanceId`    | `FIREWEAVE_INSTANCE_ID`                          | hash of the host name | Server-subject reads need a specific stable id.                                                                                                                   |

Legacy names `FW_PROJECT_API_KEY`, `FW_API_URL` and `FW_ATTEST_URL` still work with a warning.
Rename them; never add new ones. `FW_ENV` is no longer read: use `FIREWEAVE_ENV`.

### How the mode is chosen

1. `mode` option set → that mode.
2. A key is present → **remote** (fw-server decides every value).
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**
   (values from `<control-points-path>`; nothing is sent anywhere).
4. Anything else, including no environment name → **start fails**, naming `FIREWEAVE_KEY`.
   That is deliberate: a deploy without its key must fail, not silently serve defaults.

### Rules for agents

- **New control point:** add it to `<control-points-path>` as `'<key>': { local: true }` while you build
  the feature (set `false` to see the old path locally). Never seed values anywhere else.
- **Call sites:** `await fw.controlPoints.getBooleanValue('<key>', false, { targetingKey: user.id })`
  with `// @fireweave-controlpoint <key>` on the line above. The default is always `false` (RAMP-1).
  Always pass the real user's id; use `fw.instanceKey()` only when the server itself is the subject
  (cron, boot, migrations).
- **Identity:** `await fw.identify(user.id, { ...durable properties })` at sign-in, unconditionally,
  never inside a flag branch.
- **Never** put a key or URL value in code, `.env.example`, or any committed file. Never use a
  browser key (`fw_public_…`) here; `start()` rejects it.
- **Debugging:** `fw.status()` shows the mode, why it was chosen, the channel, the host and where
  the key came from (never the key). A line starting `[fireweave:local]` at boot means local mode.
  Reads never throw: on any failure they return the default you passed.
- Do not change `<start-path>` options to fix a failing local run. Set `NODE_ENV=development`
  (or `FIREWEAVE_ENV`) in the dev environment instead, unless the user asks for an override.
```

### web — placeholders `<entry>`, `<control-points-path>`, `<start-path>`, `<build-config>`

```markdown
## FireWeave SDK: configuration and overrides (web)

This app uses `@fireweaveai/web-sdk/start`. All FireWeave setup is in three places:

| File                                                      | Purpose                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (src/fireweave/control-points.ts) | Every control point the app reads, with the value served in **local mode**.                                                       |
| `<start-path>` (src/fireweave/start.ts)                   | `start({ controlPoints })` plus optional overrides. Imported **first** by `<entry>`, which renders after `ready`.                 |
| `<build-config>`                                          | `fireweave()` (Vite) or `fireweaveDefine()` (other bundlers): reads the build variables below and fails the build on a bad setup. |

Call sites import `fw` from `@fireweaveai/web-sdk/start`. Never import `initFireweave`, never call
`start()` anywhere else, and never add a second FireWeave setup file.

### Options and overrides

Each value resolves as: `start()` option → build variable (read by the build helper) → default.
Empty values count as unset. The browser itself reads no environment.

| Option          | Build variable                                                                                               | Default             | Use it when                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `controlPoints` | —                                                                                                            | `{}`                | Always: pass the object from `<control-points-path>`.                                                                                                                                      |
| `mode`          | —                                                                                                            | inferred            | You must force `'local'` (no network, values from the control-points file) or `'remote'`. `'remote'` without a key fails. `'local'` ignores any key.                                       |
| `environment`   | `FIREWEAVE_ENV`, then `APP_ENV`; the dev server and Vitest also use Vite's mode (`/define`: then `NODE_ENV`) | —                   | The build names its environment another way: `fireweave({ environment: process.env.DEPLOY_STAGE })`.                                                                                       |
| `url`           | `FIREWEAVE_URL`                                                                                              | from the SDK build  | A self-hosted fw-server, or a same-origin proxy path such as `/fw`. A staging SDK build (`x.y.z-rc.N`) calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`. |
| `key`           | `FIREWEAVE_BROWSER_KEY`                                                                                      | —                   | Almost never in code: the build variable is the normal path. Browser keys only (`fw_public_…`).                                                                                            |
| `persistence`   | —                                                                                                            | `'localStorage'`    | Consent: `'memory'` stores nothing until `fw.setPersistence('localStorage')`.                                                                                                              |
| `deviceId`      | —                                                                                                            | stored `dev_<uuid>` | Reuse the analytics anonymous id as FireWeave's anonymous key.                                                                                                                             |

`FIREWEAVE_BROWSER_KEY` belongs in the **build** environment (CI, the host's build settings), never
in a developer `.env`: a key there makes `vite dev` call fw-server instead of serving the control-points file.
`VITE_FW_PROJECT_API_KEY` and `PUBLIC_FW_PROJECT_API_KEY` are no longer read.

### How the mode is chosen

1. `mode` option set → that mode.
2. A browser key is present → **remote** (fw-server decides every value).
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**
   (values from `<control-points-path>`; nothing is sent anywhere). `vite dev` and Vitest are local by default.
4. Anything else → the **build fails**, naming `FIREWEAVE_BROWSER_KEY`. A production build never
   becomes local because of `--mode development`.

### Rules for agents

- **New control point:** add it to `<control-points-path>` as `'<key>': { local: true }` while you build
  the feature (set `false` to see the old path locally). Never seed values anywhere else.
- **Call sites:** `fw.controlPoints.getBooleanValue('<key>', false)` with
  `// @fireweave-controlpoint <key>` on the line above. Reads are synchronous and never throw; the
  default is always `false` (RAMP-1). Never pass a `targetingKey`: in the browser, decisions follow
  `fw.identify`.
- **Identity:** `await fw.identify(user.id, { ...durable properties })` at sign-in and session
  restore, `await fw.reset()` at sign-out, unconditionally and never inside a flag branch.
- **Re-render:** components that render before the first decision arrive, or that must follow a
  sign-in, re-render through `fw.subscribe(...)`.
- **Never** put a key or URL value in code or any committed file. Never use a server key
  (`project-api-key_…`) or `FIREWEAVE_KEY` in browser code, and never add `FIREWEAVE` to `envPrefix`.
  The build fails on all of these.
- **Debugging:** `fw.status()` shows the state, mode and why, the channel, the host, where the key
  came from (never the key) and a `problem`: `missing-key`, `server-key`, `wrong-key-family`,
  `insecure-url`, `key-rejected` (fw-server refused the key) or `unreachable` (offline, an ad
  blocker, a firewall or a CSP `connect-src` rule; a same-origin proxy through `FIREWEAVE_URL` fixes
  most of these). A line starting `[fireweave:local]` means local mode.
- Do not change `<start-path>` or `<build-config>` options to fix a failing local run. Set
  `FIREWEAVE_ENV=development` for that run instead, unless the user asks for an override.
```

### Python — placeholders `<entrypoints>`, `<control-points-path>`

```markdown
## FireWeave SDK: configuration and overrides (Python)

This app uses `fireweave.start`. All FireWeave setup is:

| File                                                        | Purpose                                                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (fireweave_setup/control_points.py) | Every control point the app reads, with the value served in **local mode**.                                     |
| `<entrypoints>`                                             | `start(control_points=control_points)` as the first lines of every process entrypoint, plus optional overrides. |

Call sites import `fw` from `fireweave.start`. Never call `init_fireweave`, never call `start()`
outside the entrypoints, and never create a package named `fireweave` in this repo.

### Options and overrides

Each value resolves as: `start()` keyword → env var → legacy name (warns once) → default.
Empty values count as unset.

| Option           | Env var                         | Default                    | Use it when                                                                                                                                                                         |
| ---------------- | ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `control_points` | —                               | `{}`                       | Always: pass the object from `<control-points-path>`.                                                                                                                               |
| `mode`           | —                               | inferred                   | You must force `"local"` (no network, values from the control-points file) or `"remote"`. `"remote"` without a key fails at start. `"local"` ignores any key.                       |
| `environment`    | `FIREWEAVE_ENV`, then `APP_ENV` | —                          | The app names its environment another way: `environment=settings.DEPLOY_STAGE`.                                                                                                     |
| `url`            | `FIREWEAVE_URL`                 | from the installed version | Only for a self-hosted or local fw-server. A prerelease install (staging builds are `X.Y.ZrcN`) calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`. |
| `key`            | `FIREWEAVE_KEY`                 | —                          | The key comes from your own secret store. Project keys (`project-api-key_…`) only.                                                                                                  |
| `instance_id`    | `FIREWEAVE_INSTANCE_ID`         | hash of the host name      | Server-subject reads need a specific stable id.                                                                                                                                     |

Legacy `FW_PROJECT_API_KEY`, `FW_API_URL` and `FW_ATTEST_URL` still work with a warning. Rename
them; never add new ones. `FW_ENV` is no longer read. Processes that never run an entrypoint
(`manage.py`, spawned children) start from the environment alone, so put shared settings in
`FIREWEAVE_*` variables rather than options.

### How the mode is chosen

1. `mode` set → that mode.
2. A key is present → **remote** (fw-server decides every value).
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**.
4. Anything else → `start()` raises `ConfigurationError` naming `FIREWEAVE_KEY`.

### Rules for agents

- **New control point:** add `"<key>": {"local": True}` to `<control-points-path>` while you build it.
- **Call sites:** `fw.control_points.get_boolean_value("<key>", False, EvaluationContext(user_id))`
  with `# @fireweave-controlpoint <key>` above it. Default always `False` (RAMP-1). In `async def`
  code: `await asyncio.to_thread(lambda: fw.control_points.get_boolean_value(...))`. Never pass an
  unguarded `str(user.id)` (anonymous users would share `"None"`). `fw.instance_key()` only when
  the server itself is the subject.
- **Identity:** `fw.identify(user_id, {...durable properties})` at sign-in, unconditionally, never
  inside a flag branch.
- **Never** put a key or URL value in code or committed files, and never use a browser key
  (`fw_public_…`); `start()` rejects it.
- **Debugging:** `fw.status()` shows state, mode and why, channel, host and key source (never the
  key). Reads never raise; on failure they return your default.
- To fix a failing local run, set `FIREWEAVE_ENV=development`; do not change `start()` options
  unless the user asks.
```

### Go — placeholders `<mains>`, `<control-points-path>`

```markdown
## FireWeave SDK: configuration and overrides (Go)

This app uses package `github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3/fw`. All FireWeave setup is:

| File                                                           | Purpose                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (internal/fireweave/control_points.go) | Every control point the app reads, with the value served in **local mode**.                                   |
| `<mains>`                                                      | `fw.Start(fw.Options{ControlPoints: ...})` in the serving path after config loading, plus optional overrides. |

Never call `fireweave.Init`, never import the SDK's `application` or `infrastructure` packages,
and never call `fw.Start` anywhere but the mains.

### Options and overrides

Each value resolves as: `fw.Options` field → env var → legacy name (warns once) → default.
Empty values count as unset.

| Option          | Env var                         | Default                 | Use it when                                                                                                                                             |
| --------------- | ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ControlPoints` | —                               | none                    | Always: pass the map from `<control-points-path>`.                                                                                                      |
| `Mode`          | —                               | inferred                | You must force `fw.ModeLocal` or `fw.ModeRemote`. Remote without a key is a start error; local ignores any key.                                         |
| `Environment`   | `FIREWEAVE_ENV`, then `APP_ENV` | —                       | The app names its environment another way. Never pass an app default like `"dev"`.                                                                      |
| `URL`           | `FIREWEAVE_URL`                 | from the module version | Only for a self-hosted or local fw-server. A `-rc.N` module version calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`. |
| `Key`           | `FIREWEAVE_KEY`                 | —                       | The key comes from your own secret store. Project keys only.                                                                                            |
| `InstanceID`    | `FIREWEAVE_INSTANCE_ID`         | hash of the host name   | Replicas share a host name, or server-subject reads need a specific id.                                                                                 |
| `Env`           | —                               | the process             | Tests and `run(getenv)`-style mains.                                                                                                                    |
| `Log`           | —                               | `slog.Default()`        | Route `[fireweave]` lines to the app's logger.                                                                                                          |

Legacy `FW_PROJECT_API_KEY`, `FW_API_URL` and `FW_ATTEST_URL` still work with a warning. Rename them.

### How the mode is chosen

1. `Mode` set → that mode.
2. A key is present → **remote**.
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**.
4. Anything else → `fw.Start` returns a Configuration error naming `FIREWEAVE_KEY`.

### Rules for agents

- **New control point:** add `"<key>": {Local: true}` to `<control-points-path>` while you build it.
- **Call sites:** `fw.ControlPoints().GetBooleanValue("<key>", false, fw.For(user.ID))` with
  `// @fireweave-controlpoint <key>` above it. Default always `false` (RAMP-1).
  `fw.For(fw.InstanceKey())` only when the server itself is the subject.
- **Identity:** `go func() { _ = fw.Identify(ctx, user.ID, props) }()` at sign-in, never inside a
  flag branch.
- **Never** put a key or URL value in code or committed files, and never use a browser key.
- **Debugging:** `fw.Status()` shows state, mode and why, channel, host and key source (never the
  key). Reads never fail; on failure they return your default.
- To fix a failing local run, set `FIREWEAVE_ENV=development`; do not change `fw.Options` unless
  the user asks.
```

### Java — placeholders `<entrypoint>`, `<control-points-path>`

```markdown
## FireWeave SDK: configuration and overrides (Java)

This app uses `ai.fireweave.sdk.start.Fw`. All FireWeave setup is:

| File                                                  | Purpose                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (FireweaveControlPoints.java) | Every control point the app reads, with the value served in **local mode**.                                                     |
| `<entrypoint>`                                        | `Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build())` first, plus optional overrides. |

Never call `Fireweave.init`, never construct adapters, and never call `Fw.start` anywhere else.

### Options and overrides

Each value resolves as: `StartOptions` builder field → env var → legacy name (warns once) → default.
Empty values count as unset.

| Option          | Env var                         | Default               | Use it when                                                                                                                                           |
| --------------- | ------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlPoints` | —                               | none                  | Always: pass `FireweaveControlPoints.CONTROL_POINTS`.                                                                                                 |
| `mode`          | —                               | inferred              | You must force `Mode.LOCAL` or `Mode.REMOTE`. Remote without a key is a start error; local ignores any key.                                           |
| `environment`   | `FIREWEAVE_ENV`, then `APP_ENV` | —                     | The app names its environment another way. Spring profiles are not read; pass the stage explicitly if needed. Never pass an app default like `"dev"`. |
| `url`           | `FIREWEAVE_URL`                 | from the SDK version  | Only for a self-hosted or local fw-server. A `-rc.N` artifact calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`.     |
| `key`           | `FIREWEAVE_KEY`                 | —                     | The key comes from your own secret store. Project keys only.                                                                                          |
| `instanceId`    | `FIREWEAVE_INSTANCE_ID`         | hash of the host name | Replicas share a host name, or server-subject reads need a specific id.                                                                               |

Legacy `FW_PROJECT_API_KEY`, `FW_API_URL` and `FW_ATTEST_URL` still work with a warning. Rename them.

### How the mode is chosen

1. `mode` set → that mode.
2. A key is present → **remote**.
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**.
4. Anything else → `Fw.start` throws a Configuration `FireweaveException` naming `FIREWEAVE_KEY`.

### Rules for agents

- **New control point:** add `"<key>", LocalControlPoint.local(true)` to `<control-points-path>` while you build it.
- **Call sites:** `Fw.controlPoints().getBooleanValue("<key>", false, EvaluationContext.builder().targetingKey(userId).build())`
  with `// @fireweave-controlpoint <key>` above it. Default always `false` (RAMP-1).
  `Fw.instanceKey()` as the targeting key only when the server itself is the subject.
- **Identity:** `Fw.identify(userId, Map.of(...))` at sign-in, never inside a flag branch.
- **Never** put a key or URL value in code or committed files, and never use a browser key.
- **Debugging:** `Fw.status()` shows state, mode and why, channel, host and key source (never the
  key). Reads never throw; on failure they return your default.
- To fix a failing local run, set `FIREWEAVE_ENV=development`; do not change `StartOptions` unless
  the user asks.
```

### Rust — placeholders `<mains>`, `<control-points-path>`

```markdown
## FireWeave SDK: configuration and overrides (Rust)

This app uses `fireweave::start`. All FireWeave setup is:

| File                                                      | Purpose                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (src/fireweave_control_points.rs) | Every control point the app reads, with the value served in **local mode**.                                                                                   |
| `<mains>`                                                 | `fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() })?` first, plus optional overrides. |

Never call `init_fireweave`, never construct adapters, never call `start` anywhere but the mains,
and never name a local module `fireweave` (it shadows the crate).

### Options and overrides

Each value resolves as: `StartOptions` field → env var → legacy name (warns once) → default.
Empty values count as unset.

| Option           | Env var                         | Default                | Use it when                                                                                                                                    |
| ---------------- | ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `control_points` | —                               | none                   | Always: pass `fireweave_control_points::control_points()`.                                                                                     |
| `mode`           | —                               | inferred               | You must force `Mode::Local` or `Mode::Remote`. Remote without a key is a start error; local ignores any key.                                  |
| `environment`    | `FIREWEAVE_ENV`, then `APP_ENV` | —                      | The app names its environment another way. Never pass an app default like `"dev"`.                                                             |
| `url`            | `FIREWEAVE_URL`                 | from the crate version | Only for a self-hosted or local fw-server. A `-rc.N` crate calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`. |
| `key`            | `FIREWEAVE_KEY`                 | —                      | The key comes from your own secret store. Project keys only.                                                                                   |
| `instance_id`    | `FIREWEAVE_INSTANCE_ID`         | hash of the host name  | Replicas share a host name, or server-subject reads need a specific id.                                                                        |
| `env`, `log`     | —                               | the process, stderr    | Tests and custom log sinks.                                                                                                                    |

Rust does not load `.env` files. For local runs, set `FIREWEAVE_ENV = "development"` under `[env]`
in `.cargo/config.toml` at the workspace root (cargo only; never seen by the deployed binary).
Legacy `FW_PROJECT_API_KEY`, `FW_API_URL` and `FW_ATTEST_URL` still work with a warning.

### How the mode is chosen

1. `mode` set → that mode.
2. A key is present → **remote**.
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**.
4. Anything else → `start` returns a Configuration `FireweaveError` naming `FIREWEAVE_KEY`.

### Rules for agents

- **New control point:** add `("<key>", LocalControlPoint::local(true))` to `<control-points-path>` while you build it.
- **Call sites:** `fireweave::start::control_points().get_boolean_value("<key>", false, Some(&ctx))`
  with `// @fireweave-controlpoint <key>` above it. Default always `false` (RAMP-1). Reads block:
  in async handlers wrap them in `tokio::task::spawn_blocking`.
- **Identity:** `let _ = fireweave::start::identify(&user.id, [...]);` at sign-in, never inside a
  flag branch.
- **Never** put a key or URL value in code or committed files, and never use a browser key.
- **Debugging:** `fireweave::start::status()` shows state, mode and why, channel, host and key
  source (never the key). Reads never fail; on failure they return your default.
- To fix a failing local run, set `FIREWEAVE_ENV=development`; do not change `StartOptions`
  unless the user asks.
```

### Dart — placeholders `<client.dart | server.dart>`, `<entry>`, `<control-points-path>`

```markdown
## FireWeave SDK: configuration and overrides (Dart)

This app uses `package:fireweave/<client.dart | server.dart>`. All FireWeave setup is:

| File                                                        | Purpose                                                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (lib/fireweave/control_points.dart) | Every control point the app reads, with the value served in **local mode**.                                                                           |
| `<entry>`                                                   | `await Fireweave.start(controlPoints: controlPoints)` before `runApp` / before serving, plus optional overrides. Every isolate that reads must start. |

Never call `initFireweave`, never import `server.dart` in a Flutter app, and never call `start`
anywhere else.

### Options and overrides

Each value resolves as: `Fireweave.start` option → client compile-time define / server environment
variable → default. Empty values count as unset.

| Option                      | Client define           | Server env var                  | Default                | Use it when                                                                                                                                  |
| --------------------------- | ----------------------- | ------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `controlPoints`             | —                       | —                               | `{}`                   | Always: pass the map from `<control-points-path>`.                                                                                           |
| `mode`                      | —                       | —                               | inferred               | You must force local or remote.                                                                                                              |
| `environment`               | `FIREWEAVE_ENV`         | `FIREWEAVE_ENV`, then `APP_ENV` | —                      | The build or process names its environment another way.                                                                                      |
| `url`                       | `FIREWEAVE_URL`         | `FIREWEAVE_URL`                 | from the SDK build     | Only for a self-hosted or local fw-server. A `-rc.N` SDK calls `staging-app-server.fireweave.ai`; any other calls `app-server.fireweave.ai`. |
| `key`                       | `FIREWEAVE_BROWSER_KEY` | `FIREWEAVE_KEY`                 | —                      | Almost never in code. Client: browser keys (`fw_public_…`) only. Server: project keys only.                                                  |
| `deviceId`, `deviceIdStore` | —                       | —                               | in-memory `dev_<uuid>` | Client: reuse an analytics id, or persist the id after consent.                                                                              |
| `instanceId`                | —                       | `FIREWEAVE_INSTANCE_ID`         | hash of the host name  | Server: replicas share a host name.                                                                                                          |

Client defines are compile-time: a change needs a rebuild, not a hot reload. `FIREWEAVE_KEY` must
never be a define. `--dart-define=FIREWEAVE_ENV=development` belongs only in debug launch configs.

### How the mode is chosen

1. `mode` set → that mode.
2. A key is present → **remote**.
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**.
4. Anything else → client: `fw.status.state` is `failed` and reads serve defaults (it never
   throws); server: `Fireweave.start` throws a Configuration error naming `FIREWEAVE_KEY`.

### Rules for agents

- **New control point:** add `'<key>': LocalControlPoint.local(true)` to `<control-points-path>` while you build it.
- **Call sites:** `fw.controlPoints.getBooleanValue('<key>', false)` with
  `// @fireweave-controlpoint <key>` above it. Synchronous, safe in `build()`. Default always
  `false` (RAMP-1). Never pass a per-call targeting key on the client.
- **Identity (client):** `await fw.identify(user.id, properties: {...})` at sign-in and session
  restore, `await fw.reset()` at sign-out, never inside a flag branch.
- **Never** put a key in source or a committed define file; never use a project key in a Flutter app.
- **Debugging:** `fw.status` shows state, mode and why, channel, host, key source and `problem`
  (never the key). A line starting `[fireweave:local]` means local mode.
```

### Swift — placeholders `<entry>`, `<control-points-path>`

Rule 4 follows the shipped SDK, where an app start never throws.

```markdown
## FireWeave SDK: configuration and overrides (Swift)

This app uses the `FireweaveStart` product. All FireWeave setup is:

| File                                                        | Purpose                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `<control-points-path>` (FireweaveLocalControlPoints.swift) | Every control point the app reads, with the value served in **local mode**.                                             |
| `<entry>`                                                   | `startFireweave(controlPoints: appControlPoints)` in `App.init()` / `didFinishLaunching` (app) or `configure` (server). |

Never call `initFireweave` and never call `startFireweave` anywhere else.

### Options and overrides

Each value resolves as: `startFireweave` argument → app Info.plist value / server environment
variable → default. Empty values count as unset.

| Option          | App (Info.plist)                                                                      | Server (env var)                | Default               | Use it when                                                              |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `controlPoints` | —                                                                                     | —                               | `[:]`                 | Always: pass `appControlPoints`.                                         |
| `mode`          | —                                                                                     | —                               | inferred              | You must force `.local` or `.remote`.                                    |
| `environment`   | `FIREWEAVE_ENV`                                                                       | `FIREWEAVE_ENV`, then `APP_ENV` | —                     | The build or process names its environment another way.                  |
| `url`           | `FIREWEAVE_URL`                                                                       | `FIREWEAVE_URL`                 | from the SDK build    | Only for a self-hosted or local fw-server.                               |
| `key`           | `FIREWEAVE_BROWSER_KEY` (`$(FIREWEAVE_BROWSER_KEY)` from an untracked xcconfig or CI) | `FIREWEAVE_KEY`                 | —                     | Almost never in code. App: browser keys only. Server: project keys only. |
| `persistence`   | —                                                                                     | —                               | `.userDefaults`       | App consent: `.memory` until the visitor agrees.                         |
| `deviceId`      | —                                                                                     | —                               | stored `dev_<UUID>`   | App: reuse an analytics id.                                              |
| `instanceId`    | —                                                                                     | `FIREWEAVE_INSTANCE_ID`         | hash of the host name | Server: replicas share a host name.                                      |

### How the mode is chosen

1. `mode` set → that mode.
2. A key is present → **remote**.
3. No key, and the environment name is `development`, `dev`, `local` or `test` → **local**. An app
   debug build with no key and no environment name also counts as development.
4. Anything else → app: `fw.status.state` is `.failed`, the reason is in `fw.status.problem`, and
   reads serve defaults (it never throws); server: `try startFireweave(FireweaveStartOptions(...))`
   throws a configuration error naming `FIREWEAVE_KEY`, and the one-line form stops the process at launch.

### Rules for agents

- **New control point:** add `"<key>": .local(true)` to `<control-points-path>` while you build it.
- **Call sites:** `fw.controlPoints.getBooleanValue("<key>", default: false)` with
  `// @fireweave-controlpoint <key>` above it. Synchronous; default always `false` (RAMP-1).
- **Identity (app):** `await fw.identify(user.id, properties: [...])` at sign-in and session
  restore, `await fw.reset()` at sign-out, never inside a flag branch.
- **Never** put a key literal in the workspace (Info.plist uses `$(FIREWEAVE_BROWSER_KEY)`), and
  never use a project key in an app target.
- **Debugging:** `fw.status` shows state, mode and why, channel, host, key source and `problem`
  (never the key).
```

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

## HARD ORDER — every user-facing or control-point-gated feature

1. **FIRST** author the manifest with `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` `{ feature, manifest, baseContentHash }` (Manifest contract in agent-instructions) + mint `chg_`/`stmp_` + apply the stamp policy (per-surface stamps by default — append each stamp to its own surface's `FW_STAMPS`, in `.fireweave/stamps.<ext>` on a start-profile surface; one shared stamp only when single-project + every surface's harness is surface-aware). **FireWeave stores the manifest — do not write a manifest file yourself.**
2. Implement behind the harness control point (`fw.controlPoints.getBooleanValue(<key>, false, ctx)`) with `// @fireweave-controlpoint <key>` at each evaluation site.
   On a start-profile surface `fw` comes from the SDK's start module, never a harness: add
   `'<key>'` with local value `true` to that surface's control-points file to try it locally.
   - ts-server: `await fw.controlPoints.getBooleanValue('<key>', false, { targetingKey: user.id })` (`@fireweaveai/server-sdk/start`); `src/fireweave/control-points.ts`
   - web: `fw.controlPoints.getBooleanValue('<key>', false)` (`@fireweaveai/web-sdk/start`, no per-call context); `src/fireweave/control-points.ts`
   - Python: `fw.control_points.get_boolean_value('<key>', False, EvaluationContext(user_id))`; `fireweave_setup/control_points.py`
   - Go: `fw.ControlPoints().GetBooleanValue("<key>", false, fw.For(user.ID))`; `internal/fireweave/control_points.go`
   - Java: `Fw.controlPoints().getBooleanValue("<key>", false, ctx)`; `FireweaveControlPoints.java`
   - Rust: `fireweave::start::control_points().get_boolean_value("<key>", false, Some(&ctx))`; `src/fireweave_control_points.rs`
   - Dart: `fw.controlPoints.getBooleanValue('<key>', false)`; `lib/fireweave/control_points.dart`
   - Swift: `fw.controlPoints.getBooleanValue("<key>", default: false)`; `FireweaveLocalControlPoints.swift`

   Config options and overrides: `.fireweave/agent-instructions.md` → FireWeave SDK: configuration and overrides (<language>).

3. **BEFORE done** call `use_mcp_tool(server_name="rollout-server", tool_name="assert_dev_checklist")` with `{ feature }` — PARK on any block (includes dummy metrics with no emit sites). Also `reconcile` phase `build`.
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
OR control-point-gated OR behavior-changing** change — including internal/ops/observability
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
   `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` `{ feature, manifest, baseContentHash }`
   (Manifest contract in [.fireweave/agent-instructions.md](.fireweave/agent-instructions.md)).
   **FireWeave stores the manifest — do not write a manifest file yourself.**
   `baseContentHash` is required and nullable (`null` = "no row yet"); on `conflict`,
   re-apply on top of `current` and retry with `currentContentHash`. Mint
   `chg_<ULID>` + `stmp_<ULID>`, and apply the stamp policy — per-surface stamps by default (append each stamp ONLY to its own surface's `FW_STAMPS`, in `.fireweave/stamps.<ext>` on a start-profile surface); one shared stamp only when the change is single-project and every participating surface's harness is surface-aware.
2. Gate the new behavior behind the harness control point (`fw.controlPoints.getBooleanValue(<key>, false, ctx)`) and add
   `// @fireweave-controlpoint <key>` at each evaluation site **as you write it**.
   On a start-profile surface `fw` comes from the SDK's start module, never a harness: add
   `'<key>'` with local value `true` to that surface's control-points file to try it locally.
   - ts-server: `await fw.controlPoints.getBooleanValue('<key>', false, { targetingKey: user.id })` (`@fireweaveai/server-sdk/start`); `src/fireweave/control-points.ts`
   - web: `fw.controlPoints.getBooleanValue('<key>', false)` (`@fireweaveai/web-sdk/start`, no per-call context); `src/fireweave/control-points.ts`
   - Python: `fw.control_points.get_boolean_value('<key>', False, EvaluationContext(user_id))`; `fireweave_setup/control_points.py`
   - Go: `fw.ControlPoints().GetBooleanValue("<key>", false, fw.For(user.ID))`; `internal/fireweave/control_points.go`
   - Java: `Fw.controlPoints().getBooleanValue("<key>", false, ctx)`; `FireweaveControlPoints.java`
   - Rust: `fireweave::start::control_points().get_boolean_value("<key>", false, Some(&ctx))`; `src/fireweave_control_points.rs`
   - Dart: `fw.controlPoints.getBooleanValue('<key>', false)`; `lib/fireweave/control_points.dart`
   - Swift: `fw.controlPoints.getBooleanValue("<key>", default: false)`; `FireweaveLocalControlPoints.swift`

   Config options and overrides: `.fireweave/agent-instructions.md` → FireWeave SDK: configuration and overrides (<language>).

3. **BEFORE calling the task done** — run `use_mcp_tool(server_name="rollout-server", tool_name="assert_dev_checklist")`
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

1. **HARD:** Use the **Cursor FireWeave plugin MCP** (`plugin-fireweave-rollout-server`). Confirm via `use_mcp_tool(server_name="rollout-server", tool_name="list_registered_tools")`.
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

| Surface     | Packages                                                                                            | Why both                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `@fireweaveai/server-sdk`                                                                           | the whole surface — control points, target registration, and both modes the scaffolded providers bring up                         |
| `web`       | `@fireweaveai/web-sdk`                                                                              | the whole surface — browser control points; credential resolution is inlined into the scaffolded `fw-providers.ts`                |
| `python`    | `fireweave`                                                                                         | the whole surface — control points, runtime, target registration                                                                  |
| `java`      | `ai.fireweave:fireweave-sdk` (Maven Central; a range within the major — see the java install table) | the whole surface — control points, runtime, target registration                                                                  |
| `swift`     | `Fireweave` (SwiftPM, git URL + tag from the SDK repo)                                              | control points in local and remote mode; credentials are build-baked via Info.plist, never env-read — see **Swift surface** below |

**A package surface installs at the 3.0.0 floor, through the tool.** The same names
for ts-server, web, Python and Java, plus Go
`github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3`, Rust `fireweave` (crates.io; on
staging a git dependency on the `rust/v3.0.0-rc.N` tag), Dart `fireweave` (pub:
`flutter pub add` / `dart pub add`) and Swift's `FireweaveStart` product from the
mirror `https://github.com/FireWeave-HQ/fireweave-swift` — warn the user that the
mirror must be provisioned before a Swift install can resolve, and that no Swift rc
build is published until it is, so a staging Swift surface has nothing to install.
The flow, exactly:

1. Call `use_mcp_tool(server_name="rollout-server", tool_name="resolve_sdk_install")` with
   `{ cwd, surface, harnessKind: 'package', startProfile? }` (`startProfile` for `dart` /
   `swift`). It applies the floor — prerelease-aware: on staging `3.0.0-rc.N` and
   Python `3.0.0rcN` pass, while the pre-rename `-staging.` builds and Python `a`
   builds are refused; 2.x fails — and preflights the start entry. `{ ok: false }` →
   show its `reason` and stop, as for a scaffold surface.
2. `needsVersion: true` (only Go, Rust, Dart and Swift on staging, whose manifests
   record an exact version — limit 1 below) → run the `preflight[]` entry with check
   `registry-version` (status `instruction`, its `command`), take the highest `-rc.`
   version it lists (never the highest pre-release) and call again with that
   `version`.
3. Run the result's `command` through `use_mcp_tool(server_name="rollout-server", tool_name="run_bounded_install")`, or
   apply its `snippets[]` (`{ file, content, note? }`) where the install is a build-file
   edit; then run the remaining `preflight[]` entries whose status is `instruction`.
4. Record its `sdk` (`{ name, version?, channel: 'stable' | 'staging' }`) into
   `surfaces[].sdk`, and show its `summary`: the channel **is** the endpoint the app
   will call, and `endpoint` names that host.

Without `harnessKind` the tool answers for a scaffold surface, unchanged.

**SDK installs never pin an exact version.** On every channel (stable, staging and
dev) an SDK install takes the channel's latest build, and the manifest records a
range that floats minor and patch within major 3, from the 3.0.0 floor (staging from
`3.0.0-rc.1`). The tool's commands and snippets already follow this table; never add
an exact-save flag, an `==` requirement or a plain version to them:

| Ecosystem                        | Stable                                                 | Staging                                                                                            | Dev store   | The manifest records                                  |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| npm, bun, pnpm, yarn, deno       | `<pkg>@latest` (refused while `latest` is below 3.0.0) | `<pkg>@next`                                                                                       | `<pkg>@dev` | `^3.x.y` / `^3.0.0-rc.N` / `^3.0.0-dev.<stamp>.<sha>` |
| Python (uv, poetry, pipenv, pip) | `'fireweave>=3,<4'`                                    | `'fireweave>=3.0.0rc1,<4'` (poetry adds `--allow-prereleases`)                                     | —           | the specifier as written                              |
| Java (Maven, Gradle)             | `[3.0.0,4.0.0)`                                        | `[3.0.0-rc.1,4.0.0)`                                                                               | —           | the range as written                                  |
| Rust                             | `cargo add 'fireweave@3'`                              | the highest `rust/v3.0.0-rc.N` git tag                                                             | —           | `fireweave = "3"` / that tag, exactly (limit 1)       |
| Dart                             | `^3.0.0`                                               | the highest `dart/v3.0.0-rc.N` git tag                                                             | —           | `^3.0.0` / that tag, exactly (limit 1)                |
| Go                               | `go get <module>/v3@latest`                            | the highest `v3.0.0-rc.N` (never the highest pre-release: `v3.0.0-staging.1` sorts above every rc) | —           | an exact version in `go.mod`, by design (limit 1)     |
| Swift                            | `from: "3.0.0"` (SwiftPM's up-to-next-major range)     | none until the Swift mirror exists                                                                 | —           | `from: "3.0.0"`                                       |

Name the limits that apply in the install summary:

1. **`go.mod` records an exact version, by design.** Go's minimal version selection
   writes the version `go get` resolved; there is no range to write. crates.io and
   pub.dev carry no staging build, so Rust and Dart staging depend on an rc git tag,
   recorded exactly the same way. Re-running the channel's install is how such a
   surface moves.
2. **A staging range also admits the stable release.** No ecosystem has a
   staging-only range: `^3.0.0-rc.N`, `>=3.0.0rc1,<4` and `[3.0.0-rc.1,4.0.0)` all
   include 3.0.0 once it ships, and 3.0.0 calls `app-server.fireweave.ai`. npm's
   `^3.0.0-rc.N` also matches the deprecated `3.0.0-staging.1`, which SemVer orders
   above every rc. **Re-running the channel install is how a project stays on
   staging**: npm's `next` tag always points at the newest rc; a Python or Java range
   takes the highest version, so it stays on staging only while an rc is the highest
   3.x. No FireWeave check flags a staging surface whose installed version is a plain
   release.
3. **The stable Java range admits a later rc.** Maven and Gradle ranges include
   qualifier versions: once a `3.1.0-rc.1` (or a `4.0.0-rc.1`, which Maven orders
   below `4.0.0`) is on Central, `[3.0.0,4.0.0)` can resolve it, and an rc calls
   `staging-app-server.fireweave.ai`. npm `^3.x.y`, Python `>=3,<4` and Cargo `"3"`
   skip pre-releases; pub prefers a stable version.

**Dev: install the SDK from the FireWeave dev artifact store.** This applies
**only when `FW_DEV_ARTIFACTS_URL` is set in the environment** (FireWeave's dev
stack sets it; a customer's machine or sandbox never has it) **and the surface
is `ts-server` or `web`** (the store holds the two npm SDKs, nothing else). It
replaces steps 1 and 2 above; every other surface, and every run without the
variable, follows the flow above unchanged.

1. Read the newest dev build: `curl -fsS "$FW_DEV_ARTIFACTS_URL/@fireweaveai%2fserver-sdk"`
   (or `%2fweb-sdk`) and take `dist-tags.dev`. When the store does not answer, or
   has no such package, say so in the session summary and follow the normal flow
   instead; never stop over it.
2. Point **only the `@fireweaveai` scope** at the store, in the user-level
   `~/.npmrc`: `@fireweaveai:registry=$FW_DEV_ARTIFACTS_URL/`. Never in the
   repository: no project `.npmrc`, no `bunfig.toml`, no manifest field. bun,
   npm and pnpm read it; for yarn 2+ or Deno, follow the normal flow.
3. Install by the store's `dev` tag through `use_mcp_tool(server_name="rollout-server", tool_name="run_bounded_install")`
   (`bun add @fireweaveai/server-sdk@dev`, or the repo's manager per the table
   below), never an exact version or an exact-save flag. The `dev` tag selects the
   prerelease build; the manifest records `^3.0.0-dev.<stamp>.<sha>`.
4. Record `surfaces[].sdk` as `{ name, version: <version>, channel: 'dev' }`, with
   the version step 1 read.
5. The lockfile now names the store's URL, and the Step 9 smoke's
   `sdk-channel` check FAILS on the `dev` pin: both are correct, because this
   repository does not yet build against a published SDK. Do not fix either.
   Name them in the session summary instead (in cloud setup, one `other`
   to-do: "Built against a FireWeave dev SDK build (`<name>@<version>`):
   reinstall it from the registry and drop the dev pin before this deploys").
   Fix every other failing check as usual.

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

| Detected          | Install command                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uv.lock`         | `uv add 'fireweave>=3,<4'`                                                                                                                                                                         |
| `poetry.lock`     | `poetry add 'fireweave>=3,<4'`                                                                                                                                                                     |
| `Pipfile.lock`    | `pipenv install 'fireweave>=3,<4'`                                                                                                                                                                 |
| none of the above | `pip install 'fireweave>=3,<4'` **and** record it in `pyproject.toml` / `requirements.txt` — a bare `pip install` leaves nothing in the repo, so the next checkout has no record of the dependency |

That is the stable range; staging is `'fireweave>=3.0.0rc1,<4'` (poetry adds `--allow-prereleases`), per **SDK installs never pin an exact version**. Never `==`.

A **java** surface has no "install" verb at all — every path is a build-file
edit, which the repo records by construction:

| Detected                              | Add                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pom.xml`                             | ONE `<dependency>` block — `ai.fireweave:fireweave-sdk:<range>`                          |
| `build.gradle` / `build.gradle.kts`   | `implementation("ai.fireweave:fireweave-sdk:<range>")` — `mavenCentral()` is enough      |
| `gradle/libs.versions.toml` (catalog) | a `fireweave` version entry + the one library coordinate, referenced from the build file |

**The `ai.fireweave` artifacts resolve from Maven Central.** **`<range>` is a
range within the major, never a plain version and never copied from this
document:** a package surface takes the tool's snippet (`[3.0.0,4.0.0)` on stable,
`[3.0.0-rc.1,4.0.0)` on staging — see **SDK installs never pin an exact
version**). For a scaffold surface, Maven has no dist-tags, so read the major's
newest release from Central's metadata —
`https://repo1.maven.org/maven2/ai/fireweave/fireweave-sdk/maven-metadata.xml`,
the highest plain version (no `-` suffix) in `<versions>`; not `<release>` or
`<latest>`, which an rc can occupy — and write `[X.Y.Z,<X+1>.0.0)` in the build
file. A version baked into this doc would freeze every scaffolded repo at
whatever was current the day it was written — the same trap the npm channel
paragraph below records.

**Two `ai.fireweave` artifacts are PERMANENTLY ORPHANED — never scaffold them.**
`fireweave-openfeature` and `fireweave-adapter-posthog` were published to Maven
Central before v1 and are gone from the source tree; Maven artifacts are
immutable, so those coordinates still resolve and will forever. A build file
that lists either one compiles against the retired pre-v1 surface. Only
`fireweave-sdk` is v1. (`fireweave-testing` is optional and
`<scope>test</scope>` only.)

Bun is the default when nothing is detected and the repo is otherwise Node-shaped. **Two or more lockfiles, or none in a repo with no clear shape → `ask_followup_question`** rather than guessing; installing with the wrong manager writes a second lockfile, which is a mess the user then has to unpick. Every clarification in this skill goes through `ask_followup_question` — this is not an exception.

**Never write a version from this document into these commands.** They install by the channel's tag (Python and Java: the range in **SDK installs never pin an exact version**). npm's dist-tags are the source of truth for what "current" means, and a literal pinned here freezes every repo the skill scaffolds at whatever line was current the day the sentence was written — a `0.x` caret caps at the next minor, so those repos stop receiving SDK fixes silently and look deliberately pinned. The FIR-359 harness report carries the installed `@fireweaveai/server-sdk` version.

**The channel is DERIVED, never asked.** Call
`use_mcp_tool(server_name="rollout-server", tool_name="resolve_sdk_install")` with `{ cwd, surface }` before
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

**Run the install through `use_mcp_tool(server_name="rollout-server", tool_name="run_bounded_install")`**, passing
the tool's `command` as `argv`. Never shell out to a bare `bun add` for an SDK:
an unbounded install was **63% of all tool time** in the run this instruction
comes from — one package wedged for its full 180s timeout, then needed a manual
`kill -9` and a retry. The tool bounds each attempt, escalates SIGTERM→SIGKILL,
retries exactly once with `--verbose`, and returns a named failure instead of a
silence you cannot distinguish from slowness.

**The per-surface pin.** Record what each surface actually resolved
into `project.json` `surfaces[].sdk` as `{ name, version?, channel }` — take
`resolvedVersion` from the tool's result rather than re-reading the registry:

| `channel` | Resolves from                                           | Use                                                                                                                                                              |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stable`  | the registry's default tag (`latest`)                   | every normal repo — install by the tag (`@latest`; bare in the scaffold flow), never a literal version (npm: see below)                                          |
| `staging` | the `next` dist-tag                                     | dogfooding the next SDK line before it promotes                                                                                                                  |
| `dev`     | a LOCAL path (`workspace:*`), or the dev artifact store | SDK co-development only, behind `sdkDev` / `FIREWEAVE_SDK_DEV=1`; or `FW_DEV_ARTIFACTS_URL` (see **Dev: install the SDK from the FireWeave dev artifact store**) |

**The npm dist-tag is `next`. The prerelease identifier is `-rc.N`. The
channel this skill records is `staging`. Three spellings, one line — do not
assume any of them from another.** A staging release is
`<major>.<minor>.<patch>-rc.<N>` — e.g. `3.0.0-rc.1` — published under
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
dogfooding `3.0.0-rc.1` stops receiving `-rc.2` and looks deliberately
pinned. The tag moves; the manifest records `^<resolved>` (`^3.0.0-rc.N`), a
range with limit 2 of **SDK installs never pin an exact version**; the version
recorded in `surfaces[].sdk` says what it resolved to on the day.

`-rc.N` is a semver PRERELEASE, so it sorts BELOW `3.0.0` and can never be
mistaken for the release it precedes. The channel is read from the version by
one rule in every SDK (fireweave-sdk spec SP-13): a version containing `-rc.` is
a staging build and calls `staging-app-server.fireweave.ai`; any other SemVer
version, other pre-releases included (`-beta.N`, a dev-store `-dev.` build), is
production. Python follows PEP 440: any pre-release or dev release is staging, and
FireWeave publishes only `rcN` ones. Builds published before the rename keep the
rule they shipped with, which is why `resolve_sdk_install` refuses a `-staging.`
version outright instead of reading it.

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

**Python has no dist-tags, so the channel is the specifier.** Staging and
production both publish to **PyPI**: a staging build is `X.Y.ZrcN` (PEP 440's
spelling of `-rc.N`), a release is plain. pip, uv, poetry and pipenv skip
pre-releases unless the requirement names one, so the range decides the channel:

```
pip install 'fireweave>=3,<4'            # stable: the newest 3.x release, never an rc
pip install 'fireweave>=3.0.0rc1,<4'     # staging: the pre-release in the specifier admits rc builds
```

Never `==` and never a plain version. On staging, poetry also needs
`--allow-prereleases` (the tool's command carries it), and uv prefers a final
release whenever one satisfies the range. Record the channel as `staging` either
way — the channel is FireWeave's vocabulary, not the registry's.

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

Every SDK (https://github.com/FireWeave-HQ/fireweave-sdk) has **two tiers over one
core**, and which one a surface uses is its harness kind. They obey opposite rules on
purpose — do not carry a rule from one tier to the other.

#### Tier 1 — the START PROFILE (default for every NEW surface, `harnessKind: 'package'`)

| Surface     | Package                                     | Start entry                                         | Start call                                                                           |
| ----------- | ------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ts-server` | `@fireweaveai/server-sdk` ≥ 3.0.0           | `@fireweaveai/server-sdk/start` (or `/register`)    | `start({ controlPoints })`                                                           |
| `web`       | `@fireweaveai/web-sdk` ≥ 3.0.0              | `@fireweaveai/web-sdk/start` + `/vite` or `/define` | `ready = start({ controlPoints })`                                                   |
| `python`    | `fireweave` ≥ 3.0.0                         | `fireweave.start`                                   | `start(control_points=control_points)`                                               |
| `go`        | `.../sdks/go/v3` ≥ v3.0.0                   | `.../sdks/go/v3/fw`                                 | `fw.Start(fw.Options{ControlPoints: …})` / `fw.MustStart`                            |
| `java`      | `ai.fireweave:fireweave-sdk` ≥ 3.0.0        | `ai.fireweave.sdk.start.Fw`                         | `Fw.start(StartOptions.builder().controlPoints(…).build())`                          |
| `rust`      | `fireweave` crate ≥ 3.0.0                   | `fireweave::start`                                  | `fireweave::start::start(StartOptions { control_points: …, ..Default::default() })?` |
| `dart`      | `fireweave` (pub) ≥ 3.0.0                   | `package:fireweave/client.dart` or `server.dart`    | `await Fireweave.start(controlPoints: …)`                                            |
| `swift`     | `FireweaveStart` product, mirror repository | `import FireweaveStart`                             | `startFireweave(controlPoints: …)`                                                   |

- **The mode is INFERRED, by one rule in every SDK:** an explicit `mode` option wins;
  otherwise a key means **remote**; no key and an environment name of `development`,
  `dev`, `local` or `test` means **local**, serving the values in the surface's
  **control-points file** (`defineControlPoints` / `define_control_points` /
  `fw.DefineControlPoints`); anything else **fails closed**, naming the key variable —
  a server's start throws (or returns the error), a web build fails, and a Dart client
  or Swift app marks itself failed and serves defaults without throwing. A deploy that
  lost its key never becomes local evaluation.
- **It reads `FIREWEAVE_*`.** Server profiles read `FIREWEAVE_KEY` (project key,
  `project-api-key_…`), `FIREWEAVE_URL`, `FIREWEAVE_ENV` then `APP_ENV` (ts-server also
  `NODE_ENV`) and `FIREWEAVE_INSTANCE_ID` from the process. Client profiles take
  `FIREWEAVE_BROWSER_KEY` (browser key, `fw_public_…`), `FIREWEAVE_URL` and
  `FIREWEAVE_ENV` as **build** values (the web build helper, Dart defines, Swift
  Info.plist). The legacy `FW_PROJECT_API_KEY` / `FW_API_URL` / `FW_ATTEST_URL` are
  still read with one warning; initialise never writes them for a package surface.
- **The endpoint is the SDK channel**: a `-rc.N` (Python `rcN`) build calls
  `staging-app-server.fireweave.ai`, any other `app-server.fireweave.ai`;
  `FIREWEAVE_URL` is only for a self-hosted or bench fw-server.
- **The wrong key family is refused at start** — a browser key in a server, a project
  key in a client — naming where it came from, never the value.
- **One start per process, nothing beside it**: no hand-rolled `initFireweave`, no
  second start, no harness module. Every option and override per language is in the
  **Agent instructions — SDK configuration sections**.

#### Tier 2 — the CORE `initFireweave` (scaffold surfaces, and advanced use)

The core is what a scaffold surface's generated harness calls, and what an app may
call directly for wiring the start profile does not cover (a per-user server client,
a custom adapter). Initialise never writes it for a new surface. The standalone SDKs
are REQUIRED by the scaffolded harness, not optional extras. **Every surface binds BOTH its prod and its dev provider from its OWN standalone SDK** — there is no second package in the harness graph.

| Surface     | Package                      | Entry point      | Prod tier        | Dev tier        |
| ----------- | ---------------------------- | ---------------- | ---------------- | --------------- |
| `ts-server` | `@fireweaveai/server-sdk`    | `initFireweave`  | `mode: 'remote'` | `mode: 'local'` |
| `web`       | `@fireweaveai/web-sdk`       | `initFireweave`  | `mode: 'remote'` | `mode: 'local'` |
| `python`    | `fireweave`                  | `init_fireweave` | `mode="remote"`  | `mode="local"`  |
| `java`      | `ai.fireweave:fireweave-sdk` | `Fireweave.init` | `Mode.REMOTE`    | `Mode.LOCAL`    |
| `swift`     | `Fireweave` (SwiftPM)        | `initFireweave`  | `.remote(…)`     | `.local(…)`     |

**One entry point, two modes — not two constructions.** In the core, `mode` is REQUIRED and never inferred: with inference, a missing or mistyped credential in production silently becomes local evaluation, every control point serves its default, and the boot log stays green. The observable symptom is a feature that never ramps, which is indistinguishable from a rollout nobody started. Because both tiers are the same call differing by one option, they cannot skew in validation, lifecycle gating or context canonicalization.

**Never hand-construct the runtime/adapter/client** to "simplify" a template. It compiles and runs, and it bypasses the initialisation validation that makes a bad credential fail loudly at boot.

**The core SDK reads NO environment variables** — every credential is an explicit option. The HARNESS reads `FW_API_URL` / `FW_PROJECT_API_KEY` (`PUBLIC_FW_*` on web) and passes them in. It also passes `allowedHosts` derived from the configured URL: without it the SDK validates against a canonical `*.fireweave.ai`-plus-loopback allowlist, so a **self-hosted fw-server fails initialisation with a bare `Configuration` error that names nothing**.

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
- Collect manifest control-point keys from the source chosen above (parse `controlPoints[].key` — `flags[].key` in schemas 1–2; an invalid manifest is a **block** finding, never a skip). Skip rows the branch's own draft `_shadowed`, and rows whose status is `archived` / `retiring` — their control points no longer demand an anchor.
- Walk the repo for anchors under `sourceRoots`, honouring `scanExclude` — same rules as `detect_rollout_ready` / `reconcile`.
- Match `@fireweave-controlpoint <key>` in any comment leader (line, block, hash) — same regex as the rollout-server scanner.
- **block** if an anchor key has no manifest entry.
- **block** if a manifest control point has no anchor.
- **block** (`ramp1-default`) if a manifest control point's declared `default` is `true`, or a non-zero number — RAMP-1: the ramp turns a feature on, the default never does. A recorded `ramp1Exception` (legal only alongside `default: true`) downgrades it to **warn**. `false`, `0`, a string variant key, and no declared default at all all pass. This duplicates `assert_dev_checklist` check 3b deliberately: that tool is one an agent chooses to call, while this gate is what both stop hooks actually run — before it, a `default: true` shipped past a green stop hook on every host. The EVAL-SITE half of RAMP-1 stays in `assert_dev_checklist` alone; resolving the second argument of `fw.controlPoints.getBooleanValue(key, default)` needs the TypeScript compiler API, which this standalone `.mjs` cannot import.
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
msg="FireWeave rollout-ready repo (promote-not-wrap). FIRST classify this task in one line — change | inquiry | brainstorm | infra-only — because this reminder fired on a KEYWORD match and the keyword cannot tell 'fix the checkout bug' from 'how do I fix this typo'. Only 'change' runs the package; when genuinely unclear treat it as change (skipping wrongly ships unflagged behaviour, running wrongly costs a few tool calls). For a change task the rollout-ready package comes FIRST — author the manifest via upsert_rollout_manifest (FireWeave stores it; do not write a manifest file yourself) + mint chg_/stmp_ + append each stamp to its own surface's FW_STAMPS (on a start-profile surface: in .fireweave/stamps.ts, .py or .json; one shared stamp only when single-project + every surface's harness is surface-aware), seed new control points in the surface's control-points file on a start-profile surface (config options and overrides per language: .fireweave/agent-instructions.md, FireWeave SDK: configuration and overrides), add // @fireweave-controlpoint <key> as you code, then assert_dev_checklist + reconcile(build) before done. No backfill. Absence has names: only never-authored means author one; not-fetched=fw sync, not-authorized=withheld not absent, queued=drain .fireweave/.queue. Ship via /fireweave:safe-rollout. See .fireweave/agent-instructions.md."
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
    { "name": "issue_browser_key", "server": "rollout-server" },
    { "name": "resolve_sdk_install", "server": "rollout-server" },
    { "name": "run_bounded_install", "server": "rollout-server" },
    { "name": "refresh_agent_skills", "server": "rollout-server" },
    { "name": "apply_setup_artifacts", "server": "rollout-server" },
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

- `use_mcp_tool(server_name="rollout-server", tool_name="update_repo_state")` owns the repo-scoped config —
  `sourceRoots`, `scanExclude`, `teamAgents`, `installedInto`, `language`,
  `strategy`, `mcp.mode`, `sdkDev`, `deploySdkVersion`. Set-valued fields UNION,
  so two concurrent `--reinit` runs cannot clobber each other; `resetSets` is the
  `--remove` reversal. The FIRST write materialises the full derived set, not
  just the fields you name. Pointer identity stays with `select_project`, and
  `attestUrl` (the legacy-named fw-server base-URL field) / the credential-env
  names stay pointer-only.
- `use_mcp_tool(server_name="rollout-server", tool_name="upsert_rollout_manifest")` authors a rollout-ready
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

---

## Make the FireWeave readiness check required (Step 7d — tell the user, do not do it)

Once the org's GitHub App is installed, every PR into the environment branch
gets the check run **`FireWeave — rollout readiness`** from rollout-ci (server
side, in a FireWeave sandbox — nothing to install in the repo; see
`docs/wiki/concepts/rollout-ci.md`). It is announced `in_progress` before the
verdict runs, so it blocks the merge **only if the branch ruleset requires
it**. Rulesets are the customer's to change — initialise never edits them.
Print this, verbatim, at the end of a successful run:

> To make the FireWeave verdict block merges: Settings → Rules → Rulesets →
> the ruleset for `<env branch>` → "Require status checks to pass" → add
> **FireWeave — rollout readiness** (select the FireWeave app as its source,
> not "any source"). Leave "Require branches to be up to date" as it is.
> Until you do, the check is visible on every PR but advisory-only.

Do not PARK on this; it is a message, not a gate.
