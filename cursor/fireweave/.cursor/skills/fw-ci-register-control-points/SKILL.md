---
name: "fw-ci-register-control-points"
description: "CI variant of control-point registration. Runs inside a FireWeave sandbox on a merge event and produces the DETERMINISTIC extraction with `fw merge register --dry-run --json` — every control point in the tree plus the dependency edges decidable from syntax; the agent only proposes additional (inferred) edges. Never persists anything itself, never asks the user anything, never calls an MCP tool. Use when a workflow says \"register the control points this merge introduced\", or via `/fireweave:ci-register-control-points`."
disable-model-invocation: true
---
> Interaction: there is no skill-callable prompt tool — gate each decision by STOP and ask the user to pick a labelled option (or move the gate into the bundled MCP server via Elicitation).

# CI control-point registration (deterministic extraction, advisory graph)

Registration is the FireWeave pipeline's job — it persists what this skill
extracts and creates one change rollout per unique NEW control point, linking
(never copying) the control point. This skill produces the extraction and,
separately, the agent's proposed edges. It never writes to FireWeave itself and
it never asks the user anything.

## Preconditions (PARK with a one-line reason on stderr if any is missing)

- `fw --version` prints a version that ships `merge register` (0.4.0 or later).
- A git checkout at the merge commit `$HEAD_SHA` with `$BASE_SHA` resolvable
  (in the sandbox both are set; in-editor omit them and `fw merge register`
  uses `HEAD^1`..`HEAD`).

## Step 1 — the extraction (deterministic; the agent MUST NOT alter it)

```bash
fw merge register --dry-run --json ${BASE_SHA:+--base "$BASE_SHA"} ${HEAD_SHA:+--head "$HEAD_SHA"} > extraction.json
echo "exit=$?"
```

`--dry-run` is required in this build: the persisting path is the FireWeave
pipeline, and the flag says so at the terminal rather than letting a local run
pass for a registration. Exit `0` printed · `2` usage. Do not edit
`extraction.json`.

## Step 2 — inferred edges (the agent; recorded as information only)

Read `extraction.json` (its `controlPoints[]` and the deterministic `edges[]`)
and the sources their anchors point at. Write `edges.json` — an array of edges
the syntax pass cannot see (a guarded branch that reaches another control point
through a function call, a semantic dependency), each:

```json
{
  "fromKey": "…",
  "toKey": "…",
  "edgeKind": "call-graph",
  "source": "inferred",
  "confidence": 0.0,
  "evidence": { "…": "…" }
}
```

Rules: `source` is always `inferred`; `confidence` is at most `0.8`; both keys
must appear in `extraction.json` (an edge naming a key that is not there is
dropped by the server and reported as unknown); never repeat a deterministic
edge; at most 50 edges. Nothing in this build ACTS on an edge — they are
gathered so a later join-or-create decision has history.

## Output contract

stdout is exactly two lines — the paths of `extraction.json` and `edges.json`;
the exit code is Step 1's.

## Forbidden in this skill

`a stop-and-ask user prompt`; editing any file under the checkout; any `mcp_rollout-server_*`
tool; any network call other than `fw` itself; calling `fw merge register`
without `--dry-run`.

## What the pipeline then does

Persists control points and edges, creates one rollout per unique NEW control
point (linked through `rollout_control_points`), and posts
`FireWeave — control points registered` as a check run on the merge commit.
The result is readable at `GET /v1/projects/{projectId}/control-points/graph`.
