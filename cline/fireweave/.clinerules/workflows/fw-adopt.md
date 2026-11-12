# adopt

> Attach the current coding agent's FireWeave standing loop to a repo that is already initialised (harness, credentials, agent-instructions present). Writes only agent standing instructions, hooks and the Cursor skill copies — never re-scaffolds the harness, never rotates the project API key. Use when a teammate clones an initialised repo and opens Claude Code / Cursor / another agent that was not present at initialise time, or when the user asks to "adopt this repo", "install FireWeave for my agent", or invokes `/fireweave:adopt`. `--check` reports the wanted-vs-present diff without writing.
>
> _User-triggered (Cline does not auto-activate workflows). Run with `/fw-adopt.md`._

> Interaction: gate each decision with `ask_followup_question` (one question per call; supply an `<options>` array). For multi-question groups, ask sequentially.

# Adopt (attach my agent to an already-initialised repo)

Run when the **repo is already FireWeave-initialised** and this machine's coding agent is
missing the standing loop (the agent entry files, hooks and skills). Each comes from one of FireWeave's tools (`render-entries`, `install-agent-hooks`, `refresh-agent-skills`); `adopt` writes none of them by hand. Typical cases:

1. Repo was initialised before team-agent selection existed (Cursor-only disk detect) — teammate opens Claude.
2. First init selected `teamAgents` but a new agent joins later that was not in the set.
3. Second machine / fresh clone lost executable bits or local-only drift (rare).

Greenfield `/fireweave:initialise` now asks which agents the **team** uses and writes those standing
loops up front — prefer that path for new repos. Use `adopt` when the harness is already in place
and only this agent's loop is missing.

`/fireweave:initialise --reinit` still re-scaffolds the harness and the env contract files (it mints no key) — do **not** use it just to add
an agent loop.

**Harness-skipping by design.** `adopt` does **not** scaffold `fw-harness`, does **not**
run the `record-rollout-env-contract` tool, does **not** re-enumerate environments, and does **not**
author, retire, or otherwise touch rollout-ready manifests or change stamps — those are
server-owned and belong to the feature loop, not to attaching an agent. If the repo is not
initialised → PARK and send the user to `/fireweave:initialise`.

`--check` runs Steps 0–3 and reports the wanted-vs-present diff; writes nothing.

## Running FireWeave's tools (`fw tool`)

This skill runs FireWeave's tools through the `fw` CLI in your shell, as `fw tool <name>`. There is no FireWeave MCP server.

