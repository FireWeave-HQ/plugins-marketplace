---
name: feedback
description: Report that FireWeave behaved wrong in this session. Captures the agent session, enriches it with local FireWeave state (CLI status, cache lockfile, manifest versions, MCP tool drift), redacts it locally, takes the user's own remarks, proposes a category, and uploads the bundle to FireWeave after explicit confirmation. Use when the user says "this feels off", "FireWeave is broken", "something's wrong with the rollout skill", "give feedback", "report a problem", "troubleshoot FireWeave", or invokes `/fireweave:feedback`.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-feedback
  cline: fw-feedback
  codex: fw_feedback
---

# Feedback (session capture → FireWeave)

Turns "FireWeave felt wrong" into a report someone can act on: the session, the
local state that explains most failures, and the user's own words.

**Nothing leaves the machine without the user seeing what it is first.**

## Step 0 — Soft precondition (degrade, never PARK)

Run `mcp__rollout-server__ensure_auth` with `{ cwd: <absolute open-workspace root> }`.

Unlike every other FireWeave skill, this one **does NOT PARK** on a bad result.
A repo that is unauthenticated, unbound, or org-mismatched is exactly the repo
whose owner needs to be heard. Record the failure **as evidence** — note the
`ok`, `repo_binding` and `create_permission` values in the session account
written in Step 1 — and continue.

Collection never needs auth. Only the upload does, and Step 6 handles a missing
profile by keeping the bundle and printing the command that resumes it.

## Steps

| Step                                    | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Write the session account**       | Write a structured account of this session to a temp file: what the user set out to do, which FireWeave skills and tools ran and in what order, what each returned, and where you believe it went wrong. Be specific and factual; this is the part a transcript cannot supply because it is your read of the failure. It is also the whole report on hosts where no transcript file exists. **This account is written for the FireWeave team, not for the user — it goes in the bundle and is never recited back in chat.** See [Voice](#voice).                                                               |
| **2 — Take the remarks**                | One `AskUserQuestion`: a **mandatory free-text** "what felt off?" plus severity (`low`/`medium`/`high`/`critical`). Do not paraphrase the answer — it is stored verbatim and is never redacted. Do NOT ask for a category here.                                                                                                                                                                                                                                                                                                                                                                                |
| **3 — Propose a category**              | Read `references/taxonomy.md`. Pick the category that best fits the session and the remarks, then confirm with one `AskUserQuestion` with your proposal listed first and the other plausible options beside it. If nothing fits, propose `uncategorised` — a wrong label is worse than none.                                                                                                                                                                                                                                                                                                                   |
| **4 — Collect (nothing uploads)**       | Run `fw feedback --dry-run --json --remarks-file <remarks.txt> --agent-summary-file <account.md> --category <key> --severity <level>`, where `account.md` is the file you wrote in Step 1 and `remarks.txt` holds the user's words from Step 2. The CLI collects the transcript and metadata, redacts locally, writes the bundle under `.fireweave/.cache/feedback/`, and prints a digest. **Nothing has left the machine at this point.**                                                                                                                                                                     |
| **5 — Preview + explicit confirmation** | Show the user the digest as prose: bundle size, transcript message count, redaction counts by class, and the session span. Offer to print the bundle path so they can inspect it themselves. Then one `AskUserQuestion`: send it, or not. **Do not upload without an explicit yes.** A "no" is a complete, successful outcome — say where the bundle is and stop.                                                                                                                                                                                                                                              |
| **6 — Submit**                          | On a yes, run `fw feedback --submit <bundlePath> --yes --json`. Then close with one line and stop: **"Noted your observations and forwarded your feedback to the FireWeave team."** Nothing else — no diagnosis, no findings, no restatement of what you recorded. Keep the `feedbackId` to yourself unless the user asks for a reference.                                                                                                                                                                                                                                                                     |
| **7 — When it does not go through**     | Any non-zero exit closes the same way, minus the claim it was sent: **"Noted your observations. I could not deliver them to the FireWeave team just now — your report is saved and will go through on the next attempt."** Then, only if it is the user's to act on, add the one actionable line: exit `3` → the printed `fw login && fw feedback --submit …`. For exits `4` and `5` there is nothing for the user to do — do not relay the server or transport error, and do not speculate about the cause in chat. Put the failure in the account file instead (Step 1) so it reaches the team that owns it. |

## Rules

- **Remarks are mandatory.** A bundle with no human sentence in it is telemetry,
  not feedback. If the user will not write one, stop — do not invent one.
- **Never edit the redaction output.** If the digest shows fewer redactions than
  you expect, say so in the preview; do not hand-scrub the bundle.
- **Never re-run collection to "get a cleaner transcript."** The session that
  went wrong is the evidence.
- Every clarification uses `AskUserQuestion`.

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
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure_auth", "server": "rollout-server" }
  ]
}
```
