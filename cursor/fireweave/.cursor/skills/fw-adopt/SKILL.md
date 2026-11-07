---
name: "fw-adopt"
description: "Attach the current coding agent's FireWeave standing loop to a repo that is already initialised (harness, credentials, agent-instructions present). Writes only agent standing instructions + hooks — never re-scaffolds the harness, never rotates the project API key. Use when a teammate clones an initialised repo and opens Claude Code / Cursor / another agent that was not present at initialise time, or when the user asks to \"adopt this repo\", \"install FireWeave for my agent\", or invokes `/fireweave:adopt`. `--check` reports the wanted-vs-present diff without writing."
---
> Interaction: there is no skill-callable prompt tool — gate each decision by STOP and ask the user to pick a labelled option (or move the gate into the bundled MCP server via Elicitation).

# Adopt (attach my agent to an already-initialised repo)

Run when the **repo is already FireWeave-initialised** and this machine's coding agent is
missing the standing loop (the agent entry files + hooks). Typical cases:

1. Repo was initialised before team-agent selection existed (Cursor-only disk detect) — teammate opens Claude.
2. First init selected `teamAgents` but a new agent joins later that was not in the set.
3. Second machine / fresh clone lost executable bits or local-only drift (rare).

Greenfield `/fireweave:initialise` now asks which agents the **team** uses and writes those standing
loops up front — prefer that path for new repos. Use `adopt` when the harness is already in place
and only this agent's loop is missing.

`/fireweave:initialise --reinit` still re-scaffolds credentials/harness — do **not** use it just to add
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

Run `fw tool list --json`, then `fw tool ensure-auth`, from this shell, not from what an earlier session saw. **PARK, writing nothing,** and say which case it is:

