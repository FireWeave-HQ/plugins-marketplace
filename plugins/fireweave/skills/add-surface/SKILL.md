---
name: add-surface
description: Add one app (a surface) to a repository FireWeave already set up, with the same setup core as initialise. Picks the app (detected and not yet declared, or a path the person names), plans that one app with every recorded surface carried as it is, runs setup pre, the per-app steps and setup post for it, and records it (the surface appended, the scan scope unioned, the agent entry files re-rendered). Never touches the apps already set up. Use when the user asks to "add a surface", "set up another app", "add the web app to FireWeave", or invokes `/fireweave:add-surface`.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-add-surface
  cline: fw-add-surface
  codex: fw_add_surface
---

# Add a surface (one more app in a set-up repository)

Run in a repository FireWeave **already set up**, to set up **one more app**:
a new web app, a second server. It is `/fireweave:initialise`'s setup core for
that one app: the same plan file, `setup-pre`, per-app steps and `setup-post`,
run in this checkout. The apps already set up are carried as they are: their
surface ids, files and entries stay, and setup never re-runs on them.
**Nothing is committed or pushed:** the person reviews the working tree and
commits.

A repository with no surface set up yet → `/fireweave:initialise`, not this
skill.

## Running FireWeave's tools (`fw tool`)

This skill runs FireWeave's tools through the `fw` CLI in your shell, as `fw tool <name>`. There is no FireWeave MCP server.

