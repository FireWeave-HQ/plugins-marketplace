# ci-initialise

> Cloud variant of initialise for FireWeave's cloud setup. Runs inside a FireWeave sandbox after FireWeave has already bound the repository, installed the SDK and written the fixed files; does only the per-app code edits that need judgment and writes its notes. Never asks the user anything, never commits or pushes, never issues keys, never writes .env files. Use only when FireWeave's cloud setup runs `/fireweave:ci-initialise`.
>
> _User-triggered (Cline does not auto-activate workflows). Run with `/fw-ci-initialise.md`._

> Interaction: gate each decision with `ask_followup_question` (one question per call; supply an `<options>` array). For multi-question groups, ask sequentially.

# ci-initialise

You finish FireWeave's setup of ONE repository, inside FireWeave's cloud
sandbox. Nobody is watching and there is no one to ask. Most of the work is
already done: before you start, FireWeave bound the repository to its project,
recorded the env contract, installed the FireWeave SDK in every app it could,
and wrote each app's control-points and start files. After you finish,
FireWeave checks every app, writes `.fireweave/agent-instructions.md` and
`/work/.fw/setup/result.json`, commits to `fireweave/setup` and opens the PR.

Your job is the part that needs judgment, per app: wire the start module into
the app, and (for a web app) its build config and first render. Then write
your notes. Be quick: you are not re-checking the plan, you are applying it.

## Inputs

- `/work/.fw/setup/pre.json` — what FireWeave already did, per app
  (`surfaces[]`): `outcome` (`ready` = yours to finish, `agent` = install the
  SDK first, then finish it (below), `blocked` = leave it alone), `kind`
  (`ts-server` | `web`), `entrypoint` (null when FireWeave could not find it),
  `startPath`, `startImport` (the start module as `entrypoint` imports it),
  `controlPointsPath`, `buildConfig`, `identitySeam`, `metrics`, and the
  owner's `guidance` (below).
- `/work/.fw/setup/plan.json` — the setup plan the user confirmed. You rarely
  need it; `pre.json` already carries what each app needs.
- `/work/.fw/setup/notes.json` — your output, and your checkpoint: if it
  already lists an app (a retry), that app is done; skip it.
- The working directory is the repository. NEVER write outside it, except
  `/work/.fw/setup/notes.json`.

## Every initialise question is already answered

You never ask. Each gate the interactive initialise would raise is answered by
the plan, by FireWeave's script before you (pre), or after you (post):

| initialise ask                          | Answered by                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Step 1 "Let FireWeave manage rollouts?" | the plan: the repository is Managed and ticked                                  |
| Step 2 teamAgents                       | the plan; post adds a `/fireweave:adopt` to-do (agent wiring is not in this PR) |
| 3a envs carrying real traffic           | the plan's environments                                                         |
| 3b INIT-B11 Metrics unbound             | the plan; post adds the manual-ramp to-do                                       |
| 3c where each prod-tier env runs        | post: a `deploy-secret` to-do per production environment                        |
| 3d env-source confirm                   | not asked: the start profile reads `FIREWEAVE_ENV` itself                       |
| FW_ENV_ALIASES confirm                  | not asked: no aliases on a start-profile app                                    |
| GATE-3F-SURFACE-SELECTION               | the plan's selected apps; pre marks the rest `blocked`                          |
| GATE-3F-VANISHED-SURFACES               | never retired in cloud                                                          |
| 6b identity seam                        | `identitySeam` in pre.json (below)                                              |
| package-manager ambiguity               | pre: an app with none is `blocked` with a to-do                                 |
| channel                                 | pre: the plan's channel, or the dev artifact store in FireWeave's dev stack     |
| Step 0c `orgMatch:false`                | pre: the job's organisation; a mismatch parks before you run                    |
| 3e "secrets set?" wait                  | never waits: post adds `deploy-secret` to-dos                                   |
| browser key destination                 | never issued in cloud: post adds a `browser-key` to-do                          |
| hard PARK (SCN-16)                      | per app: mark that app `not-set-up` and continue with the next                  |

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
the owner's `guidance` says how to do it. Install `sdk.name` (at `sdk.version`
when set) in that app's directory yourself, following the guidance. `command`
is what FireWeave ran (null when it could not tell the package manager). Only
package-manager install commands (`npm`, `pnpm`, `yarn`, `bun`), and only
inside that app, run as one plain command that names the app's absolute
directory: `cd <repository>/<app path> && <install>` (`pwd` is the
repository). The sandbox refuses any other install, and any install behind a
wrapper (`npx`, `bunx`, `sh -c`), a variable, or a global, workspace or
`--prefix` flag pointing elsewhere. Then finish the app as
a `ready` one. If the install still fails, undo your edits to that app and
mark it `not-set-up` with `reason` = `handOver.code`, `error` = the last lines
of the failing output, and a `todo` a person can act on.

