---
name: safe-rollout
description: Wraps new code in a Fireweave-managed feature flag with cohort-keyed metrics, logs, traces, and alerts; persists configuration; registers a Restate-backed agent controller that ramps the rollout safely with auto-promote/rollback. Use when the user asks to "add a feature flag", "wrap this with telemetry", "set up a safe rollout", "ramp deployment", or invokes `/fireweave:safe-rollout`.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-rollout
  cline: fw-rollout
  codex: fw_rollout
---

# Wrap with Rollout

You are about to wrap new code behind one OR MORE Fireweave-managed feature
flags with the right cohort-keyed telemetry so a Restate-backed controller
can ramp them safely. **Follow the steps in order. Use `AskUserQuestion`
for every clarification — never raw open-ended text prompts.**

### Multi-flag rollouts

A rollout can ramp N flags together. Each wrap point binds to exactly ONE
flag via its `flagKey` field. All flags in a rollout ramp at the same
percentage — the controller calls `feature-flag.control.updateRolloutPercentage`
per flag, with per-flag idempotency keys. Cross-provider partial failure
emits a `rollout.flag-toggle-failed` page alert per failed flag and blocks
forward progress until the operator acks.

**When to use multiple flags**: related features that should ramp together
(e.g. UI variant + backend variant of the same experiment). The rollout
state machine treats them as one unit.

**When NOT to use multiple flags**: independent experiments. Use separate
rollouts so they can be paused/rolled back independently.

## Tool surfaces

This skill works across **two** surfaces:

- **`rollout-server`** — a local stdio MCP server (configured in
  `.mcp.json`). It owns every operation that genuinely requires the
  developer's local filesystem or git tree: the lockfile, confirmation
  receipts, the preferences file, baseline detection, code-tagging,
  `analyze_codebase`, `generate_wrapper`, the seven `verify_*` tools that
  inspect local code, and `guarded_call`. Tools surface as
  `mcp__rollout-server__<name>`.

- **`fw api`** — the `fw` CLI's hidden, authenticated REST passthrough to
  fw-server. Invoke it via `Bash: fw api <METHOD> <path> [--body '<json>']`.
  It prints exactly one JSON line: on success the response body, on failure
  `{ "error": { "httpStatus": N, "message": "..." } }` together with a
  non-zero exit code. The CLI owns authentication end-to-end — it attaches
  the bearer token and silently refreshes it on a 401 — so the skill **never
  handles a bearer token, never sees an `Authorization` header, and never
  configures an endpoint**. Cloud reads call `fw api` directly via `Bash`;
  cloud writes/config go through `guarded_call` (which shells out to
  `fw api` for you) so failures are classified and half-state is recorded.

**Cloud operations** (the `guarded_call` dispatch table; pinned in the
rollout-server's `cloud-op-manifest`). Writes/config (`isConfig`, always
via `guarded_call`): `register_rollout`, `add_rollout_participant`,
`update_participant_sha`, `withdraw_participant`, `update_rollout_spec`,
`finalize_rollout`, `seal_rollout`, `cancel_rollout`, `record_pr_url` —
nine ops. Reads (call `fw api` directly): `get_rollout_status`
(`GET /v1/rollouts/{id}`), `list_open_rollouts`, `list_project_repos`,
`list_project_environments`, `get_project_capabilities`,
`get_environment_capabilities`, `resolve_environment_for_branch`,
`get_recommendation_data` — six ops. Path params in `{braces}` are passed
as flat args (e.g. `id`, `participantId`) and consumed into the URL; the
remaining args form the request body.

**Auth**: authentication is fully owned by the `fw` CLI. The
`fw-auth-gate.sh` hook guarantees a fresh token before this skill runs and
`fw api` refreshes tokens on its own, so you do NOT handle 401s in the happy
path. If `fw api` ever exits non-zero with `{ error: { httpStatus: 401 } }`
mid-skill (token revoked, network anomaly), abort cleanly with: _"`fw api`
returned 401 mid-skill. Run `fw doctor` then retry `/fw-rollout`."_

`fw api` resolves the profile pinned for this repo (personal pin in gitignored `.fireweave/local.json`, org-match against committed `.fireweave/project.json` otherwise); `--profile <alias>` overrides for one call. The skill never selects profiles itself.

**On any `fw api` read failure** (non-zero exit / an `{ error: { httpStatus
} }` envelope on stdout), surface the error to the user and stop — do NOT
invent data. On success, parse the JSON printed on stdout.

**Never invent file paths, flag keys, metric queries, or rollout IDs.** Use
the tools for every decision.

## Step 0 (resume guard) — runs BEFORE everything else

The skill may have been interrupted by a process crash, an IDE restart, a
`/clear`, or an explicit user abort. Before doing anything else, call
`mcp__rollout-server__read_lockfile` and branch on the result.

### If the lockfile exists

Decide based on `state.lastStep`:

- `lastStep === 'discovery'` — silently restart from Step 0.1 below
  (cheap to redo; no working-tree edits to reconcile).
- `lastStep === 'codegen' && !state.diffApplied` — silently restart from
  **Step 5** (codegen). The proposal is captured in `state.workingSpec`;
  rehydrate it instead of re-prompting from scratch.
- `lastStep === 'codegen' && state.diffApplied` —

  > **Gate `GATE-0-RESUME-DECISION`** — required.
  >
  > 1. Call `AskUserQuestion` with the question and options below.
  > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
  >    `{ gateId: 'GATE-0-RESUME-DECISION', questionHash, selectedOption,
stepNumber: '0' }`.
  > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0-RESUME-DECISION`** — call `AskUserQuestion`:
- Q: Diffs from a previous run are in your working tree. What would you like to do?
- Options:
  - Confirm and continue (Recommended)
  - Revert and start over
  Then act on the selected option:
  - **Confirm and continue** → jump to **Step 8** (verify).
  - **Revert and start over** → run `git restore` on the files listed in
    `state.workingSpec.wrapPoints[].file`; call
    `mcp__rollout-server__clear_lockfile`; restart from Step 0.1.

- `lastStep === 'summary'` — jump to **Step 8.5** (re-show summary preview).
- `lastStep === 'created' && state.rolloutId` — the draft rollout already
  exists server-side (state `drafting`); the local work (wrap points,
  metrics, codegen) may be incomplete. Branch on `state.diffApplied`:

  - **`state.diffApplied === true`** — diffs from the previous run are in
    the working tree; present `GATE-0-RESUME-DECISION` (the diffs
    question) with the draft-aware option set:

    > **Gate `GATE-0-RESUME-DECISION`** — required.
    >
    > 1. Call `AskUserQuestion` with the question and options below.
    > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
    >    `{ gateId: 'GATE-0-RESUME-DECISION', questionHash, selectedOption,
stepNumber: '0' }`.
    > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0-RESUME-DECISION`** — call `AskUserQuestion`:
