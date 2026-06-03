# Fireweave (Claude Code plugin)

Skills for working with FireweaveAI directly from your AI coding tool.

## Skills

- **safe-rollout** — Wrap new code behind one or more Fireweave-managed feature flags with cohort-keyed telemetry, then register a Restate-backed controller that ramps the rollout safely (auto-promote / rollback). Invoke via `/fireweave:safe-rollout`.

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
