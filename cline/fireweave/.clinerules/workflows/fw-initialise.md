# initialise

> One-time per-repo setup for FireWeave Rollouts. Detects coding agents + language + deploy targets, runs the capability/connection resolver to wire the FireWeave control-points SDK for control points (telemetry is the app's own — initialise DETECTS it, never wires it), wires each NEW surface onto the SDK start profile (one start call first in the entrypoint + a control-points file; existing scaffold surfaces keep their isProd() harness + fw-tracker), installs standing instructions + Cursor dev-loop rules/hooks (so feature work keeps rollout-ready manifests/anchors/stamps in sync), and writes agent links. Use when the user asks to "set up FireWeave rollouts", "initialise rollout-ready", "instrument this repo", or invokes `/fireweave:initialise`. `--reinit` / `--remove`.
>
> _User-triggered (Cline does not auto-activate workflows). Run with `/fw-initialise.md`._
>
> _The files this workflow names as beside its SKILL.md are in the `fw-initialise/` directory next to this file._

> Interaction: gate each decision with `ask_followup_question` (one question per call; supply an `<options>` array). For multi-question groups, ask sequentially.

# Initialise (one-time rollout-ready setup)

Run **once** per repo. This front-loads the rollout structure so later shipping is
a **promote, not a wrap** (D26): each app reads its control points through the
FireWeave SDK from day one, and the **dev loop** (standing instructions, the
agent entry files and the coding-agent hooks) keeps
`// @fireweave-controlpoint` anchors, the **server-owned rollout-ready manifest**
and the stamps aligned before the pull request that ships a change. It does NOT
wrap existing code, and it wires **no telemetry**: the app's observability SDK
is the app's own.

**TypeScript servers and web apps run FireWeave's setup core, in this
checkout.** It is the cloud setup's own code, driven locally: the cloud's
analysis (`setup-analyze`), the same plan file (`prepare-local-setup`),
`setup-pre` and `setup-post` with the local driver, and the same per-app steps
as `/fireweave:ci-initialise`. A local run and a cloud setup pull request write
the same files; the local run also wires the coding-agent hooks. **Nothing is
committed or pushed:** the person reviews the working tree and commits.

## Files beside this skill

Resolve each relative to the directory containing THIS `SKILL.md`, never the
target repository:

| File                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `other-languages.md`      | The steps for apps in Python, Go, Java, Rust, Dart and Swift, and for scaffold surfaces (Step 8), with the per-language reference, the harness templates' map and the scan scope                                                                                                                                                                                                                                                                                                                     |
| `templates.md`            | The agent-instructions template and the entry templates. FireWeave renders them (`setup-post`, `render-entries`); only `other-languages.md` Step 7 copies from it                                                                                                                                                                                                                                                                                                                                    |
| `harness/<surface>/*.tpl` | Scaffold-surface templates, used only by `other-languages.md` Step 4: `fw-harness.ts.tpl`, `fw-providers.ts.tpl`, `fw-tracker.ts.tpl` (ts-server, web); `fw_harness.py.tpl`, `fw_providers.py.tpl`, `fw_tracker.py.tpl`; `fw_harness.go.tpl`, `fw_providers.go.tpl`, `fw_tracker.go.tpl`; `fw_harness.rs.tpl`, `fw_providers.rs.tpl`, `fw_tracker.rs.tpl`; `FwHarness.java.tpl`, `FwProviders.java.tpl`, `FwTracker.java.tpl`; `FwHarness.swift.tpl`, `FwProviders.swift.tpl`, `FwTracker.swift.tpl` |

## Two harness kinds — the start profile for new surfaces, the scaffold for existing ones

Every surface is one of two kinds, recorded as `harnessKind` on its `project.json`
`surfaces[]` entry:

| Kind                                    | When                                                                                               | What initialise writes                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **package** — the SDK **start profile** | **every NEW surface**, all eight languages, SDK ≥ 3.0.0                                            | A control-points file and ONE start call placed first in the entrypoint (see **Start profile — per-language reference** in `other-languages.md`), stamps in `.fireweave/stamps.<ext>`. No harness module, no providers file, no `FW_ENV_PROFILES`. |
| **scaffold** — `harnessKind` absent     | a surface that ALREADY carries a generated harness (`fw-harness.*`, `FwHarness.*`, `fw_harness.*`) | The generated harness + providers + tracker, calling the core `initFireweave` with an explicit mode. Everything this document says about `FW_ENV_PROFILES`, the env-source interview, templates and `FW_STAMPS` is about this kind.                |

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
| `.fireweave/project.json` — the **pointer**: `orgId`, `projectId` (or a `projects{}` map), `server.url` | Rollout-ready manifests → `repo_manifests`, authored via `fw tool upsert-rollout-manifest`                                                                     |
| `.fireweave/agent-instructions.md`                                                                      | Change stamps → `change_stamps` (D-D). `FW_STAMPS` in `fw-tracker` (`.fireweave/stamps.<ext>` on a package surface) stays the one git-visible per-feature line |
| `.fireweave/PROVIDERS.md` (scaffold surfaces only)                                                      | Repo-scoped config → `repo_state`, written via `fw tool update-repo-state`                                                                                     |
| `.fireweave/hooks/` (build gate + wrapper)                                                              | Project×env + surface config → already server-side                                                                                                             |
| `.fireweave/.gitignore`                                                                                 |                                                                                                                                                                |

**Do not create `.fireweave/rollout-ready/`, `.fireweave/changelog/`, or an
`_archive/` directory.** They have no successor directory — archival is a `status`
on a server row. **`config.json` is dropped**: it is inert and read by nothing;
creating it on a fresh init only gives a future reader a second place to look.

**Ownership is a POSITIVE marker, never the absence of a block.** `fw init` writes
`repoState: "server"` into the pointer; that is what says fw-server owns this repo's
state. There is no "shape" to read any more — `repoShapeOf` answered from the
ABSENCE of a `rolloutReady` block, which is also exactly what `fw select-project`
leaves behind, so it could never tell _migrated_ from _never initialised_ and every
gate keyed on it decided from a field nobody had written. It is deleted. **`version`
stays `2`** — `ProjectBindingSchema` accepts only `1 | 2`, so writing `version: 3`
makes the pointer fail to parse and every reader treats the repo as _unbound_,
which is strictly worse than not migrating. Never branch on `version` either: it is
advisory and has been observed wrong in both directions.

Gitignored, per-worktree, and **never committed**: `.fireweave/.cache/` (a
disposable projection, rebuildable with `fw sync`), `.fireweave/.lock`,
`.fireweave/local.json`. Unsynced manifest edits wait in the outbox,
`.git/fireweave/outbox/` (in the git common dir, shared by every worktree, never
committed — _not_ a cache, no cache-clear remediation may delete it); `fw sync`
sends it.

Initialise writes no credential to disk. The project key is issued by the operator in the
portal; a package client surface's browser key comes from `issue-browser-key`
(Step 9). `fireweave.md` (repo root, **committed**) names a scaffold surface's variables.
A `.fireweave/deploy-beacon.env.local` left by an older initialise is inert and safe to delete.

**Scaffold surfaces are environment-keyed, not dev/prod-binary (D26).** (A package
surface needs none of this: the start profile infers its mode — see **The SDK
contract** in `other-languages.md`.) The harness selects its branch
from the **running environment NAME** — the project's `defaultEnvironment` plus
every environment declared in FireWeave (`list-project-environments`) — via a
generated `FW_ENV_PROFILES` map, NOT a bare `NODE_ENV` boolean. Each environment
is classified into a **tier** (`dev` → local provider + console; `prod` → connected
vendor + OTLP). `staging` is a **first-class prod-tier** environment,
never silently folded into dev or prod. `isProd()` remains only as the classifier
for the tier and the token `verify-prod-path` greps for — it is no longer the
switch. The default environment is the row that runs when nothing is set at runtime,
and it determines which capability bindings the **dev** branch reflects; the **prod**
branch is wired from the **prod-tier** environment's bindings (Step 3).

**Surface support (one table, the rollout-server `SURFACE_REGISTRY` agrees).**
Every language — ts-server, web, Python, Go, Java, Rust, Dart and Swift — is
**package-capable at SDK ≥ 3.0.0**, prod included, on the SDK's remote mode. The
gate is `fw tool resolve-sdk-install`: when it cannot resolve a 3.0.0
release for the surface's channel it refuses, and the surface is not wired. Swift is
installed **straight from the SDK repository** (SwiftPM resolves the `FireweaveStart`
product from its root `Package.swift` at a plain `X.Y.Z` tag, package `fireweave-sdk`),
never from a `swift/*` tag. Scaffold
surfaces keep the support they were scaffolded with and are not created any more. A
project with **no prod-tier environment** (dev-only) gets the dev path wired and prod
secrets **deferred with an explicit notice** — Step 3 never forces a prod-run
question when there is no prod-tier environment to run against.

## Running FireWeave's tools (`fw tool`)

This skill runs FireWeave's tools through the `fw` CLI in your shell, as `fw tool <name>`. There is no FireWeave MCP server.

- **Which `fw`.** Run `command -v fw`; when it prints nothing, use `~/.fireweave/bin/fw` (`fw.exe` on Windows) if that file exists. Then run `fw tool list --json`: its `binary.realpath` is the `fw` that answered. When that is not the installed FireWeave binary (`~/.fireweave/bin/fw`, or wherever the user installed it), stop and say which `fw` is first on `PATH`.
- **Input.** Write the tool's input as one JSON object to `.fireweave/tmp/<name>.json` with your file-editing tool, then run `fw tool <name> --input-file .fireweave/tmp/<name>.json` from the repository root. A tool that needs no input runs as `fw tool <name>`. Leave `cwd` out: `fw tool` takes it from the shell's directory, clamped to the repository. `.fireweave/.gitignore` ignores `tmp/`; add that line when it is missing.
- **Output.** One JSON envelope, `{ "status", "exitCode", "reason"?, "result"? }`; `result` is the tool's own answer. Exit `0` ok · `1` refused · `2` bad input · `3` auth (`fw login`) · `4` upgrade (`fw self-update`) · `5` unavailable (retry later). A refusal never exits 0.
- **Plain commands.** One `fw …` command per shell call, and each `fw tool` command on its own (FireWeave's hook refuses one joined to anything else); other commands may form a plain `&&` chain: no redirection, no heredocs, no `$(…)`, no `VAR=` prefixes, no globs, and never `fw api`. Hosts pre-approve plain `fw tool`, `fw status` and `fw sync` commands; `fw manifest …`, `fw login` and `fw select-project` ask the user first.

## Step 0 — Auth + create-permission + repo-bind precondition (fail closed)

**SCN-16 — hard PARK writes nothing.** Reserve the word **PARK** for
precondition failures the user must fix outside this run. On any hard PARK,
leave FireWeave **scaffold / ship artifacts** unchanged this run (no harness /
hooks / lockfile / `.fireweave/.cache/**` / `rollout-ready` writes from
Steps 1–9). Interactive waits _after_ an intentional commit-point are
**awaiting-user** (soft continue) — never labeled PARK. **Bind carve-out:**
Step 0c may run `fw select-project` to rebind a stale bind (`orgMatch: false`) —
that remedy writes `.fireweave/project.json` **and** `.fireweave/local.json` as
**bind artifacts in full** (precondition for the rest of init). It never binds
an unbound repository: that is the user's `fw init` (Step 0.0).
Those two paths are **never** tracked in `sessionWrote[]`, **never** rolled
back / deleted on hard PARK, and on `orgMatch: false` rebind **never** restored
to the stale pre-bind content (trade: bind+later PARK may leave bind files;
idempotent for the next run — SCN-16 scopes scaffold/ship orphans, not the
bind). Standalone paths those remedies may also touch (repo-root `.gitignore`,
`.fireweave/rollouts/`, `.fireweave/.cache/**`, etc.) **remain** scaffold/ship —
track them in `sessionWrote[]` and roll back on hard PARK. Gate order: every
**scaffold/ship** hard gate runs before the first scaffold write batch
(Step 5, setup pre, here; Step 3e in `other-languages.md`). If a scaffold/ship tool still writes before a hard stop (crash /
partial provision), track **those** paths in session-only `sessionWrote[]` and
delete **new** scaffold/ship paths on hard PARK (prefer restoring git-clean
modified _scaffold_ files — never the Step-0 bind files). When `other-languages.md` 3e has patched
`project.json` with env fields and then hard-PARKs, rollback
restores **pre-3e content with the bind intact** — do not delete the file and
do not revert to a stale `orgMatch: false` bind. Do **not** invent a resume
lockfile for init.

**0.00 — `fw`, sign-in, the agent switch and the binding (the first commands; fail closed).**

<!-- fw-step0 -->
<!-- The same text in initialise, adopt, add-surface, cleanup and migrate-harness. Edit it in initialise, then run `bun run gen:setup-templates` in packages/rollout-tools. -->

Run these from this shell, in this order, not from what an earlier session saw. Stop at the first one that fails: **PARK, writing nothing,** and say which case it is.

1. **Which `fw`: `$FW`.** Read `.fireweave/local.json`. When it has a `cliPath` that is an absolute path to an executable file (`test -x <cliPath>`), `$FW` is that path; otherwise `$FW` is `fw`, found as **Which `fw`** says. Every `fw …` command this skill names runs as `$FW …`. `$FW` is a placeholder, never a shell variable: type the path itself.
2. **The tools are there.** `$FW tool list --json` lists every tool this skill's **Tool manifest** names.
3. **Signed in.** `$FW tool ensure-auth` exits `0`.
4. **FireWeave is on for coding agents here.** `$FW tool agent-context`. From here on `$FW` is its `result.cli`. On `result.state`:
   - `on` → continue. When `result.enforced` is `true`, say so: this project requires FireWeave for coding agents, so `fw agents off` cannot switch it off here.
   - `off` → **stop, writing nothing,** and tell the user: _"FireWeave is switched off for coding agents in this repository on this machine. Run `fw agents on` in a terminal, then run this skill again."_ Never switch it on yourself.
   - `sign-in` or `ask` → `fw login` in a terminal, then run this skill again.
   - `silent` → this repository is not bound to a FireWeave project (`result.reason` `not-fireweave-repo`), or `.fireweave/project.json` is not valid JSON (`invalid-project-json`): run `fw init` in this repository first, then this skill again.
5. **Bound.** `result.repo_binding.bound` from step 3 is `true`; otherwise run `fw init` in this repository first, then this skill again. Never bind it yourself.

| What happened                                                                              | Tell the user                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fw` is not found (see **Which `fw`**)                                                     | install the `fw` CLI (`docs/install.md`), then run `fw plugins install fireweave`: it installs FireWeave's skills and the allow rule that lets this agent run `fw`. Then run this skill again                                   |
| `$FW tool list --json` lacks a tool this skill's **Tool manifest** names                   | this `fw` is older than the skill: `fw self-update`, then `fw plugins install fireweave`                                                                                                                                        |
| `$FW tool ensure-auth` exits `5`, or its `result.create_permission.cause` is `unreachable` | this shell cannot reach FireWeave: it is sandboxed or offline. `fw plugins install fireweave` writes this agent's allow rule for `fw`, which lets `fw` reach FireWeave from a sandboxed shell; or run where the network is open |
| `$FW tool ensure-auth` exits `3`                                                           | `fw login`, then run this skill again                                                                                                                                                                                           |

<!-- /fw-step0 -->

**0.0 — SDK channel (the first tool call; fail closed).** Before anything else, run
`fw tool resolve-sdk-channel`. Which SDK line this repository
installs is fw-server's decision, made from its own environment
(`development` → `dev`, `staging` → `staging`, `production` → `production`):
the tool reads `server.url` from `.fireweave/project.json` and asks that
server's public meta endpoint for its `channel`. The installed `fw` CLI
does not decide it, and neither does this skill: **never ask the user for a
channel and never default one.**

- `{ ok: true, channel, serverUrl, serverKind }` → hold `channel` for the whole
  run. Every `resolve-sdk-install` call passes it (`other-languages.md` Step 4, `--reinit`), and it
  answers Step 0d's channel gate. `serverKind` is `project.json`'s
  `server.kind`; `custom` is when `other-languages.md` Step 3c asks about `FIREWEAVE_URL`.
- `{ ok: false, reason, detail }` → **STOP: write nothing** — no bind, no
  `fw select-project`, no scaffold (a hard PARK). Show `detail`; it names the
  remedy:

  | `reason`             | What it means                                                                | Remedy                                                                                |
  | -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
  | `unbound`            | no `.fireweave/project.json`, or it names no project                         | run `fw init` in this repository, then initialise again                               |
  | `no-server-url`      | a project, but no `server.url`                                               | run `fw init` here again, then initialise again                                       |
  | `server-unreachable` | the server did not answer its meta endpoint                                  | check that it is up and reachable; bound to the wrong server → `fw login`, `fw init`  |
  | `server-too-old`     | its meta endpoint has no `channel` (before this release)                     | this server does not report its SDK channel yet: initialise again once it is upgraded |
  | `unknown-channel`    | its meta endpoint names a channel this plugin does not know (a newer server) | update the FireWeave plugin, then initialise again; never guess a channel             |

This is local initialise only. Cloud setup never calls it: fw-server writes the
same answer into the setup plan's `channel`.

**0a — Profile.** Read `result` of the `fw tool ensure-auth` run in 0.00 (run it
from the directory the user opened). On `ok: false` (no profile) → instruct
`fw login` (then `fw init`) and PARK. `ok: true` only proves a CLI profile (user/org) exists — it does
**NOT** mean this repo is bound to a project.

**0b — Create permission (SCN-14, flag-aware, before any disk write).** Read
**`create_permission_park.required`** from the same `fw tool ensure-auth` result. When it
is `true`, PARK — **write nothing** (no `fw select-project`, scaffold, package tree,
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
When `create_permission_park` is absent (an older fw-server), fall back to the
bullets above.

**0c — Repo binding (fail closed, allowlist).** Read `repo_binding`
from the same `fw tool ensure-auth` result. Continue **ONLY** when
`repo_binding.bound === true` **and** `repo_binding.orgMatch !== false`.
Missing / undefined `repo_binding` or missing fields → treat as unbound and
PARK.

On PARK:

- Auth (`cause: auth`) → `fw login` / `fw whoami --force`. Do **not** scaffold.
- Create denied or indeterminate-while-enforced → use
  `create_permission_park.reason` (or: _You don't have permission to create
  rollouts in this org — contact an org admin to grant member access, or switch
  to a profile that can_). Do **not** scaffold and do **not** run
  `fw select-project`.
- `bound: false` / incomplete bind → tell the user to run `fw init` in this
  repository, then initialise again. **Never bind it yourself** — no
  `fw select-project` and no `fw init` from this skill: the binding names the
  server whose environment decides the SDK channel (Step 0.0).
- `orgMatch: false` → ask: wrong active profile, or stale/copied bind?
  Wrong profile → `fw profile use <alias>` (do **not** rebind). Stale bind →
  `fw select-project` (it lists the projects and asks first; `fw tool
select-project` never rebinds a bound repository), then run
  `fw tool resolve-sdk-channel` again and use its answer: the rebind may name
  another server.

**Do not scaffold or write any FireWeave file while unbound or unauthorized.**

**Do not scaffold or write FireWeave scaffold/ship artifacts while unbound or
unauthorized.** The sole exception is the Step 0c stale-bind remedy
(`fw select-project`) after create permission is clear — its
`.fireweave/project.json` + `.fireweave/local.json` writes are the bind
carve-out above (whole-file per remedy; there is no field-level rollback).
Other writes those remedies may perform (repo-root `.gitignore`,
`.fireweave/rollouts/`, machine-local pointers outside `local.json`, etc.)
remain scaffold/ship — track them in `sessionWrote[]` and roll back on hard
PARK.

**0d — Setup plan (ADR-028, ONB-D9).** Once the bind holds, ask FireWeave
whether this repository was already analysed and planned in the web app:
`fw tool get-setup-plan` with the input `{ "projectId": "<projectId>", "repo": "<owner/name>" }`
(`projectId` from `.fireweave/project.json`, `owner/name` from the `origin`
remote). Over the CLI profile, like every Step 0 call — read only, writes
nothing.

- exit `1` with `result.code` `SETUP_PLAN_NOT_FOUND` (HTTP 404) — no plan:
  proceed exactly as without one.
- exit `1` with `result.code` `REPO_CONTEXT_ONLY` (HTTP 409) — this project
  links the repository as Context only; FireWeave never sets it up. PARK and
  name the project that manages it (the `reason` names it), or say none does.
- exit `0` — `result.data.plan` answers these gates. For each one, use the
  plan's value instead of asking, and name it in the session summary with
  `source: webapp (setup plan v<version>)`, so the summary says the answer
  came from the web app, not this session:

  | Gate                                                  | Plan answer                                               |
  | ----------------------------------------------------- | --------------------------------------------------------- |
  | Step 1 "Let FireWeave manage rollouts?"               | yes: the repository is Managed in the plan                |
  | Step 3b `teamAgents`                                  | `plan.teamAgents`                                         |
  | Step 3c envs carrying real traffic                    | `plan.environments`                                       |
  | Step 3d INIT-B11 observability unbound                | `plan.automation.autoRampEnabled`                         |
  | `other-languages.md` 3c where each prod-tier env runs | `plan.environments[].runsOn`                              |
  | `other-languages.md` 3d env-source confirm            | `plan.surfaces[].envSource`                               |
  | FW_ENV_ALIASES confirm                                | `plan.environments[].aliasValues`                         |
  | Step 3a GATE-3F-SURFACE-SELECTION                     | `plan.surfaces[].selected`                                |
  | GATE-3F-VANISHED-SURFACES                             | not in the plan: ask as today                             |
  | Step 3e identity seam                                 | `plan.surfaces[].identitySeam` (`pr-todo` → ask as today) |
  | Step 3f package-manager ambiguity                     | `plan.surfaces[].packageManager`                          |
  | channel                                               | Step 0.0's `resolve-sdk-channel` (never asked)            |

  A plan value that is `null` or missing answers nothing: ask that gate as
  today. Everything not in the table — auth, keys, secrets, the browser key,
  the harness itself — runs exactly as it does without a plan. The channel
  row is not the plan's either: `plan.channel` is the same server's answer,
  and Step 0.0 already holds it.

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

  A re-asked gate shows the plan's value as the default, and the summary
  carries the session's answer, not `source: webapp`. When the plan's
  commit is not in this clone's history, the area cannot be known: re-ask
  every row, with the plan's values as defaults.

The tool-manifest check ran in 0.00: every tool this skill's **Tool manifest**
names is in `fw tool list --json`.

## Steps

| App                                                                                                    | Path                                                           |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| a TypeScript server (`ts-server`) or a web app (`web`)                                                 | the setup core: Steps 1–7, then 9                              |
| Python, Go, Java, Rust, Dart or Swift, or a scaffold surface (one that already carries `fw-harness.*`) | Steps 1–3 here, then Step 8: `other-languages.md`, then Step 9 |

The run's files live under `.fireweave/tmp/setup/` (git-ignored): `plan.json`,
`pre.json`, `notes.json` and `result.json`, plus the run's checkpoints. Only the
tools write them, except `notes.json`, which is yours (Step 6). Every
clarification uses `ask_followup_question`.

### 1 — Repo gate

`ask_followup_question`: _"Let FireWeave manage rollouts in this repo?"_ **No → exit,
touch nothing.**

### 2 — Analyse

Run `fw tool setup-analyze`. It is the cloud setup's deterministic analysis of
this checkout, read-only and offline: `findingApps` (each app root with its
`kind`, `entrypoint`, `verdict`, `framework` and `preselect`), `signInCode`
(where each app learns who is signed in), `deployTargets`, `observability`,
`teamAgents` and `packageManagers` (by app root). A stage that is `unavailable`
or `failed` answers nothing: ask its question plainly in Step 3, never guess.

### 3 — Plan: the web app's setup questions, asked here

A setup plan from Step 0d answers each question it covers (name it
`source: webapp`); ask the rest.

- **a. Apps** (gate `GATE-3F-SURFACE-SELECTION`). Show every `findingApps` row
  with its verdict, then one multi-select: pre-tick exactly the rows with
  `preselect: true`; leave the others unticked but selectable. An app already in
  `.fireweave/project.json` `surfaces[]` is set up: leave it out unless this is
  `--reinit`. Never declare an app the person did not tick.
- **b. Coding agents** (`teamAgents`). One multi-select,
  _"Which coding agents will the team use in this repo?"_, pre-ticked from
  `teamAgents`. **V1 full-materialize options:** `claude` and `cursor` get the
  entry files and the hooks; `codex` and `cline` are link-only experimental and
  read `AGENTS.md` only. The person may add an agent not installed on this
  machine. **Hold** the selection in memory as `teamAgents`: it reaches
  FireWeave through Step 4's plan and Step 9's repo state. An empty answer:
  re-ask once, then use the detected agents; never invent `["cursor","claude"]`
  when neither was detected and the person declined.
- **c. Environments.** `fw tool list-project-environments` with
  `{ "projectId": "<projectId>" }`. Each environment is `production` tier when it
  runs real user traffic, else `non-production`; ask which ones do when the tool
  does not say.
- **d. Metrics.** `fw tool get-project-capabilities` with
  `{ "projectId": "<projectId>", "environment": "<a production-tier slug>" }`.
  Hold its `perEnvironmentRegistration` for Step 7. Read `automation` first: an
  unreadable `automation` block (absent, a failed read, malformed) is a hard
  PARK, never `{ autoRampEnabled: false }`; hold `automation.autoRampEnabled`
  for Step 4. `bindings.observability.state`
  `bound` → `already-connected`. Otherwise (**INIT-B11**) ask: connect metrics
  in FireWeave now (`connect`), or continue without (`skip`, every rollout ramps
  manually). With `autoRampEnabled` on, `skip` is a hard PARK. Never write an
  exporter or any telemetry.
- **e. Sign-in code** (identity seam), per app: show the `signInCode`
  candidates under its root and confirm one file; none, or not sure → leave it,
  and setup post adds the to-do.
- **f. Package manager**, per app: `packageManagers[<app root>]`; ask when there
  is none or more than one.

The SDK channel is Step 0.0's, never asked.

### 4 — Write the plan and declare the apps

Write to `.fireweave/tmp/prepare-local-setup.json`, for the `ts-server` and
`web` apps ticked in 3a:

```json
{
  "surfaces": [
    {
      "path": "<app root>",
      "kind": "ts-server",
      "surfaceId": null,
      "entrypoint": "<findingApps entrypoint, or null>",
      "packageManager": "<3f>",
      "metricsClient": "<observability's client for this app, or null>",
      "identityFile": "<3e, or leave it out>"
    }
  ],
  "environments": [{ "slug": "production", "tier": "production" }],
  "teamAgents": ["<3b>"],
  "channel": "<Step 0.0's channel>",
  "metrics": "<3d>",
  "autoRampEnabled": "<3d: automation.autoRampEnabled, true or false>"
}
```

`surfaceId` is the one `.fireweave/project.json` records for that app root, or
`null`. Run `fw tool prepare-local-setup --input-file .fireweave/tmp/prepare-local-setup.json`.
It writes `.fireweave/tmp/setup/plan.json` (the cloud's plan file, with every
surface the repository already records carried unchanged) and starts the run
over.

**The server mints every surface id; you never do.** When `result.undeclared`
is not empty, write it as it is, each entry with `"rolloutCredentialEnv"` added
(`FIREWEAVE_KEY` for `ts-server`, `FIREWEAVE_BROWSER_KEY` for `web`), to
`.fireweave/tmp/declare-surfaces.json` and run **one**
`fw repo declare-surfaces --project <projectId> --json --surfaces @.fireweave/tmp/declare-surfaces.json`.
A non-zero exit → PARK: on `conflict` name the colliding surface and its
project; `unknown command 'declare-surfaces'` means an old `fw` (`fw self-update`).
Never mint an id to get past it. Put each returned `surfaceId` on its app and run
`prepare-local-setup` again: `undeclared` is now empty.

When 3a also ticked apps in other languages, add one entry per such app to the
same `declare-surfaces.json`, built as `other-languages.md` Step 3f says, so
this one call carries every surface. Hold their ids for Step 8.

### 5 — Setup pre

Run `fw tool setup-pre`. It records which files are already uncommitted (setup
never reverts them), checks the bind, records the env contract, installs the
SDK in each app on Step 0.0's channel and writes the fixed files (each app's
control-points and start modules, the stamps file, the ignore lines). It
resumes from its checkpoint: after a failure, fix the cause and run it again.
`result.status` `parked` → say `parkReason` and stop. Per app: `ready` or
`agent` → Step 6; `blocked` → tell the person its `todo`.

### 6 — Per app

The same steps FireWeave's cloud setup runs, on `.fireweave/tmp/setup/pre.json`.
Your notes go in `.fireweave/tmp/setup/notes.json`, in the shape
`/fireweave:ci-initialise`'s **Output contract** gives: `schemaVersion: 1`, one
`surfaces[]` entry per `ready` or `agent` app (`path`, `outcome` `set-up` or
`not-set-up`, `reason`, `todo`, `entrypoint`, `filesEdited`, `identity`,
`metrics`) and `todos[]`. The person is here: when an app cannot be wired
safely, ask before you mark it `not-set-up`. Never write `.fireweave/project.json`,
`.fireweave/agent-instructions.md`, `.fireweave/instructions/`, the agent entry
files or any hooks file: setup post writes them.

<!-- fw-per-app -->
<!-- The same text in ci-initialise and initialise. Edit it in ci-initialise, then run `bun run gen:setup-templates` in packages/rollout-tools. -->

**1. Find the entrypoint** when `entrypoint` is null: the module the app's
process (server) or page (web) loads first. Read its manifest (`package.json`
scripts, `index.html`, `pyproject.toml`, `Cargo.toml`, `Package.swift`,
`go.mod`, `pom.xml`, `build.gradle*`, `pubspec.yaml`); do not
explore further than that. Record it in your notes.

**Repo conventions.** Every edit should look like the repo wrote it:

- The lockfile is written only by the repo's own tool. Never edit one by hand.
- A dependency goes in the manifest of the module that owns the entrypoint, in
  the declaration style that manifest already uses.
- Imports follow the entrypoint's existing style.
- Format the files you edited, and only those, with the formatter the repo
  already configures. No formatter configured: format nothing. Never run an
  import sorter over a start call.

`kind` decides the steps. `startPath` null means the start call goes in the
entrypoint itself. Do not edit `<startPath>` or `<controlPointsPath>`.

**2. `ts-server`.** The entrypoint's FIRST import is the start module:

```ts
import '<startImport>'; // FireWeave: must stay the first import
```

Nothing else changes. When pre installed the CommonJS twin under the ES module
name (`"@fireweaveai/server-sdk": "npm:@fireweaveai/server-sdk-cjs@…"`),
imports stay `@fireweaveai/server-sdk/start`. When it added
`@fireweaveai/server-sdk-cjs` as a devDependency (Jest runs as CommonJS), add
to the Jest config
`moduleNameMapper: { '^@fireweaveai/server-sdk(/.*)?$': '@fireweaveai/server-sdk-cjs$1' }`,
and for a jsdom environment a setup file with
`globalThis.TextEncoder ??= require('node:util').TextEncoder;`.

**3. `web`.** The entry module's FIRST import is the start module, and the
first render waits for it with `then` (never a top-level `await ready`):

```ts
import { ready } from '<startImport>';
// …existing imports…
ready.then(() => createRoot(el).render(<App />));
```

- Build config (`buildConfig`). Vite, SvelteKit, React Router 7, Nuxt, Astro:
  `fireweave()` from `@fireweaveai/web-sdk/vite` in its plugins (Nuxt and
  Astro under `vite: { plugins: [...] }`). Next.js:
  `compiler: { define: fireweaveDefine() }` in `next.config`
  (`@fireweaveai/web-sdk/define`); never a `webpack()` DefinePlugin hook,
  which fails Next 16's default Turbopack build. webpack, esbuild, Rollup:
  `fireweaveDefine()` through the bundler's define plugin. Angular, Parcel,
  Create React App: no build plugin; pass `key` and `environment` to `start()`
  at runtime, from the app's own config.
- Named entries. SvelteKit: `src/hooks.client.ts`. Next.js:
  `instrumentation-client.ts` (Next ≥ 15.3) or a `'use client'` provider in the
  fireweave directory, wrapping `{children}` in `app/layout.tsx`. React Router
  7: `app/entry.client.tsx`; when absent, write the default one
  `react-router reveal` would, with the start import first. Nuxt:
  `plugins/fireweave.client.ts` that imports `ready` and returns it. Astro: a
  `<script>` importing the start module in the base layout. Angular:
  `ready.then(() => bootstrapApplication(...))`.
- A Content-Security-Policy that would block the SDK's request: add the
  FireWeave origin if the policy is in this repository, otherwise a to-do.

**4. `python`.** The start call is the FIRST statements of every process
entrypoint (`main.py`, `wsgi.py`, `asgi.py`, the `create_app()` module, the
Celery app module), before the app's own imports; only a docstring and
`from __future__` imports stay above it:

```python
from fireweave.start import start
from fireweave_setup.control_points import control_points
start(control_points=control_points)
```

`fireweave_setup/` sits in the entrypoint's import root (`src/` in a src
layout). Never create a package or module named `fireweave`: it shadows the
SDK.

**5. `rust`.** In each server binary's `main.rs`: `mod fireweave_control_points;`
beside its other `mod` lines, `use fireweave::start::StartOptions;`, and first
in `main`:

```rust
fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() }).expect("FireWeave start");
```

End it in `?` instead only when `main` returns a `Result` whose error type
accepts `FireweaveError` (`Box<dyn Error>`, `anyhow::Error`). Under
`#[tokio::main]` it still goes first: the call is synchronous. Never a local
module named `fireweave`.

