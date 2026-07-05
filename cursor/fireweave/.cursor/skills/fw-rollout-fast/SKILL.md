---
name: "fw-rollout-fast"
description: "The no-swap \"promote, not wrap\" ship path for repos already initialised with FireWeave Rollouts. Detects the rollout-ready manifest + change stamps, verifies the already-generated prod branch (no provider swap), then registers a ramp on the deploy-liveness gate. Use when the user asks to \"ship this\", \"promote the rollout\", \"ramp the feature\", or invokes `/fireweave:safe-rollout-fast` in a repo containing `.fireweave/rollout-ready/`."
---
> Interaction: there is no skill-callable prompt tool — gate each decision by STOP and ask the user to pick a labelled option (or move the gate into the bundled MCP server via Elicitation).

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

Run `mcp_rollout-server_ensure_auth`. It verifies an authenticated `fw` profile
**and** a bound project (`.fireweave/project.json` `orgId` + `projectId`). On
failure, instruct the user to run `fw login` then `fw init` / and call
`mcp_rollout-server_select_project`, and PARK until both are satisfied. Never
handle a bearer token or endpoint directly — `fw api` owns auth end-to-end.

### Step 0.1b — Tool manifest check

Call `mcp_rollout-server_list_registered_tools` and confirm every tool in
`SKILL_EXPECTED_TOOL_MANIFEST` (below) is present. If any is missing, hard-abort
with an upgrade message — the server is older than this skill expects.

## Steps

| Step | Action |
|---|---|
| **1 — Detect manifest + stamps** | Read `.fireweave/rollout-ready/<feature>.json` (the load-bearing committed contract) and the active change stamps in `.fireweave/changelog/` + `fw-tracker`. Run `mcp_rollout-server_detect_rollout_ready` to confirm the `// @fireweave-flag <key>` anchors are present for every manifest flag. |
| **2 — Reconcile (gate)** | Run `mcp_rollout-server_reconcile` with `phase: "ship"` — the `manifest ⇄ (anchor ∪ FW_DUMP ∪ stamp)` gate. A coded-but-unmanifested flag, an orphan manifest entry, or a stamp whose flag is gone all FAIL. Do not proceed on a blocking finding. |
| **3 — Verify prod path (NO swap, D26)** | Run `mcp_rollout-server_verify_prod_path`. The 5-point checklist: (1) the named vendor provider is imported + called in the `isProd()` branch; (2) the credential env var is present + in `.env.example`; (3) the app `posthogProjectId` equals the bound one (phantom-ramp guard); (4) `initFwHarness()` is awaited from the recorded entrypoint; (5) optional gated smoke-eval. A surface with no vendor provider is **skipped/xfail** (recorded gap, never a false-green). |
| **4 — Build + register (single-shot promote)** | **Never** use legacy draft-first register (`commitSha: null` with empty flags/spec). Instead: (1) resolve `git rev-parse HEAD`, `git symbolic-ref --short HEAD`, and `git remote get-url origin` → `org/repo`; (2) call `mcp_rollout-server_build_register_rollout_from_manifest` with `{ feature, projectId, environment, primaryRepo, firstParticipant: { repo, branch, commitSha: <HEAD> } }`; (3) call `mcp_rollout-server_assert_register_rollout_args` on the returned `args` — if `completeness.ok` is false, STOP; (4) call `mcp_rollout-server_guarded_call` with `{ toolName: "register_rollout", args: <from step 2>, isConfigurationStep: true, expectedResponseSchema: "RegisterRolloutResult" }`; (5) on success write lockfile `{ lastStep: "finalize", rolloutId, participantId, role: "creator", diffApplied: true }` — **never** `lastStep: "created"` with `diffApplied: false` on this path. |
| **5 — Ramp on the deploy-liveness gate** | The `awaiting-deploys → ramping` gate is dual-source: the boot **stamp beacon** (`stamps[]`, exact `stampId` match) advances the participant, and/or the GitHub `deployment_status` webhook (SHA-containment) where a `commitSha` is present. The real autonomous engine then takes over — durable Restate soak, `ramping → completed`, guardrails govern auto-promote/rollback via `flag.control`. |

Every clarification uses `a stop-and-ask user prompt` — never raw open-ended prompts.

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
