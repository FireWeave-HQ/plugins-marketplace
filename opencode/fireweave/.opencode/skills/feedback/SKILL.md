---
name: "feedback"
description: "Report that FireWeave behaved wrong in this session. Captures the agent session, enriches it with local FireWeave state (CLI status, cache lockfile, manifest versions, tool drift), redacts it locally, takes the user's own remarks, proposes a category, and uploads the bundle to FireWeave after explicit confirmation. Use when the user says \"this feels off\", \"FireWeave is broken\", \"something's wrong with the rollout skill\", \"give feedback\", \"report a problem\", \"troubleshoot FireWeave\", or invokes `/fireweave:feedback`."
compatibility: "opencode"
---
> Interaction: gate each decision with the native `question` tool (multi-option; supports multi-select + custom free-text).

# Feedback (session capture → FireWeave)

Turns "FireWeave felt wrong" into a report someone can act on: the session, the
local state that explains most failures, and the user's own words.

**Nothing leaves the machine without the user seeing what it is first.**

## Running FireWeave's tools (`fw tool`)

This skill runs FireWeave's tools through the `fw` CLI in your shell, as `fw tool <name>`. There is no FireWeave MCP server.

- **Which `fw`.** Run `command -v fw`; when it prints nothing, use `~/.fireweave/bin/fw` (`fw.exe` on Windows) if that file exists. Then run `fw tool list --json`: its `binary.realpath` is the `fw` that answered. When that is not the installed FireWeave binary (`~/.fireweave/bin/fw`, or wherever the user installed it), stop and say which `fw` is first on `PATH`.
- **Input.** Write the tool's input as one JSON object to `.fireweave/tmp/<name>.json` with your file-editing tool, then run `fw tool <name> --input-file .fireweave/tmp/<name>.json` from the repository root. A tool that needs no input runs as `fw tool <name>`. Leave `cwd` out: `fw tool` takes it from the shell's directory, clamped to the repository. `.fireweave/.gitignore` ignores `tmp/`; add that line when it is missing.
- **Output.** One JSON envelope, `{ "status", "exitCode", "reason"?, "result"? }`; `result` is the tool's own answer. Exit `0` ok · `1` refused · `2` bad input · `3` auth (`fw login`) · `4` upgrade (`fw self-update`) · `5` unavailable (retry later). A refusal never exits 0.
- **Plain commands.** One `fw …` command per shell call, and each `fw tool` command on its own (FireWeave's hook refuses one joined to anything else); other commands may form a plain `&&` chain: no redirection, no heredocs, no `$(…)`, no `VAR=` prefixes, no globs, and never `fw api`. Hosts pre-approve plain `fw tool`, `fw status` and `fw sync` commands; `fw manifest …`, `fw login` and `fw select-project` ask the user first.

## Step 0 — Soft precondition (degrade, never PARK)

Run `fw tool ensure-auth`.

**Only a missing `fw` stops this skill**, because `fw` is what collects (Step 4).
When `fw` is not found (see **Which `fw`**), tell the user to install the `fw`
CLI (`docs/install.md`) and run `fw plugins install fireweave`, which lets this agent run
`fw`, then run this skill again. Write nothing first.

Unlike every other FireWeave skill, this one **does NOT PARK** on a bad result.
A repo that is unauthenticated, unbound, or org-mismatched is exactly the repo
whose owner needs to be heard. Record the failure **as evidence** — note the
envelope's `exitCode` and the `ok`, `repo_binding` and `create_permission`
values of its `result` in the session account written in Step 1 — and continue.
A sandboxed or offline shell (`exitCode` 5, or `create_permission.cause`
`unreachable`) is evidence too.

Collection never needs auth. Only the upload does, and Step 6 handles a missing
profile by keeping the bundle and printing the command that resumes it.

## Steps

| Step                                    | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Write the session account**       | Write a structured account of this session to a temp file: what the user set out to do, which FireWeave skills and tools ran and in what order, what each returned, and where you believe it went wrong. Be specific and factual; this is the part a transcript cannot supply because it is your read of the failure. It is also the whole report on hosts where no transcript file exists. **This account is written for the FireWeave team, not for the user — it goes in the bundle and is never recited back in chat.** See [Voice](#voice).                                                               |
| **2 — Take the remarks**                | One `the `question` tool`: a **mandatory free-text** "what felt off?" plus severity (`low`/`medium`/`high`/`critical`). Do not paraphrase the answer — it is stored verbatim and is never redacted. Do NOT ask for a category here.                                                                                                                                                                                                                                                                                                                                                                                |
| **3 — Propose a category**              | Read `references/taxonomy.md`. Pick the category that best fits the session and the remarks, then confirm with one `the `question` tool` with your proposal listed first and the other plausible options beside it. If nothing fits, propose `uncategorised` — a wrong label is worse than none.                                                                                                                                                                                                                                                                                                                   |
| **4 — Collect (nothing uploads)**       | Run `fw feedback --dry-run --json --remarks-file <remarks.txt> --agent-summary-file <account.md> --category <key> --severity <level>`, where `account.md` is the file you wrote in Step 1 and `remarks.txt` holds the user's words from Step 2. The CLI collects the transcript and metadata, redacts locally, writes the bundle under `.fireweave/.cache/feedback/`, and prints a digest. **Nothing has left the machine at this point.**                                                                                                                                                                     |
| **5 — Preview + explicit confirmation** | Show the user the digest as prose: bundle size, transcript message count, redaction counts by class, and the session span. Offer to print the bundle path so they can inspect it themselves. Then one `the `question` tool`: send it, or not. **Do not upload without an explicit yes.** A "no" is a complete, successful outcome — say where the bundle is and stop.                                                                                                                                                                                                                                              |
| **6 — Submit**                          | On a yes, run `fw feedback --submit <bundlePath> --yes --json`. Then close with one line and stop: **"Noted your observations and forwarded your feedback to the FireWeave team."** Nothing else — no diagnosis, no findings, no restatement of what you recorded. Keep the `feedbackId` to yourself unless the user asks for a reference.                                                                                                                                                                                                                                                                     |
| **7 — When it does not go through**     | Any non-zero exit closes the same way, minus the claim it was sent: **"Noted your observations. I could not deliver them to the FireWeave team just now — your report is saved and will go through on the next attempt."** Then, only if it is the user's to act on, add the one actionable line: exit `3` → the printed `fw login && fw feedback --submit …`. For exits `4` and `5` there is nothing for the user to do — do not relay the server or transport error, and do not speculate about the cause in chat. Put the failure in the account file instead (Step 1) so it reaches the team that owns it. |

## Rules

- **Remarks are mandatory.** A bundle with no human sentence in it is telemetry,
  not feedback. If the user will not write one, stop — do not invent one.
- **Never edit the redaction output.** If the digest shows fewer redactions than
  you expect, say so in the preview; do not hand-scrub the bundle.
- **Never re-run collection to "get a cleaner transcript."** The session that
  went wrong is the evidence.
- Every clarification uses `the `question` tool`.

## Voice

This skill collects and forwards. It does not investigate, and it does not
report back.

The user came here to be heard, not to receive a defect analysis. Everything you
learn about **why** FireWeave misbehaved belongs in the account file, where the
team that owns the fix will read it — not in chat, where it only asks the user
to carry a problem that is not theirs.

- **Do not diagnose in chat.** No root cause, no "this is a FireWeave-side
  infrastructure problem", no confirming or refuting the user's theory.
- **Do not rank FireWeave's own defects out loud** — nothing is "a
  higher-priority defect than the ones you filed". Severity is the user's field
  (Step 2) and the team's call afterwards.
- **Never quote internal identifiers or error text**: bucket names, ARNs,
  account IDs, role and service names, stack traces, raw server responses. These
  reach the team through the bundle.
- **Do not read the account file back.** If the user asks what you wrote, offer
  the path and let them read it themselves.
- The only exception is the Step 5 preview, which is a consent gate: the user
  always sees the shape of what is about to leave their machine.

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [{ "name": "ensure-auth", "via": "fw tool" }]
}
```
