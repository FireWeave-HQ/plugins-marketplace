# initialise

> One-time per-repo setup for FireWeave Rollouts. Detects coding agents + language + deploy targets, runs the capability/connection resolver to wire the right SDKs per function (PostHog OpenFeature provider for flags, direct OTLP exporter for telemetry), scaffolds the isProd() harness + fw-tracker + config, wires the harness into the app entrypoint, installs standing instructions + Cursor dev-loop rules/hooks (so feature work keeps rollout-ready manifests/anchors/stamps in sync), and writes agent links. Use when the user asks to "set up FireWeave rollouts", "initialise rollout-ready", "instrument this repo", or invokes `/fireweave:initialise`. `--reinit` / `--remove`.
>
> _User-triggered (Cline does not auto-activate workflows). Run with `/fw-initialise.md`._

> Interaction: gate each decision with `ask_followup_question` (one question per call; supply an `<options>` array). For multi-question groups, ask sequentially.

# Initialise (one-time rollout-ready setup)

Run **once** per repo. This front-loads the rollout structure so later shipping is
a **promote, not a wrap** (D26): it scaffolds a harness with BOTH branches present
(dev in-memory provider + console exporter; prod connected-vendor provider + OTLP),
wires it into the app entrypoint, and installs the **dev loop** (standing
instructions + Cursor rules/hooks) so every feature change keeps
`// @fireweave-flag` anchors, `.fireweave/rollout-ready/<feature>.json`, and
`fw-tracker` stamps aligned before `/fireweave:safe-rollout-fast`. It does NOT
wrap existing code.

V1 prod scope is **TS-server + web on PostHog**. For a surface with no vendor
provider (Go/Rust/Flutter), it scaffolds dev-only console wiring and prints an
explicit "prod deferred" notice — it never emits a half-wired prod branch that
would false-green `use_mcp_tool(server_name="rollout-server", tool_name="verify_prod_path")`.

## Step 0 — Auth precondition

Run `use_mcp_tool(server_name="rollout-server", tool_name="ensure_auth")` (authenticated profile + bound project).
On failure → `fw login` then `fw init` / `use_mcp_tool(server_name="rollout-server", tool_name="select_project")`,
and PARK. Then run the Step 0.1b tool-manifest check via
`use_mcp_tool(server_name="rollout-server", tool_name="list_registered_tools")`.

## Steps

