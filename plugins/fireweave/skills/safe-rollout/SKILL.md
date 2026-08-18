---
name: safe-rollout
description: The no-swap "promote, not wrap" ship path for repos already initialised with FireWeave Rollouts. Detects the rollout-ready manifest + change stamps, verifies the already-generated prod branch (no provider swap), then registers a ramp on the deploy-liveness gate. Use when the user asks to "ship this", "promote the rollout", "ramp the feature", or invokes `/fireweave:safe-rollout` in an initialised repo.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-rollout
  cline: fw-rollout
  codex: fw_rollout
---

# Safe Rollout (promote, not wrap)

This is the ship path for repos that ran `/fireweave:initialise`. The rollout
structure was front-loaded during development (each change is already behind a
standard OpenFeature flag with OTel telemetry + a change-stamp), so shipping is a
**promote, not a wrap**: FireWeave **verifies** the already-generated prod branch
and **registers a ramp** — it never re-analyzes, re-wraps, re-instruments, or
swaps a provider registration (D26). **No functional code changes at promotion.**

> If the repo is not initialised — no `.fireweave/project.json` pointer, or
> `assert_dev_checklist` reports it — run `/fireweave:initialise` first and
> build the rollout-ready package during development; there is no
> wrap-from-scratch ship path. **Do not test for a manifest DIRECTORY:**
> manifests are server rows (`repo_manifests`), authored through
> `upsert_rollout_manifest`. Nothing materialises a tracked file any more — in
> any repo — so the directory's absence proves nothing about whether the repo
> is initialised. It is absent on every initialised repo.
>
> **HARD:** If the feature under ship has no valid rollout-ready package (manifest +
> anchors + stamp), **abort** — run `assert_dev_checklist` and finish the package.
> Do not wrap/backfill during `/safe-rollout`.

## Step 0 — Auth + create-permission + repo-bind precondition (fail closed)

**SCN-16 — hard PARK writes nothing.** Before any lockfile / register artifact /
`.fireweave/.cache/**` write: run the gates below. On hard PARK, leave the
working tree unchanged for FireWeave ship artifacts this run.

Run `mcp__rollout-server__ensure_auth` with
`{ cwd: <absolute open-workspace root> }` (required when known — MCP process
cwd is often not the repo). Three **independent** gates (order matters —
create permission before bind remedies that write disk):

- `ok: false` → no profile: instruct `fw login` (then `fw init`) and PARK —
  **write nothing.**
- **Create permission (SCN-14, flag-aware) BEFORE bind writes.** PARK — **write
  nothing** (no `select_project`, register, or lockfile `rolloutId`) when
  **`create_permission_park.required === true`**. The tool computes it; do not
  re-derive the matrix. It is `true` when:
  - `create_permission.cause === "auth"` → `fw login` / `fw whoami --force`; or
  - `allowed === false` **and** `enforced === true` (hard-block flag on); or
  - `allowed === false` with role `viewer` and no `enforced` field (older server); or
  - `allowed: "unknown"` **and** `enforced === true` — indeterminate while the
    block is live, so writing first would strand artifacts on the server's 503.
    Do **not** PARK on `allowed: "unknown"` with `cause` `unsupported` /
    `unreachable` when `enforced !== true` — continue; late register **403** /
    `PERMISSION_DENIED` is the authoritative refuse. Do **not** PARK when
    `enforced === false` (flag off). Older MCP servers omit
    `create_permission_park` — fall back to the bullets above.
- Continue **ONLY** when `repo_binding.bound === true` **and**
  `repo_binding.orgMatch !== false`. Missing / undefined `repo_binding`
  (older MCP server) → PARK as unbound — only after create permission is clear.

On PARK for create permission: use `create_permission_park.reason` (or: _You don't
have permission to create rollouts — contact an org admin for member access_).
Do **not** run `select_project` while create is denied.

On PARK for bind:

- `bound: false` → `select_project` with the same `{ cwd }` / `fw init`.
- `orgMatch: false` → ask: wrong profile (`fw profile use`) vs stale bind
  (`select_project` with `{ cwd }`) — never blindly rebind a correct binding.

**Never register or write FireWeave ship artifacts while unbound or unauthorized.**

If `guarded_call` → `register_rollout` returns **403** / `PERMISSION_DENIED`
(late refuse): PARK with the same message; **do not** write lockfile
`{ rolloutId }` — leave the working tree unchanged for this step.

Never handle a bearer token or endpoint directly — `fw api` owns auth
end-to-end.