- Q: Diffs from a previous run are in your working tree. What would you like to do?
- Options:
  - Resume the draft rollout (Recommended)
  - Cancel draft rollout
  - Withdraw my participation
  - _Offer "Withdraw my participation" ONLY when state.participantId is present AND get_rollout_status shows more than one participant — the server never removes the last participant._

  - **`state.diffApplied` is `false` or absent** — there are NO diffs to
    decide about, so the diffs question above would be nonsense. Present
    `GATE-0-DRAFT-RESUME` instead (same option semantics, draft-focused
    question):

    > **Gate `GATE-0-DRAFT-RESUME`** — required.
    >
    > 1. Call `AskUserQuestion` with the question and options below.
    > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
    >    `{ gateId: 'GATE-0-DRAFT-RESUME', questionHash, selectedOption,
stepNumber: '0' }`.
    > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0-DRAFT-RESUME`** — call `AskUserQuestion`:
- Q: A draft rollout '<name>' from a previous run is open. Continue, cancel it, or withdraw?
- Options:
  - Continue (Recommended)
  - Cancel draft rollout
  - Withdraw my participation
  - _Offer "Withdraw my participation" ONLY when state.participantId is present AND get_rollout_status shows more than one participant — the server never removes the last participant. Substitute <name> with the rollout name from get_rollout_status._

  Then act on the selected option (identical handling for both gates;
  "Continue" and "Resume the draft rollout" are the same action):
  - **Resume the draft rollout / Continue** → branch on `state.role`:
    - `role === 'joiner'` → resume at **Step 1** (feature surface): a
      joiner inherited the rollout's flags/providers/plan at join time
      and still needs to walk THIS repo's wrap points and metrics.
    - `role === 'creator'` (or absent — legacy lockfiles without `role`
      were only ever written on the CREATE path) → resume at **Step 3**
      (rollout style): the draft register at Step 2.5 already captured
      metadata; Steps 3–9 fill in the spec and finalize.
  - **Cancel draft rollout** → this is a **Configuration step** — call
    `cancel_rollout` via `guarded_call` (`mcp__fireweave-api__`,
    `cancel_rollout`, args `{ id: <rolloutId>,
    reason: 'draft cancelled by user from resume guard' }`,
    `isConfigurationStep: true, expectedResponseSchema:
    'CancelRolloutResult' }`). On `{ ok: true }`, call
    `mcp__rollout-server__clear_lockfile`; the skill ends here.
  - **Withdraw my participation** → this is a **Configuration step** —
    call `withdraw_participant` via `guarded_call`
    (`mcp__fireweave-api__`, `withdraw_participant`, args
    `{ id: <rolloutId>, participantId: <state.participantId> }`,
    `isConfigurationStep: true, expectedResponseSchema:
    'WithdrawParticipantResult' }`). The server removes this repo's
    participant while the rollout is `drafting`/`wrapping` (never the
    last one). On `{ ok: true }`, call
    `mcp__rollout-server__clear_lockfile`; the skill ends here.
- `lastStep === 'finalize' && state.rolloutId` — run
  `Bash: fw api GET /v1/rollouts/<rolloutId>` (get_rollout_status):
  - If `state === 'wrapping'` (or further along) — finalize completed,
    but the crash may have hit BEFORE the post-finalize work. Do not
    skip straight to Step 10; finish Step 9's tail first:
    1. Check whether the baseline tag already exists:
       `Bash: git tag -l fw-rollout/<rolloutId>`. If empty, run the
       `tag_baseline_commit` Configuration step exactly as documented
       at the end of Step 9 (via `guarded_call`). If the tag exists,
       the baseline is already tagged — skip.
    2. Present Sub-step 9.1's `GATE-9-COMMIT-AND-PR` offer (skip it
       only if its receipt is already present in
       `state.userConfirmations`).
    3. Then continue to **Step 10** (final summary).
  - Otherwise (still `drafting`) — the crash happened mid-Step-9; re-run
    Step 9's three Configuration calls in order
    (`update_participant_sha` → `update_rollout_spec` →
    `finalize_rollout`). This is safe: `update_participant_sha` is
    idempotent, `update_rollout_spec` is CAS-guarded by
    `expectedSpecVersion`, and `finalize_rollout` re-validates before
    transitioning.
- `lastStep === 'register' && state.rolloutId` — LEGACY: written by
  pre-draft-first skill versions (single-shot register). Jump to the
  **post-register status path**: run
  `Bash: fw api GET /v1/rollouts/<rolloutId>` with the recorded
  `rolloutId`, render the current state, and offer the appropriate
  action buttons (Cancel for non-terminal, ack-alerts always available).

### If no lockfile exists (scoped-file recovery)

A missing lockfile does not always mean "no work in progress" — the
gitignored cache may have been wiped (fresh clone, `git clean`). Before
restarting cold, check the committed scoped files:

1. List `.fireweave/rollouts/*.json`. If none exist, proceed to Step 0.1
   normally.
2. For each file whose `rolloutId` is non-null, read `projectId` from
   `.fireweave/project.json` and run
   `Bash: fw api GET /v1/projects/<projectId>/rollouts`. If that
   rollout appears with an open state (`drafting` or `wrapping`):
3. Recover the `participantId`: run
   `Bash: fw api GET /v1/rollouts/<rolloutId>` (get_rollout_status) and
   match `participants[]` on this repo (`git remote get-url origin`
   parsed to `org/repo`) + branch (`git symbolic-ref --short HEAD`).
4. Recover the `role`: `'creator'` when this repo matches the rollout's
   `primaryRepo`, otherwise `'joiner'`.
5. Write the lockfile
   `{ lastStep: 'created', rolloutId, participantId, role,
   diffApplied: false }` and resume exactly as the
   `lastStep === 'created'` branch above — with `diffApplied: false`
   that branch presents `GATE-0-DRAFT-RESUME` (no diffs question).

If no participant matches this repo+branch, treat the open rollout as
someone else's and proceed to Step 0.1 normally (the join path at
Step 0.2 will offer it).

### Force-push detection

If the lockfile has a `rolloutId`, also check for branch-HEAD divergence
before resuming:

1. Run `Bash: fw api GET /v1/rollouts/<rolloutId>` and parse the JSON.
2. Find the participant for THIS repo by matching `participant.repo` against
   `git remote get-url origin` (parsed to `org/repo`).
3. If the matching participant's recorded `commitSha` is `null` — a draft
   participant whose SHA has not been captured yet (that happens at
   Step 9) — **SKIP force-push detection entirely** and continue with the
   resume flow: there is nothing to compare.
4. Otherwise compare `participant.commitSha` against the current
   `git rev-parse HEAD`.
5. If they DIFFER (rebase / amend / force-push since register-time):

   > **Gate `GATE-0-FORCE-PUSH-DECISION`** — required.
   >
   > 1. Call `AskUserQuestion` with the question and options below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0-FORCE-PUSH-DECISION', questionHash, selectedOption,
stepNumber: '0' }`.
   > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0-FORCE-PUSH-DECISION`** — call `AskUserQuestion`:
- Q: Branch HEAD changed since this rollout was registered (was `<oldSha[:7]>`, now `<newSha[:7]>`). Update the participant SHA?
- Options:
  - Yes, update (Recommended)
  - No, abort and start fresh
   Then act on the selected option:
   - **Yes, update** → this is a **Configuration step** — call via `guarded_call`:
     1. Resolve the underlying tool name and server prefix
        (`mcp__fireweave-api__`, `update_participant_sha`).
     2. Call `mcp__rollout-server__guarded_call` with
        `{ serverPrefix, toolName, args: { id: <rolloutId>, participantId,
        repo, branch, newSha: <git rev-parse HEAD> },
        isConfigurationStep: true,
        expectedResponseSchema: 'UpdateParticipantShaResult' }` (`id` +
        `participantId` fill the route path; `{ repo, branch, newSha }`
        is the body).
     3. If the response shape is `{ error: { code, ... } }`, print the
        `remediation` field verbatim and stop. Do not retry, do not call the
        underlying tool directly, do not call another tool.
     4. If the response shape is `{ ok: true, result }`, use `result` as if it
        were the underlying tool's return value.
   - **No, abort and start fresh** → clearing the local lockfile does NOT
     remove the server-side rollout, so first reconcile the live row
     (state was read in step 1 above):
     - If `state === 'drafting'` — this is a **Configuration step** —
       call `cancel_rollout` via `guarded_call` (`mcp__fireweave-api__`,
       `cancel_rollout`, args `{ id: <rolloutId>,
       reason: 'draft abandoned after force-push divergence' }`,
       `isConfigurationStep: true, expectedResponseSchema:
       'CancelRolloutResult' }`) so no orphaned draft is left open.
     - Otherwise — tell the user verbatim: _"The rollout `<rolloutId>`
       remains open server-side (state `<state>`). Cancel it from the
       Rollouts tab, or re-run `/fireweave:safe-rollout` and choose
       Cancel."_
     Then call `mcp__rollout-server__clear_lockfile`; the user can start
     fresh from Step 0.1.

### Pre-seal spec-delta on re-run

If the lockfile carries a `rolloutId` AND `get_rollout_status` reports the
rollout is still pre-seal (state is `drafting` or `wrapping`), re-running the
skill against an edited worktree must surface the new wrap-points / threshold
changes before any further step proceeds. The rollout spec is mutable ONLY in
the `drafting` and `wrapping` states — once the rollout is `sealed`,
`ramping`, `completed`, or `rolled-back`, the spec is frozen per CL6 and the
only option presented is "Start a new rollout" (covered below).

1. Run `Bash: fw api GET /v1/rollouts/<rolloutId>` and read
   `rollout.state`, `rollout.specVersion` (the CAS counter, exposed on the
   `rollout` object of the response), and the registered spec.
2. If `state === 'drafting'`, **SKIP the spec-delta check entirely** and
   continue from Step 0.1 — the server-side spec is intentionally empty
   until Step 9 syncs it (`update_rollout_spec` runs there), so diffing
   the worktree against it would falsely report every wrap-point as new.
3. If `state === 'wrapping'`, we diff the current worktree against
   the registered spec (wrap-points added, removed, threshold or cohort-key
   changes). If the diff is non-empty, render a delta panel showing each
   change.

   > **Gate `GATE-0-SPEC-DELTA-DECISION`** — required when the diff is
   > non-empty.
   >
   > 1. Call `AskUserQuestion` with the delta-panel summary and the options
   >    below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0-SPEC-DELTA-DECISION', questionHash, selectedOption,
stepNumber: '0' }`.
   > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0-SPEC-DELTA-DECISION`** — call `AskUserQuestion`:
- Q: Your worktree diverges from the registered spec. Apply the delta to this rollout?
- Options:
  - Yes, update the spec (Recommended)
  - No, keep the registered spec
   Then act on the selected option:
   - **Yes, update the spec** → this is a **Configuration step** — call via
     `guarded_call`:
     1. Resolve the underlying tool name and server prefix
        (`mcp__fireweave-api__`, `update_rollout_spec`).
     2. Call `mcp__rollout-server__guarded_call` with
        `{ serverPrefix, toolName, args: { id: <rolloutId>, deltaJson,
        expectedSpecVersion: rollout.specVersion }, isConfigurationStep: true,
        expectedResponseSchema: 'UpdateRolloutSpecResult' }`.
     3. On `{ error: { code: 'conflict', ... } }`, print the `remediation` field
        verbatim and stop. The skill will re-read state on the next invocation.
     4. On `{ ok: true, result: { specVersion } }`, surface the new
        `specVersion` and continue from Step 0.1.
   - **No, keep the registered spec** → ignore the local edits and continue from
     Step 0.1.

4. If `state ∉ { drafting, wrapping }` — the rollout is sealed or further
   along — the spec is frozen per CL6. Do NOT attempt `update_rollout_spec`.
   Instead:

   > **Gate `GATE-0-SEALED-RERUN-DECISION`** — required.
   >
   > Present a single option only.

**Gate `GATE-0-SEALED-RERUN-DECISION`** — call `AskUserQuestion`:
- Q: This rollout is `<state>` and its spec is frozen. What would you like to do?
- Options:
  - Start a new rollout
   Then act on the selected option:
   - **Start a new rollout** → call `mcp__rollout-server__clear_lockfile`;
     restart the skill from Step 0.1 with a fresh lockfile.

After the resume guard completes (or if no lockfile was found and the
scoped-file recovery found nothing to resume), proceed to Step 0.1 below.
**At every step boundary from here on, write the lockfile via
`mcp__rollout-server__write_lockfile` so the next interruption resumes
from the right place.** After `finalize_rollout` succeeds at Step 9 and
Step 10's summary is rendered, call `mcp__rollout-server__clear_lockfile`
to mark the work complete.

## Step 0.1 — Preflight (deterministic, via `fw` CLI)

Auth and project binding are guaranteed by the `fw-auth-gate.sh` hook
that fired when this skill was invoked — by the time you read this, the
user is authenticated and has a project bound. You do **NOT** need to
call `whoami`, list projects, or run a device flow. Those are now CLI
responsibilities, not LLM judgment.

Run `Bash: fw status --machine-readable` and parse the JSON. Bind the
returned `org`, `project`, `tokenExpiresAt`, and `profileSource` into your
working memory. Cloud operations are reached through the `fw api` REST
passthrough (`Bash: fw api <METHOD> <path>`) — reads call it directly,
writes/config go through `guarded_call`. Three local rollout-server tools
(`extract_diff_surface`, `recommend_rollout_strategy`, `propose_metrics`)
run entirely on this machine and are reached via
`mcp__rollout-server__<name>` — they are stable local tools, not cloud
forwarders.

If for some reason `fw status` returns `ready: false` despite the hook
having fired (race condition, env-var clearing mid-session, network
blip), print the `remediation` array to the user and abort the skill
cleanly with:

> "Fireweave preflight unexpectedly invalid. Please run `fw doctor` and
> try again."

**Profile-binding check.** After parsing `fw status`, check whether this
repo pins a profile using the `Read` tool:

1. Read `.fireweave/local.json` via the `Read` tool (the file may be
   absent — that is not an error).
2. If the file is absent or has no `profile` key, read
   `.fireweave/rollout.config.json` via the `Read` tool (legacy v1
   binding; also not an error if absent).

The pinned alias is `profile` from `local.json` when present; otherwise
`profile` from `rollout.config.json`. This precedence also resolves any
`<alias>` ambiguity in the message below.

`global-default` and `sole` mean the CLI ignored the repo's binding files
entirely — a current `fw` binary fail-closes in a bound repo, so either
value here indicates a stale binary.

If a binding exists AND `profileSource` ∈ {`global-default`, `sole`}:

- If the resolved `profile` from `fw status` is **different** from the
  pinned alias → abort with:

  _"This project pins a profile but the CLI resolved '<alias>' via
  <profileSource>. Upgrade fw (`fw self-update`) then re-run, or run
  `fw init` to re-bind."_

  (Substitute `<alias>` with the pinned alias from the binding file, and
  `<profileSource>` with the literal string returned by `fw status`.)

- If the resolved `profile` from `fw status` **equals** the pinned alias
  → print a one-line warning:

  _"fw resolved the right profile but via `<profileSource>` — your fw
  binary predates project-pinned profiles; run `fw self-update` soon."_

  and **continue**.

If no binding file is found, or `profileSource` is any other value
(`flag`, `local`, `repo`, `org-match`), the profile resolved correctly —
continue to Step 0.1b.

## Step 0.1b — MCP manifest check

Call `mcp__rollout-server__list_registered_tools`.

Compare the result against `SKILL_EXPECTED_TOOL_MANIFEST` (declared
inline below). If any expected tool is missing, registered on the
wrong server, or any unknown tool is registered on a server that the
skill calls into (and a downstream call might shadow a known name),
hard-abort with code `MANIFEST_MISMATCH` and a list of differences.

Cloud operations are reached via `fw api` (the `fw` CLI), not an MCP
server, so there is no cloud tool manifest to verify.

This sub-step is the only place the skill is allowed to enumerate
MCP server contents; downstream steps assume the manifest is correct.

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "read_lockfile", "server": "rollout-server" },
    { "name": "write_lockfile", "server": "rollout-server" },
    { "name": "clear_lockfile", "server": "rollout-server" },
    { "name": "write_confirmation_receipt", "server": "rollout-server" },
    { "name": "read_confirmation_receipts", "server": "rollout-server" },
    { "name": "guarded_call", "server": "rollout-server" },
    { "name": "get_tool_usage_counts", "server": "rollout-server" },
    { "name": "list_registered_tools", "server": "rollout-server" },
    { "name": "ensure_auth", "server": "rollout-server" },
    { "name": "select_project", "server": "rollout-server" },
    { "name": "detect_baseline", "server": "rollout-server" },
    { "name": "analyze_codebase", "server": "rollout-server" },
    { "name": "generate_wrapper", "server": "rollout-server" },
    { "name": "read_preferences", "server": "rollout-server" },
    { "name": "write_preferences", "server": "rollout-server" },
    { "name": "tag_baseline_commit", "server": "rollout-server" },
    { "name": "verify_cohort_keying", "server": "rollout-server" },
    { "name": "verify_no_orphan_flags", "server": "rollout-server" },
    { "name": "verify_safe_defaults", "server": "rollout-server" },
    { "name": "verify_no_mixed_provider_calls", "server": "rollout-server" },
    { "name": "verify_telemetry_completeness", "server": "rollout-server" },
    { "name": "verify_rollout_config_schema", "server": "rollout-server" },
    { "name": "verify_provider_health", "server": "rollout-server" },
    {
      "name": "recommend_rollout_strategy",
      "server": "rollout-server"
    },
    {
      "name": "propose_metrics",
      "server": "rollout-server"
    },
    {
      "name": "extract_diff_surface",
      "server": "rollout-server"
    }
  ]
}
```

After the manifest check passes, proceed to Step 0.2.

## Step 0.2 — Project discovery (still needed; CLI doesn't handle these)

Mode and project come from `fw status` (Step 0.1). The remaining
discovery calls below need server state at skill-run time, so they stay
in the skill:

1. **Multi-rollout coexistence (D21).** Run
   `Bash: fw api GET /v1/projects/<projectId>/rollouts` and parse the JSON.
   If any open rollouts exist (`state ∈ {drafting, wrapping}`):

   > **Gate `GATE-0.2-JOIN-OR-CREATE`** — required.
   >
   > 1. Call `AskUserQuestion` with the question and options below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-JOIN-OR-CREATE', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-JOIN-OR-CREATE`** — call `AskUserQuestion`:
- Q: Open rollouts in this project — join an existing one or start fresh?
- Options:
  - Create a new rollout (Recommended)
  - _plus one entry per open rollout (showing name + state + primary_dev)_
   On selecting an existing rollout (**join**), the skill becomes the JOIN
   path, not the CREATE path:

   1. This is a **Configuration step** — call `add_rollout_participant`
      via `guarded_call`:
      1. Resolve the underlying tool name and server prefix
         (`mcp__fireweave-api__`, `add_rollout_participant`).
      2. Call `mcp__rollout-server__guarded_call` with
         `{ serverPrefix, toolName, args: { id: <selected rolloutId>,
         repo: <git remote get-url origin parsed to org/repo>,
         branch: <git symbolic-ref --short HEAD>, commitSha: null },
         isConfigurationStep: true, expectedResponseSchema:
         'AddRolloutParticipantResult' }`. A `null` `commitSha` joins as a
         draft participant — the real SHA is captured at Step 9.
      3. If the response shape is `{ error: { code, ... } }`, print the
         `remediation` field verbatim and stop. Do not retry, do not call
         the underlying tool directly, do not call another tool.
      4. If the response shape is `{ ok: true, result }`, capture
         `result.participantId`.
   2. Call `mcp__rollout-server__write_lockfile` with
      `{ lastStep: 'created', rolloutId, participantId, role: 'joiner',
      diffApplied: false }` — `role: 'joiner'` makes a later resume
      re-enter at Step 1, not Step 3.
   3. Seed the local rollout file: run
      `Bash: fw api GET /v1/rollouts/<rolloutId>` (get_rollout_status),
      compose this repo's rollout entry from the server spec — inherit
      the rollout's `flags`, `providers`, and rollout plan
      (style/schedule/guardrails) verbatim — then call
      `write_preferences` via `guarded_call` with
      `{ rolloutId, file: <composed entry> }` (plus
      `header: { orgId, projectId, projectName }` only if
      `.fireweave/project.json` does not exist yet).
   4. **Continue at Step 1** (feature surface). The joiner walks the same
      steps to add THIS repo's wrap points and metrics, scoped to the
      same `rolloutId` — but a joiner **MUST NOT change the rollout's
      flag keys or providers**; those are inherited from the rollout
      being joined. Skip Step 2.5 (the rollout already exists) and
      Steps 2's metadata gates (name/type/description are the
      creator's).

2. **Multi-repo coordination (D6).** Run
   `Bash: fw api GET /v1/projects/<projectId>/repos` and parse the JSON. If
   the project has > 1 repo connected:

   > **Gate `GATE-0.2-MULTI-REPO`** — required.
   >
   > 1. Call `AskUserQuestion` with the question and options below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-MULTI-REPO', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-MULTI-REPO`** — call `AskUserQuestion`:
- Q: This project has <N> repos: [...]. You're in <currentRepo>. Does this rollout require coordinated changes in any other repo?
- Options:
  - No, contained to <currentRepo> (Recommended)
  - Yes, also needs: <multi-select sibling repos>
  - Unsure — show me typical patterns
   On **Yes**: collect a free-text "what changes" note per selected sibling. v1
   records these as advisory in the spec; coordination happens via teammates
   running `/fw-rollout` in those repos against the same rolloutId.

3. **Capability discovery.** Run
   `Bash: fw api GET /v1/projects/<projectId>/environments` and read
   `defaultEnvironment` from the response (fall back to
   `.fireweave/project.json` `defaultEnvironment` when absent). Then run
   `Bash: fw api GET /v1/projects/<projectId>/capabilities --query '{"environment":"<defaultEnvironment>"}'`
   and parse the JSON to enumerate which provider implements each capability
   for the **default pipeline stage**. A rollout requires bindings for ALL
   SIX capabilities in that environment. For every capability that has no
   provider, present a per-capability missing-config gate (`AskUserQuestion`
   with the three-option pattern), then record the most recent unbound
   capability in `lastConfigGap` (lockfile field) before proceeding so a
   clean-exit resume can jump straight back to the gap. Walk the list in the
   order shown — the first unbound capability blocks until resolved, then move
   to the next.

   Portal links for missing capabilities MUST target the per-environment
   configure path:
   `https://app.fireweave.ai/projects/${projectId}/configure/environments/<defaultEnvironment>/capabilities/<capability-slug>/`

   The three options for every capability gate are:

   ```yaml
   options:
     - label: 'Open portal at https://app.fireweave.ai/projects/${projectId}/configure/${slug}/'
       description: 'Open the Fireweave portal and bind the capability via the UI; resume `/fireweave:safe-rollout` after binding.'
     - label: 'Cancel rollout'
       description: 'Abort the current /fireweave:safe-rollout invocation cleanly; resumable via lastConfigGap.'
   ```

   The `feature-flag.control` gate additionally offers a managed-PostHog
   shortcut (see capability 3.1 below). The other five capabilities use the
   two-option set above verbatim.

   ### 3.1 — `feature-flag.control`

   If `feature-flag.control` has no provider:

   > **Gate `GATE-0.2-CAPABILITY-FALLBACK-FEATURE-FLAG-CONTROL`** — required.
   >
   > 1. Set `lastConfigGap = 'feature-flag.control'` and write the lockfile.
   > 2. Call `AskUserQuestion` with the question and options below.
   > 3. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-CAPABILITY-FALLBACK-FEATURE-FLAG-CONTROL', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 4. Do not proceed past this point without a successful receipt write.

   > **Note:** Managed PostHog must be enabled via the portal before running this skill.

**Gate `GATE-0.2-CAPABILITY-FALLBACK-FEATURE-FLAG-CONTROL`** — call `AskUserQuestion`:
- Q: No feature-flag provider is connected. Bind one via the portal or cancel?
- Options:
  - Open portal at https://app.fireweave.ai/projects/${projectId}/configure/feature-flag-control/
  - Cancel rollout
   On **Cancel rollout**: exit cleanly; `lastConfigGap` is preserved so a
   subsequent `/fireweave:safe-rollout` invocation resumes here.

   ### 3.2 — `observability.query.metrics`

   If `observability.query.metrics` has no provider:

   > **Gate `GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-METRICS`** — required.
   >
   > 1. Set `lastConfigGap = 'observability.query.metrics'` and write the lockfile.
   > 2. Call `AskUserQuestion` with the question and options below.
   > 3. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-METRICS', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 4. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-METRICS`** — call `AskUserQuestion`:
- Q: No metrics provider is connected for `observability.query.metrics`. Bind one via the portal, or cancel?
- Options:
  - Open portal at https://app.fireweave.ai/projects/${projectId}/configure/observability-query-metrics/
  - Cancel rollout

   ### 3.3 — `observability.query.logs`

   If `observability.query.logs` has no provider:

   > **Gate `GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-LOGS`** — required.
   >
   > 1. Set `lastConfigGap = 'observability.query.logs'` and write the lockfile.
   > 2. Call `AskUserQuestion` with the question and options below.
   > 3. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-LOGS', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 4. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-LOGS`** — call `AskUserQuestion`:
- Q: No logs provider is connected for `observability.query.logs`. Bind one via the portal, or cancel?
- Options:
  - Open portal at https://app.fireweave.ai/projects/${projectId}/configure/observability-query-logs/
  - Cancel rollout

   ### 3.4 — `observability.query.traces`

   If `observability.query.traces` has no provider:

   > **Gate `GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-TRACES`** — required.
   >
   > 1. Set `lastConfigGap = 'observability.query.traces'` and write the lockfile.
   > 2. Call `AskUserQuestion` with the question and options below.
   > 3. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-TRACES', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 4. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-CAPABILITY-FALLBACK-OBSERVABILITY-QUERY-TRACES`** — call `AskUserQuestion`:
- Q: No traces provider is connected for `observability.query.traces`. Bind one via the portal, or cancel?
- Options:
  - Open portal at https://app.fireweave.ai/projects/${projectId}/configure/observability-query-traces/
  - Cancel rollout

   ### 3.5 — `alerts.{create,update,delete}`

   If any of `alerts.create`, `alerts.update`, `alerts.delete` has no
   provider (treat the triple as a single binding — all three must resolve
   to the same alerts provider):

   > **Gate `GATE-0.2-CAPABILITY-FALLBACK-ALERTS`** — required.
   >
   > 1. Set `lastConfigGap = 'alerts.create'` (the canonical slug for the
   >    triple) and write the lockfile.
   > 2. Call `AskUserQuestion` with the question and options below.
   > 3. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-CAPABILITY-FALLBACK-ALERTS', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 4. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-CAPABILITY-FALLBACK-ALERTS`** — call `AskUserQuestion`:
- Q: No alerts provider is connected for `alerts.create`/`alerts.update`/`alerts.delete`. Bind one via the portal, or cancel?
- Options:
  - Open portal at https://app.fireweave.ai/projects/${projectId}/configure/alerts/
  - Cancel rollout

   ### 3.6 — `cicd.commit-was-deployed`

   If `cicd.commit-was-deployed` has no provider:

   > **Gate `GATE-0.2-CAPABILITY-FALLBACK-CICD-COMMIT-WAS-DEPLOYED`** — required.
   >
   > 1. Set `lastConfigGap = 'cicd.commit-was-deployed'` and write the lockfile.
   > 2. Call `AskUserQuestion` with the question and options below.
   > 3. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-0.2-CAPABILITY-FALLBACK-CICD-COMMIT-WAS-DEPLOYED', questionHash, selectedOption,
stepNumber: '0.2' }`.
   > 4. Do not proceed past this point without a successful receipt write.

**Gate `GATE-0.2-CAPABILITY-FALLBACK-CICD-COMMIT-WAS-DEPLOYED`** — call `AskUserQuestion`:
- Q: No CI/CD deploy-tracking provider is connected for `cicd.commit-was-deployed`. Bind one via the portal, or cancel?
- Options:
  - Open portal at https://app.fireweave.ai/projects/${projectId}/configure/cicd-commit-was-deployed/
  - Cancel rollout

   Once all six capabilities resolve, clear `lastConfigGap` on the next
   lockfile write and continue to step 4 below.

4. **Default environment (no picker).** Use `defaultEnvironment` from step 3
   (or `production` when the registry is synthesised-only). Store it in
   `workingSpec.environment` for register. Optionally warn when the current
   git branch maps to a different environment:
   `Bash: fw api POST /v1/projects/<projectId>/resolve-environment --body '{"branch":"<currentBranch>","repo":"<org/repo>"}'`
   — if the resolved `slug` differs from `defaultEnvironment`, surface an
   advisory (seal-time branch resolution is authoritative; do not block).

   Do **not** run `GATE-0.2-ENVIRONMENT-CHOICE` — environment is injected
   from the project default unless an admin explicitly overrides at register.

5. **Baseline detection.** Call `mcp__rollout-server__detect_baseline`
   (local — needs git access) to find candidate baselines (last
   fw-rollout commit, last release tag, last green CI sha, current
   main).

6. **Rollout history defaults.** When
   `Bash: fw api GET /v1/projects/<projectId>/rollouts/recommendation-data`
   returns a non-empty `stableFlags[]`, surface them before Step 1 as flags
   from completed rollouts whose wrappers should be removed from code during
   this run (they are deprecated — safe to delete the `flag.evaluate` branches
   and provider keys). Do not auto-delete provider flags; the developer removes
   code references and the verifier `verify_no_orphan_flags` catches drift.

7. **Lockfile checkpoint.** Call `mcp__rollout-server__write_lockfile`
   with the discovery-checkpoint shape below. The `lastConfigGap` field
   is `null` once all six capabilities from step 3 resolved, or the slug
   of the most recent unbound capability if the user chose "Cancel
   rollout" at any sub-gate (3.1–3.6) — a subsequent
   `/fireweave:safe-rollout` reads it and resumes at the matching gate.

   ```yaml
   lastStep: 'discovery'
   lastStepTimestamp: <now>
   lastConfigGap: string | null # Most recent unbound capability slug (e.g. "observability.query.metrics") for clean-exit resume; null once all six capabilities resolve.
   workingSpec:
     projectId: string
     primaryRepo: string
     providers: Record<capabilityId, providerId>
     environment: string
   ```

## Step 1 — Feature surface mode

> **Gate `GATE-1-FEATURE-SURFACE`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-1-FEATURE-SURFACE', questionHash, selectedOption,
stepNumber: '1' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-1-FEATURE-SURFACE`** — call `AskUserQuestion`:
- Q: How should I find what to wrap?
- Options:
  - Diff since last Fireweave rollout commit (Recommended) — default if `detect_baseline` found one
  - Diff since last release tag
  - Diff since last green CI build on main
  - Custom commit/tag/branch
  - First-time wrap (ignore prior baselines)

If the user chose any diff option:

1. Resolve the chosen option to the `baseRef`/`headRef` pair (e.g. the
   `detect_baseline` commit, the last release tag, a custom ref).
2. Call `mcp__rollout-server__extract_diff_surface` with
   `{ fromRef: <baseRef>, toRef: <headRef> }` (optionally `repoRoot`). The
   tool runs `git diff --name-status <fromRef>..<toRef>` locally and returns
   a structured `{ files, changedRoutes, changedTests, changedSymbols }`
   surface — you do **not** run git yourself or pass diff text.
3. Present a confirm popup of detected files (multi-select, default-all).

If the user chose "First-time wrap":

> **Gate `GATE-1-FIRST-TIME-DIRS`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-1-FIRST-TIME-DIRS', questionHash, selectedOption,
stepNumber: '1' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-1-FIRST-TIME-DIRS`** — call `AskUserQuestion` (multi-select):
- Q: Which directories form the feature surface?
- Options:

  - _detected top-level src dirs_

## Step 2 — Feature metadata (D12)

Three sub-prompts, one `AskUserQuestion` each:

1. **Type** (radio per D20):

   > **Gate `GATE-2-TYPE`** — required.
   >
   > 1. Call `AskUserQuestion` with the question and options below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-2-TYPE', questionHash, selectedOption,
stepNumber: '2' }`.
   > 3. Do not proceed past this point without a successful receipt write.
**Gate `GATE-2-TYPE`** — call `AskUserQuestion`:
- Q: What kind of change is this?
- Options:
  - Feature (Recommended) — Recommended for new functionality → type: 'feature'
  - Bugfix — → type: 'bugfix'
  - Performance optimisation — → type: 'performance'
  - Refactor — → type: 'refactor'
  - Other — → type: 'other'

2. **Name** (free text via "Other"):

   > **Gate `GATE-2-NAME`** — required.
   >
   > 1. Call `AskUserQuestion` with the question and options below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-2-NAME', questionHash, selectedOption,
stepNumber: '2' }`.
   > 3. Do not proceed past this point without a successful receipt write.

   "Short feature name (e.g. `dark-mode-checkout`)?"

3. **Description** (free text via "Other"):

   > **Gate `GATE-2-DESCRIPTION`** — required.
   >
   > 1. Call `AskUserQuestion` with the question and options below.
   > 2. Call `mcp__rollout-server__write_confirmation_receipt` with
   >    `{ gateId: 'GATE-2-DESCRIPTION', questionHash, selectedOption,
stepNumber: '2' }`.
   > 3. Do not proceed past this point without a successful receipt write.

   "One-line description of what's being rolled out — what reviewers
   should know."

## Step 2.5 — Register draft rollout (CREATE path only)

Joiners skip this step — their rollout already exists (Step 0.2). On the
CREATE path, the rollout is registered NOW as a `drafting` draft — flags,
wrap points, and metrics may all still be empty; they are synced into the
spec at Step 9 and validated by `finalize_rollout`.

**Race guard.** First RE-RUN
`Bash: fw api GET /v1/projects/<projectId>/rollouts` and parse the JSON.
If a new open rollout (`state ∈ {drafting, wrapping}`) appeared since
Step 0.2 ran (a teammate registered one in the meantime), do NOT create —
re-present **`GATE-0.2-JOIN-OR-CREATE`** with the fresh list (same gate
recipe as Step 0.2 sub-step 1) and honour the user's choice: joining
follows the Step 0.2 join path; "Create a new rollout" continues below.

> **Gate `GATE-2.5-REGISTER-DRAFT`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-2.5-REGISTER-DRAFT', questionHash, selectedOption,
stepNumber: '2.5' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-2.5-REGISTER-DRAFT`** — call `AskUserQuestion`:
- Q: Create rollout '<name>' in <environment> now? It starts in 'drafting' and can be cancelled.
- Options:
  - Yes, create draft (Recommended)
  - No — exit
Then act on the selected option:

- **No — exit** → exit cleanly; nothing was created server-side.
- **Yes, create draft** → this is a **Configuration step** — call
  `register_rollout` via `guarded_call`:

  1. Resolve the underlying tool name and server prefix
     (`mcp__fireweave-api__`, `register_rollout`).
  2. Call `mcp__rollout-server__guarded_call` with
     `{ serverPrefix, toolName, args, isConfigurationStep: true,
     expectedResponseSchema: 'RegisterRolloutResult' }`, where `args` is
     the flat draft shape (mirrors fw-server's `POST /v1/rollouts` body,
     single source of truth in `@fireweaveai/contracts`):

     ```jsonc
     {
       "projectId": "<from `fw status`>",
       "name": "<Step 2>",
       "description": "<Step 2>",
       "type": "<Step 2 featureType>",
       "environment": "<Step 0.2>",
       "primaryRepo": "<git remote get-url origin parsed to org/repo>",
       "firstParticipant": {
         "repo": "<same org/repo>",
         "branch": "<git symbolic-ref --short HEAD>",
         "commitSha": null
       }
     }
     ```

     `commitSha: null` is what makes this a DRAFT register — the server
     creates the rollout in state `drafting` and defers the workflow
     side-effects to `finalize_rollout`. `joinedByUserId` is injected
     server-side — do **NOT** send it. Flags and spec are intentionally
     absent here; they sync at Step 9 via `update_rollout_spec`.
  3. If the response shape is `{ error: { code, ... } }`, print the
     `remediation` field verbatim and stop. Do not retry, do not call the
     underlying tool directly, do not call another tool.
  4. If the response shape is `{ ok: true, result }`, expect
     `{ rolloutId, participantId, state: 'drafting' }` — bind all three.

After a successful draft register:

1. Call `mcp__rollout-server__write_lockfile` with
   `{ lastStep: 'created', rolloutId, participantId, role: 'creator',
   diffApplied: false }` — `role: 'creator'` makes a later resume
   re-enter at Step 3.
2. Write the skeleton rollout entry — this is a **Configuration step** —
   call `write_preferences` via `guarded_call` with
   `{ rolloutId, file: <skeleton entry>, header: { orgId, projectId,
   projectName } }` (the `header` creates `.fireweave/project.json` when
   it does not exist yet; when it exists the CLI owns it and the header
   is ignored). The skeleton entry carries: the Step 2 feature metadata,
   `flags: []`, `wrapPoints: []`, `metrics: []`, the canonical
   verification-policies block, and the `providers` map resolved at
   Step 0.2.

Continue to Step 3. From here on, every decision (rollout style, wrap
points, metrics) materialises into this rollout's entry
(`.fireweave/rollouts/<rolloutId>.json`) at Step 7.

## Step 3 — Rollout style (scenario-aware)

Run `Bash: fw api GET /v1/projects/<projectId>/rollouts/recommendation-data`
and parse the JSON. This returns recent rollouts + outcomes for the project —
raw data, not a pre-cooked recommendation. It also returns `stableFlags[]`:
flags from successfully completed rollouts whose code wrappers should be treated
as deprecated and removed during this run.

**Synthesise the recommendation INLINE** using your own reasoning. Consider:

- Feature complexity (number of files, lines changed, surface area).
- Blast radius (handler reach, downstream consumers).
- Prior outcomes in similar contexts (look at `outcomes[]` for failures and
  what drove them).
- The team's feature-flag provider patterns (visible from the recent
  rollouts' `flags[].flagProviderId` distribution).

Produce a recommendation of the shape:
`{ kind, stages: [{ targetPct, soakMs }] }`. For first-pitch projects with
no prior rollouts, fall back to a canonical 100%-soak plan
(`kind: 'stub', stages: [{ targetPct: 100, soakMs: 120000 }]`).

> **Gate `GATE-3-ROLLOUT-STYLE`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-3-ROLLOUT-STYLE', questionHash, selectedOption,
stepNumber: '3' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-3-ROLLOUT-STYLE`** — call `AskUserQuestion`:
- Q: What's the rollout style?
- Options:

  - _recommended one first, tagged with reason (e.g. "<recommended> (Recommended for this scenario: <reason from tool>)"), then the next-best alternatives, plus "Other / custom-schedule"_

The confirmed plan (style + schedule + guardrails) materialises into the
rollout's entry — the `rollout` block of
`.fireweave/rollouts/<rolloutId>.json` — when Step 7 writes it.

## Step 4 — Capability resolution

Capabilities resolved already in Step 0.2 sub-step 3 via
`fw api GET /v1/projects/<projectId>/capabilities`. For any capability still
unbound (`null` in the map):

> **Gate `GATE-4-PROVIDER-BINDING`** — required (per unbound capability).
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-4-PROVIDER-BINDING', questionHash, selectedOption,
stepNumber: '4' }`.
> 3. Do not proceed past this point without a successful receipt write.

`AskUserQuestion` with each candidate provider. If none and Fireweave
PostHog supports it, default to Fireweave PostHog.

For each provider binding, the resolved `providerId` is recorded in the
working spec's `providers` field.

## Step 5 — Wrap-point analysis

For each file in the feature surface, **read the file content locally via
the `Read` tool** (the cloud MCP can't reach the dev's working tree —
security boundary).

Call `mcp__rollout-server__analyze_codebase` with
`{ files, snippetsPerFile: { [path]: <file content> } }`. The tool returns
`{ contexts: [{ path, kind, cohortKeyHint? }] }`. v1 detects HTTP handlers
via regex; non-HTTP contexts return `kind: 'unknown'` with no cohort-key
hint.

**Compose wrap-point proposals INLINE** from the diff + `contexts[]` returned by
`analyze_codebase`. For each context, propose a wrap-point of the shape
`{ file, symbol, wrapStyle, cohortKeyExpression? }`:

- `file` + `symbol`: take from `contexts[i]`.
- `wrapStyle`: `'replace-handler'` for HTTP handlers (kind === 'http'),
  `'wrap-call'` for other invokables, `'manual'` for `kind: 'unknown'`.
- `cohortKeyExpression`: default to `'req.user.id'` for HTTP handlers; leave
  absent for `kind: 'unknown'` and prompt the user via the per-symbol cohort-key
  gate below.

The resulting `wrapPoints[]` array has the same shape the deprecated cloud tool
used to return — downstream gates (`GATE-5-WRAP-SELECT` multi-select,
`GATE-5-COHORT-KEY` per-symbol) continue to consume it unchanged.

> **Gate `GATE-5-WRAP-SELECT`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-5-WRAP-SELECT', questionHash, selectedOption,
stepNumber: '5' }`.
> 3. Do not proceed past this point without a successful receipt write.

`AskUserQuestion` with multi-select options for each candidate (default to
high-confidence ones).

For wrap-points where `cohortKeyExpression` is missing, prompt explicitly
(per-symbol receipt — `GATE-5-COHORT-KEY-<symbol>` gate IDs are written
dynamically; canonical group ID is `GATE-5-COHORT-KEY`):

**Gate `GATE-5-COHORT-KEY`** — call `AskUserQuestion`:
- Q: What identifier should `<symbol>` use for cohort bucketing?
- Options:

  - _detected globals (`req.user.id`, `req.session.id`, `ctx.userId`…) plus "Other (free text)"_

### Sub-step 5.1 — Coherence grouping

Before codegen, confirm or override a proposed coherence-group grouping
so multi-flag rollouts ramp together when they describe one logical
feature. Inspect the confirmed wrap-points (and the `contexts` returned
by `analyze_codebase`) for coupling signals — in this order:

- Shared cohort key — wrap-points whose `cohortKeyExpression` resolves
  to the same identifier almost always belong to one group.
- Cross-stack file paths — backend (`apps/*-server/`, `src/api/`) and
  frontend (`apps/*-webapp/`, `src/routes/`) files that change together
  for the same user-stated feature.
- Shared imports / types — wrap-points that import the same module or
  type are likely two faces of one feature.
- User-stated feature name — Step 2 metadata anchors the default
  grouping name when the above signals agree.

Combine these to draft a proposed grouping (e.g. one group named after
the Step 2 feature name, or split groups by stack when the cohort keys
disagree).

> **Gate `GATE-5-COHERENCE-GROUPING`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-5-COHERENCE-GROUPING', questionHash, selectedOption,
stepNumber: '5' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-5-COHERENCE-GROUPING`** — call `AskUserQuestion`:
- Q: How should these wrap-points ramp together?
- Options:
  - All wrap-points enable together (single coherence group)
  - Group as follows: <proposed grouping with cross-stack rationale>
  - Each flag is independent (no coherence group)

**Enforcement.** Within a coherence group, all flags MUST declare the
**same cohort key** expression — the controller buckets users once per
group, then toggles every flag in the group at that bucket. If two
wrap-points in the same proposed group resolve different
`cohortKeyExpression` values, surface the mismatch in the
"Group as follows" rationale and refuse to proceed until the user
either picks one expression for the whole group or splits the
mismatching wrap-points into separate groups.

Materialise the user's choice into the rollout's entry (and the final
spec synced at Step 9): write the chosen `coherenceGroups[]` array (one
entry per group, with an id and the group's resolved cohort-key
expression) and set `flags[].coherenceGroupId` on every grouped flag.
For "Each flag is independent", leave `coherenceGroups: []` and omit
`coherenceGroupId` from every flag.

## Step 6 — Metric proposal

**Propose the canonical 3-metric set INLINE** — the cloud tool is no
longer involved. Every safe rollout, regardless of `featureType` or
`providers`, should propose the same three metrics tied to the
primary `flagKey` (substitute `<flag>` with the flag's key):

1. **Adoption** (engagement counter) — `feature.<flag>.adopted`.
   Emitted on each `if (variant === 'on')` branch so we can count how
   many distinct users hit the new code path.
2. **Health** (error counter) — `feature.<flag>.error`. Emitted on
   caught exceptions / `result.kind === 'fail'` inside the new code
   path so we can count how many requests error out.
3. **Latency** (timer) — `feature.<flag>.duration_ms`. Emitted by
   wrapping the handler body in `startSpan` / `endSpan` so we can
   observe p95 latency change for the new code path.

These three metrics are pre-selected by default. The user may opt
out of any one OR add custom metrics via the gate below. The accepted
set materialises into the rollout's entry (`metrics[]`) at Step 7.

> **Gate `GATE-6-ACCEPT-METRIC`** — required (multi-select across the
> canonical three).
> The runtime gate IDs are `GATE-6-ACCEPT-METRIC-<name>` (suffixed by
> metric name); the canonical group ID written above is the static
> anchor referenced by the manifest and receipt-guard predicates.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-6-ACCEPT-METRIC-<name>', questionHash, selectedOption,
stepNumber: '6' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-6-ACCEPT-METRIC`** — call `AskUserQuestion` (multi-select):
- Q: Confirm the metrics to track for `<flag>`. The canonical three are pre-selected.
- Options:
  - Adoption — `feature.<flag>.adopted` (Recommended)
  - Health — `feature.<flag>.error` (Recommended)
  - Latency — `feature.<flag>.duration_ms` (Recommended)
  - Add custom metric (free text)

If the user de-selects all three (no metric accepted), surface a
warning popup and require explicit confirmation that they want to
ship with no metric guardrails:

> **Gate `GATE-6-ZERO-METRIC-WARNING`** — required (only when no
> metric accepted).
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-6-ZERO-METRIC-WARNING', questionHash, selectedOption,
stepNumber: '6' }`.
> 3. Do not proceed past this point without a successful receipt write.

### Sub-step 7.0 — SDK-install pre-codegen (TypeScript-only for v1)

Before composing the wrap-point diffs (Step 7 proper), run the
**SDK-install** pre-codegen pass so the project has the provider SDK
declared and an init module ready to import from each wrap point.

**Language scope.** v1 supports **TypeScript-only** wrap points. If any
wrap point file extension is not `.ts` / `.tsx` / `.js` / `.jsx`, print
the literal message `SDK auto-install for Python is not yet supported`
(substitute the actual language) and skip both sub-steps below — the
human author wires the SDK manually for that language.

This pass is **fully local** — it inspects the developer's own
`package.json` and emits an init module on disk; there is no cloud call.

For each grouped flag whose wrap points are all TypeScript:

1. **Detect whether the SDK is installed.** Read the project's
   `package.json` (via the `Read` tool at `<projectRoot>/package.json`) and
   check whether the provider's SDK package appears under `dependencies` or
   `devDependencies`. The package name is the Fireweave-flags client for the
   bound provider (`flag.providerId`). Treat a present entry as
   `needsInstall === false`; otherwise `needsInstall === true`.
2. **Compose the init module inline.** If the SDK is missing OR the init
   module does not yet exist on disk, compose the `fireweave-flags` init
   module yourself for the bound provider (the small module that constructs
   the provider client and exports the `flag` handle the wrap points
   import). Default its path to the project's source root (e.g.
   `src/fireweave-flags.ts`).
3. **Surface both proposals to the user as a single `Edit` review:**
   - The `package.json` dependency add (one line under `dependencies`)
     showing the SDK package at its current version.
   - The new init-module file with its full contents.
     Apply both diffs alongside the codegen diffs in Step 7 below — they
     are part of the same review surface, so the user accepts or rejects
     the SDK install + codegen in one pass.

If the SDK is already present in `dependencies` or `devDependencies`, skip
the init-module emission only when the init-module file already exists on
disk; otherwise still emit it.

## Step 7 — Codegen

Before applying any diffs, call `mcp__rollout-server__write_lockfile` with
`{ lastStep: 'codegen', rolloutId, participantId, role,
diffApplied: false, workingSpec: <partial spec captured so far> }`. This
way an interrupt before the first `Edit` restarts at Step 5 cleanly.
**`write_lockfile` REPLACES the lockfile state** — always carry
`rolloutId`, `participantId`, and `role` forward on every write or the
draft linkage (and the Step 0 draft-aware resume branches) is lost.

**Multi-flag rollouts**: every wrap point now binds to ONE flag via its
`flagKey` field. Group wrap points by `flagKey` before composing the
edits — each wrap point embeds ONE flag, so multi-flag rollouts produce
N independent `Edit` sequences (one per flag).

**Codegen IS the `Edit`-tool sequence you execute.** The skill composes
the diff INLINE — there is no cloud tool that returns a pre-baked patch.
For each confirmed wrap point (grouped by its `flagKey`):

1. Read the target file content locally via the `Read` tool at
   `wrapPoint.file`.
2. Resolve the flag from the rollout entry's flags:
   `flag = entry.flags.find(f => f.key === wp.flagKey)`.
3. Locate `wrapPoint.symbol` inside the file content. Apply the wrap
   pattern per `wrapPoint.wrapStyle` — use **your own `Edit` tool** to
   produce the diff:
   - `'replace-handler'` — wrap the entire handler body in
     `if (await flag.evaluate({ key: '<flag.key>', cohortKey: <wp.cohortKeyExpression> })) { /* new */ } else { /* baseline */ }`.
   - `'wrap-call'` — wrap the specific call site at `wp.symbol` with the
     same `flag.evaluate(...)` branching.
   - `'manual'` — compose the most appropriate placement based on context;
     prefer placement immediately before the first observable side-effect
     of the new code path.
4. Inside the `if (variant === 'on')` branch, emit the metrics confirmed
   in Step 6 inline (e.g. counter `feature.<flag.key>.adopted` on entry,
   counter `feature.<flag.key>.error` on caught exceptions / failure
   results, timer `feature.<flag.key>.duration_ms` spanning the new
   branch). **Hard rule:** `assert_dev_checklist` / promote-fast will
   **block** if a declared `telemetry.metrics[].name` is missing as a
   string-literal emit arg in wrap-point files — registry-only names are
   forbidden.
5. Use `wp.cohortKeyExpression` from Step 5 verbatim as the
   `cohortKey: <expr>` argument so the controller buckets users on the
   same identifier the operator confirmed.

> **Gate `GATE-7-CODEGEN-REVIEW`** — required (per file edited).
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-7-CODEGEN-REVIEW', questionHash, selectedOption,
stepNumber: '7' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-7-CODEGEN-REVIEW`** — call `AskUserQuestion`:
- Q: Apply the proposed wrap for `<wp.symbol>` in `<wp.file>`?
- Options:
  - Yes, apply this Edit (Recommended)
  - Edit needs adjustment — revise and re-prompt
  - Skip this wrap-point

