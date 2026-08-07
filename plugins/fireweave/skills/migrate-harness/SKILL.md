---
name: migrate-harness
description: Move an app's feature-flag reads off a direct PostHog SDK and onto FireWeave — the code half of migrating to FireWeave-managed flags. Rewrites provider wiring to `@fireweaveai/sdk`, maps `posthog.identify` to target registration, and reports the result to fw-server so the project page can pair it with the flag half. Use when the user asks to "migrate to FireWeave flags", "move off PostHog", "switch to the FireWeave SDK", or invokes `/fireweave:migrate-harness`. `--check` reports what would change without writing.
activation:
  globs: []
  manual: false
aliases:
  cursor: fw-migrate-harness
  cline: fw-migrate-harness
  codex: fw_migrate_harness
---

# Migrate harness (move flag reads onto FireWeave)

Migrating a project to FireWeave-managed flags is **two independent halves**:

| Half        | Where it happens                                                            | Who does it                                    |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| **Flags**   | FireWeave server — flags copied into the managed project, binding repointed | the _Migrate flags_ button on the project page |
| **Harness** | The app's own repository — flag reads go through fw-server                  | this skill                                     |

Doing only the flags half is the dangerous outcome: FireWeave ramps a flag in
the managed project while the running app still reads the customer's old
PostHog project. The FireWeave UI shows a rollout progressing and **no real
user sees anything change**. Nothing server-side can detect that, which is why
step 5 reports back.

Run this AFTER the flags half, so the flags the rewritten code reads already
exist in the managed project.

## HARD ORDER

1. **Detect** — find every direct provider read.
2. **Confirm** — show the plan; never rewrite without the user seeing it.
3. **Rewrite** — provider wiring, then identity, then call sites.
4. **Verify** — typecheck/build; a migration that does not compile is not done.
5. **Report** — `POST /v1/projects/:projectId/harness-migration`.

Do not skip 5. An unreported migration reads as "never happened", and the
project page will keep warning that flags moved without the code.

## 1. Detect

Search the repo for direct provider usage:

- imports of `posthog-js`, `posthog-node`, `PostHog`
- `posthog.isFeatureEnabled` / `getFeatureFlag` / `getFeatureFlagPayload`
- `posthog.identify` / `posthog.reset`
- OpenFeature providers bound to a PostHog adapter
- `POSTHOG_*` / `NEXT_PUBLIC_POSTHOG_*` / `VITE_POSTHOG_*` env reads

Group by **surface** (server, web, worker, mobile). Surfaces migrate
independently and the report records which ones actually moved.

If nothing is found, stop and say so. Do not scaffold a harness — that is
`/fireweave:initialise`.

## 2. Confirm

Show: the files to change, the surfaces covered, and anything you are NOT
migrating and why. Get explicit agreement before writing.

## 3. Rewrite

### 3a. Provider wiring

Replace the direct PostHog provider with the FireWeave remote adapter. Server:

```ts
import {
  FireweaveProvider,
  FireweaveRemoteAdapter,
  FireweaveRuntime,
} from '@fireweaveai/sdk';

const adapter = new FireweaveRemoteAdapter({
  apiUrl: process.env.FW_API_URL ?? process.env.FW_ATTEST_URL,
  apiKey: process.env.FW_PROJECT_API_KEY,
});
const runtime = new FireweaveRuntime(adapter);
await OpenFeature.setProviderAndWait(new FireweaveProvider(runtime));
```

The app must end up holding **no PostHog key**. Flags are evaluated by
fw-server, which holds the managed credentials. Remove the now-unused
`POSTHOG_*` env vars from the app's config and deployment.

Reference implementation: `apps/api/src/fireweave/fw-providers.ts` and
`apps/web/src/fireweave/` in the pulse-folio repo.

### 3b. Identity — the part that is easy to get wrong

`posthog.identify(id, props)` does **two** jobs:

1. declares who the current user is, and
2. **stores** those properties as a person profile.

The FireWeave equivalent is also two calls, and emitting only the first is the
common mistake:

```ts
// durable: stored server-side; rules keep matching without the app resending
await runtime.registerTarget(user.id, {
  properties: { plan: user.plan, beta: user.inBeta },
});

// per-request: overrides the stored properties for this evaluation only
await OpenFeature.setContext({ targetingKey: user.id, ...perRequestState });
```

Emit **both**. Context alone makes every rule only as good as what the app
remembers to send on each request — a rule targeting `plan` matches nobody if
one surface forgets it, silently and with no error.

Split the properties deliberately:

- **durable** (register): plan, beta membership, region, device model
- **per-request** (context): page, session, experiment context

`posthog.reset()` on logout becomes `setContext` with the anonymous id. Do NOT
"unregister" the target — the stored profile is still correct, the user simply
stopped being the current one.

### 3c. Call sites

Flag reads become OpenFeature reads. Keep the same flag keys — the flags half
copied them under their existing names, so renaming here would break the
mapping.

## 4. Verify

Run the project's typecheck/build and its tests. Report failures; do not
proceed to step 5 with a broken build — a migration that does not compile is
not migrated, and reporting it as such makes the project page lie.

## 5. Report

```
POST {FW_API_URL}/v1/projects/{projectId}/harness-migration
Authorization: Bearer {FW_PROJECT_API_KEY}

{
  "status": "migrated" | "partial" | "failed",
  "sdkVersion": "<@fireweaveai/sdk version installed>",
  "surfaces": ["server", "web"],
  "notes": "<what was left behind and why, if anything>"
}
```

Status honestly:

- `migrated` — every detected read now goes through FireWeave.
- `partial` — some surfaces still read the provider directly. Name them in
  `notes`. Partial does **not** count as done: the project page keeps warning,
  which is correct, because those surfaces still bypass FireWeave.
- `failed` — the rewrite did not land. Say why.

Never report `migrated` to make the page green. The page's whole purpose is to
show when the two halves disagree.

## `--check`

Do steps 1–2 and stop. Write nothing, report nothing.
