# Fireweave MCP servers — one-time setup (cline)

This plugin bundles 1 MCP server(s):

- `rollout-server`

On **cline** the server launch path must be written into the host's config with
an **absolute** path (this host has no plugin-root variable like Claude's
`${CLAUDE_PLUGIN_ROOT}`). Run the Fireweave CLI once, pointed at this bundle:

```sh
fw mcp install cline --from /path/to/this/bundle
```

(`--from` defaults to the current directory if you run it from inside the bundle.)
It resolves the absolute `launcher.sh` path and merges it into VS Code globalStorage `cline_mcp_settings.json` (with `HOME`, which Cline doesn't forward to children),
injecting `FW_PLUGIN_ROOT` so the launcher self-locates.

The first MCP launch downloads the matching native binary (~50–100 MB) from
GitHub Releases; later launches run offline from the cache.

Don't have the `fw` CLI yet? `bun install -g @fireweaveai/cli`, then `fw login`.