Once **the first** diff has been applied, immediately call
`mcp__rollout-server__write_lockfile` again with the same shape
(`rolloutId`, `participantId`, `role`, `workingSpec` carried forward)
and `diffApplied: true`. From this point on the working tree is dirty —
an interrupt resumes via the "Confirm or revert?" prompt in Step 0.

After all diffs are applied, this is a **Configuration step** — call
`write_preferences` via `guarded_call`:

1. Resolve the underlying tool name and server prefix
   (`mcp__rollout-server__`, `write_preferences`).
2. Call `mcp__rollout-server__guarded_call` with
   `{ serverPrefix, toolName, args: { rolloutId, file: <assembled rollout
entry> }, isConfigurationStep: true, expectedResponseSchema:
'WritePreferencesResult' }`. The `file` is the full rollout entry for
   THIS rollout — feature metadata, `flags[]`, `wrapPoints[]`,
   `metrics[]`, the `rollout` plan block, `providers`, and the
   verification-policies block — upserted into
   `.fireweave/rollouts/<rolloutId>.json`.
3. If the response shape is `{ error: { code, ... } }`, print the
   `remediation` field verbatim and stop. Do not retry, do not call the
   underlying tool directly, do not call another tool.
4. If the response shape is `{ ok: true, result }`, the rollout file
   has been validated and atomically written.