### Step 0.1b — Tool manifest check

Call `mcp__rollout-server__list_registered_tools` and confirm every tool in
`SKILL_EXPECTED_TOOL_MANIFEST` (below) is present. If any is missing, hard-abort
with an upgrade message — the server is older than this skill expects.

## Steps

| Step                                                   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.2 — Dev checklist (fail closed)**                  | Run `mcp__rollout-server__assert_dev_checklist` with `{ feature }`. On any **block** → PARK and refuse to register. Checklist requires manifest + anchors + stamp **and** that every `telemetry.metrics[].name` appears as a real emit (string literal on increment/record/track/capture/…) in wrap-point files — dummy / registry-only metrics hard-fail — **and** SRF-A13 (no direct vendor SDK import/require/dynamic import in wrap points). **RAMP-1:** a boolean `flags[].default` of `true` hard-fails, **and so does a `true` safe default at any eval site of the feature's flags** — scanned repo-wide by flag key, not just in anchored files, with same-file `const` indirection resolved (`fw.flag(key, true, ctx)` serves on when the flag is missing at the provider, whatever the manifest says; an unprovable default warns) — the feature must stay off until ramp, so fix both the manifest and the call site to `false`. **Local ON is `devFlags`, not the eval default:** if dogfood needs the flag on in laptop/dev, set `devFlags: { '<key>': true }` on that surface's `makeDevProvider()`; never leave `fw.flag(key, true)` or invent a new `ramp1Exception`. Legacy inverted kill-switches remediate only via the agent-instructions kill-switch runbook (PostHog 100% ON → verify → flip to `false` → prove kill in staging). Backfill during ship is forbidden.                                                          |
| **1 — Detect manifest + stamps**                       | Read the manifest and the active change stamps through `mcp__rollout-server__detect_rollout_ready` — **never off disk**. The manifest is a server row (`repo_manifests`) and the stamps are `change_stamps`; the tool resolves them through the queue → server → cache chain for you. The committed half is `FW_STAMPS` in `fw-tracker`, which is the one git-visible per-feature line. The manifest may be **schema 1** (one harness + one `change.stampId`) or **schema 2** (`surfaces[]` — one entry per participating surface, each with its OWN `stampId` and `wrapPoints`); a v1 manifest reads as a single synthesised surface entry, so treat both through the same per-surface view. Run `mcp__rollout-server__detect_rollout_ready` to confirm the `// @fireweave-flag <key>` anchors are present for every manifest flag — anchors are checked per surface entry's `wrapPoints`, and EACH surface's `stampId` must be present in that surface's `fw-tracker` `FW_STAMPS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **2 — Reconcile (gate)**                               | Run `mcp__rollout-server__reconcile` with `phase: "ship"` — the `manifest ⇄ (anchor ∪ FW_DUMP ∪ stamp)` gate. A coded-but-unmanifested flag, an orphan manifest entry, or a stamp whose flag is gone all FAIL. Do not proceed on a blocking finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **3 — Verify prod path (NO swap, D26)**                | Run `mcp__rollout-server__verify_prod_path` with `{ feature, projectId }` only — **do not pass `targetEnvironment`**. The tool matches PostHog bindings using the **already-configured** `harness.posthogProjectId` / `rolloutReady.promotionEnvironment` (never "first prod-tier" map order). For a **schema-2** manifest it runs the full checklist **once per `surfaces[]` entry** (each entry against its OWN `harness` block + `telemetry.metrics`), returns per-surface results (`result.surfaces[]`, keyed by `surfaceId` when minted else surface type), and passes only when every entry passes-or-skips; a v1 manifest yields the single-surface result unchanged. Per entry the binding uses that entry's own `harness.posthogProjectId` exactly as v1 does — the per-surface `resolveCapability`/`projects{}` project chain is a **Phase-1 deferral**, not yet wired. Checklist per surface: (1) vendor provider in `isProd()` branch; (2) credential env in `.env.example`; (3) manifest `posthogProjectId` matches bound project; (4) `initFwHarness()` awaited; (5) optional smoke-eval. Unsupported surfaces are **skipped/xfail** (a skip never false-greens).                                                                                                                                                                                                                                                                      |
| **3.5 — No mixed provider calls (SRF-A13)**            | Run `mcp__rollout-server__verify_no_mixed_provider_calls` with `{ feature }` (rollout-ready wrap points — **not** `rolloutId`; there is no scoped rollout yet). On `pass !== true` (any **block** finding) → PARK. Warns alone (e.g. non-TS wrap-point language the scanner cannot analyze) do not PARK — surface them. Fix blocks: remove direct vendor SDK imports / requires / re-exports (`posthog-node`, `posthog-js`, LaunchDarkly, Statsig, Split, …) from wrap-point files; flag eval stays harness OpenFeature-only. `import type` is ignored; `import { type X }` / `import {}` emit a declared warn (verbatimModuleSyntax ambiguity). The harness prod-branch vendor provider (Step 3) is correct — dual-calling that SDK beside OF at the feature wrap point is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **4 — Build + register (single-shot promote)**         | Rollout `environment` is resolved automatically from the FireWeave project default (UI `isDefault` → API → `.fireweave/project.json`). **Never pass `environment` to `build_register_rollout_from_manifest` or `register_rollout`** — mismatches are rejected. **Never** use legacy draft-first register. (1) resolve git HEAD/branch/repo; (2) call `mcp__rollout-server__build_register_rollout_from_manifest` with `{ feature, projectId, firstParticipant: { repo, branch, commitSha: <HEAD> }, primaryRepo }` only; (3) `assert_register_rollout_args`; (4) `guarded_call` `register_rollout`; (5) lockfile `{ lastStep: "finalize", rolloutId, participantId, role: "creator", diffApplied: true }`. To ship to a different environment than the project default, change the default in the FireWeave UI (Environments → Save pipeline) first — do not override via tool args.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **4.5 — Tell the human to SEAL (this skill does not)** | Registering leaves the rollout in `wrapping`. **Sealing is a human act and no skill performs it** — it locks the participant set and provisions the vendor flags, and until somebody does it nothing ramps. This step is a HANDOFF, not a tool call: once the participating PRs are merged, tell the user in plain words to open **Rollouts → this rollout → Seal** in the FireWeave dashboard, and say that the ramp will not start until they do. Report the rollout as _registered, awaiting seal_ — never as "shipped". Omitting this is how a rollout sits untouched for days: every automated surface reads `wrapping`, which looks like healthy progress.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **5 — Ramp on the deploy-liveness gate**               | After the human seals. The `awaiting-deploys → ramping` gate advances on the GitHub `deployment_status` webhook (SHA-containment) where a `commitSha` is present — deploy attestation is retired, so freshly scaffolded harnesses emit nothing themselves (the server still accepts legacy boot-beacon wires from harnesses scaffolded before the retirement, but do not scaffold or recommend one). A **schema-2** (multi-surface) rollout advances to `ramping` only when EVERY participating surface is live, not on the first one. **The gate holds indefinitely and that is by design:** a participant that never deploys does not time the gate out — the deploy tracker's 7-day `onTimeout` settles the tracker, not the gate, and liveness is read from `deployState`. The only ways out are a human clicking **Start ramp** (the sanctioned bypass, offered whenever the rollout is `sealed` or `awaiting-deploys`) or cancelling. Do not treat a long wait here as a fault; the rollouts list and the rollout page both show it as _waiting_. The real autonomous engine then takes over — the **pipekit** ramp pipeline (`rollout:<rolloutId>`, pipeline `safe-rollout`) drives stage → soak → decide, `ramping → completed`, and guardrails govern auto-promote/rollback via `flag.control`. pipekit runs _on_ Restate as its transport; the old `rollout-controller` workflow is deleted, so nothing here addresses a workflow by name. |

Every clarification uses `AskUserQuestion` — never raw open-ended prompts.

## Environment resolution (do not override)

| Concern                                               | Source                                                                                              | Agent action                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Rollout target** (`register_rollout` `environment`) | FireWeave UI default (`isDefault`) → API → `.fireweave/project.json`                                | **Never pass `environment`** to `build_register_rollout_from_manifest` or `register_rollout` |
| **Prod-path binding lookup** (`verify_prod_path`)     | Manifest `harness.posthogProjectId` → matching `rolloutReady.environments` / `promotionEnvironment` | **Never pass `targetEnvironment`** — do not invent a different PostHog project               |

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
    { "name": "verify_no_mixed_provider_calls", "server": "rollout-server" },
    {
      "name": "build_register_rollout_from_manifest",
      "server": "rollout-server"
    },
    { "name": "assert_register_rollout_args", "server": "rollout-server" },
    { "name": "assert_dev_checklist", "server": "rollout-server" },
    { "name": "eject", "server": "rollout-server" }
  ]
}
```