| What happened                                                                             | Tell the user                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fw` is not found (see **Which `fw`**)                                                    | install the `fw` CLI (`docs/install.md`), then run `fw plugins install`: it installs FireWeave's skills and the allow rule that lets this agent run `fw`. Then run this skill again                                   |
| `fw tool list --json` lacks a tool this skill's **Tool manifest** names                   | this `fw` is older than the skill: `fw self-update`, then `fw plugins install`                                                                                                                                        |
| `fw tool ensure-auth` exits `5`, or its `result.create_permission.cause` is `unreachable` | this shell cannot reach FireWeave: it is sandboxed or offline. `fw plugins install` writes this agent's allow rule for `fw`, which lets `fw` reach FireWeave from a sandboxed shell; or run where the network is open |
| `fw tool ensure-auth` exits `3`                                                           | `fw login`, then run this skill again                                                                                                                                                                                 |

### Step 0.1 — the repo binding

Read `result.repo_binding` from the same `fw tool ensure-auth` envelope.
Continue **ONLY** when `repo_binding.bound === true` **and**
`repo_binding.orgMatch !== false`. Missing / undefined `repo_binding` → PARK
as unbound. On `orgMatch: false`: switch profile (`fw profile use`) or, when
the bind is stale, `fw select-project` (it asks first) — do not blindly rebind.
**Do not write FireWeave files while unbound.** A profile alone does NOT mean
this repo is bound to a project.

## Steps

| Step                              | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 — Bound gate**                | Read `.fireweave/project.json`. **The repo is initialised iff the pointer carries identity — `projectId` (or `projects{}`).** Do not read `rolloutReady` and do not branch on `version`: the block is a shape fact, not an initialisation fact, and `rolloutReady.initialized` no longer exists. (It used to gate this step; a block that never wrote the key was indistinguishable from `initialized: false`, so `adopt` PARKed on healthy repos and the standing-loop hooks no-opped on them — same defect, three doors.) Else PARK: _"this repo is not initialised — run `/fireweave:initialise` first"_ — **write nothing.** **`adopt` never initialises.** Confirm `.fireweave/agent-instructions.md` exists; if missing on an initialised repo → PARK toward `/fireweave:initialise --reinit` (genuine drift, not an adopt case) — **write nothing.** **Why PARK here but WARN for a missing build-gate (N4):** every standing loop points at `agent-instructions.md`, so attaching HARD ORDER / hooks that link a missing SoT is not useful; the build-gate is orthogonal to standing instructions and does not justify a key-rotating `--reinit`. Note `mcp.mode`, `installedInto[]`, and whether `teamAgents` is **absent** (pre-teamAgents initialisation — Step 5 will seed) or **present**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **2 — Choose agents**             | Detect coding-agent markers (`.claude/`, `.cursor/`, …). Then one `a stop-and-ask user prompt` (multi-select) for **this** machine. **V1 full-materialize:** `cursor`, `claude` only. Other hosts are link-only experimental (optional second ask). Host detection alone is unreliable. Empty selection → re-ask once; if still empty → PARK (write nothing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **3 — Diff**                      | For each selected agent, compute wanted-vs-present against the **Write matrix** below. Report what is missing / stale before writing. A stop hook script (`.claude/hooks/rollout-build-gate-stop.sh`, `.cursor/hooks/fireweave-rollout-stop.sh`) without its `# fireweave-stop-hook: 3` line is an older copy, which forces a turn on every reply of a fresh clone: stale (the plugin's session-start check names these and sends the person here). A `.claude/hooks/rollout-intent-gate.sh` or `.cursor/hooks/fireweave-rollout-session.sh` is retired: Step 4 removes it and its hook entries. **Also check the shared build gate and the agent gate:** note whether `.fireweave/hooks/rollout-build-gate.mjs`, `.fireweave/hooks/rollout-build-gate.sh` and `.fireweave/hooks/agent-gate.sh` exist, and whether each matches the installed plugin bundle's copy byte for byte (one that differs is an older copy: stale). A repository set up by FireWeave's cloud setup has **neither**: the setup PR carries only what the app needs to run, and `adopt` adds the coding-agent wiring, the build gate included. Either file **missing** is not a PARK (do **not** PARK, do **not** force `--reinit` / key rotate): Step 4 copies it from the installed plugin bundle. If the `.sh` exists but is non-executable → note mode-bit repair for Step 4. On `--check` → stop here (write nothing; still report build-gate status).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **4 — Write standing loop**       | **First write step.** **The agent entry files come from FireWeave's renderer, never by hand:** write `{ "teamAgents": [<the repo's teamAgents, plus the agents selected in Step 2>] }` to `.fireweave/tmp/render-entries.json` and run `fw tool render-entries --input-file .fireweave/tmp/render-entries.json`. It writes `AGENTS.md` (FireWeave's rollout contract), the `CLAUDE.md` block, the Cursor rule `.cursor/rules/fireweave-rollout-ready.mdc` and the per-app rules exactly as FireWeave's cloud setup does, upgrades an older FireWeave block in place (`format=1` becomes `format=2` once the project's capabilities allow it), leaves a current one unchanged, and removes the HARD ORDER blocks an older adopt appended. **Never write or edit `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.fireweave/agents-core.md` or the Cursor rule yourself.** Its `result.rendered` paths go into `installedInto[]` (Step 5); tell the user each line of `result.todos`; when the project's sync mode is outbox the same call installs the git pre-push hook that runs `fw sync` for the pushed branches (`result.prePushHook`, added to an existing hook, never replacing it): tell the user what it says; for an entry `skipped` because someone edited FireWeave's block, ask the user, and on yes run it again with `"editedBlock": "replace"` added to the input. A non-zero exit writes nothing: report its `reason` and clear the cause (`fw login` for exit `3`, retry for `5`) before Step 6. Then write **only** missing/stale hooks, hook scripts, settings wiring and skill copies for the selected agents (templates below). **Merge, never replace** `.cursor/hooks.json` / `.claude/settings.json`. Scripts: overwrite from template, `chmod +x`. **Build gate:** when `.fireweave/hooks/rollout-build-gate.mjs` or `.sh` is **missing**, copy it from the **installed plugin bundle's** `hooks/` directory (`<dir of this SKILL.md>/../../hooks/`, never `packages/fw-plugins/` platform source) and `chmod +x` the `.sh`. **Refresh an older copy:** when either file exists but differs from the bundle's, overwrite both from the bundle — they are FireWeave's own files, and an older wrapper never runs `fw gate` — then `chmod +x` the `.sh`; when both match, only repair the `.sh` mode bits. **Agent gate:** copy `.fireweave/hooks/agent-gate.sh` the same way (missing, or differing from the bundle's: overwrite it), `chmod +x` it, and in the same step retire `.claude/hooks/rollout-intent-gate.sh` and `.cursor/hooks/fireweave-rollout-session.sh` — delete each when present and remove the `.claude/settings.json` / `.cursor/hooks.json` entries that name it (see **Agent gate**). Do **not** change `mcp.mode`. |
| **5 — Bookkeeping (server-side)** | `installedInto[]` and `teamAgents` are **repo-scoped server state**. Write them with `fw tool update-repo-state` — one call, input `{ "fields": { "installedInto": [...], "teamAgents": [...] } }` — never by hand-editing `project.json`. Both are **set-valued and UNION on merge**, which is exactly what a second machine adopting concurrently needs: send only what this run added and the server folds it in. The write is online-only and fails closed; on `refused` → PARK and report, do not fall back to editing the file. It writes **no file at all** — not `rolloutReady.installedInto[]`, not `rolloutReady.teamAgents`, in any repo — so `fw sync` is how this worktree sees the merged row back. Append written paths (sorted, deduped). **Union** selected agents (sorted, deduped). **When `teamAgents` is absent**, first **derive** the existing set exactly as `/fireweave:initialise --reinit` rule 2 — agents implied by `installedInto[]` paths, plus disk markers that already carry FireWeave standing-loop artifacts (HARD ORDER / FireWeave rule / intent-gate — **not** bare `.cursor/` or `.claude/` alone) — then union the selection into **that** derived set; never into a bare `[]` (N3 — first adopt must not drop other agents already wired). A **present** array (including `[]`) is authoritative: union into it as-is (post-`--remove` present-`[]` stays intentional). Record per-machine adopt fact in gitignored `.fireweave/local.json` as `adopt: { agents, at, skillVersion }` — do **not** write credential / env / capability / `mcp.mode` fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **6 — Verify**                    | `fw tool detect-rollout-ready` + `fw tool reconcile` with `{ "phase": "build" }`. Assert each written script is executable, `.fireweave/hooks/rollout-build-gate.sh` included. **Feedback reachable:** the `feedback` skill exists for every selected agent. **Entry files:** `CLAUDE.md` (or `.claude/CLAUDE.md`) holds FireWeave's `claude-entry` block and `AGENTS.md` its `agents-core` block (Step 4's `result.rendered`, or a to-do saying why one was left alone). **Claude** (when selected): `.fireweave/hooks/agent-gate.sh` is executable, `.claude/settings.json` wires it under `SessionStart`, `UserPromptSubmit` and `PreToolUse` (matcher `Edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Write | MultiEdit | NotebookEdit`) and names no `rollout-intent-gate.sh`, and `git check-ignore` matches none of them (they must be committable). Fix any miss before finishing. |
| **7 — Reload notice**             | Name **only** the agents whose reloadable artifacts were written this run (from this run's `installedInto[]` appends): Cursor → Developer → Reload Window; Claude Code → hooks apply on the next session. If Step 4 copied or refreshed the build gate, say so: the gate now runs on this machine's agent stop hooks. Each adopted agent runs FireWeave's tools as `fw tool …`: on a machine where `fw` is not set up for that agent yet, `fw plugins install` sets it up (**notice only** — do not run it). `--reinit` remains available for harness/credential drift — prefer `adopt` for standing-loop-only gaps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Every clarification uses `a stop-and-ask user prompt`.

## Write matrix

| Agent                                                              | Artifacts `adopt` ensures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`                                                           | `CLAUDE.md` block, `AGENTS.md` and the per-app rules (Step 4's `fw tool render-entries`); `.fireweave/hooks/agent-gate.sh` (chmod +x, shared); `.claude/hooks/rollout-build-gate-stop.sh` (chmod +x) — the build gate itself, without which Claude is never checked; `.claude/settings.json` → merge `SessionStart` + `UserPromptSubmit` + `PreToolUse` + `Stop` (templates below); `.claude/hooks/rollout-intent-gate.sh` removed                                                                                                                                                          |
| `cursor`                                                           | `.cursor/rules/fireweave-rollout-ready.mdc` and the per-app rules (Step 4's `fw tool render-entries`); `.cursor/hooks.json` `sessionStart` and `afterFileEdit` (the agent gate) and `stop` entries; `.cursor/hooks/fireweave-rollout-stop.sh` (chmod +x); `.cursor/hooks/fireweave-rollout-session.sh` removed; FireWeave skills under `.cursor/skills/` copied **from the installed plugin bundle only** (never from `packages/fw-plugins/` platform source), each as a **whole directory** — never `SKILL.md` alone, or initialise arrives without its `harness/**` templates (C27 below) |
| `cline` / `codex` / `opencode` / `copilot` / `gemini` / `windsurf` | **Link-only experimental** — they read `AGENTS.md` (Step 4); Step 4's `fw tool render-entries` also puts FireWeave's block into a `.github/copilot-instructions.md`, `.junie/AGENTS.md`, root `AGENTS.override.md` or `GEMINI.md` the repository already has (and creates `GEMINI.md` beside a `.gemini/`); do not invent full HARD ORDER templates                                                                                                                                                                                                                                         |

Shared: `.fireweave/hooks/rollout-build-gate.{mjs,sh}` and `.fireweave/hooks/agent-gate.sh` — checked in Step 3; Step 4 copies a missing one, and refreshes an older one, from the installed bundle's `hooks/` and repairs `.sh` mode bits. Commit them with the rest: every teammate's agent runs the same gate.

**V1 completeness:** Claude and Cursor rows must be fully materialised. Link-only rows are optional and cheap.

**Skill copies are COPIES, not links (C27).** `.cursor/skills/<skill>/` is a
real file copy of the installed plugin bundle; nothing refreshes it automatically.

**Where the installed plugin bundle is:** the directory containing the `SKILL.md`
you are executing right now. `adopt` runs from the bundle, so the skills root is
its parent — `<dir of this SKILL.md>/..`. Resolve it that way rather than searching
the filesystem, and never substitute the `packages/fw-plugins/` platform source.

**Copy whole DIRECTORIES, not just `SKILL.md`.** A skill is its directory: the
initialise skill ships `harness/**` (the harness `.tpl` files its Step 4 generates
from). A copy that took only `SKILL.md` leaves the next agent running initialise
in this repo with no templates to read, and it hand-writes a harness instead.
Copy `<skill-dir>/**`, never `<skill-dir>/SKILL.md` alone — and take
`<skill-dir>` from the bundle as it is named there, since hosts rename it
(`initialise`, `fw-initialise` on Cursor, `fw_initialise` on Codex).

Copy the **whole** FireWeave skill set (`initialise`, `adopt`,
`migrate-harness`, `cleanup`, `feedback`), not just the one you were thinking
about — a half-refreshed set is a repo where `adopt` reads the seam and `cleanup`
still tries to delete files. A copied `fw-rollout` directory is the removed
`safe-rollout` skill: delete it, since nothing it calls exists any more. Overwrite stale copies rather than skipping them on
"already present": a repo whose data migrated to fw-server while its skill copies
stayed behind has an agent authoring manifest files into a tree where the gate no
longer reads them, and **nothing errors to say so**. Stale readers fail loudly;
stale instructions fail silently. Then say so in the Step 7 reload notice — a user
who is not told their copied skills changed has no reason to reload.

## Idempotency and merge rules

- Second run is a **no-op** apart from refreshing a stale entry block, script template or build gate. Report "already current" when the diff is empty.
- `.claude/settings.json` and `.cursor/hooks.json`: **read → merge → write**. Dedupe hook entries by `command`. Never emit a file containing only FireWeave entries.
- `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` and the Cursor rule: only `fw tool render-entries` writes them (Step 4). It replaces FireWeave's own block in place between its markers, removes an older HARD ORDER block, and never reorders or edits the team's text.
- Scripts: overwrite from the templates below, then `chmod +x`.

## Do not

- Run the `record-rollout-env-contract` tool, or ask about cloud secrets. (Nothing in FireWeave mints a
  credential any more — both key families are issued by the operator in the portal — so there are
  no keys for adopt to rotate either.)
- Scaffold or rewrite `fw-harness`, `fw-tracker`, or entrypoint wiring.
- **Never** touch `.fireweave/rollout-ready/**` (server-owned) or register rollouts.
- Blind-copy `.cursor/**` into `.claude/**` — generate each host from the templates below (Cursor and Claude shapes differ).
- Write repo-local `mcp/rollout-server/` or `.cursor/mcp.json` launcher entries.
- Change `rolloutReady.mcp.mode` (host transport is initialise's job).
- Run while unbound or on a non-initialised repo.
- Write any file on PARK (Steps 0–3).

---

## Agent gate

`.fireweave/hooks/agent-gate.sh` is the one script every host's hooks call to tell the coding agent whether FireWeave's instructions apply in this repository on this machine (`FireWeave: ON` with the contract, `OFF`, `ASK` or `SIGN IN`), once per conversation and then only on a change. Step 4 copies it from the **installed plugin bundle's** `hooks/` directory with the build gate and `chmod +x` it; never write or edit it by hand. Like the build-gate wrapper, it must decide on **project identity** (`projectId` / `projects`), never on the `rolloutReady` block. initialise's **Agent gate script** section says what it does. It replaces `.claude/hooks/rollout-intent-gate.sh` and `.cursor/hooks/fireweave-rollout-session.sh`: Step 4 deletes those when present and removes the hook entries that name them.

---

## Cursor hooks

**Merge** FireWeave hooks into `.cursor/hooks.json` — **never replace** the whole file. Existing events (`beforeMCPExecution`, `afterFileEdit`, …) must survive.

1. Read existing `.cursor/hooks.json`, or start with `{ "version": 1, "hooks": {} }`.
2. Under `hooks.sessionStart`, append (if not already present by `command`):
   `{ "command": "bash .fireweave/hooks/agent-gate.sh cursor sessionStart" }`
3. Under `hooks.stop`, append (if not already present by `command`):
   `{ "command": ".cursor/hooks/fireweave-rollout-stop.sh" }`
   and under `hooks.afterFileEdit`, append (if not already present by `command`):
   `{ "command": "bash .fireweave/hooks/agent-gate.sh cursor afterFileEdit" }` — it only records that this conversation edited a file, for the stop hook.
4. **Retire the old session hook:** remove every entry whose `command` names `.cursor/hooks/fireweave-rollout-session.sh`, and delete that file when present.
5. Write the merged JSON back. Do **not** paste a hooks.json that contains only FireWeave entries.

Write `.cursor/hooks/fireweave-rollout-stop.sh` (executable). Cursor submits a stop hook's `followup_message` as the next prompt, so it sends one only for drift, and none while `loop_count` says it already sent one; `cache-required` and `gate-outdated` alone get one line on stderr per conversation and no follow-up (0049 Stage D). When the project requires FireWeave, nobody is signed in and the conversation edited files, it sends the agent gate's sign-in follow-up instead of running the gate; when FireWeave is off here or waiting on the person, the build gate it runs passes quietly. Keep its `# fireweave-stop-hook: 3` line:

```bash
#!/usr/bin/env bash
# After agent work, nudge when rollout-ready artifacts drift.
# fireweave-stop-hook: 3
#
# Cursor submits a stop hook's `followup_message` as the next prompt, up to
# five times, so every follow-up is a forced turn (0049 Stage D):
#   - setup state is not drift: when `cache-required` (a fresh clone has no
#     .fireweave/.cache/) or `gate-outdated` are the only blocking findings,
#     there is no follow-up; one line goes to stderr (Cursor's hook output),
#     once per conversation. The gate still refuses to pass on them;
#   - drift sends one follow-up, and none while `loop_count` says this hook
#     already sent one.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
gate="$root/.fireweave/hooks/rollout-build-gate.sh"
payload=""
if [[ ! -t 0 ]]; then payload="$(cat 2>/dev/null || true)"; fi
flat="$(printf '%s' "$payload" | tr '\n\r' '  ')"
loops="$(printf '%s' "$flat" | grep -oE '"loop_count"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -1 || true)"
if [[ -n "$loops" && "$loops" -gt 0 ]]; then exit 0; fi
conversation="$(printf '%s' "$flat" | grep -oE '"conversation_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^.*:[[:space:]]*"//; s/"$//' || true)"
# The project requires FireWeave and nobody is signed in: a conversation that
# edited files (afterFileEdit) gets the sign-in follow-up instead of the build
# gate. The agent gate decides and words it. (When FireWeave is off here or
# waiting on the person, the build gate below passes quietly.)
agent_gate="$root/.fireweave/hooks/agent-gate.sh"
if [[ -f "$agent_gate" ]]; then
  signin="$(printf '%s' "$payload" | bash "$agent_gate" cursor stop 2>/dev/null || true)"
  if [[ -n "$signin" ]]; then
    printf '%s\n' "$signin"
    exit 0
  fi
fi
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
rules="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log([...new Set((j.findings||[]).filter(f=>f.severity==='block').map(f=>f.rule))].sort().join(','))" "$out" 2>/dev/null || true)"
findings="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log((j.findings||[]).filter(f=>f.severity!=='info').map(f=>f.fix?f.message+' Fix: '+f.fix:f.message).join('; '))" "$out" 2>/dev/null || true)"
if [[ -z "$findings" ]]; then
  findings="the gate produced no verdict: $(tr '\n' ' ' <"$err")"
fi
case ",$rules," in
  ,cache-required, | ,gate-outdated, | ,cache-required,gate-outdated,)
    marks="${TMPDIR:-/tmp}/fireweave-stop-hook.$(id -u 2>/dev/null || echo 0)"
    key="$(printf '%s|%s|setup:%s' "$root" "$conversation" "$rules" | cksum | awk '{print $1}')"
    if [[ ! -e "$marks/$key" ]]; then
      { mkdir -p "$marks" && : >"$marks/$key"; } 2>/dev/null || true
      echo "FireWeave build gate: not green, and nothing to fix in code (shown once this conversation): ${findings}" >&2
    fi
    exit 0
    ;;
esac
msg="FireWeave rollout-ready drift: ${findings}. Follow FireWeave's contract in .fireweave/instructions/contract.md (the manifest on this branch, one anchor, where the key is read), then run fw tool reconcile with phase build."
printf '%s\n' "{\"followup_message\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$msg")}"
```

Record `.cursor/hooks.json`, `.fireweave/hooks/agent-gate.sh`, `.cursor/hooks/fireweave-rollout-stop.sh`, `.cursor/rules/fireweave-rollout-ready.mdc` in `installedInto[]` when written.

---

## Claude Code hook

Three artifacts, all **required and committed**:

**1. The agent gate** — `.fireweave/hooks/agent-gate.sh` (executable), copied from the installed plugin bundle (see **Agent gate**). **Retire the old intent gate:** delete `.claude/hooks/rollout-intent-gate.sh` when present, and remove from `.claude/settings.json` every hook entry whose `command` names `rollout-intent-gate.sh`.

**2. The settings wiring** — merge (never replace) into `.claude/settings.json`. Use a **fail-open guarded command** so a missing script cannot error the hook. `PreToolUse` matches file edits only (`Edit|Write|MultiEdit|NotebookEdit`): it refuses an edit only when the project requires FireWeave and nobody is signed in.

```json
"SessionStart": [
  { "hooks": [ { "type": "command",
    "command": "[ -f .fireweave/hooks/agent-gate.sh ] && bash .fireweave/hooks/agent-gate.sh claude SessionStart || true" } ] }
],
"UserPromptSubmit": [
  { "hooks": [ { "type": "command",
    "command": "[ -f .fireweave/hooks/agent-gate.sh ] && bash .fireweave/hooks/agent-gate.sh claude UserPromptSubmit || true" } ] }
],
"PreToolUse": [
  { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
    "hooks": [ { "type": "command",
    "command": "[ -f .fireweave/hooks/agent-gate.sh ] && bash .fireweave/hooks/agent-gate.sh claude PreToolUse || true" } ] }
],
"Stop": [
  { "hooks": [ { "type": "command",
    "command": "[ -f .claude/hooks/rollout-build-gate-stop.sh ] && bash .claude/hooks/rollout-build-gate-stop.sh || true" } ] }
]
```

**3. The build-gate stop hook** — `.claude/hooks/rollout-build-gate-stop.sh` (executable, `chmod +x`), wired on **Stop**. Without it Claude Code has NO build gate: the agent gate only tells the agent whether FireWeave applies (it never checks the change), so on a Claude-only host the manifest ⇄ anchor check simply does not happen and nothing says so. Cursor has run this gate on every stop since initialise; this is the parity. It MUST:

- Honour `stop_hook_active` from the stdin payload — blocking twice loops the agent against a gate it may not be able to clear (a `fw sync` finding needs a network the session may not have). Cursor runs this hook too, through its import of Claude Code's hooks, and sends no `stop_hook_active`: honour its `loop_count`, and block at most once per conversation for the same findings when the payload carries no `stop_hook_active`.
- Emit `{ "decision": "block", "reason": <findings> }` when the gate finds drift and **nothing at all** on success. **Setup state is not drift (0049 Stage D):** when `cache-required` (a fresh clone has no `.fireweave/.cache/`) or `gate-outdated` are the only blocking findings, emit `{ "systemMessage": <findings> }` once per session and do not block. The gate still does not pass — a missing cache is never green — but no code edit clears it, and blocking forced a turn on every reply.
- Carry the `# fireweave-stop-hook: 3` line: the plugin's session hook names a stop hook without it as an older copy for `/fireweave:adopt` to refresh.
- Ask the agent gate first (`bash .fireweave/hooks/agent-gate.sh claude Stop`, the payload on stdin) and emit what it prints: a `{ "decision": "block" }` with the sign-in message when the project requires FireWeave, nobody is signed in and this session made file edits without declaring the task infra-only. When FireWeave is off here or waiting on the person, the build-gate wrapper passes quietly.
- Filter `severity: "info"` findings out of the reason — the manifest-source line is diagnostics, not drift.
- Be fail-open on everything except a gate that ran and failed. The one fail-open that is now **visible** is a gate present but not executable: that used to skip the check silently, which is a repo that believes it is gated and is not.

```bash
#!/usr/bin/env bash
# Claude Code Stop-hook parity for the rollout-ready build gate.
# fireweave-stop-hook: 3
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
#
# Setup state is not drift (0049 Stage D). A fresh clone has no
# .fireweave/.cache/ (it is gitignored), and a copied gate can be older than the
# cache `fw` wrote. The gate still refuses to pass on either (`cache-required`,
# `gate-outdated`: a missing cache is never green), but blocking on them forced
# a turn on every reply for something no code edit fixes. So when those are the
# only blocking findings, the person is told ONCE per session (`systemMessage`)
# and the stop is not blocked. Drift (an orphan anchor, a manifest control
# point with no anchor, RAMP-1, an unreplayable queue entry) still blocks.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
gate="$root/.fireweave/hooks/rollout-build-gate.sh"

payload=""
if [ ! -t 0 ]; then payload="$(cat 2>/dev/null || true)"; fi
flat="$(printf '%s' "$payload" | tr '\n\r' '  ')"
# Claude sets `stop_hook_active` once this hook has already blocked. Blocking a
# second time loops the agent against a gate it may not be able to clear (e.g.
# `fw sync` needs a network this session does not have).
case "$flat" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
# Cursor runs this hook too (it imports Claude Code's hooks) and sends no
# `stop_hook_active`. Its `loop_count` says it already sent a follow-up.
loops="$(printf '%s' "$flat" | grep -oE '"loop_count"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -1)"
if [ -n "$loops" ] && [ "$loops" -gt 0 ]; then exit 0; fi
session="$(printf '%s' "$flat" | grep -oE '"(session_id|conversation_id)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^.*:[[:space:]]*"//; s/"$//')"

# True the first time `$1` is seen in this session (per repository); a marker
# file under $TMPDIR remembers it.
once() {
  marks="${TMPDIR:-/tmp}/fireweave-stop-hook.$(id -u 2>/dev/null || echo 0)"
  key="$(printf '%s|%s|%s' "$root" "$session" "$1" | cksum | awk '{print $1}')"
  [ -e "$marks/$key" ] && return 1
  { mkdir -p "$marks" && : >"$marks/$key"; } 2>/dev/null || true
  return 0
}

# The project requires FireWeave and nobody is signed in: finishing with file
# edits made waits for a sign-in, unless the agent declared the task
# infra-only. The agent gate decides and words it. (When FireWeave is off here
# or waiting on the person, the build gate below passes quietly.)
agent_gate="$root/.fireweave/hooks/agent-gate.sh"
if [ -f "$agent_gate" ]; then
  signin="$(printf '%s' "$payload" | bash "$agent_gate" claude Stop 2>/dev/null || true)"
  if [ -n "$signin" ]; then
    printf '%s\n' "$signin"
    exit 0
  fi
fi

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

rules="$(node -e "
const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
console.log([...new Set((j.findings || []).filter((f) => f.severity === 'block').map((f) => f.rule))].sort().join(','));
" "$out" 2>/dev/null || true)"
reason="$(node -e "
const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
console.log((j.findings || []).filter((f) => f.severity !== 'info').map((f) => (f.fix ? f.message + ' Fix: ' + f.fix : f.message)).join('; '));
" "$out" 2>/dev/null || true)"
if [ -z "$reason" ]; then
  reason="the gate produced no verdict: $(tr '\n' ' ' <"$err")"
fi

case ",$rules," in
  ,cache-required, | ,gate-outdated, | ,cache-required,gate-outdated,)
    once "setup:$rules" || exit 0
    msg="FireWeave build gate: not green, and nothing to fix in code (shown once this session): ${reason}"
    node -e "console.log(JSON.stringify({ systemMessage: process.argv[1] }))" "$msg" 2>/dev/null \
      || printf '%s\n' "$msg" >&2
    exit 0
    ;;
esac

# A host that sends no `stop_hook_active` (Cursor) blocks once per conversation
# for the same findings, never in a loop.
case "$flat" in
  *'"stop_hook_active"'*) ;;
  *) once "drift:$reason" || exit 0 ;;
esac
msg="FireWeave rollout-ready build gate FAILED: ${reason} Follow FireWeave's contract in .fireweave/instructions/contract.md — author the manifest on this branch with fw tool upsert-rollout-manifest and put one // @fireweave-controlpoint <key> where the key is read — then re-run the gate. If a finding says \`fw sync\`, this worktree has no server projection and absence is NOT evidence: fetch it rather than authoring over a contract you cannot see."
node -e "console.log(JSON.stringify({ decision: 'block', reason: process.argv[1] }))" "$msg" 2>/dev/null \
  || printf '%s\n' "$msg"
exit 0
```

Record `CLAUDE.md`, `.fireweave/hooks/agent-gate.sh`, `.claude/hooks/rollout-build-gate-stop.sh`, and `.claude/settings.json` in `installedInto[]` when written. Claude Code needs the `CLAUDE.md` block (the gate text), the agent gate (whether FireWeave applies, and the contract when it does) and the stop gate (the check) — they are three different jobs and no two of them substitute for the third.

---

## Tool manifest

Every `fw tool` this skill runs; Step 0.0 checks each one is in `fw tool list --json`.

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure-auth", "via": "fw tool" },
    { "name": "detect-rollout-ready", "via": "fw tool" },
    { "name": "reconcile", "via": "fw tool" },
    { "name": "render-entries", "via": "fw tool" },
    { "name": "update-repo-state", "via": "fw tool" }
  ]
}
```