**6. `swift`.** `FireweaveLocalControlPoints.swift` sits beside the entry. Add
`import FireweaveStart` to the file that starts. App:
`startFireweave(controlPoints: appControlPoints)` in the SwiftUI `App`'s
`init()` (add one if absent) or the first line of `didFinishLaunching`.
Server (Vapor): `try startFireweave(FireweaveStartOptions(controlPoints: appControlPoints))`
first in `configure`. Never edit `project.pbxproj`: an Xcode app's SDK install
is a to-do pre already wrote.

**7. `go`.** In each `main`, after config loading and flag parsing:
`fw.Start(fw.Options{ControlPoints: appfw.ControlPoints})` (`appfw` = the
control-points package), its error handled as `main` handles others. Not in
`init()`.

**8. `java`.** `Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build());`
first in `main` (`ai.fireweave.sdk.start.{Fw, StartOptions}`); Spring Boot:
before `SpringApplication.run`.

**9. `dart`.** `await Fireweave.start(controlPoints: controlPoints);` in `main`
before `runApp` or serving (`main` turns `async`), importing the control-points
file and its `package:fireweave/…` entry. A Flutter app stays `unverified` (no
Flutter SDK here; pre edited `pubspec.yaml`): add a to-do to run `flutter pub get`.

**10. Identity.** When `identitySeam.kind` is `path`, open that file and bind
identity where the user is known, unconditionally — never inside a
control-point branch (INIT-S8):

