---
name: create-task
description: Create a Fireweave task from the current editor context. Trigger when the user says "file a Fireweave task", "send this to Fireweave", "create a task for this bug", or asks to track work in Fireweave. Captures selected code, error messages, branch name, and surrounding context, then POSTs to the Fireweave Task Intake API.
activation:
  globs: ["**/*"]
  manual: false
aliases:
  cursor: fireweave-create-task
  cline: fw-task
  codex: create_fireweave_task
---

# Create a Fireweave Task

Use this skill to file a task in the user's Fireweave workspace from whatever they have open in their editor.

## When to use

- The user explicitly asks to file/create/send a Fireweave task.
- The user describes a bug or feature and asks for it to be tracked.
- The user shares an error trace and asks to follow up later.

Do NOT use this skill if the user is asking about Fireweave's own internals or about an already-existing task — use `check-status` (when added) instead.

## Required environment

- `FIREWEAVE_API_URL` — base URL, e.g. `https://api.fireweave.ai`.
- `FIREWEAVE_API_TOKEN` — bearer token from the user's Fireweave settings page.

If either is missing, ask the user to add them to their shell profile and abort. Do not prompt for the token interactively.

## Workflow

1. **Gather context:**
   - Selection (if any) → put in `body.codeContext.selection`.
   - Active file path → `body.codeContext.filePath`.
   - Current git branch (`git rev-parse --abbrev-ref HEAD`) → `body.codeContext.branch`.
   - Last error from the terminal (if visible) → `body.codeContext.errorTrace`.

2. **Draft a task title and description:**
   - Title: imperative mood, ≤ 80 chars (e.g. "Fix null deref in MarketplaceRouter").
   - Description: 2–4 sentences summarising what, where, and why.

3. **Show the user the draft** before sending. Let them edit title/description.

4. **POST to the Task Intake API:**

   ```sh
   curl -sS -X POST "$FIREWEAVE_API_URL/api/tasks" \
     -H "Authorization: Bearer $FIREWEAVE_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d @task.json
   ```

   The response shape is `{ data: { taskId: string, url: string } }`.

5. **Report back:** show the task URL so the user can click through.

## Failure handling

- 401: token is bad or expired. Tell the user to regenerate it from settings.
- 422: validation error. Show the response `data.errors[]` and offer to fix and retry.
- 5xx: network/server. Suggest retry once; if still failing, surface the full response.
