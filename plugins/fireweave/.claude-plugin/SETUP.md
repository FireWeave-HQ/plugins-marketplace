# Fireweave plugin — setup

This plugin gives your AI coding tool (Claude Code, Cursor, Cline, Codex)
deterministic access to FireweaveAI: create tasks, wrap code in safe
rollouts, manage feature flags, inspect platform state.

The plugin is *deterministic by design*: a Claude Code hook
(`fw-auth-gate.sh`) intercepts every Fireweave skill invocation, runs
`fw status`, and triggers an inline OAuth device flow if you're not
authenticated. The LLM never sees credentials or makes auth decisions.

---

## 1. Prerequisites

You need the **`fw` CLI** on your `PATH`. It owns auth, project binding,
token rotation, and machine-readable status output that the skills
consume.

Install via bun (recommended):

```bash
bun install -g @fireweaveai/cli
```

Verify:

```bash
fw --version
fw doctor          # runs all diagnostics, never gates
```

> If you're contributing to Fireweave itself, the CLI source lives in
> `packages/fw-cli/` — see that package's README.

---

## 2. First-time setup

Three one-time steps per repo:

### 2.1 — Initialise the repo

```bash
cd <your-repo>
fw repo init
```

This creates `.fireweave/.gitignore` (so the local `.cache/` directory
isn't committed) and ensures `.fireweave/rollout.config.json` is on the
current schema. Idempotent — safe to run again later.

### 2.2 — Authenticate

```bash
fw login --cloud         # production (default)
# or
fw login --local         # local dev — Fireweave engineers only
```

This kicks off an OAuth device flow:

1. CLI prints a URL + code; opens your browser to that URL.
2. You approve the request.
3. CLI persists the token to your OS keyring (preferred) or
   `~/.fireweave/auth.json` (fallback).

You only need to do this once per machine — tokens auto-refresh near
expiry via the `fw-auth-gate.sh` hook (Level 3, silent).

### 2.3 — Bind a project

```bash
fw select-project
```

Lists projects you have access to in the active org and writes the
chosen `projectId` to `.fireweave/rollout.config.json`. This file is
**committed** so teammates inherit the project binding when they clone.

### 2.4 — Verify

```bash
fw status
```

Should print `ready: true` with your user, org, project, and token
expiry. If anything's missing, the output includes a `remediation` list
of exact commands to run.

---

## 3. How the hook works

When you invoke any Fireweave skill (typed slash command like
`/fireweave:safe-rollout`, or natural-language dispatch like "use
safe-rollout for this"), Claude Code fires the `fw-auth-gate.sh` hook
**before** the LLM sees the prompt. The hook escalates through three
levels:

- **L3** — `fw token rotate --silent`: refresh near-expiry tokens. No
  user interaction; you see nothing.
- **L2** — `fw login --inline-device-flow`: if no token (or refresh
  expired), opens a browser and polls for completion. You click one
  URL once and the skill resumes automatically.
- **L1** — fallback: if browser-open fails (headless, SSH) or auth
  times out, the prompt is blocked with a clear remediation message
  ("run `fw login` manually and retry").

The hook is **scoped**: matchers are `^/fireweave:` for slash commands
and `Skill(skill='safe-rollout|create-task')` for skill dispatch.
Other prompts and other plugins are untouched.

---

## 4. Troubleshooting

### "Failed to reconnect to plugin:fireweave:rollout-server"

Usually a stale Claude Code plugin cache from an interrupted install.
Run the bundled cleanup script:

```bash
bash ~/.claude/plugins/marketplaces/fireweave-local/plugins/fireweave/.claude-plugin/scripts/cleanup-stale-cache.sh

# or, if installed from another marketplace, use whatever path resolves to:
bash ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/cleanup-stale-cache.sh
```

Then reload the plugin:

```
/plugin disable fireweave@fireweave
/plugin enable fireweave@fireweave
```

### Headless / SSH / devcontainer (no browser available)

`fw login --inline-device-flow` detects when no GUI is available
(no `DISPLAY`, all of `xdg-open` / `open` / `wslview` fail) and instead
of opening a browser, prints the URL + code to stderr:

```
Open this URL on a machine with a browser:
  https://api.fireweave.cloud/activate?user_code=ABCD-1234
Waiting for completion...
```

Open the URL on your laptop / phone, approve, and the hook resumes the
skill automatically on the headless side.

### "Fireweave CLI (`fw`) is not installed or not on your PATH"

The hook script printed this at L0 because `fw` wasn't found. Install it
(see §1 above), then retry your prompt. The hook itself will start the
inline device flow on the retry.

### Token expiry / rotation

Tokens auto-rotate at hook time (L3). If the refresh token has also
expired, L2 falls back to a fresh device flow. You can also force a
rotation manually:

```bash
fw token rotate            # explicit; prints status
fw token rotate --silent   # what the hook calls
```

### "Fireweave preflight unexpectedly invalid"

The skill saw `ready: false` from `fw status` despite the hook having
fired. Likely a race (env vars cleared mid-session, network blip).
Diagnose:

```bash
fw doctor
fw status --machine-readable
```

Apply the printed `remediation` items, then retry the skill.

---

## 5. Uninstall

To remove the plugin:

```
/plugin uninstall fireweave@fireweave
```

The hook is bundled with the plugin, so disabling/uninstalling the
plugin removes the hook entirely. To clear cached credentials and repo
state too:

```bash
fw logout --all                # revokes server-side, clears local
rm -rf ~/.fireweave            # removes cached auth + config
rm -rf .fireweave              # in any repo: removes per-repo state
                               # (rollout.config.json + .cache/)
```

If you only want to revoke from one mode:

```bash
fw logout --cloud
fw logout --local
```
