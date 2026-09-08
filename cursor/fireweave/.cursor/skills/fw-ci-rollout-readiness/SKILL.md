---
name: "fw-ci-rollout-readiness"
description: "CI variant of the safe-rollout readiness gate. Runs inside a FireWeave sandbox on a pull-request event (or in-editor before opening a PR) and produces a DETERMINISTIC verdict with `fw pr check --json`; the agent only adds advisory notes. Never asks the user anything, never writes to the repo, never calls an MCP tool. Use when a workflow says \"check this PR for rollout readiness\", when reviewing a FireWeave check-run failure, or via `/fireweave:ci-rollout-readiness`."
disable-model-invocation: true
---
> Interaction: there is no skill-callable prompt tool — gate each decision by STOP and ask the user to pick a labelled option (or move the gate into the bundled MCP server via Elicitation).

# CI rollout readiness (deterministic verdict, advisory agent)

The **verdict is never the agent's**. `fw pr check` decides — a pure function of
the tree, the diff range and the server-owned manifests — and the check run on
the pull request carries that decision. This skill's only judgement is the
advisory section beside it. It never asks the user anything: there is nobody to
ask inside a sandbox, and an in-editor run must read identically.

## Preconditions (PARK with a one-line reason on stderr if any is missing)

- `fw --version` prints a version that ships `pr check` (0.4.0 or later).
- `$FW_MANIFESTS` names a readable JSON file — the project's rollout-ready
  manifests. The FireWeave sandbox pipeline writes it to
  `/work/.fireweave/.cache/manifests.json` (the default); in-editor, export it
  with `fw manifest show --json > /tmp/manifests.json` and point `FW_MANIFESTS`
  at it.
- A git checkout with `$BASE_SHA` and `$HEAD_SHA` resolvable (in the sandbox
  both are set; in-editor omit them and `fw pr check` defaults to
  `merge-base origin/HEAD HEAD`..`HEAD`).

There is no `.fireweave/project.json`, no credential and no network in this
flow. If you find yourself wanting one, you are in the wrong skill.

## Step 1 — the verdict (deterministic; the agent MUST NOT alter it)

```bash
fw pr check --json --manifests "${FW_MANIFESTS:-/work/.fireweave/.cache/manifests.json}" \
  ${BASE_SHA:+--base "$BASE_SHA"} ${HEAD_SHA:+--head "$HEAD_SHA"} > report.json
echo "exit=$?"
```

Exit codes are the contract: `0` ready or no rollout surface · `1` not ready ·
`2` could not evaluate. `2` is "nobody looked" and a CI gate must treat it as
not-approved. Do not edit `report.json`; do not re-run to "get a better answer".

## Step 2 — the advisory (the agent; never blocks)

Read `report.json` and the diff (`git diff "$BASE_SHA".."$HEAD_SHA"`). Write
`advisory.json` matching:

```json
{
  "notes": [
    {
      "kind": "naming | guardrail-metric | ramp-shape | other",
      "message": "…",
      "key": "optional control-point key"
    }
  ]
}
```

Rules: at most 10 notes; a note may never contradict a finding in
`report.json`; a note about a control point names its `key`; nothing in
`advisory.json` changes the exit code.

## Output contract

stdout is exactly two lines — the paths of `report.json` and `advisory.json`;
the process exit code is Step 1's. The sandbox pipeline reads both; a human in
an editor reads the same two files.

## Forbidden in this skill

`a stop-and-ask user prompt`; editing any file under the checkout; any `mcp_rollout-server_*`
tool; any network call other than `fw` itself; reading `.env*`.

## What the check run then says

The FireWeave pipeline posts `FireWeave — rollout readiness` on the PR:
`success` (ready / no surface), `failure` (not ready, with per-finding
annotations), `neutral` (could not evaluate — fail-open) or `action_required`
(could not evaluate and the project opted to fail closed). Making that check
**required** on the env branch is what blocks the merge; see the initialise
skill's "make the FireWeave check required" note. Control points registered by
merges are visible at `GET /v1/projects/{projectId}/control-points`.
