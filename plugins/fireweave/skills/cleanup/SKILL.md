---
name: cleanup
description: Local cleanup for FireWeave Rollouts. Lists the control points fw-server says are stable, shows where each one still sits in this branch, and for the ones the user picks removes the old path in the code, retires the manifest on this branch (`fw manifest retire`; the tombstone lands when the cleanup merges into each environment branch), syncs and verifies. Leaves the change in the working tree for the user to commit. Use when the user asks to "clean up old flags", "retire stable rollouts", "remove dead feature flags", or invokes `/fireweave:cleanup`.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-cleanup
  cline: fw-cleanup
  codex: fw_cleanup
---

# Cleanup (remove stable control points from this branch)

A control point is ready to clean when **fw-server lists it as stable**: its
rollout finished and the new path is what everyone gets. That is the only
gate. Cleanup works on the checked-out branch: it edits code, retires the
manifest on this branch, and leaves the change in the working tree. The user
reviews and commits it; nothing is committed or pushed for them.

## Running FireWeave's tools (`fw tool`)

This skill runs FireWeave's tools through the `fw` CLI in your shell, as `fw tool <name>`. There is no FireWeave MCP server.

- **Which `fw`.** Run `command -v fw`; when it prints nothing, use `~/.fireweave/bin/fw` (`fw.exe` on Windows) if that file exists. Then run `fw tool list --json`: its `binary.realpath` is the `fw` that answered. When that is not the installed FireWeave binary (`~/.fireweave/bin/fw`, or wherever the user installed it), stop and say which `fw` is first on `PATH`.
- **Input.** Write the tool's input as one JSON object to `.fireweave/tmp/<name>.json` with your file-editing tool, then run `fw tool <name> --input-file .fireweave/tmp/<name>.json` from the repository root. A tool that needs no input runs as `fw tool <name>`. Leave `cwd` out: `fw tool` takes it from the shell's directory, clamped to the repository. `.fireweave/.gitignore` ignores `tmp/`; add that line when it is missing.
- **Output.** One JSON envelope, `{ "status", "exitCode", "reason"?, "result"? }`; `result` is the tool's own answer. Exit `0` ok · `1` refused · `2` bad input · `3` auth (`fw login`) · `4` upgrade (`fw self-update`) · `5` unavailable (retry later). A refusal never exits 0.
- **Plain commands.** One `fw …` command per shell call, and each `fw tool` command on its own (FireWeave's hook refuses one joined to anything else); other commands may form a plain `&&` chain: no redirection, no heredocs, no `$(…)`, no `VAR=` prefixes, no globs, and never `fw api`. Hosts pre-approve plain `fw tool`, `fw status` and `fw sync` commands; `fw manifest …`, `fw login` and `fw select-project` ask the user first.

## Step 0 — `fw`, auth and the repo binding (fail closed, allowlist)

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

### Step 1 — Stable control points in this branch

Run `fw tool find-cleanup-candidates`. It reads the project's stable control points from fw-server and, for each, reports where its `@fireweave-controlpoint` anchors sit in this branch and which live manifest declares it. The manifests come from the **shipped set** through the FireWeave seam (fw-server → `.fireweave/.cache/` projection), with `retiring` tombstones already applied — **never a listing of `.fireweave/rollout-ready/`**.

- `result.candidates[]`: `flagKey`, `rolloutName`, `stableAt`, `anchors` (`file`, `line`) and `feature` / `changeId` / `stampId` of the declaring manifest (`null` when no live manifest declares it).
- `result.alreadyGone[]`: stable on the server, but no anchor and no live manifest here. Nothing to do in this branch.
- **Read `absence` before `candidates`.** When the shipped set could not be read, the result carries `absence` + `absenceFix` and `feature` is `null` on every candidate: `not-fetched` → `fw sync`, then run the tool again; `not-authorized` → the manifests are **withheld, not absent**; `server-unavailable` → retry. Never retire with an absence open.
- A refusal (no project bound, or the server's stable list could not be read) stops the skill; say why.

### Step 2 — Show and pick

Show one row per candidate: key · stable since (`stableAt`) · rollout · `file:line` of each anchor. List `alreadyGone` under **Already gone from this branch**. Ask which candidates to clean (`AskUserQuestion`, several allowed). Clean only the ones picked.

### Step 3 — Remove the old path

For each picked key, at every anchor:

- Keep the path the code takes when the control point is **on** (the new path).
- Delete the control-point check, the old path, and the `@fireweave-controlpoint <key>` anchor comment.
- Delete code that only the old path used, when nothing else uses it.
- Drop the key's entry from the surface's control-points file, and the change's `stampId` from the surface's stamps (`FW_STAMPS` / `.fireweave/stamps.<ext>`).
- Fix the tests that exercised the old path or switched the control point.

Leave unrelated code alone.

### Step 4 — Retire the manifest

When the candidate has a `feature`, run `fw manifest retire --feature <feature> --branch <this branch> --json` → `POST /v1/repo-manifests/retire`. It is a typed command, not an `fw tool`, so the host asks the user before it runs. **There is no `_archive/` directory and no stamp file to move** — archival is a `status` on a server row, and change stamps are archived with the manifest in the same transaction (M2). The tombstone is branch-scoped by design. Idempotent: a second call returns `already-retiring`, which is a success. `404 MANIFEST_NOT_SHIPPED` means nothing shipped this feature — do **not** "fix" it by authoring or archiving something else. With no `feature` (and no `absence`), there is no manifest to retire: the code edit is the whole cleanup.

Then run `fw sync`, so this branch's view drops the retired manifest.

### Step 5 — Verify

- `fw tool find-cleanup-candidates` again: each cleaned key is now in `alreadyGone`.
- `fw tool reconcile` with `{ "phase": "build" }` passes. A block naming a cleaned key means an anchor, a manifest or a stamp was left behind: go back to Step 3 or 4.
- Run the repository's own checks on the touched files (its typecheck, lint and tests).

Leave the change in the working tree and tell the user what changed; they commit it.

### Step 6 — The merge into each environment branch lands the tombstone

The tombstone shadows the shipped contract **in this branch's view only**. That is deliberate: an immediate global archive would orphan `main`'s still-present `// @fireweave-controlpoint` anchors, blocking every gate on every other branch for a cleanup that has not merged and may never merge. Open the cleanup's pull request like any change. **Merging it into each environment branch lands the tombstone there (F2)**: with one shared branch that merge archives the shipped manifest and its stamps; with a branch per environment, each merge records its environments and the last one archives. There is nothing to call — no registration naming the feature and no promote. **Do not chase the archive by hand** and do not reach for `fw manifest archive` (the break-glass) to shortcut it — that route is immediate and global, and it is exactly what this two-step exists to avoid.

Every clarification uses `AskUserQuestion`.

## Do not

- Clean a key fw-server does not list as stable.
- Delete or move a manifest file, or create an `_archive/` directory — neither has a successor; retirement is a server transition.
- Delete a change-stamp file. Stamps live in `change_stamps` and are archived with the manifest.
- Remove a `FW_STAMPS` line instead of retiring: the stamp line goes in the same change as `fw manifest retire`, never alone.
- Archive globally (`fw manifest archive --shipped`) as a shortcut for retire → merge.
- Commit or push for the user.

## Tool manifest

Every `fw tool` this skill runs; Step 0.0 checks each one is in `fw tool list --json`.

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure-auth", "via": "fw tool" },
    { "name": "agent-context", "via": "fw tool" },
    { "name": "find-cleanup-candidates", "via": "fw tool" },
    { "name": "reconcile", "via": "fw tool" }
  ]
}
```