- `ts-server`: `await fw.identify(user.id, { ...durable properties })` at
  sign-in (`import { fw } from '@fireweaveai/server-sdk/start'`).
- `web`: `await fw.identify(user.id, props)` at sign-in AND session restore,
  `await fw.reset()` at sign-out (`@fireweaveai/web-sdk/start`).
- `python`: `fw.identify(user_id, props)` at sign-in
  (`from fireweave.start import fw`; async code: `asyncio.to_thread`); skip an
  anonymous user, whose id is `None`.
- `rust`: `let _ = fireweave::start::identify(&user.id, [...]);` at sign-in
  (async code: `spawn_blocking`).
- `swift`: `await fw.identify(user.id, properties: [...])` at sign-in; an app
  also at session restore, with `await fw.reset()` at sign-out.
- `go`: `go func() { _ = fw.Identify(ctx, user.ID, props) }()` at sign-in.
- `java`: `Fw.identify(userId, Map.of(...))` at sign-in.
- `dart`: `await fw.identify(user.id, properties: {...})` at sign-in; a client
  also at session restore, with `await fw.reset()` at sign-out.

Otherwise leave identity alone: post adds the to-do. Record what you bound.

**11. Metrics.** `metrics` in pre.json is what the analysis found and checked:
`plan.surfaces[].metricsClient` and the real calls from
`plan.surfaces[].metricsExamples`. Confirm each cited line still says what it
quotes; drop one that does not. Add what a feature agent will need and the
analysis did not record, all from code you can cite: the import line as it
appears, the counter and histogram call shapes, where the instrument comes from,
a wrapper the repo prefers, the tag convention. Never invent a convention: when
the app emits no metrics, keep `client: "none"`. Post writes all of it into
the app's metrics file under `.fireweave/instructions/` (indexed by
`.fireweave/agent-instructions.md`), beside the per-change metrics check:
**Before you add a metric.** Write that section whatever the plan's
observability says about Metrics (`bindings.observability.state` is the Metrics
unit; Logs and Traces are bound separately), because metrics can be connected
after this PR merges; post
does, for every app, so you never need to.

