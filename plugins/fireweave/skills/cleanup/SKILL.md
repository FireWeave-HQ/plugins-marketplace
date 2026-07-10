---
name: cleanup
description: Manual flag/metric-debt retirement for FireWeave Rollouts. Finds measured-DEAD stable changes (flag at 100% + zero recent off-branch evaluations) and proposes retiring the flag, removing the dead flag-off branch, archiving the change-stamp, and retiring associated guardrail/adoption metrics. Use when the user asks to "clean up old flags", "retire stable rollouts", "remove dead feature flags", or invokes `/fireweave:cleanup`. Replaces the autonomous stability→deprecation reconciliation.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-cleanup
  cline: fw-cleanup
  codex: fw_cleanup
---

# Cleanup (measured-dead flag retirement)

The **only** lifecycle/retirement mechanism (the autonomous stability→deprecation
reconciliation is dropped). Deprecation is gated on **measured deadness**, never
an asserted status: a flag is retirable only when it is at **100%** AND has
**zero recent off-branch evaluations**. Cleanup proposes — it never auto-deletes.

## Step 0 — Auth precondition

Run `mcp__rollout-server__ensure_auth` (authenticated profile + bound project);
on failure → `fw login` then `mcp__rollout-server__select_project`, and PARK.

## Steps

| Step | Action |
|---|---|
| **1 — Find candidates** | Run `mcp__rollout-server__find_cleanup_candidates`. Supply a `measure` callback that queries PostHog in the **completed rollout's environment** (resolve via `GET /v1/rollouts/:id` → `environment`, then `get_project_capabilities` with that env for `posthogProjectId`). Without env-scoped measurement every candidate is `measurementPending`. |
| **2 — Reconcile before removal** | Run `mcp__rollout-server__reconcile` to confirm the flag's manifest entry, code anchor, and stamp are consistent before proposing removal — a measured-dead flag that still has live call-sites must drop its code branch + manifest entry + stamp together (same PR). |
| **3 — Propose retirement** | For each confirmed measured-dead change, propose (via `AskUserQuestion`): retire the flag at the provider, remove the dead flag-off branch, archive `.fireweave/changelog/<stampId>.json` to `_archive/`, and retire the associated guardrail/adoption metrics. Apply only on explicit confirmation. |

Every clarification uses `AskUserQuestion`.

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
