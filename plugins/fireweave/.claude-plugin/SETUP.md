# Fireweave plugin — setup

This plugin gives your AI coding tool (Claude Code, Cursor, Cline, Codex)
deterministic access to FireweaveAI: create tasks, wrap code in safe
rollouts, manage feature flags, inspect platform state.

The plugin is _deterministic by design_: every skill runs FireWeave's tools
through the `fw` CLI in your shell (`fw tool <name>`), and its Step 0 checks
that `fw` is installed, reaches FireWeave and is signed in before it writes
anything. The LLM never sees credentials or makes auth decisions: `fw` holds
them. There is no MCP server and no ship command — shipping is a pull request.

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

One guided command sets up a repo end to end:

### 2.1 — Set up the repo

```bash
cd <your-repo>
fw init
```

`fw init` is the whole walkthrough: it scaffolds `.fireweave/` (creating
`.fireweave/.gitignore` so the local `.cache/` directory isn't committed,
and `.fireweave/rollout.config.json` on the current schema), lets you pick
or log into a profile, and binds a project — then prints a diff of what
changed vs. what stayed. Idempotent and re-runnable: run it again any time
to reconfigure.

The two commands it composes are also available standalone — use them to
do a single step, or to change auth or project later:

### 2.2 — Authenticate (`fw login`)

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

You only need to do this once per machine — `fw` refreshes tokens near
expiry by itself.

### 2.3 — Bind / re-point a project (`fw select-project`)

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

## 3. How a skill checks auth

Every FireWeave skill starts with the same Step 0: it runs `fw tool list --json`
and `fw tool ensure-auth` from your agent's shell. It stops, writing nothing,
and tells you what to run when:

- `fw` is not installed → install it (§1), then `fw plugins install`, which also
  writes your agent's allow rule for `fw`;
- the shell is sandboxed or offline and cannot reach FireWeave → `fw plugins
install`, or run where the network is open;
- you are not signed in → `fw login`.

---

## 4. Troubleshooting

### "Failed to reconnect to plugin:fireweave:rollout-server"

An install from before the convergence release still points at the retired MCP
server. Update the plugin (`/plugin update fireweave@fireweave`); if the
message stays, it is a stale Claude Code plugin cache from an interrupted
install — run the bundled cleanup script:

```bash
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
  https://app-server.fireweave.ai/activate?user_code=ABCD-1234
Waiting for completion...
```

Open the URL on your laptop / phone, approve, and `fw login` completes on the
headless side; then run the skill again.

### "`fw` is not found"

A skill's Step 0 stopped because `fw` is not on your agent's `PATH`. Install it
(see §1 above), run `fw plugins install`, then run the skill again.

### Token expiry / rotation

`fw` refreshes tokens itself. If the refresh token has also expired, run
`fw login` again.

### "Fireweave preflight unexpectedly invalid"

The skill saw `ready: false` from `fw status`. Likely a race (env vars cleared
mid-session, network blip).
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

To clear cached credentials and repo state too:

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
