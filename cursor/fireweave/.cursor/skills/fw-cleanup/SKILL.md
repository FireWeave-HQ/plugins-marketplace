---
name: "fw-cleanup"
description: "Manual flag/metric-debt retirement for FireWeave Rollouts. Finds measured-DEAD stable changes (flag at 100% + zero recent off-branch evaluations) and proposes retiring the flag, removing the dead flag-off branch, archiving the change-stamp, and retiring associated guardrail/adoption metrics. Use when the user asks to \"clean up old flags\", \"retire stable rollouts\", \"remove dead feature flags\", or invokes `/fireweave:cleanup`. Replaces the autonomous stability→deprecation reconciliation."
---
> Interaction: there is no skill-callable prompt tool — gate each decision by STOP and ask the user to pick a labelled option (or move the gate into the bundled MCP server via Elicitation).

# Cleanup (measured-dead flag retirement)

The **only** lifecycle/retirement mechanism (the autonomous stability→deprecation
reconciliation is dropped). Deprecation is gated on **measured deadness**, never
an asserted status: a flag is retirable only when it is at **100%** AND has
**zero recent off-branch evaluations**. Cleanup proposes — it never auto-deletes.

## Step 0 — Auth precondition

Run `mcp_rollout-server_ensure_auth` (authenticated profile + bound project);
on failure → `fw login` then `mcp_rollout-server_select_project`, and PARK.

## Steps

| Step | Action |
|---|---|
| **1 — Find candidates** | Run `mcp_rollout-server_find_cleanup_candidates`. It scans `.fireweave/rollout-ready/` manifests for changes whose derived `status` is `stable` (server `RolloutState` = `completed` + soak) and gates each on MEASURED deadness (flag at 100% + zero recent off-branch evals). Without live measurement a candidate is returned `measurementPending` — never propose retiring an unconfirmed flag. |
| **2 — Reconcile before removal** | Run `mcp_rollout-server_reconcile` to confirm the flag's manifest entry, code anchor, and stamp are consistent before proposing removal — a measured-dead flag that still has live call-sites must drop its code branch + manifest entry + stamp together (same PR). |
| **3 — Propose retirement** | For each confirmed measured-dead change, propose (via `a stop-and-ask user prompt`): retire the flag at the provider, remove the dead flag-off branch, archive `.fireweave/changelog/<stampId>.json` to `_archive/`, and retire the associated guardrail/adoption metrics. Apply only on explicit confirmation. |

Every clarification uses `a stop-and-ask user prompt`.

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure_auth", "server": "rollout-server" },
    { "name": "select_project", "server": "rollout-server" },
    { "name": "list_registered_tools", "server": "rollout-server" },
    { "name": "find_cleanup_candidates", "server": "rollout-server" },
    { "name": "reconcile", "server": "rollout-server" }
  ]
}
```
