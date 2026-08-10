# Fireweave (Claude Code plugin)

Skills for working with FireweaveAI directly from your AI coding tool.

## Skills

- **safe-rollout** — Ship a change that is already rollout-ready: verify the generated prod branch (no provider swap, no re-wrapping), register the rollout, and ramp it on the deploy-liveness gate with auto-promote / rollback. Requires a repo initialised via `/fireweave:initialise`. Invoke via `/fireweave:safe-rollout`.

## Install

```
/plugin marketplace add FireWeave-HQ/plugins-marketplace
/plugin install fireweave@fireweave
```

## Configuration

Authentication is handled by the `fw` CLI: the plugin's auth hook runs `fw status` (and an inline OAuth device flow if needed) before any skill runs. Install the CLI and sign in:

- `bun install -g @fireweaveai/cli`
- `fw login --cloud` (production) or `fw login --local` (Fireweave engineers)

See [`.claude-plugin/SETUP.md`](.claude-plugin/SETUP.md) for the full setup and troubleshooting guide.