**12. Optional overrides.** Add `environment:` to the start call only when the
app demonstrably names its environment in another variable. Otherwise leave the
start file as FireWeave wrote it.

**13. Validate.** After the edits, run:

```sh
fw setup validate --cwd <repository> --pre /work/.fw/setup/pre.json --path <app path> --json
```

Exit 1 means your edits added errors: `newErrors` lists them. Fix them once,
then run it again. Record the last run's `validation` in the app's notes
entry. Errors still there: mark the app `not-set-up` with `reason`
`validation-failed` and the errors in `error`.

**If an app cannot be finished** (no entrypoint you can identify, a framework
you cannot wire safely), undo YOUR edits to that app and mark it `not-set-up`
with a one-line `reason` and a `todo` a person can act on. Then continue.

**After each app**, rewrite your notes file, `notes.json`, with every app done
so far, so a retry resumes after it.

<!-- /fw-per-app -->

### 7 — Setup post

Write `{ "perEnvironmentRegistration": <3d's value, false when absent> }` to
`.fireweave/tmp/setup-post.json` and run
`fw tool setup-post --input-file .fireweave/tmp/setup-post.json`. It checks
each app, writes `.fireweave/agent-instructions.md` and
`.fireweave/instructions/`, the agent entry files (as `fw tool render-entries`
does), the allow rules, FireWeave's coding-agent hooks for `claude` and
`cursor` (as `fw tool install-agent-hooks` does) and the git pre-push hook, and
reverts only the agent wiring setup itself changed: never a file that was
uncommitted before Step 5 (that gets a to-do). Its result
(`.fireweave/tmp/setup/result.json`) carries `status`, each app's `outcome`,
`todos`, `repoState` and `filesChanged`.

