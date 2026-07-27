# Fireweave Plugins Marketplace

Official [Fireweave](https://fireweave.ai) skills marketplace — ship-safe plugins for
coding agents. Install once, and every change your agent builds comes out
rollout-ready: wrapped at a control point, safe to ship, with adoption measured from
the first user.

## Plugins

| Plugin | Description |
|--------|-------------|
| [`fireweave`](./plugins/fireweave) | Customer-facing skills for working with Fireweave (e.g. `/fireweave:safe-rollout`) |
| [`fireweave-dev`](./plugins/fireweave-dev) | Developer skills for building Fireweave integration plugins |

## Install (Claude Code)

```
/plugin marketplace add FireWeave-HQ/plugins-marketplace
/plugin install fireweave@fireweave
```

Adapters for other agents live in their own directories: [`cursor/`](./cursor),
[`codex/`](./codex), [`cline/`](./cline), [`opencode/`](./opencode).

## Prerequisites

Authentication is handled by the `fw` CLI — install it and sign in before using the skills:

```
bun install -g @fireweaveai/cli
fw login --cloud
```

Full setup and troubleshooting: [`plugins/fireweave/.claude-plugin/SETUP.md`](./plugins/fireweave/.claude-plugin/SETUP.md).

## Learn more

- [fireweave.ai](https://fireweave.ai) — what Fireweave is and how it works
- [Book a demo](https://fireweave.ai/demo)