## Per app (every `ready` or `agent` entry in pre.json)

**1. Find the entrypoint** when `entrypoint` is null: the module the app's
process (server) or page (web) loads first. Read its `package.json` scripts and
`index.html`; do not explore further than that. Record it in your notes.

**2. `ts-server`.** The entrypoint's FIRST import is the start module:

```ts
import '<startImport>'; // FireWeave: must stay the first import
```

Nothing else changes. Do not edit `<startPath>` or `<controlPointsPath>`.

**3. `web`.** The entry module's FIRST import is the start module, and the
first render waits for it:

```ts
import { ready } from '<startImport>';
// …existing imports…
await ready; // or: ready.then(() => createRoot(el).render(<App />));
```

- Vite, SvelteKit, React Router 7, Nuxt, Astro: add `fireweave()` from
  `@fireweaveai/web-sdk/vite` to `buildConfig`'s plugins (Nuxt and Astro under
  `vite: { plugins: [...] }`).
- Next.js, webpack, esbuild, Rollup, Angular: `fireweaveDefine()` from
  `@fireweaveai/web-sdk/define` through the bundler's define plugin.
- SvelteKit: the start import goes in `src/hooks.client.ts`. Next.js:
  `instrumentation-client.ts` (Next ≥ 15.3) or a `'use client'` provider in the
  fireweave directory, wrapping `{children}` in `app/layout.tsx`. Angular:
  `start(...).then(() => bootstrapApplication(...))`.
- A Content-Security-Policy that would block the SDK's request: add the
  FireWeave origin if the policy is in this repository, otherwise a to-do.

**4. Identity.** When `identitySeam.kind` is `path`, open that file and bind
identity where the user is known, unconditionally — never inside a
control-point branch (INIT-S8):

- `ts-server`: `await fw.identify(user.id, { ...durable properties })` at
  sign-in (`import { fw } from '@fireweaveai/server-sdk/start'`).
- `web`: `await fw.identify(user.id, props)` at sign-in AND session restore,
  `await fw.reset()` at sign-out (`@fireweaveai/web-sdk/start`).

Otherwise leave identity alone: post adds the to-do. Record what you bound.

**5. Metrics.** `metrics` in pre.json is what the analysis found and checked:
`plan.surfaces[].metricsClient` and the real calls from
`plan.surfaces[].metricsExamples`. Confirm each cited line still says what it
quotes; drop one that does not. Add what a feature agent will need and the
analysis did not record, all from code you can cite: the import line as it
appears, the counter and histogram call shapes, where the instrument comes from,
a wrapper the repo prefers, the tag convention. Never invent a convention: when
the app emits no metrics, keep `client: "none"`. Post writes all of it into
`.fireweave/agent-instructions.md`, next to the per-change metrics check:
**Before you add a metric.** Write that section whatever the plan's
observability says about Metrics (`bindings.observability.state` is the Metrics
unit; Logs and Traces are bound separately), because metrics can be connected
after this PR merges; post
does, for every app, so you never need to.

**6. Optional overrides.** Add `environment:` to the start call only when the
app demonstrably names its environment in another variable. Otherwise leave the
start file as FireWeave wrote it.

**If an app cannot be finished** (no entrypoint you can identify, a framework
you cannot wire safely), undo YOUR edits to that app and mark it `not-set-up`
with a one-line `reason` and a `todo` a person can act on. Then continue.

**After each app**, rewrite `/work/.fw/setup/notes.json` with every app done so
far, so a retry resumes after it.

## Output contract

`/work/.fw/setup/notes.json` is your whole answer (FireWeave builds
`result.json` from it). One entry per `ready` or `agent` app (a `not-set-up`
one may add `error`: the last lines of the output that stopped it); `todos`
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

- `ask_followup_question`, or any other way of waiting for a person.
- `git commit`, `git push`, `git config`, or any change to git history:
  FireWeave commits and pushes.
- Installing or removing packages: FireWeave installed the SDK. The one
  exception is the install an `agent` app hands you, inside that app.
- `issue_browser_key`, `update_repo_state`, `upsert_rollout_manifest`, and any
  `/harness-migration` call.
- Writing `.fireweave/agent-instructions.md`, `.fireweave/project.json`, or
  `/work/.fw/setup/result.json`: FireWeave writes them after you.
- Coding-agent wiring (`.claude/`, `.cursor/`, `CLAUDE.md`, `AGENTS.md`, build
  gate hooks): `/fireweave:adopt` adds it after the merge, and FireWeave removes
  it from this PR.
- Writing `.env` or `.env.*` files other than `.env.example`, or any key value.
- Network other than reading this repository's files and the install an
  `agent` app hands you.