| Step | Action |
|---|---|
| **1 — Repo gate** | `ask_followup_question`: *"Let FireWeave manage rollouts in this repo?"* **No → exit, touch nothing.** |
| **2 — Detect agents + language + deploy targets** | Detect coding agents (`CLAUDE.md`/`.claude/`, `.cursor/`, `.clinerules/`, `AGENTS.md`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`; default `AGENTS.md` + `CLAUDE.md`). Detect surface(s) → tier + harness profile. Detect deploy targets → the stamp-beacon tier. Record which agents are present (`cursor`, `claude`, `cline`, …) for Step 7–8. |
| **3 — Provider/connection resolution (capability-driven, D-PROVISION)** | Query the project's bound capabilities + connections via `use_mcp_tool(server_name="rollout-server", tool_name="guarded_call")` (→ `fw api`) and provision each FUNCTION from its backing vendor. **Flags:** if `feature-flags.flag.control` is not bound, hand off to the fw-webapp **OAuth connect** screen (browser-redirect, no CLI path) and PARK until bound. **Telemetry:** read each observability vendor's connection descriptor `{ vendor, otlpEndpoint, credentialEnvName }` and scaffold a **direct** app→vendor OTLP exporter — NEVER an `observability.ingest` proxy through FireWeave (the firehose stays out of FireWeave's data path). Always offer the FireWeave local dev provider. **Boot beacon (mandatory — BLOCKING):** call `use_mcp_tool(server_name="rollout-server", tool_name="provision_deploy_beacon_env")` with `{ apiSurface: true, webSurface: true }` when both ts-server + web harnesses exist; `{ apiSurface: true }` for API-only; `{ webSurface: true, apiSurface: false }` for web-only. **On `{ ok: false }` or missing tool → PARK** (do not continue to Step 4). **After success, verify on disk:** `.fireweave/deploy-beacon.env.local` contains both `FW_ATTEST_URL` + `FW_PROJECT_API_KEY`, and `.fireweave/.gitignore` lists `deploy-beacon.env.local`. Record both paths in `installedInto[]`. Then `ask_followup_question`: where will prod run (GitHub Actions secrets / VM env / docker-compose)? Show the tool's `cloudSecretDestinations` copy-paste block and PARK until the user confirms secrets are set. |
| **4 — Scaffold harness (both branches, D26)** | Generate `fireweave/fw-harness.<ext>` with the `isProd()` conditional: dev → in-memory OpenFeature provider + OTel console exporter; prod → the connected vendor's real provider + direct OTLP. The harness imports `fw-tracker/index`, imports `resolveBootBeaconFromEnv` from `@fireweaveai/deploy-sdk/attest`, and calls `initFwAttestation({ stamps: FW_STAMPS, ...resolveBootBeaconFromEnv({ env: process.env, prod }) })` via PLAIN static imports (no glob/embed/build script). **TS-server `.mjs` harness:** patch the API package `build` script to copy compiled harness artifacts — see **API Docker build** below. |
| **5 — Scaffold `fw-tracker/` + `.fireweave/`** | Empty `fw-tracker/` const tree at the idiomatic path; `.fireweave/changelog/` + `_archive/`, `.fireweave/rollout-ready/` (manifests), `PROVIDERS.md`, `config.json`. Ensure `.fireweave/.gitignore` contains `deploy-beacon.env.local` (the provision tool writes this — re-check if missing). Also write `.fireweave/hooks/rollout-build-gate.mjs` (see **Build-gate script** below) and `.fireweave/hooks/rollout-build-gate.sh` wrapper. |
| **6 — Wire the harness into the app entrypoint** | Inject `await initFwHarness()` as the FIRST awaited statement in the detected entrypoint, and record the location in `project.json.rolloutReady.harnessEntrypoint`. `use_mcp_tool(server_name="rollout-server", tool_name="verify_prod_path")` asserts this. |
| **7 — Standing instructions + agent links** | Write `.fireweave/agent-instructions.md` (see **Agent instructions template** below). Link it from every detected agent file (`AGENTS.md`, `CLAUDE.md`, …). **Do not** rely on a one-line link alone for Cursor — Step 7b is mandatory when `.cursor/` exists. |
| **7b — Cursor dev loop (when `.cursor/` exists)** | Write `.cursor/rules/fireweave-rollout-ready.mdc` (always-on rule; see template). Merge `rollout-server` into `.cursor/mcp.json` (see **MCP merge**). Ensure the four FireWeave skills exist under `.cursor/skills/` (copy from plugin dist or platform source if missing). Record every path in `installedInto[]`. |
| **8 — Hooks** | **Cursor** (when `.cursor/` exists): write `.cursor/hooks.json` + executable scripts under `.cursor/hooks/` (see **Cursor hooks**). **Claude Code** (when `.claude/` exists): optional `UserPromptSubmit` + `SessionStart` via `rollout-intent-gate.sh` in `.claude/hooks/` (same intent text as the Cursor rule). |
| **9 — Record + verify** | Write `project.json.rolloutReady` (`initialized`, `language`, `strategy`, `sourceRoot`, `trackerPath`, `changelogPath`, `harnessPath`, `harnessEntrypoint`, `rolloutCredentialEnv`, `webRolloutCredentialEnv` when web surface, `attestUrl`, `installedInto[]`, optional `rolloutMcpPlatformPath`). **Reconcile manifest credential env:** for each `.fireweave/rollout-ready/*.json`, set `harness.rolloutCredentialEnv` from surface — `ts-server` → `POSTHOG_PROJECT_API_KEY`, `web` → `PUBLIC_POSTHOG_KEY` (see **Credential env canon**). Run `use_mcp_tool(server_name="rollout-server", tool_name="detect_rollout_ready")` (anchor scan works). Run `use_mcp_tool(server_name="rollout-server", tool_name="reconcile")` with `phase: "build"` (should pass on empty tree). **Smoke:** run `use_mcp_tool(server_name="rollout-server", tool_name="verify_prod_path")` on one manifest per surface present; fix any **fail** before declaring done. Confirm `.fireweave/deploy-beacon.env.local` still exists. Tell the user to **reload Cursor** (Developer → Reload Window) so rules, hooks, and MCP reload. |

**`--reinit`** re-detects agent/language; **always re-runs** `provision_deploy_beacon_env` (rotates key if needed); refreshes harness/tracker/strategy, manifest credential-env fields, API build script, and Cursor dev-loop artifacts; never loses `.fireweave/changelog/`. **`--remove`** reads `installedInto[]` and reverses precisely (rule, hooks, hook scripts, agent links, harness wiring recorded in `installedInto`) in one command.

Every clarification uses `ask_followup_question`.

---

## Boot beacon env (Step 3 — URL + key, same treatment)

`FW_ATTEST_URL` and `FW_PROJECT_API_KEY` are a **pair**. Initialise provisions and documents them together — never one without the other.

| Artifact | Purpose |
|---|---|
| `.fireweave/deploy-beacon.env.local` | Gitignored local copy of **both** values for dev reference |
| `.env.example` | Names only (`FW_ATTEST_URL=`, `FW_PROJECT_API_KEY=`; add `VITE_FW_*` when web surface) |
| `project.json.rolloutReady.attestUrl` | Committed fw-server base URL (not secret) |
| Cloud deploy secrets | User copies **both** vars to GitHub Actions / VM / docker-compose |

**Tool:** `use_mcp_tool(server_name="rollout-server", tool_name="provision_deploy_beacon_env")` — calls `POST /v1/projects/:projectId/deploy-beacon-keys` via `fw api` (CLI bearer token). The session-gated `/api/projects/:id/ingest-keys` route is for the web control plane only.

**After the tool returns:** `ask_followup_question` — *"Where will production run?"* (GitHub Actions / VM / docker-compose / other). Paste the matching block from `cloudSecretDestinations`. PARK until the user confirms both secrets are set in that destination.

**Local dev (optional):** if the repo uses `.env.local`, pass `{ mergeRootEnvLocal: true }` to also merge both vars there.

**Never commit** `FW_PROJECT_API_KEY` or write it into tracked files other than the gitignored local env file.

---

## Credential env canon (Step 3 + Step 9)

PostHog credential env names differ by harness surface. Initialise must keep **`.env.example`**, **`project.json`**, and **each manifest's `harness.rolloutCredentialEnv`** aligned.

| Surface | `harness.rolloutCredentialEnv` | Host env | `project.json` field |
|---|---|---|---|
| `ts-server` | `POSTHOG_PROJECT_API_KEY` | `POSTHOG_HOST` | `rolloutReady.rolloutCredentialEnv` |
| `web` | `PUBLIC_POSTHOG_KEY` | `PUBLIC_POSTHOG_HOST` | `rolloutReady.webRolloutCredentialEnv` |

`provision_deploy_beacon_env` appends all required names to `.env.example` when `apiSurface` / `webSurface` are set. **Do not** use a single env name across both surfaces — `verify_prod_path` checks the manifest's surface-specific name.

On `--reinit`, patch every existing `.fireweave/rollout-ready/*.json` where `harness.rolloutCredentialEnv` does not match the surface row above.

---

## API Docker build (Step 4 — ts-server `.mjs` harness)

When the API harness lives under `src/fireweave/*.mjs` (compiled from TypeScript), the package `build` script must copy those files into `dist/` after `tsc`. Without this, Docker images ship without the harness.

Patch `packages/api/package.json` (or the detected API package) `scripts.build`:

```json
"build": "tsc && mkdir -p dist/fireweave && cp src/fireweave/*.mjs dist/fireweave/"
```

Record the patched `package.json` path in `installedInto[]` when changed.

---

## Agent instructions template

Write `.fireweave/agent-instructions.md` using repo-specific paths from Step 4–6. It MUST include these sections:

### Rollout-ready layout

Table of harness paths, `fw-tracker`, `.fireweave/rollout-ready/`, `.fireweave/changelog/`, `PROVIDERS.md`.

### Every feature change (dev — before `/fw-rollout-fast`)

1. **Gate** user-facing or risky behavior behind OpenFeature via the harness — not legacy direct vendor SDK calls.
2. Add `// @fireweave-flag <key>` at every flag evaluation site (grep-stable anchor).
3. Add or update `.fireweave/rollout-ready/<feature>.json` (manifest is the committed ship contract).
4. Set `change.stampId` in the manifest; append that id to `FW_STAMPS` in `fw-tracker/index.ts`.
5. Before marking the task done, run `use_mcp_tool(server_name="rollout-server", tool_name="detect_rollout_ready")` and `use_mcp_tool(server_name="rollout-server", tool_name="reconcile")` with `phase: "build"`; fix all **block** findings.

### Ship

Run `/fw-rollout-fast` only after the dev checklist passes — it **promotes** rollout-ready work; it does not wrap code.

### Do not

- Swap providers at promotion time.
- Route telemetry through FireWeave (OTLP direct to bound vendor).
- Delete `fw-tracker` stamps without `/fw-cleanup`.

---

## Cursor rule template (Step 7b)

Write `.cursor/rules/fireweave-rollout-ready.mdc`:

```markdown
---
description: FireWeave rollout-ready — mandatory conventions for every feature change in an initialised repo
alwaysApply: true
---

# FireWeave rollout-ready (promote-not-wrap)

Read [.fireweave/agent-instructions.md](.fireweave/agent-instructions.md).

## On every user-facing or flag-gated feature change

1. Implement behind the harness OpenFeature provider (not legacy direct PostHog/vendor calls).
2. Add `// @fireweave-flag <key>` at each evaluation site.
3. Add or update `.fireweave/rollout-ready/<feature>.json` (flags, wrapPoints, harness, telemetry, change metadata).
4. Link `change.stampId` in the manifest and append it to `fw-tracker/index.ts` `FW_STAMPS`.

## Before you finish a feature task

- Call `use_mcp_tool(server_name="rollout-server", tool_name="detect_rollout_ready")` and `use_mcp_tool(server_name="rollout-server", tool_name="reconcile")` with `phase: "build"`.
- Fix every **block** finding; do not leave orphan anchors or unmanifested flags.

## Ship path

`/fw-rollout-fast` promotes existing rollout-ready work only. If manifests/anchors/stamps are missing, complete the dev checklist first — do not use `/fw-rollout` unless explicitly migrating legacy code.
```

---

## MCP merge (Step 7b)

When `.cursor/` exists, ensure `.cursor/mcp.json` includes `rollout-server`:

1. Resolve platform path: `FIREWEAVE_PLATFORM_PATH` env → else walk parents for `fireweaveai-platform` → else `ask_followup_question` for the directory containing `packages/fw-plugins/.../rollout-server`.
2. **Merge** into existing `mcpServers` — read `.cursor/mcp.json` first, spread existing servers, add/overwrite only `rollout-server`. Never replace the whole file. Record the path in `project.json.rolloutReady.rolloutMcpPlatformPath`.
3. Use an **absolute** path in `args` — Cursor may ignore `cwd` when spawning MCP stdio.

```json
{
  "mcpServers": {
    "rollout-server": {
      "command": "bun",
      "args": [
        "run",
        "<FIREWEAVE_PLATFORM_PATH>/packages/fw-plugins/src/plugins/fireweave/mcp/rollout-server/src/server.ts"
      ],
      "env": {
        "PATH": "<FIREWEAVE_PLATFORM_PATH>/packages/fw-cli/bin:/usr/local/bin:/usr/bin:/bin"
      }
    }
  }
}
```

If the repo already has a published-plugin `rollout-server` entry, keep it — only add when missing.

---

## Build-gate script (Step 5)

Write `.fireweave/hooks/rollout-build-gate.mjs` — standalone Node (no extra deps). It prints JSON `{ pass, findings[] }` to stdout:

- Read all `.fireweave/rollout-ready/*.json` → collect manifest flag keys (parse `flags[].key`; skip invalid files with a block finding).
- Walk the **entire repo** from root for anchors — same coverage as `detect_rollout_ready` / `reconcile`: all `*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,go,rs,dart,py,rb,java,kt,kts,swift,php,cs}` files, skipping path segments `node_modules`, `dist`, `build`, `coverage`, and dot-directories (do **not** limit to `apps/` / `packages/` only).
- Match `@fireweave-flag <key>` in any comment leader (line, block, hash) — same regex as deploy-sdk.
- **block** if anchor key has no manifest entry.
- **block** if manifest flag has no anchor.
- **warn** if manifests exist but `FW_STAMPS` in `project.json.rolloutReady.trackerPath` (fallback: recorded tracker path) is empty.
- Exit `0` when `pass: true`, else `1`.

Write `.fireweave/hooks/rollout-build-gate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
if [[ ! -f "$proj" ]]; then exit 0; fi
initialized="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(j.rolloutReady?.initialized ? 'yes' : 'no');
" "$proj")" || {
  echo "rollout-build-gate: cannot read $proj" >&2
  exit 1
}
[[ "$initialized" == "yes" ]] || exit 0
node "$root/.fireweave/hooks/rollout-build-gate.mjs"
```

`chmod +x` the `.sh` file. Do **not** swallow probe errors (`2>/dev/null` + exit 0) — invalid `project.json` on an initialised repo must fail closed.

---

## Cursor hooks (Step 8)

**Merge** FireWeave hooks into `.cursor/hooks.json` — **never replace** the whole file. Existing events (`beforeMCPExecution`, `afterFileEdit`, …) must survive.

1. Read existing `.cursor/hooks.json`, or start with `{ "version": 1, "hooks": {} }`.
2. Under `hooks.sessionStart`, append (if not already present by `command`):
   `{ "command": ".cursor/hooks/fireweave-rollout-session.sh" }`
3. Under `hooks.stop`, append (if not already present by `command`):
   `{ "command": ".cursor/hooks/fireweave-rollout-stop.sh" }`
4. Write the merged JSON back. Do **not** paste a hooks.json that contains only FireWeave entries.

Write `.cursor/hooks/fireweave-rollout-session.sh` (executable):

```bash
#!/usr/bin/env bash
# Inject rollout-ready context when this repo is initialised.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
inst="$root/.fireweave/agent-instructions.md"
if [[ ! -f "$proj" ]]; then exit 0; fi
initialized="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(j.rolloutReady?.initialized ? 'yes' : 'no');
" "$proj")" || exit 1
[[ "$initialized" == "yes" ]] || exit 0
summary="FireWeave rollout-ready repo: follow .fireweave/agent-instructions.md on every feature change (anchor + manifest + stamp before /fw-rollout-fast)."
if [[ -f "$inst" ]]; then
  summary="$summary See agent-instructions for harness paths and dev checklist."
fi
printf '%s\n' "{\"additional_context\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$summary")}"
```

Write `.cursor/hooks/fireweave-rollout-stop.sh` (executable):

```bash
#!/usr/bin/env bash
# After agent work, nudge when rollout-ready artifacts drift.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
gate="$root/.fireweave/hooks/rollout-build-gate.sh"
if [[ ! -x "$gate" ]]; then exit 0; fi
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if "$gate" >"$out" 2>/dev/null; then exit 0; fi
findings="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log((j.findings||[]).map(f=>f.message).join('; '))" "$out" 2>/dev/null || echo 'rollout-ready drift detected')"
msg="FireWeave rollout-ready drift: ${findings}. Complete anchor + manifest + fw-tracker stamp per .fireweave/agent-instructions.md, then run reconcile phase build."
printf '%s\n' "{\"followup_message\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$msg")}"
```

Record `.cursor/hooks.json`, `.cursor/hooks/fireweave-rollout-session.sh`, `.cursor/hooks/fireweave-rollout-stop.sh`, `.cursor/rules/fireweave-rollout-ready.mdc`, `.fireweave/hooks/rollout-build-gate.mjs`, `.fireweave/hooks/rollout-build-gate.sh` in `installedInto[]`.

---

## Claude Code hook (Step 8, when `.claude/` exists)

Write `.claude/hooks/rollout-intent-gate.sh` (executable) that prints the same dev-checklist reminder when `rolloutReady.initialized` and the user prompt matches feature-intent keywords (`add`, `implement`, `feature`, `fix`, `ship`). Wire in `.claude/settings.json` hooks for `UserPromptSubmit` and `SessionStart` if not already present. Record paths in `installedInto[]`.

---

## Tool manifest

```json
{
  "SKILL_EXPECTED_TOOL_MANIFEST": [
    { "name": "ensure_auth", "server": "rollout-server" },
    { "name": "select_project", "server": "rollout-server" },
    { "name": "list_registered_tools", "server": "rollout-server" },
    { "name": "guarded_call", "server": "rollout-server" },
    { "name": "provision_deploy_beacon_env", "server": "rollout-server" },
    { "name": "detect_rollout_ready", "server": "rollout-server" },
    { "name": "reconcile", "server": "rollout-server" },
    { "name": "verify_prod_path", "server": "rollout-server" }
  ]
}
```
