# Fireweave Dev (Claude Code plugin)

Skills for developers building FireweaveAI integration plugins.

## Skills

- **scaffold-integration** — Scaffold a new `packages/integration-<name>/` directory with the standard manifest, Dockerfile, and entry point.

## Install

```
/plugin marketplace add FireWeave-HQ/plugins-marketplace
/plugin install fireweave-dev@fireweave
```

## Prerequisites

- A clone of the FireweaveAI platform monorepo (or a fork with the same `packages/integration-*` convention).
- Bun installed (`curl -fsSL https://bun.sh/install | bash`).
- Familiarity with the Integration SDK in `packages/integration-sdk`.