- **Which `fw`.** Run `command -v fw`; when it prints nothing, use `~/.fireweave/bin/fw` (`fw.exe` on Windows) if that file exists. Then run `fw tool list --json`: its `binary.realpath` is the `fw` that answered. When that is not the installed FireWeave binary (`~/.fireweave/bin/fw`, or wherever the user installed it), stop and say which `fw` is first on `PATH`.
- **Input.** Write the tool's input as one JSON object to `.fireweave/tmp/<name>.json` with your file-editing tool, then run `fw tool <name> --input-file .fireweave/tmp/<name>.json` from the repository root. A tool that needs no input runs as `fw tool <name>`. Leave `cwd` out: `fw tool` takes it from the shell's directory, clamped to the repository. `.fireweave/.gitignore` ignores `tmp/`; add that line when it is missing.
- **Output.** One JSON envelope, `{ "status", "exitCode", "reason"?, "result"? }`; `result` is the tool's own answer. Exit `0` ok · `1` refused · `2` bad input · `3` auth (`fw login`) · `4` upgrade (`fw self-update`) · `5` unavailable (retry later). A refusal never exits 0.
- **Plain commands.** One `fw …` command per shell call, and each `fw tool` command on its own (FireWeave's hook refuses one joined to anything else); other commands may form a plain `&&` chain: no redirection, no heredocs, no `$(…)`, no `VAR=` prefixes, no globs, and never `fw api`. Hosts pre-approve plain `fw tool`, `fw status` and `fw sync` commands; `fw manifest …`, `fw login` and `fw select-project` ask the user first.

## Step 0 — `fw`, auth and the repo binding (fail closed, allowlist)

**SCN-16 — PARK writes nothing.** Do not create or modify any FireWeave path until every gate below passes. On any PARK, leave the working tree unchanged for this run.

### Step 0.0 — `fw` reaches FireWeave from this shell (fail closed)

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

### Step 0.1 — the repo binding

Read `result.repo_binding` from the same `fw tool ensure-auth` envelope.
Continue **ONLY** when `repo_binding.bound === true` **and**
`repo_binding.orgMatch !== false`. Missing / undefined `repo_binding` → PARK
as unbound. On `orgMatch: false`: switch profile (`fw profile use`) or, when
the bind is stale, `fw select-project` (it asks first) — do not blindly rebind.
**Do not write FireWeave files while unbound.** A profile alone does NOT mean
this repo is bound to a project.

## Steps

<!-- prettier-ignore -->
| Step | Action |
| --- | --- |
| **1 — Bound gate** | Read `.fireweave/project.json`. **The repo is initialised iff the pointer carries identity — `projectId` (or `projects{}`).** Do not read `rolloutReady` and do not branch on `version`: the block is a shape fact, not an initialisation fact, and `rolloutReady.initialized` no longer exists. (It used to gate this step; a block that never wrote the key was indistinguishable from `initialized: false`, so `adopt` PARKed on healthy repos and the standing-loop hooks no-opped on them — same defect, three doors.) Else PARK: _"this repo is not initialised — run `/fireweave:initialise` first"_ — **write nothing.** **`adopt` never initialises.** Confirm `.fireweave/agent-instructions.md` exists; if missing on an initialised repo → PARK toward `/fireweave:initialise --reinit` (genuine drift, not an adopt case) — **write nothing.** **Why PARK here but WARN for a missing build-gate (N4):** every standing loop points at `agent-instructions.md`, so attaching hooks that link a missing SoT is not useful; the build gate is orthogonal to standing instructions and does not justify a `--reinit` (which mints no key): Step 5's installer writes it. Run `fw sync`, then read `mcp.mode`, `installedInto[]` and `teamAgents` from `repoState` in `.fireweave/.cache/repo-state.json` (the server row; `project.json` never carries them), and note whether `teamAgents` is **absent** (pre-teamAgents initialisation — Step 7 will seed) or **present**. |
| **2 — Choose agents** | Detect coding-agent markers (`.claude/`, `.cursor/`, …). Then one `ask_followup_question` (multi-select) for **this** machine. **Hooks:** `claude`, `cursor`, `codex`, `gemini`, `copilot`, `kiro` and `cline` (the hosts `fw tool install-agent-hooks` wires). `opencode` and `windsurf` are link-only experimental (optional second ask). Host detection alone is unreliable. Empty selection → re-ask once; if still empty → PARK (write nothing). |
| **3 — Diff** | For the selected agents the installer wires (Step 2), write `{ "mode": "check", "hosts": [<them>] }` to `.fireweave/tmp/install-agent-hooks.json` and run `fw tool install-agent-hooks --input-file .fireweave/tmp/install-agent-hooks.json`. It writes nothing and reports each hooks file (`absent`, `current`, `partial`, `outdated`, `modified` or `refused`), each script it owns (the agent gate `.fireweave/hooks/agent-gate.sh`, the build gate `.fireweave/hooks/rollout-build-gate.{mjs,sh}` and each host's stop hook: `absent`, `current`, `outdated`, `not-executable` or `refused`) and the cross-checks (`unwired`, `orphaned`, `not-executable`, `ignored`, `disabled-in-repo`). A repository set up by FireWeave's cloud setup has no hooks and no build gate: that is what `adopt` adds, so a missing build gate is not a PARK (do **not** PARK, do **not** force `--reinit`). For `cursor`, also run `fw tool refresh-agent-skills` with `"dryRun": true` added to Step 6's input to see which skill copies are stale. Report what is missing or stale before writing. On `--check` → stop here (write nothing). |
| **4 — Instructions** | **First write step.** **The agent entry files come from FireWeave's renderer, never by hand:** write `{ "teamAgents": [<the repo's teamAgents, plus the agents selected in Step 2>] }` to `.fireweave/tmp/render-entries.json` and run `fw tool render-entries --input-file .fireweave/tmp/render-entries.json`. It writes the repository-root `AGENTS.md` (FireWeave's gate: when its instructions apply), `.fireweave/instructions/contract.md` (the rollout contract the gate points at), the `CLAUDE.md` block, the Cursor rule `.cursor/rules/fireweave-rollout-ready.mdc` and the per-app rules exactly as FireWeave's cloud setup does, upgrades an older FireWeave block in place (every always-loaded block becomes the `format=3` gate; the contract is `format=2` once the project's capabilities allow it, else `format=1`), moves the gate's Claude copy from the older `.fireweave/agents-core.md` to `.fireweave/agents-gate.md`, leaves a current one unchanged, and removes the HARD ORDER blocks an older adopt appended. **Never write or edit `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.fireweave/agents-gate.md`, `.fireweave/instructions/contract.md` or the Cursor rule yourself.** Its `result.rendered` paths go into `installedInto[]` (Step 7); tell the user each line of `result.todos`; when the project's sync mode is outbox the same call installs the git pre-push hook that runs `fw sync` for the pushed branches (`result.prePushHook`, added to an existing hook, never replacing it): tell the user what it says; for an entry `skipped` because someone edited FireWeave's block, ask the user, and on yes run it again with `"editedBlock": "replace"` added to the input. A non-zero exit writes nothing: report its `reason` and clear the cause (`fw login` for exit `3`, retry for `5`) before going on. Do **not** change `mcp.mode`. |
| **5 — Hooks** | Run `fw tool install-agent-hooks` again with `"mode": "install"` and the same `hosts`. **The hooks come from FireWeave's installer, never by hand:** it merges FireWeave's entries into `.claude/settings.json`, `.cursor/hooks.json`, `.codex/hooks.json` and `.gemini/settings.json` (team entries never move or change; an outdated FireWeave entry is replaced in place), writes its own `.github/hooks/fireweave.json` (Copilot) and `.kiro/hooks/fireweave.json` (Kiro) whole and one script per event under `.clinerules/hooks/` (Cline, never over a script of the team's), writes the agent gate, the build gate and each host's stop hook from the copies in this `fw` and makes them executable, and retires the old intent and session hooks with their entries. **Never write or edit `.claude/settings.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.gemini/settings.json`, `.github/hooks/fireweave.json`, `.kiro/hooks/fireweave.json` or any script under `.fireweave/hooks/`, `.claude/hooks/`, `.cursor/hooks/` or `.clinerules/hooks/` yourself.** A file reported `modified` (someone edited FireWeave's entry) is kept: ask the user, and on yes run it again with `"editedHooks": "replace"` added. A `refused` file (not JSON, a link out of the repository, ignored by git, holding a key, Codex hooks kept in `.codex/config.toml`, no `.gemini/` directory, a Cline slot holding the team's own script) is never touched: tell the user each line of `result.todos`, which carry the JSON to paste. Every path in `result.files` and `result.scripts` whose `change` is `write` or `chmod` goes into `installedInto[]` (Step 7): a script only made executable again is FireWeave's too. Committed with the rest, the scripts run every teammate's agent through the same gate. |
| **6 — Skills** | **Cursor** (when selected): run `fw tool refresh-agent-skills` with `{ "sourceSkillsRoot": <the installed Cursor bundle's .cursor/skills>, "destSkillsRoot": ".cursor/skills" }` (see **Skill copies**). Its `installedInto` goes into `installedInto[]`; its `rows[].state` goes in Step 9's notice. Claude Code reads FireWeave's skills from its plugin and needs no copy. |
| **7 — Bookkeeping (server-side)** | `installedInto[]` and `teamAgents` are **repo-scoped server state**. Write them with `fw tool update-repo-state` — one call, input `{ "fields": { "installedInto": [...], "teamAgents": [...] } }` — never by hand-editing `project.json`. Both are **set-valued and UNION on merge**, which is exactly what a second machine adopting concurrently needs: send only what this run added and the server folds it in. The write is online-only and fails closed; on `refused` → PARK and report, do not fall back to editing the file. It writes **no file at all** — not `rolloutReady.installedInto[]`, not `rolloutReady.teamAgents`, in any repo — so `fw sync` is how this worktree sees the merged row back. Append written paths (sorted, deduped): Record `CLAUDE.md` and the other entry files from Step 4, the hooks files and scripts from Step 5 and the skill copies from Step 6 in `installedInto[]`. **Union** selected agents (sorted, deduped). **When `teamAgents` is absent**, first **derive** the existing set exactly as `/fireweave:initialise --reinit` rule 2 — agents implied by `installedInto[]` paths, plus disk markers that already carry FireWeave standing-loop artifacts (FireWeave's block in `AGENTS.md` or `CLAUDE.md` / the FireWeave Cursor rule / a hook entry naming `.fireweave/hooks/agent-gate.sh` — **not** bare `.cursor/` or `.claude/` alone) — then union the selection into **that** derived set; never into a bare `[]` (N3 — first adopt must not drop other agents already wired). A **present** array (including `[]`) is authoritative: union into it as-is (post-`--remove` present-`[]` stays intentional). **Never write `.fireweave/local.json`**: it holds this machine's `cliPath` and FireWeave's on/off switch, and only `fw` writes it. |
| **8 — Verify** | Run `fw tool install-agent-hooks` with `"mode": "check"` and the same `hosts`: every file in `result.files` is `current`, every script in `result.scripts` is `current`, and `result.checks` is empty. Anything else that is not a to-do the user was told about → go back to Step 5. Then `fw tool detect-rollout-ready` + `fw tool reconcile` with `{ "phase": "build" }`. **Feedback reachable:** the `feedback` skill exists for every selected agent. **Entry files:** `CLAUDE.md` (or `.claude/CLAUDE.md`) holds FireWeave's `claude-entry` block and `AGENTS.md` its `agents-core` block (Step 4's `result.rendered`, or a to-do saying why one was left alone). |
| **9 — Reload notice** | Name **only** the agents whose reloadable artifacts were written this run (from this run's `installedInto[]` appends): Cursor → Developer → Reload Window; Claude Code → hooks apply on the next session (it may ask the person to trust changed hooks); Codex and Gemini CLI skip new or changed project hooks until the person trusts them (Codex: `/hooks`), and whether they did is not in the repository. If Step 5 wrote or refreshed the build gate, say so: the gate now runs on this machine's agent stop hooks. If Step 6 replaced stale skill copies, say which. Each adopted agent runs FireWeave's tools as `fw tool …`: on a machine where `fw` is not set up for that agent yet, `fw plugins install fireweave` sets it up (**notice only** — do not run it). `--reinit` remains available for harness/credential drift — prefer `adopt` for standing-loop-only gaps. |

Every clarification uses `ask_followup_question`.

## Write matrix

| Agent                                             | Artifacts `adopt` ensures                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`                                          | `CLAUDE.md` block, `AGENTS.md` and the per-app rules (Step 4's `fw tool render-entries`); `.claude/settings.json` hooks, `.fireweave/hooks/agent-gate.sh`, the build gate and `.claude/hooks/rollout-build-gate-stop.sh` (Step 5's `fw tool install-agent-hooks`)                                                                                        |
| `cursor`                                          | `.cursor/rules/fireweave-rollout-ready.mdc` and the per-app rules (Step 4); `.cursor/hooks.json` hooks, `.fireweave/hooks/agent-gate.sh`, the build gate and `.cursor/hooks/fireweave-rollout-stop.sh` (Step 5); FireWeave skills under `.cursor/skills/` (Step 6's `fw tool refresh-agent-skills`, each a **whole directory** — never `SKILL.md` alone) |
| `codex` / `gemini` / `copilot` / `kiro` / `cline` | `AGENTS.md` (Step 4; render-entries also puts FireWeave's block into a `.github/copilot-instructions.md`, `.junie/AGENTS.md`, root `AGENTS.override.md` or `GEMINI.md` the repository already has, and creates `GEMINI.md` beside a `.gemini/`); the host's hooks and `.fireweave/hooks/agent-gate.sh` (Step 5)                                          |
| `opencode` / `windsurf`                           | **Link-only experimental** — they read `AGENTS.md` (Step 4); no hooks                                                                                                                                                                                                                                                                                    |

**V1 completeness:** Claude and Cursor rows must be fully materialised, and both end with Step 8's check reporting `current`. Link-only rows are optional and cheap.

The agent gate (`.fireweave/hooks/agent-gate.sh`) tells the coding agent whether FireWeave's instructions apply in this repository on this machine; like the build gate, it decides on project identity (`projectId` / `projects`), never on the `rolloutReady` block. initialise's **Agent gate script** section says what it does.

## Skill copies

**Skill copies are COPIES, not links (C27).** `.cursor/skills/<skill>/` is a
real file copy of the installed plugin bundle; nothing refreshes it automatically.
`fw tool refresh-agent-skills` makes the copy: it compares by content, replaces
stale copies, and takes each directory name from the bundle as it is named there,
since hosts rename it (`initialise`, `fw-initialise` on Cursor, `fw_initialise` on Codex).

**Where the installed plugin bundle is:** the directory containing the `SKILL.md`
you are executing right now. `adopt` runs from the bundle, so the skills root is
its parent — `<dir of this SKILL.md>/..`. Resolve it that way rather than searching
the filesystem, and never substitute the `packages/fw-plugins/` platform source.
When this skill runs in another agent, the Cursor bundle is the FireWeave plugin
under `~/.cursor/plugins/`, at its `.cursor/skills`; when there is none, tell the
user to run `fw plugins install fireweave` and skip Step 6.

**Copy whole DIRECTORIES, not just `SKILL.md`.** A skill is its directory: the
initialise skill ships `harness/**` (the harness `.tpl` files its Step 4 generates
from). Copy `<skill-dir>/**`, never `<skill-dir>/SKILL.md` alone — the tool copies
whole directories; never copy skills by hand.

## Idempotency

- Second run is a **no-op**: each tool leaves a current file unchanged. Report "already current" when Step 3 found nothing missing or stale.
- `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` and the Cursor rule: only `fw tool render-entries` writes them. The hooks files and hook scripts: only `fw tool install-agent-hooks`. The skill copies: only `fw tool refresh-agent-skills`.

## Do not

- Run the `record-rollout-env-contract` tool, or ask about cloud secrets. (Nothing in FireWeave mints a
  credential any more — both key families are issued by the operator in the portal — so there are
  no keys for adopt to rotate either.)
- Scaffold or rewrite `fw-harness`, `fw-tracker`, or entrypoint wiring.
- **Never** touch `.fireweave/rollout-ready/**` (server-owned) or register rollouts.
- Write a hooks file, a hook script or a skill copy by hand, or copy `.cursor/**` into `.claude/**`.
- Write `.fireweave/local.json`.
- Write repo-local `mcp/rollout-server/` or `.cursor/mcp.json` launcher entries.
- Change `rolloutReady.mcp.mode` (host transport is initialise's job).
- Run while unbound or on a non-initialised repo.
- Write any file on PARK (Steps 0–3).

---

## Tool manifest

Every `fw tool` this skill runs; Step 0.0 checks each one is in `fw tool list --json`.

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure-auth", "via": "fw tool" },
    { "name": "agent-context", "via": "fw tool" },
    { "name": "detect-rollout-ready", "via": "fw tool" },
    { "name": "reconcile", "via": "fw tool" },
    { "name": "render-entries", "via": "fw tool" },
    { "name": "install-agent-hooks", "via": "fw tool" },
    { "name": "refresh-agent-skills", "via": "fw tool" },
    { "name": "update-repo-state", "via": "fw tool" }
  ]
}
```