**The skill never writes `.fireweave/rollouts/<rolloutId>.json` or
`.fireweave/project.json` directly — always go through
`write_preferences` via `guarded_call`** so the schema is validated and
the files are written atomically. (`write_preferences` also auto-migrates
a LEGACY single-file `.fireweave/rollout.config.json` into the split-file
model on first scoped write.)

## Step 8 — Verification

Run all seven `mcp__rollout-server__verify_*` tools, in order, each with
`{ rolloutId }` (plus `cwd` only if the repo root differs from the MCP
server's working directory). Each returns `{ pass, findings: [...] }`.
These are LOCAL tools because they inspect the dev's working tree — and
they read the wrap points / flags / metrics from the committed scoped
file `.fireweave/rollouts/<rolloutId>.json`, so **Step 7's
`write_preferences` MUST have run before Step 8** or the verifiers have
nothing to check against.

If any check returns `pass: false` and the rule's policy is `block`:

> **Gate `GATE-8-VERIFY-OVERRIDE`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-8-VERIFY-OVERRIDE', questionHash, selectedOption,
stepNumber: '8' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-8-VERIFY-OVERRIDE`** — call `AskUserQuestion`:
- Q: Verification failed: <count> findings. Block commit?
- Options:
  - Block and let me fix
  - Add TODO comments and proceed
  - Override (record reason)
If **Override**, prompt for reason (free text); record in `.fireweave/rollout.audit.log`.

Render a summary table of all findings before proceeding.

## Step 8.5 — Summary preview (D4)

**Compose the summary INLINE** from the full working spec — the cloud
tool is no longer involved. Format the summary as concise markdown
with the following sections, in this order:

- **Title** — the rollout name from Step 2.
- **Type** — the rollout type from Step 2 (`featureType`).
- **Environment** — target environment.
- **Primary repo** — the participating repo + branch.
- **Wrap-points selected** — one row per confirmed wrap-point as
  `<file>:<symbol>` with the resolved `wrapStyle`.
- **Flags** — one entry per flag with `key`, `providerId`, `type`,
  `safeDefault`, and `isPrimary`.
- **Metrics** — the canonical three (or custom set) confirmed in Step 6.
- **Rollout stages** — the plan from Step 3.
- **Cohort-key assignments** — one row per wrap-point with the
  resolved `cohortKeyExpression`.
- **Safe-default** — per-flag default returned when evaluation fails.
- **First participant SHA** — placeholder until Step 9 captures the
  commit SHA.

Render the summary.

> **Gate `GATE-8.5-REGISTER-OR-EDIT`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-8.5-REGISTER-OR-EDIT', questionHash, selectedOption,
stepNumber: '8.5' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-8.5-REGISTER-OR-EDIT`** — call `AskUserQuestion`:
- Q: Finalize this rollout?
- Options:
  - Yes, finalize and capture commit (Recommended)
  - Edit specific section…
  - Cancel
(The rollout was already registered as a draft at Step 2.5 — this gate
confirms finalization, not registration. The gate ID keeps its historic
name for receipt continuity.)
On **Edit specific section…** → jump back to the relevant step (4, 6, or 7);
re-render the summary on return.

Call `mcp__rollout-server__write_lockfile` with `{ lastStep: 'summary',
rolloutId, participantId, role, diffApplied: true,
workingSpec: <full spec> }` (the draft linkage fields carried forward —
the write replaces state) so an interrupt here resumes at this same
panel.

## Step 9 — SHA capture + Finalize (D7)

The rollout has existed server-side in state `drafting` since Step 2.5
(or since the join at Step 0.2). This step captures the real commit SHA
the deploy gate will track, syncs the final spec, and finalizes the
draft into `wrapping`. Before anything else, prompt the user to
commit + push:

> **Gate `GATE-9-SHA-READY`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-9-SHA-READY', questionHash, selectedOption,
stepNumber: '9' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-9-SHA-READY`** — call `AskUserQuestion`:
- Q: Ready to finalize? I'll need a commit SHA. Have you committed and pushed?
- Options:
  - Yes, on branch <auto-detected>
  - Not yet — exit so I can commit/push
Then act on the selected option:
- **Yes, on branch <auto-detected>** → run `git rev-parse HEAD` via Bash; run
  `git symbolic-ref --short HEAD`; verify the SHA is reachable from
  `origin/<branch>` (`git branch -r --contains <sha>` includes `origin/<branch>`).
- **Not yet — exit so I can commit/push** → exit cleanly; print resume command.

Once the SHA is captured, **first** call
`mcp__rollout-server__write_lockfile` with `{ lastStep: 'finalize',
rolloutId, participantId, role, diffApplied: true }` — BEFORE the first
cloud call below, so a crash anywhere in this sequence resumes via the
`lastStep === 'finalize'` branch of Step 0 (which safely re-runs all
three calls).

Then run **three Configuration steps, in this order**, each via
`guarded_call`:

**(1) `update_participant_sha`** — record the real SHA on this repo's
participant (draft participants carry `commitSha: null` until now):

1. Resolve the underlying tool name and server prefix
   (`mcp__fireweave-api__`, `update_participant_sha`).
2. Call `mcp__rollout-server__guarded_call` with
   `{ serverPrefix, toolName, args: { id: <rolloutId>,
   participantId: <from the lockfile>, repo: <org/repo>,
   branch: <git symbolic-ref --short HEAD>,
   newSha: <git rev-parse HEAD> }, isConfigurationStep: true,
   expectedResponseSchema: 'UpdateParticipantShaResult' }`.

   The wire shape is flat: `id` and `participantId` fill the route path
   (`PATCH /v1/rollouts/{id}/participants/{participantId}`); the
   remaining `{ repo, branch, newSha }` is the request body, which the
   server uses to resolve the same participant. The call works in
   `drafting` and from a null SHA, and is idempotent — if `newSha`
   already matches it returns `updated: false`. Success shape:
   `{ participantId, oldSha, newSha, updated }`.
3. If the response shape is `{ error: { code, ... } }`, print the
   `remediation` field verbatim and stop. Do not retry, do not call the
   underlying tool directly, do not call another tool.

**(2) `update_rollout_spec`** — sync the final spec assembled from the
rollout's entry (`.fireweave/rollouts/<rolloutId>.json`):

1. Run `Bash: fw api GET /v1/rollouts/<rolloutId>` (get_rollout_status)
   and read the current CAS counter from `rollout.specVersion` in the
   response.
2. Resolve the underlying tool name and server prefix
   (`mcp__fireweave-api__`, `update_rollout_spec`).
3. Call `mcp__rollout-server__guarded_call` with
   `{ serverPrefix, toolName, args: { id: <rolloutId>,
   deltaJson: <final spec — flags, wrapPoints, metrics, guardrails,
   coherence groups — from the rollout's entry>,
   expectedSpecVersion: <rollout.specVersion from step 1> },
   isConfigurationStep: true,
   expectedResponseSchema: 'UpdateRolloutSpecResult' }`.
4. **ONE-RETRY conflict rule.** On a version-conflict error envelope
   (the CAS guard — HTTP 409 / `code: 'conflict'`): re-fetch via
   `get_rollout_status`, re-apply the local delta on top of the fresh
   spec, and retry ONCE with the new `expectedSpecVersion`. If the
   retry conflicts again, stop and print the `remediation` field
   verbatim. This is an **explicit exception to the "never retry"
   `guarded_call` doctrine, scoped to THIS call only** — the CAS
   version makes one re-read-and-retry provably safe; no other
   guarded_call may ever be retried.
5. On any other error envelope, print the `remediation` field verbatim
   and stop. On `{ ok: true, result: { specVersion } }`, continue.

**(3) `finalize_rollout`** — transition the draft to `wrapping`:

1. Resolve the underlying tool name and server prefix
   (`mcp__fireweave-api__`, `finalize_rollout`).
2. Call `mcp__rollout-server__guarded_call` with
   `{ serverPrefix, toolName, args: { id: <rolloutId> },
   isConfigurationStep: true,
   expectedResponseSchema: 'FinalizeRolloutResult' }`. The server
   validates completeness (≥1 flag, ≥1 spec wrap point, the caller's
   participant SHA non-null), transitions `drafting → wrapping`, and
   fires the deferred enter-wrapping side effects (the
   safe-rollout-playbook workflow + participant-registered signal).
3. If the response shape is `{ error: { code, ... } }`, print the
   `remediation` field verbatim and stop. Do not retry, do not call the
   underlying tool directly, do not call another tool.
4. If the response shape is `{ ok: true, result }`, expect
   `{ rolloutId, state: 'wrapping' }`.

This is a **Configuration step** — call `tag_baseline_commit` via
`guarded_call`:

1. Resolve the underlying tool name and server prefix
   (`mcp__rollout-server__`, `tag_baseline_commit`).
2. Call `mcp__rollout-server__guarded_call` with
   `{ serverPrefix, toolName, args: { rolloutId },
isConfigurationStep: true, expectedResponseSchema:
'TagBaselineCommitResult' }` (the tool reads HEAD itself; pass
   `repoRoot` only if the repo root differs from the MCP server's
   working directory — there is no `commitSha` argument).
3. If the response shape is `{ error: { code, ... } }`, print the
   `remediation` field verbatim and stop. Do not retry, do not call the
   underlying tool directly, do not call another tool.
4. If the response shape is `{ ok: true, result }`, the trailer + tag
   are written so the next `/fw-rollout` invocation's baseline
   detection finds this point.

After Step 10 completes successfully, call
`mcp__rollout-server__clear_lockfile` — the work is checkpointed in the
committed `.fireweave/project.json` + `.fireweave/rollouts/<rolloutId>.json`
and the server-side rollout row, so the local resume cache is no longer
needed.

### Sub-step 9.1 — `GATE-9-COMMIT-AND-PR` (opt-in commit + PR creation)

After `finalize_rollout` returns and `tag_baseline_commit` has been
written, the skill MAY optionally commit the wrap diff and open a PR
on the user's behalf. This sub-step is **opt-in** — the default
selection is "Skip" so existing flows keep working unchanged.

> **Gate `GATE-9-COMMIT-AND-PR`** — required.
>
> 1. Call `AskUserQuestion` with the question and options below.
> 2. Call `mcp__rollout-server__write_confirmation_receipt` with
>    `{ gateId: 'GATE-9-COMMIT-AND-PR', questionHash, selectedOption,
stepNumber: '9.1' }`.
> 3. Do not proceed past this point without a successful receipt write.

**Gate `GATE-9-COMMIT-AND-PR`** — call `AskUserQuestion`:
- Q: Commit the wrap diff and open a PR for this rollout? (opt-in; default Skip preserves the manual flow.)
- Options:
  - Skip — I'll commit + push manually (Recommended) — default; continue to Step 10 without touching git
  - Commit + open PR — execute the commit + PR flow below

**Commit + PR flow (only when the user selected "Commit + open PR"):**

1. Compose the commit message using the rollout's primary flag and
   the captured feature metadata. Default template:
   `wrap(${flagKey}): ${featureName} — guard new code path`
   (substituting the primary `flagKey` from Step 4 and the
   `featureName` from Step 2). The skill MAY offer the message via a
   follow-up `AskUserQuestion` for edit; the default is the template
   verbatim.
2. Run `git add -A` then `git commit -m "<message>"` via Bash. On
   non-zero exit, print stderr and stop — do not retry.
3. Capture the new SHA: `git rev-parse HEAD`.
4. Push: `git push -u origin <branch>`. On non-zero exit, print
   stderr and stop.
5. Call `record_pr_url` is deferred until after `gh pr create`
   succeeds (Step 9.1 step 7 below).
6. Detect the `gh` CLI: `command -v gh`. If absent OR if `gh pr
create --fill --web=false` fails for any reason, print the
   verbatim hard-abort message and stop:
   ```
   Commit succeeded at <sha>. PR creation skipped: gh CLI not found. Install gh and re-run /fireweave:safe-rollout to resume at Step 9 post-commit, or open the PR manually at <compare-page-url>.
   ```
   `<sha>` is the SHA from step 3; `<compare-page-url>` is the
   GitHub compare URL derived from the push remote
   (`https://github.com/<owner>/<repo>/compare/<branch>?expand=1`).
7. On `gh pr create` success, parse the returned PR URL from stdout
   and record it via `guarded_call` with `{ serverPrefix:
   'mcp__fireweave-api__', toolName: 'record_pr_url', args: { id:
   <rolloutId>, prUrl }, isConfigurationStep: true,
   expectedResponseSchema: 'RecordPrUrlResult' }` (`id` fills the
   route path `PATCH /v1/rollouts/{id}/pr-url`; `{ prUrl }` is the
   body). The server persists `prUrl` on the rollout row via the
   `record_pr_url` use-case.

The commit + PR step is purely additive — failing it never breaks
the rollout. The rollout is already finalized + tagged at this
point; the worst case is "user opens the PR by hand".

## Step 10 — Final summary

Print a markdown summary covering:

- Feature: name + description + type
- Files changed: list with diff line counts
- Flags: list each flag — key, provider, type, safe default, primary
  (multi-flag rollouts list N rows; single-flag rollouts list one)
- Telemetry: list of metrics, logs, traces wired
- Verification: pass/fail per rule
- Rollout: style, schedule, guardrails, environment
- Controller: rolloutId + URL to the Rollouts tab in the webapp
  (`<webapp-url>/projects/<projectId>/rollouts/<rolloutId>`)
- Next ramp step: explain that **Seal** is the next user action — the
  primary developer (you, unless multi-repo) opens the Rollouts tab and
  clicks Seal once all participating PRs are merged. The deploy gate
  arms after seal; the agent runs once all participants deploy.

## Step 10.1 — Promotion offer (when auto-promote is off)

After printing the Step 10 summary, if the rollout state is `completed` and
`GET /v1/projects/<projectId>/environments` shows a next environment in the
pipeline (higher `promotionRank` than the rollout's current env), offer manual
promotion:

> **Gate `GATE-10.1-PROMOTE`** — optional.

**Gate `GATE-10.1-PROMOTE`** — call `AskUserQuestion`:
- Q: Rollout completed in `<currentEnv>`. Promote to `<nextEnv>`?
- Options:
  - Promote to <nextEnv>
  - Skip — I'll promote in the portal

If the user promotes: `Bash: fw api POST /v1/rollouts/<rolloutId>/promote` and
show the returned `childRolloutId`.

Skip this step when the server already auto-promoted (child rollout exists) or
no next environment is configured.

## Universal rules

- **Never** invoke the slash command `/fw-rollout` recursively.
- **Never** call provider APIs directly — always go through the
  `rollout-server` MCP tools or the `fw api` passthrough.
- **Never** write to `.fireweave/project.json` or
  `.fireweave/rollouts/<rolloutId>.json` except via
  `mcp__rollout-server__write_preferences` (which also migrates the
  LEGACY `.fireweave/rollout.config.json` when it finds one). Participants
  are server-owned and NEVER appear in committed files.
- **Never** mint, store, or send a Bearer token from inside the skill —
  authentication is owned by the `fw` CLI and the `fw-auth-gate.sh`
  hook. `fw api` attaches and refreshes the token itself; the skill
  never touches `Authorization` headers or token env vars.
- **Always** ack the user before destructive actions (delete flag, override
  verification, abort an in-flight rollout).
- **Always** write the lockfile at every step boundary so a crash is
  recoverable.
- **If** any MCP tool call returns an error envelope with `code` ∈
  { `CONFIRMATION_MISSING`, `CONFIG_TOOL_FAILURE`, `SCHEMA_DRIFT`,
  `TOOL_NOT_FOUND`, `MANIFEST_MISMATCH` } or fails with
  network/timeout/5xx, print the embedded remediation verbatim and
  stop. Do not retry, do not infer a fallback, do not call another
  tool. The session ends here; the operator must check connectivity
  to the MCP server or escalate.
