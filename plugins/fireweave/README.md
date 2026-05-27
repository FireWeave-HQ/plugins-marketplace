# Fireweave (Claude Code plugin)

Skills for working with FireweaveAI directly from your AI coding tool.

## Skills

- **create-task** — File a new Fireweave task from the current editor context (selection, error, current branch).

## Install

```
/plugin marketplace add FireWeave-HQ/plugins-marketplace
/plugin install fireweave@fireweave
```

## Configuration

This plugin expects two environment variables to be available to the AI tool's shell:

- `FIREWEAVE_API_URL` — base URL of your Fireweave deployment (e.g. `https://api.fireweave.ai`)
- `FIREWEAVE_API_TOKEN` — personal access token from your Fireweave settings page
