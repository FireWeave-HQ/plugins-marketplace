---
name: "ci-initialise"
description: "Cloud variant of initialise for FireWeave's cloud setup. Runs inside a FireWeave sandbox after FireWeave has already bound the repository, installed the SDK and written the fixed files; does only the per-app code edits that need judgment and writes its notes. Never asks the user anything, never commits or pushes, never issues keys, never writes .env files. Use only when FireWeave's cloud setup runs `/fireweave:ci-initialise`."
compatibility: "opencode"
metadata:
  opencode/autoinvoke: "false"
---
> Interaction: gate each decision with the native `question` tool (multi-option; supports multi-select + custom free-text).

# ci-initialise

You finish FireWeave's setup of ONE repository, inside FireWeave's cloud
sandbox. Nobody is watching and there is no one to ask. Most of the work is
already done: before you start, FireWeave bound the repository to its project,
recorded the env contract, installed the FireWeave SDK in every app it could,
and wrote each app's control-points and start files. After you finish,
FireWeave checks every app, writes `.fireweave/agent-instructions.md`, the
agent entry files (`AGENTS.md`, a `CLAUDE.md` block, a Cursor rule) and
`/work/.fw/setup/result.json`, commits to `fireweave/setup` and opens the PR.

Your job is the part that needs judgment, per app: wire the start module into
the app, and (for a web app) its build config and first render. Then write
your notes. Be quick: you are not re-checking the plan, you are applying it.

## Inputs

- `/work/.fw/setup/pre.json` — what FireWeave already did, per app
  (`surfaces[]`): `outcome` (`ready` = yours to finish, `agent` = install the
  SDK first, then finish it (below), `blocked` = leave it alone), `kind`
  (`ts-server`, `web`, `python`, `rust`, `swift`, `go`, `java`, `dart`), `entrypoint` (null when
  FireWeave could not find it), `startPath` (null: the start call goes in the
  entrypoint), `startImport` (the start module as `entrypoint` imports it),
  `controlPointsPath`, `buildConfig`, `identitySeam`, `metrics`, `baseline`
  (the errors the app had before you), and the owner's `guidance` (below).
- `/work/.fw/setup/plan.json` — the setup plan the user confirmed. You rarely
  need it; `pre.json` already carries what each app needs.
- `/work/.fw/setup/notes.json` — your output, and your checkpoint: if it
  already lists an app (a retry), that app is done; skip it.
- The working directory is the repository. NEVER write outside it, except
  `/work/.fw/setup/notes.json`.

## Every initialise question is already answered

You never ask. Each gate the interactive initialise would raise is answered by
the plan, by FireWeave's script before you (pre), or after you (post):

| initialise ask                          | Answered by                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Step 1 "Let FireWeave manage rollouts?" | the plan: the repository is Managed and ticked                                             |
| Step 2 teamAgents                       | the plan; post writes the agent entry files, and adds a `/fireweave:adopt` to-do for hooks |
| 3a envs carrying real traffic           | the plan's environments                                                                    |
| 3b INIT-B11 Metrics unbound             | the plan; post adds the manual-ramp to-do                                                  |
| 3c where each prod-tier env runs        | post: a `deploy-secret` to-do per production environment                                   |
| 3d env-source confirm                   | not asked: the start profile reads `FIREWEAVE_ENV` itself                                  |
| FW_ENV_ALIASES confirm                  | not asked: no aliases on a start-profile app                                               |
| GATE-3F-SURFACE-SELECTION               | the plan's selected apps; pre marks the rest `blocked`                                     |
| GATE-3F-VANISHED-SURFACES               | never retired in cloud                                                                     |
| 6b identity seam                        | `identitySeam` in pre.json (below)                                                         |
| package-manager ambiguity               | pre: an app with none is `blocked` with a to-do                                            |
| channel                                 | `plan.channel` (fw-server's environment); pre installed that line                          |
| Step 0c `orgMatch:false`                | pre: the job's organisation; a mismatch parks before you run                               |
| 3e "secrets set?" wait                  | never waits: post adds `deploy-secret` to-dos                                              |
| browser key destination                 | never issued in cloud: post adds a `browser-key` to-do                                     |
| hard PARK (SCN-16)                      | per app: mark that app `not-set-up` and continue with the next                             |

## The owner's guidance

An earlier setup run stopped, and the repository's owner told FireWeave how to
handle it. `guidance` in pre.json is that answer, in their words: at the top
level for the whole run, and on an app (`surfaces[].guidance`) for that app.
Follow it for the app it names, ahead of this skill's defaults. It never
overrides the Forbidden list below, except for the one install an `agent` app
hands you.

**An `agent` app** has `handOver: { step: "install", code, command, guidance,
sdk }`: FireWeave's own SDK install failed again (`code`, e.g.
`sdk-install-failed`, `registry-not-allowed`, `package-manager-ambiguous`), and
the owner's `guidance` says how to do it. Install `sdk.name` in that app's
directory yourself, following the guidance, on the line `sdk.channel` names.
Never a bare or untagged install: it takes the production line, which calls
production.