- **Which `fw`.** Run `command -v fw`; when it prints nothing, use `~/.fireweave/bin/fw` (`fw.exe` on Windows) if that file exists. Then run `fw tool list --json`: its `binary.realpath` is the `fw` that answered. When that is not the installed FireWeave binary (`~/.fireweave/bin/fw`, or wherever the user installed it), stop and say which `fw` is first on `PATH`.
- **Input.** Write the tool's input as one JSON object to `.fireweave/tmp/<name>.json` with your file-editing tool, then run `fw tool <name> --input-file .fireweave/tmp/<name>.json` from the repository root. A tool that needs no input runs as `fw tool <name>`. Leave `cwd` out: `fw tool` takes it from the shell's directory, clamped to the repository. `.fireweave/.gitignore` ignores `tmp/`; add that line when it is missing.
- **Output.** One JSON envelope, `{ "status", "exitCode", "reason"?, "result"? }`; `result` is the tool's own answer. Exit `0` ok · `1` refused · `2` bad input · `3` auth (`fw login`) · `4` upgrade (`fw self-update`) · `5` unavailable (retry later). A refusal never exits 0.
- **Plain commands.** One `fw …` command per shell call, and each `fw tool` command on its own (FireWeave's hook refuses one joined to anything else); other commands may form a plain `&&` chain: no redirection, no heredocs, no `$(…)`, no `VAR=` prefixes, no globs, and never `fw api`. Hosts pre-approve plain `fw tool`, `fw status` and `fw sync` commands; `fw manifest …`, `fw login` and `fw select-project` ask the user first.

## Step 0 — `fw`, sign-in, the agent switch and the binding (fail closed)

**PARK writes nothing.** Do not create or modify any FireWeave path until every
gate below passes.

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

**0.1 — SDK channel.** Run `fw tool resolve-sdk-channel`. `ok: true` → hold
`channel` for the run; never ask for one or default one. `ok: false` → PARK and
show `detail` (initialise's Step 0.0 table names each `reason`'s remedy).

**0.2 — Set up already.** Read `.fireweave/project.json`. Its `surfaces[]` must
hold at least one entry with a `surfaceId`; otherwise this repository is not set
up yet: run `/fireweave:initialise` instead, and write nothing. Run `fw sync`,
then read `teamAgents` from `repoState` in `.fireweave/.cache/repo-state.json`
(the server row; `project.json` never carries it).

## Initialise's core

Steps 3 to 7 below run initialise's own steps for one app. Read them from
initialise's `SKILL.md` in the installed plugin bundle, beside this skill:
`<dir of this SKILL.md>/../<initialise>/SKILL.md`, with `<initialise>` named as
this host names it (`initialise`, `fw-initialise` on Cursor and Cline,
`fw_initialise` on Codex). Never read the platform source.

## Steps

Every clarification uses `AskUserQuestion`.

### 1 — Pick the app

- **The person named a path.** Use it as the app root (repo-relative, `.` for
  the root).
- **Otherwise** write `{ "declared": [<each surfaces[] entry as { "surface", "path", "surfaceId" }>] }`
  to `.fireweave/tmp/detect-surfaces.json` and run
  `fw tool detect-surfaces --input-file .fireweave/tmp/detect-surfaces.json`.
  Offer the `drift.added` rows, each with its `surface`, `verdict` and
  evidence, in one single-select; pre-tick a row only when it has
  `preselect: true`. Show `unreadable` when it is not empty: an unreadable zone
  looks like an empty one. `drift.vanished` lists recorded apps detection no
  longer finds: tell the person, and never retire or drop one (that is their
  decision, outside this skill).

An app root `surfaces[]` already records is set up: stop and say so
(`/fireweave:initialise --reinit` refreshes it). One app per run.

### 2 — Which path

The app's kind is the picked row's `surface`; for a named path, the
`fw tool setup-analyze` row at that root, or ask.

| Kind                                  | Path                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ts-server` or `web`                  | Steps 3–7 here                                                                                                                                   |
| Python, Go, Java, Rust, Dart or Swift | stop here and run `/fireweave:initialise`, ticking only this app in its Step 3a: initialise leaves the apps already set up out unless `--reinit` |

### 3 — Plan, one app

Run `fw tool setup-analyze` and take this app's row and its root's
`signInCode`, `observability` and `packageManagers`. Ask initialise's Step 3
questions for this app only: **c** (environments), **d** (metrics; hold
`perEnvironmentRegistration` and `automation.autoRampEnabled`), **e** (sign-in
code) and **f** (package manager). Do not ask **a** (Step 1 picked the app) or
**b**: `teamAgents` is Step 0.2's; ask **b** only when it is absent.

Then initialise's Step 4 with **one** entry in `surfaces`: this app, with
`"surfaceId": null`. Never list the apps already set up:
`prepare-local-setup` carries every surface `project.json` records, unchanged
and unselected. Declare this app as Step 4 says (one
`fw repo declare-surfaces` call; the server mints its id), then run
`prepare-local-setup` again with that id.

### 4 — Setup pre

Initialise's Step 5. Its report lists this app only.

### 5 — Per app

Initialise's Step 6, for this app. Edit nothing under the apps already set up.

### 6 — Setup post

Initialise's Step 7. It checks this app, appends it to `surfaces[]` (every
other entry stays, in place) and re-renders the agent entry files over every
surface.

### 7 — Record and report

1. **Repo state.** Write `{ "fields": <result.repoState> }` to
   `.fireweave/tmp/update-repo-state.json` and run
   `fw tool update-repo-state --input-file .fireweave/tmp/update-repo-state.json`.
   Its `sourceRoots` holds this app only: `update-repo-state` unions it with
   the recorded scan scope (an empty scope is the whole repository and stays
   so). `outcome: 'refused'` → PARK.
2. **Hooks are current:** initialise's Step 9.3 (`fw tool install-agent-hooks`
   in check mode).
3. **Browser keys**, when the app is `web`: initialise's Step 9.4
   (`fw tool issue-browser-key`), for this app's `surfaceId`.
4. **Tell the person**: the app's outcome, every to-do, the files changed
   (`filesChanged`), that the apps already set up were left as they were, and
   that nothing is committed: review the working tree and commit it.

## Do not

- Re-run setup on, re-declare, move or drop an app already set up.
- Mint a surface id, or write `.fireweave/project.json`, the agent entry files
  or any hooks file by hand: `setup-post` writes them.
- Send `surfaces` to `update-repo-state`: it owns only its repo-scoped fields.
- Commit, push or open a pull request.

## Tool manifest

Every `fw tool` this skill runs; Step 0 checks each one is in `fw tool list --json`.

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure-auth", "via": "fw tool" },
    { "name": "agent-context", "via": "fw tool" },
    { "name": "resolve-sdk-channel", "via": "fw tool" },
    { "name": "detect-surfaces", "via": "fw tool" },
    { "name": "setup-analyze", "via": "fw tool" },
    { "name": "list-project-environments", "via": "fw tool" },
    { "name": "get-project-capabilities", "via": "fw tool" },
    { "name": "prepare-local-setup", "via": "fw tool" },
    { "name": "setup-pre", "via": "fw tool" },
    { "name": "setup-post", "via": "fw tool" },
    { "name": "update-repo-state", "via": "fw tool" },
    { "name": "install-agent-hooks", "via": "fw tool" },
    { "name": "issue-browser-key", "via": "fw tool" }
  ]
}
```
