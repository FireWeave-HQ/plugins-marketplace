# Fireweave (Claude Code plugin)

Skills for working with FireweaveAI directly from your AI coding tool.

## Skills

- **initialise** — One-time per-repo setup: wires the FireWeave SDK into each app and writes the agent standing instructions. Invoke via `/fireweave:initialise`.
- **adopt** — Attach this machine's coding agent to a repo that is already initialised. Invoke via `/fireweave:adopt`.
- **migrate-harness** — Move an app's flag reads onto the FireWeave SDK. Invoke via `/fireweave:migrate-harness`.
- **cleanup** — Retire measured-dead control points; the tombstone lands when the cleanup merges. Invoke via `/fireweave:cleanup`.
- **feedback** — Report that FireWeave behaved wrong in this session. Invoke via `/fireweave:feedback`.
- **ci-initialise**, **ci-rollout-readiness**, **ci-register-control-points** — run by FireWeave's cloud setup and checks, never by hand.

There is no ship command: shipping is a pull request into an environment branch, and merging it registers the rollout for a person to start. The skills run FireWeave's tools as `fw tool <name>` in the shell; the plugin has no MCP server.

## Install

```
/plugin marketplace add FireWeave-HQ/plugins-marketplace
/plugin install fireweave@fireweave
```

## Configuration

Authentication is handled by the `fw` CLI: each skill's Step 0 runs `fw tool ensure-auth` and stops with `fw login` when you are not signed in. Install the CLI and sign in:

- `bun install -g @fireweaveai/cli`
- `fw login --cloud` (production) or `fw login --local` (Fireweave engineers)

See [`.claude-plugin/SETUP.md`](.claude-plugin/SETUP.md) for the full setup and troubleshooting guide.