- `production`: `<sdk.name>@latest`.
- `staging`: `'<sdk.name>@>=X.Y.Z-rc.1 <X.Y.Z-rd'`, quoted, where `X.Y.Z` is
  `sdk.version` without its `-rc.N` (null: read it, as part of this install,
  with `npm view <sdk.name>@next version`). It admits every rc of X.Y.Z and
  never X.Y.Z itself. With pnpm, write the range into the app's
  `package.json` `dependencies`, then `pnpm install` (`pnpm add` rewrites a
  range to exact).
- `dev`: `'<sdk.name>@^<sdk.version>'`, quoted. `sdk.version` is the dev
  store's real build: the one its `dev` tag names, or its `latest` when it has
  no `dev` tag, so never assume a `dev` tag (null: read the tags, as part of
  this install, with `npm view <sdk.name> dist-tags --json`). The caret is
  what FireWeave's own dev install records; a bare version is an exact pin in
  bun. With pnpm, write it into `dependencies` as on staging. FireWeave
  already pointed the `@fireweaveai` scope at the store in `~/.npmrc`: add no
  registry setting anywhere.

`command` is what FireWeave ran (null when it could not tell the package
manager). Only package-manager install commands (`npm`, `pnpm`, `yarn`, `bun`),
and only inside that app, run as one plain command that names the app's absolute
directory: `cd <repository>/<app path> && <install>` (`pwd` is the
repository). The sandbox refuses any other install, and any install behind a
wrapper (`npx`, `bunx`, `sh -c`), a variable, or a global, workspace or
`--prefix` flag pointing elsewhere. Then finish the app as
a `ready` one. If the install still fails, undo your edits to that app and
mark it `not-set-up` with `reason` = `handOver.code`, `error` = the last lines
of the failing output, and a `todo` a person can act on.

## Per app (every `ready` or `agent` entry in pre.json)

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

## Output contract

`/work/.fw/setup/notes.json` is your whole answer (FireWeave builds
`result.json` from it). One entry per `ready` or `agent` app (a `not-set-up`
one may add `error`: the last lines of the output that stopped it; any may add
`validation`, the last `fw setup validate` verdict); `todos`
for anything else a person must do (kinds: `env-var`, `deploy-secret`,
`required-check`, `browser-key`, `merge-onward`, `other`; FireWeave adds the
standard ones):

```json
{
  "schemaVersion": 1,
  "surfaces": [
    {
      "path": "apps/api",
      "outcome": "set-up",
      "reason": null,
      "todo": null,
      "entrypoint": "apps/api/src/index.ts",
      "filesEdited": ["apps/api/src/index.ts", "apps/api/src/auth/session.ts"],
      "identity": {
        "file": "apps/api/src/auth/session.ts",
        "calls": ["await fw.identify(user.id, { plan: user.plan })"]
      },
      "metrics": {
        "client": "prometheus-client",
        "importLine": "import { Counter } from 'prom-client';",
        "counter": "ordersPlaced.inc({ plan })",
        "histogram": "checkoutLatency.observe(ms)",
        "instrumentSource": "module singletons in apps/api/src/metrics.ts",
        "examples": [
          {
            "file": "apps/api/src/metrics.ts",
            "line": 12,
            "snippet": "export const ordersPlaced = new Counter({ name: 'orders_placed_total', help: 'Orders', labelNames: ['plan'] });"
          }
        ],
        "wrapper": null,
        "tags": "labels: plan, region"
      }
    },
    {
      "path": "apps/web",
      "outcome": "not-set-up",
      "reason": "render-not-found",
      "todo": "Import ./fireweave/start first in apps/web's entry module and wait for ready before the first render.",
      "entrypoint": null,
      "filesEdited": [],
      "identity": null,
      "metrics": null
    }
  ],
  "todos": [
    {
      "kind": "other",
      "text": "apps/web sets a Content-Security-Policy in the CDN config: allow FireWeave's origin there.",
      "environment": null
    }
  ]
}
```

## Forbidden in this skill

- `the `question` tool`, or any other way of waiting for a person.
- `git commit`, `git push`, `git config`, or any change to git history:
  FireWeave commits and pushes.
- Installing or removing packages: FireWeave installed the SDK. The one
  exception is the install an `agent` app hands you, inside that app.
- Any `fw tool` run — `fw tool issue-browser-key`, `fw tool update-repo-state`
  and `fw tool upsert-rollout-manifest` among them — and any
  `/harness-migration` call.
- Writing `.fireweave/agent-instructions.md`, `.fireweave/instructions/`,
  `.fireweave/project.json`, or `/work/.fw/setup/result.json`: FireWeave
  writes them after you.
- Coding-agent wiring (`.claude/`, `.cursor/`, `CLAUDE.md`, `AGENTS.md`, build
  gate hooks): FireWeave writes the entry files after you, `/fireweave:adopt`
  adds the hooks after the merge, and FireWeave reverts any edit you make there.
- Writing `.env` or `.env.*` files other than `.env.example`, or any key value.
- Network other than reading this repository's files and the install an
  `agent` app hands you.
