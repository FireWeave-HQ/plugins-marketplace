---
name: "fw_rollout_fast"
description: "The no-swap \"promote, not wrap\" ship path for repos already initialised with FireWeave Rollouts. Detects the rollout-ready manifest + change stamps, verifies the already-generated prod branch (no provider swap), then registers a ramp on the deploy-liveness gate. Use when the user asks to \"ship this\", \"promote the rollout\", \"ramp the feature\", or invokes `/fireweave:safe-rollout-fast` in a repo containing `.fireweave/rollout-ready/`."
---
> Interaction: gate each decision with `request_user_input` (single-choice; "(Recommended)" first). If interactive prompting is unavailable (non-interactive run), present numbered options inline and wait.

# Safe Rollout (fast path — promote, not wrap)

This is the **fast path** for repos that ran `/fireweave:initialise`. The rollout
structure was front-loaded during development (each change is already behind a
standard OpenFeature flag with OTel telemetry + a change-stamp), so shipping is a
**promote, not a wrap**: FireWeave **verifies** the already-generated prod branch
and **registers a ramp** — it never re-analyzes, re-wraps, re-instruments, or
swaps a provider registration (D26). **No functional code changes at promotion.**

> If `.fireweave/rollout-ready/` does NOT exist, this repo is not initialised —
> use `/fireweave:safe-rollout` (the legacy wrap-from-scratch path) instead.

## Step 0 — Auth precondition

Run `mcp__rollout_server__ensure_auth`. It verifies an authenticated `fw` profile
**and** a bound project (`.fireweave/project.json` `orgId` + `projectId`). On
failure, instruct the user to run `fw login` then `fw init` / and call
`mcp__rollout_server__select_project`, and PARK until both are satisfied. Never
handle a bearer token or endpoint directly — `fw api` owns auth end-to-end.

### Step 0.1b — Tool manifest check

Call `mcp__rollout_server__list_registered_tools` and confirm every tool in
`SKILL_EXPECTED_TOOL_MANIFEST` (below) is present. If any is missing, hard-abort
with an upgrade message — the server is older than this skill expects.

## Steps

| Step | Action |
|---|---|
| **1 — Detect manifest + stamps** | Read `.fireweave/rollout-ready/<feature>.json` (the load-bearing committed contract) and the active change stamps in `.fireweave/changelog/` + `fw-tracker`. Run `mcp__rollout_server__detect_rollout_ready` to confirm the `// @fireweave-flag <key>` anchors are present for every manifest flag. |
| **2 — Reconcile (gate)** | Run `mcp__rollout_server__reconcile` with `phase: "ship"` — the `manifest ⇄ (anchor ∪ FW_DUMP ∪ stamp)` gate. A coded-but-unmanifested flag, an orphan manifest entry, or a stamp whose flag is gone all FAIL. Do not proceed on a blocking finding. |
| **3 — Verify prod path (NO swap, D26)** | Run `mcp__rollout_server__verify_prod_path` with `{ feature, projectId }` only — **do not pass `targetEnvironment`**. The tool auto-resolves the **prod-tier** environment from `project.json` `rolloutReady.environments` for PostHog binding lookup (phantom-ramp guard). This checks the harness **prod branch** wiring — it is **not** the rollout target environment. Checklist: (1) vendor provider in `isProd()` branch; (2) credential env in `.env.example`; (3) manifest `posthogProjectId` matches bound project; (4) `initFwHarness()` awaited; (5) optional smoke-eval. Unsupported surfaces are **skipped/xfail**. |
| **4 — Build + register (single-shot promote)** | Rollout `environment` is resolved automatically from the FireWeave project default (UI `isDefault` → API → `.fireweave/project.json`). **Never pass `environment` to `build_register_rollout_from_manifest` or `register_rollout`** — mismatches are rejected. **Never** use legacy draft-first register. (1) resolve git HEAD/branch/repo; (2) call `mcp__rollout_server__build_register_rollout_from_manifest` with `{ feature, projectId, firstParticipant: { repo, branch, commitSha: <HEAD> }, primaryRepo }` only; (3) `assert_register_rollout_args`; (4) `guarded_call` `register_rollout`; (5) lockfile `{ lastStep: "finalize", rolloutId, participantId, role: "creator", diffApplied: true }`. To ship to a different environment than the project default, change the default in the FireWeave UI (Environments → Save pipeline) first — do not override via tool args. |
| **5 — Ramp on the deploy-liveness gate** | The `awaiting-deploys → ramping` gate is dual-source: the boot **stamp beacon** (`stamps[]`, exact `stampId` match) advances the participant, and/or the GitHub `deployment_status` webhook (SHA-containment) where a `commitSha` is present. The real autonomous engine then takes over — durable Restate soak, `ramping → completed`, guardrails govern auto-promote/rollback via `flag.control`. |

Every clarification uses `request_user_input` — never raw open-ended prompts.

## Environment resolution (do not override)

| Concern | Source | Agent action |
|---|---|---|
| **Rollout target** (`register_rollout` `environment`) | FireWeave UI default (`isDefault`) → API → `.fireweave/project.json` | **Never pass `environment`** to `build_register_rollout_from_manifest` or `register_rollout` |
| **Prod-path binding lookup** (`verify_prod_path`) | First prod-tier slug in `project.json` `rolloutReady.environments` | **Never pass `targetEnvironment`** — tool auto-resolves prod-tier for PostHog binding |

Passing `environment: "stage"` (or any prod-tier slug) when the UI default is `dev` is a common agent mistake — the MCP server rejects it.

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure_auth", "server": "rollout-server" },
    { "name": "select_project", "server": "rollout-server" },
    { "name": "list_registered_tools", "server": "rollout-server" },
    { "name": "guarded_call", "server": "rollout-server" },
    { "name": "detect_rollout_ready", "server": "rollout-server" },
    { "name": "reconcile", "server": "rollout-server" },
    { "name": "verify_prod_path", "server": "rollout-server" },
    { "name": "build_register_rollout_from_manifest", "server": "rollout-server" },
    { "name": "assert_register_rollout_args", "server": "rollout-server" },
    { "name": "eject", "server": "rollout-server" }
  ]
}
```