### 8 — Other languages

When Step 3a ticked apps that are not `ts-server` or `web`, follow
`other-languages.md` for them now, then come back for Step 9.

### 9 — Finalise

1. **Repo state.** Write `{ "fields": <result.repoState> }` (plus the other
   languages' fields from Step 8; only those when no `ts-server` or `web` app
   ran setup post) to `.fireweave/tmp/update-repo-state.json` and
   run `fw tool update-repo-state --input-file .fireweave/tmp/update-repo-state.json`.
   It is the one writer of `sourceRoots`, `scanExclude`, `teamAgents`,
   `installedInto`, `language`, `strategy` and `sdkDev`: never hand-write them
   into `project.json`. `outcome: 'refused'` → PARK.
2. **Skills.** When `cursor` ∈ `teamAgents`, copy FireWeave's skills with
   `fw tool refresh-agent-skills` (see **Skill copies**). The `feedback` skill
   must be in the installed set for every agent in `teamAgents`.
3. **Hooks are current.** Write `{ "mode": "check" }` to
   `.fireweave/tmp/install-agent-hooks.json` and run
   `fw tool install-agent-hooks --input-file .fireweave/tmp/install-agent-hooks.json`:
   every file and script is `current` and `checks` is empty. A `modified` file
   (someone edited FireWeave's entry): ask, and on yes run it with
   `"mode": "install"` and `"editedHooks": "replace"`. Anything else is a to-do
   for the person.
4. **Browser keys** (each `web` app set up, each production-tier environment):
   `fw tool issue-browser-key --input-file .fireweave/tmp/issue-browser-key.json --write-to .fireweave/tmp/browser-key-<slug>`
   with `{ "projectId", "surfaceId", "environment": "<slug>" }`. `issued` → the
   key is in that git-ignored file, never printed: hand it to that
   environment's build destination as `FIREWEAVE_BROWSER_KEY` (set it there
   only on the person's explicit yes), then delete the file; `exists` → the
   person reuses the key they stored, or on explicit yes run it again with
   `"rotate": true`; `fallback-portal` → the portal's **Browser keys** panel.
   A refusal is never a PARK.
5. **Report the harness — FIR-359**, over the CLI profile:
   `fw tool report-harness-migration --input-file .fireweave/tmp/report-harness-migration.json`
   with `{"projectId":"<projectId>","status":"migrated","repo":"<owner/name>","sdkVersion":"<installed SDK version>","surfaces":[<every app set up this run>]}`.
   `partial`, naming the gap in `notes`, when any app ticked in 3a is not set up.
   **Never report `migrated` to make the page green.** A non-zero exit: say the
   project page still warns; do not PARK.
6. **Tell the person**, in this order: each app's outcome; every to-do
   (`deploy-secret`: set `FIREWEAVE_KEY`, a project key from the portal's
   **Project settings → API keys**, in that environment's deploy destination;
   `env-var`, `required-check`, `browser-key`, `merge-onward`, `other` as they
   read); the merge gate (below); the files changed (`filesChanged`), and that
   nothing is committed: review the working tree and commit it. The hooks run
   on every teammate's machine once merged. **Reload notice — INIT-A4:** name
   only the agents whose files this run wrote (Cursor → reload Cursor; Claude →
   the next Claude session), and mention `/fireweave:adopt` for a teammate on
   another agent.

**The merge gate.** Once this repository is set up, FireWeave makes its
readiness check, "FireWeave — rollout readiness", required on the repository's
environment branches through its own ruleset of that name, after 14 days'
notice. Do not add a ruleset or branch protection for it, never change
FireWeave's ruleset, and never merge with `gh pr merge --admin` for the user.
`fw doctor` shows it under "Merge gate".

## `--reinit` and `--remove`

**`--reinit`** runs the Steps again with the apps the repository already records ticked in 3a, each with its recorded `surfaceId` (the setup core keeps the person's control-points file and start options; `other-languages.md` covers the rest: environments, `record-rollout-env-contract`, harness/tracker/strategy, manifest credential-env fields, API build script), **and refreshes the dev-loop artifacts for the resolved refresh set** — the entry files (`setup-post`, or `fw tool render-entries` with `{ "teamAgents": [<the set>] }` when no app is re-run) and the coding-agent hooks (`fw tool install-agent-hooks` with `{ "mode": "install", "hosts": [<every agent in the set the installer knows: claude, cursor, codex, gemini, copilot, kiro, cline>] }`; it re-creates a missing or non-executable script). **Refresh-set resolution (N1 — absent ≠ empty).** `teamAgents` and `installedInto[]` live only in the server row: run `fw sync`, then read them from `repoState` in `.fireweave/.cache/repo-state.json`; `project.json` never carries them.

1. If `teamAgents` is a **present** array (including `[]`) → use it as-is. An explicit empty array means refresh **no** agent loops (intentional post-`--remove`).
2. If `teamAgents` is **absent** (pre-teamAgents initialisation) → **never** treat that as `[]`. Derive the set from (a) agents implied by remaining `installedInto[]` paths (e.g. `.cursor/rules/fireweave-rollout-ready.mdc` / `.cursor/hooks/fireweave-rollout-*.sh` → `cursor`; `CLAUDE.md` / `.claude/hooks/rollout-build-gate-stop.sh` / `.claude/settings.json` → `claude`) and (b) disk markers that already carry FireWeave standing-loop artifacts (FireWeave's block in `AGENTS.md` or `CLAUDE.md` / the FireWeave Cursor rule / a hook entry naming `.fireweave/hooks/agent-gate.sh` — **not** bare `.cursor/` or `.claude/` alone). Write the resolved sorted set back as `teamAgents`, then refresh that set.

Reinit MUST re-render the entry files (it upgrades them in place and leaves current ones unchanged) and MUST end with `install-agent-hooks` `"mode": "check"` reporting `current`. Reinit **also declares surfaces (the server mints their IDs) and writes the canonical top-level `surfaces[]`** into `project.json` — Step 4 here, and **`--reinit` — declare surfaces + write `surfaces[]`** in `other-languages.md`. **Reinit MUST refresh the copied FireWeave skill directories** — see **Skill copies are copies (C27)** below; a repo whose data migrated while its skill copies stayed stale is the worst failure mode this skill has. Reinit **never touches change stamps or manifests**: both are server-owned, `--reinit` is a harness/loop refresh, and re-authoring a manifest it did not author would displace a contract.

**`--reinit` on a package surface** re-runs `resolve-sdk-install` (`harnessKind:
'package'`, Step 0.0's `channel`) for the 3.0.0 floor, re-checks that the start call is still first and
the only one, and re-runs `record-rollout-env-contract` in package mode. It
**never** rewrites the control-points file, the start call's options or the web
build helper's options — they are the user's. It never moves a scaffold surface onto
the start profile; that is `/fireweave:migrate-harness`.

**`--reinit` is idempotent, and there is only one path.** It used to branch on whether the pointer carried a `rolloutReady` block — writing the repo-scoped config back into the file in one case and not the other. `update-repo-state` writes **no file at all** now, in any repo, so there is nothing to discriminate: it sends the delta, fw-server merges it, and `fw sync` is how this worktree sees the result. **Never write `version: 3`** — `ProjectBindingSchema` accepts only `1 | 2`, so a `3` makes the pointer unparseable and every reader treats the repo as unbound. A second `--reinit` changes nothing but re-minted-nothing surface ids and refreshed loop artifacts.

**`--remove`** reads `installedInto[]` and reverses precisely (rule, hooks, hook scripts, agent links, harness wiring recorded in `installedInto`) in one command. **The hooks are reversed by FireWeave's installer, never by hand:** `fw tool install-agent-hooks` with `{ "mode": "remove" }` takes FireWeave's entries out of every hooks file it wired (Claude Code, Cursor, Codex, Gemini CLI, Copilot, Kiro, Cline) and leaves the team's own entries byte for byte. **The agent entry files are reversed by FireWeave's renderer, never by hand:** write `{ "remove": true }` to `.fireweave/tmp/render-entries.json` and run `fw tool render-entries --input-file .fireweave/tmp/render-entries.json`. It cuts FireWeave's blocks and the older HARD ORDER blocks out of `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, the Cursor rule, the per-app rules and the other coding agents' files (`.github/copilot-instructions.md`, `.junie/`, `AGENTS.override.md`, `GEMINI.md`), deletes `.fireweave/agents-gate.md`, an older `.fireweave/agents-core.md`, `.fireweave/instructions/contract.md` and any file left holding nothing but whitespace, keeps every byte of the team's own text, and needs no network. Tell the user each line of `result.todos`.

**C28 — `--remove` must have an OFFLINE answer.** `installedInto[]` is repo-scoped
server state now, and reversing an install is _exactly_ the moment you may be
disconnected — an unreachable server is not a reason to leave an uninstall
half-done. Resolve it in this order and **say which one answered**:

1. **fw-server** (`update-repo-state`'s read leg / `fw sync`) — authoritative. Use it.
2. **`.fireweave/.cache/` projection** — use it as a fallback, and **warn explicitly**
   that the list is a snapshot: name `_fetchedAt` and the recorded branch, and state
   that anything installed after that snapshot will be left behind. A stale list that
   removes _most_ artifacts is still far better than refusing to uninstall.
3. **Neither can answer** → refuse, and name which leg failed and why (server
   unreachable vs. no projection on disk vs. not authorised for this project). Do
   **not** guess a removal set from disk markers and delete files on that basis:
   `installedInto[]` exists precisely because "looks like ours" is not evidence, and a
   wrong guess deletes a user's own `.cursor/hooks.json` entries or `CLAUDE.md` prose.

Reverse `installedInto` and `teamAgents` server-side with `update-repo-state`'s
`resetSets` — the union merge can never reach a deliberately empty set, so a plain
write would silently re-add everything you just removed. `sourceRoots` unions too;
to narrow the scan scope after removing an app, send the remaining apps' roots with
`resetSets: ["sourceRoots"]`, which replaces the scope with the list sent. **Also prune `teamAgents`:** if `teamAgents` is **absent**, first derive the set the same way as `--reinit` rule 2 (from remaining `installedInto[]` + FW standing artifacts on disk), then prune. For each agent host whose standing-loop artifacts were removed (map paths → `cursor` / `claude` / …), drop that id from the (present or just-derived) `teamAgents` array (sorted); when the array empties write **`teamAgents: []`** (present empty — do **not** omit the key), so the next `--reinit` does not re-derive and resurrect removed loops (INIT-C4). Never leave the key absent after a remove that cleared agent loops.

Every clarification uses `ask_followup_question`.

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
ships `harness/**` (the `.tpl` files `other-languages.md` Step 4 generates
from — see **Harness templates — where they live** there), `other-languages.md`
and `templates.md`, and a copy that took only `SKILL.md` leaves the
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
   `fw tool refresh-agent-skills` with
   `{ sourceSkillsRoot: <installed bundle>/<host tree>/skills, destSkillsRoot: '.cursor/skills' }`
   (or the host's equivalent). The tool compares by CONTENT (an mtime comparison calls an identical
   tree stale on every fresh clone), replaces rather than merges so a file
   retired upstream stops instructing the agent, and takes the destination names
   **verbatim from the host's own tree** — Cursor's bundle ships `fw-`prefixed
   directories, and copying from another host's tree renames every `/fw-*`
   command the user types. Its `rows[].state` is what the reload notice reports;
   its `installedInto` feeds step 3 below.
   Copy the set, not just the skill you were thinking about: `initialise`, `adopt`,
   `add-surface`, `migrate-harness`, `cleanup`, `feedback` move together, and a half-refreshed
   set is a repo where `adopt` reads the seam and `cleanup` still deletes
   files. A copied `fw-rollout` directory is the removed `safe-rollout` skill:
   delete it.
2. Re-assert the standing surfaces in the same run (the entry files, and the agent
   gate and its hooks through `fw tool install-agent-hooks`) — they restate the same
   instruction and drift the same way.
3. Record every refreshed path in `installedInto[]`.
4. **Report the refresh in the reload notice.** A user who is told "reinit done" but
   not "your agent's copied skills changed" has no reason to reload, and the stale
   copy stays live in the current session.

`/fireweave:adopt` performs the same copy for the host it is attaching. If you are
adding an agent to a repo that migrated, `adopt` is the cheaper path — it writes
only standing instructions and hooks.

---

## Tool manifest

Every `fw tool` this skill runs; Step 0.00 checks each one is in `fw tool list --json`.

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure-auth", "via": "fw tool" },
    { "name": "agent-context", "via": "fw tool" },
    { "name": "get-setup-plan", "via": "fw tool" },
    { "name": "list-project-environments", "via": "fw tool" },
    { "name": "get-project-capabilities", "via": "fw tool" },
    { "name": "record-rollout-env-contract", "via": "fw tool" },
    { "name": "issue-browser-key", "via": "fw tool" },
    { "name": "resolve-sdk-channel", "via": "fw tool" },
    { "name": "resolve-sdk-install", "via": "fw tool" },
    { "name": "sdk-install", "via": "fw tool" },
    { "name": "refresh-agent-skills", "via": "fw tool" },
    { "name": "apply-setup-artifacts", "via": "fw tool" },
    { "name": "render-entries", "via": "fw tool" },
    { "name": "setup-analyze", "via": "fw tool" },
    { "name": "prepare-local-setup", "via": "fw tool" },
    { "name": "setup-pre", "via": "fw tool" },
    { "name": "setup-post", "via": "fw tool" },
    { "name": "install-agent-hooks", "via": "fw tool" },
    { "name": "detect-surfaces", "via": "fw tool" },
    { "name": "detect-rollout-ready", "via": "fw tool" },
    { "name": "reconcile", "via": "fw tool" },
    { "name": "verify-prod-path", "via": "fw tool" },
    { "name": "verify-rollout-config-schema", "via": "fw tool" },
    { "name": "assert-dev-checklist", "via": "fw tool" },
    { "name": "new-change-ids", "via": "fw tool" },
    { "name": "upsert-rollout-manifest", "via": "fw tool" },
    { "name": "update-repo-state", "via": "fw tool" },
    { "name": "report-harness-migration", "via": "fw tool" },
    { "name": "stop-feature-claim", "via": "fw tool" }
  ]
}
```

### Server-owned authoring (ADR-019 Phase 2)

Two write tools replace hand-poking files under `.fireweave/`:

- `fw tool update-repo-state` owns the repo-scoped config —
  `sourceRoots`, `scanExclude`, `teamAgents`, `installedInto`, `language`,
  `strategy`, `sdkDev` (and the retired `mcp.mode`, which
  this skill no longer sends). Set-valued fields UNION,
  so two concurrent `--reinit` runs cannot clobber each other, and `sourceRoots`
  unions with the row; `resetSets` is the `--remove` reversal, and
  `resetSets: ["sourceRoots"]` replaces the scan scope when an app moved. The FIRST write materialises the full derived set, not
  just the fields you name. Pointer identity stays with `fw select-project`, and
  `attestUrl` (the legacy-named fw-server base-URL field) / the credential-env
  names stay pointer-only.
- `fw tool upsert-rollout-manifest` authors a rollout-ready
  manifest to fw-server under an If-Match (`baseContentHash`, required and
  nullable), and to fw-server ALONE — it no longer writes `.fireweave/rollout-ready/<feature>.json`
  in any repo. When fw-server does not answer the
  edit is queued in the outbox (`.git/fireweave/outbox/`) and `fw sync` sends it
  with its ORIGINAL base hash — **shipping is blocked until it drains**. When the write
  cannot be addressed at all (no profile, no `projectId`, no `origin`) it is
  REFUSED, because a manifest on disk is a contract only this worktree can see.
  An absent manifest is reported as _not-authored_ / _not-fetched_ /
  _not-authorized_ / _queued_; never author a replacement to resolve one of the
  last three.
