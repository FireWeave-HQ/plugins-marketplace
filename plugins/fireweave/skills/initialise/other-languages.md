# Initialise — other languages and scaffold surfaces

`SKILL.md` sets up TypeScript servers and web apps with FireWeave's setup core.
This file is the rest: apps in Python, Go, Java, Rust, Dart and Swift, and
scaffold surfaces (an app that already carries `fw-harness.*`). Run it after
the core (`SKILL.md` Step 8), for those apps only. Step 0, the repo gate, the
coding agents, the environments and the setup plan's answers already ran in
`SKILL.md`: do not ask them again. The agent-instructions template and the SDK
configuration sections it names are in `templates.md` beside this file.

## Steps (other languages)

<!-- prettier-ignore -->
| Step | Action |
| --- | --- |
| **1 — Repo gate** | Already answered in `SKILL.md` Step 1: do not ask again. |
| **2 — Detect agents + language + deploy targets** | Detect coding-agent markers on disk (`CLAUDE.md`/`.claude/`, `.cursor/`, `.clinerules/`, `AGENTS.md`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`). Detect surface(s) → tier + harness profile. Detect deploy targets → the secret destinations Step 3c offers. **The coding agents were chosen in `SKILL.md` Step 3b:** use that `teamAgents` for Steps 7–8; do not ask again. Teammates who join later on an agent missing from `teamAgents` run `/fireweave:adopt`. |
| **3 — Environment map + provider/connection resolution (capability-driven, D-PROVISION; SCN-16 gate-before-write)** | **Hard gates first — no disk.** **3a — Enumerate environments (in memory).** Via `fw tool list-project-environments` with `{ "projectId": "<projectId>" }` (fall back to reading `.fireweave/project.json`), read the full environment list and `defaultEnvironment`. Classify each environment into a **tier**: use the API's `tier`/`kind` field when present; otherwise treat `defaultEnvironment` as `dev` and confirm the **prod-tier set** with one `AskUserQuestion` (multi-select the environments that run real user traffic — e.g. `staging`, `production`). Build the env→tier **profile map** (becomes harness `FW_ENV_PROFILES` in Step 4) **in memory only** — **do not** persist `rolloutReady.environments` yet. **A package surface gets no profile map:** the start profile infers its own mode, so nothing is generated from this for it; the tier list still decides which destinations 3c asks about. **3b — Resolve capabilities per tier (do NOT wire prod from the dev env; still no disk).** **Read `automation` off the same `fw tool get-project-capabilities` result before anything else in this step** — `{ autoRampEnabled, … }`, the project-scoped release-automation settings. They are what decides whether an OPTIONAL family is actually required here: `observability` iff `autoRampEnabled`. It defaults OFF, so on a fresh project the honest answer is usually "this addon is optional". **An unreadable `automation` block is a hard PARK — write nothing.** Absent (an fw-server that predates the optional-automation feature), a transport or auth failure, or a malformed block all mean _we could not ask_, and that is NOT the same answer as _the operator turned it off_. Never synthesize `{ autoRampEnabled: false }` from a failed read: that fabricates permission to skip an addon the project may genuinely require. Say which read failed, tell the user to restore connectivity or upgrade fw-server, and stop. For the **dev branch** the FireWeave local provider needs no vendor binding. For the **prod branch**, run `fw tool get-project-capabilities` with `{ projectId, environment: <prod-tier env> }` — the family Binding (`bindings.observability` `{ integrationId, connectionId, state }` — the QUERY leg; there is no OTLP target in it; see (2)) MUST come from the **prod-tier** environment, never the default/dev one. When multiple prod-tier environments exist, resolve each. Do not write `harness.posthogProjectId`: every environment shares FireWeave's managed control-points project, so there is no per-environment PostHog project to record (09 §6 g). **Capability XOR (SCN-8 / INIT-B11 / FIR-290) — classify before writing anything.** After `fw tool get-project-capabilities`, per prod-tier env: (1) **Control points are always ready.** Every environment carries its control-points Binding from creation, served by FireWeave; there is nothing to check, connect or wait for, and no hand-off (09 §3, §6 g). (2) **Observability ready? — classify on the VENDOR, never on an endpoint.** FireWeave's observability binding is its **query leg**: how fw-server reads guardrail metrics back out of the vendor (`connectionId`). It does **not** carry the app's OTLP ingest target and never will — `otlpEndpoint` / `credentialEnvName` are not fields any capability descriptor produces (the OpenObserve Integration, `packages/integration-openobserve/src/index.ts`, serves `observability.*.query` capabilities and no ingest capability). The app's **export leg** — a direct app→vendor OTLP exporter — is **deployment config the operator supplies**, exactly like `FW_ATTEST_URL` / `FW_PROJECT_API_KEY`. So: the capabilities response is keyed by family — `bindings.observability.state` (the **Metrics** unit; Logs and Traces are separate units under `bindings.observability.signals`) is `bound` → observability **bound** (read its `integrationId`); `unbound` or `needs-attention` → **unbound**. **Matrix:** **obs-bound** → **detect how this repo already emits, per surface. Do NOT scaffold an exporter.** FireWeave does not own telemetry initialisation: a repo that has not chosen an observability SDK has not asked FireWeave to choose one for it, and an exporter FireWeave writes is one the team never reviewed and does not maintain. NEVER an `observability.ingest` proxy through FireWeave either. And **never** defer telemetry merely because the descriptor carries no endpoint: it never does, for anyone — that is the expected shape, not a gap (**FIR-354**). **What to detect, per surface — two answers from one read:** (1) **Is telemetry initialised at all?** Look for the provider/client construction itself, not call sites — an OTel `MeterProvider`, a vendor SDK client, a StatsD connection, whatever this repo actually chose. **None found → tell the user which surface, and PARK.** Say plainly that without an initialised metrics client a rollout on that surface can only ramp manually, because there is nothing for the soak to query. Do not fill the hole. (2) **What does it already emit?** Inventory the metric names this surface emits today, where, and what each measures. This is what makes REUSE possible at change time: the vendor's metric list (`observability.metric.list`) says which names exist, but only the repo says where each is emitted and what it measures. Both answers go into `.fireweave/agent-instructions.md` at Step 7 (**How to emit a metric**), and the resolved client is recorded as `surfaces[].metricsClient`. obs-unbound (**INIT-B11**) → print **"observability deferred — no observability vendor bound"**; `AskUserQuestion`: bind observability in the portal **now**, or **continue with deferred telemetry**. **What a refusal costs depends on `autoRampEnabled` (3b).** With auto-ramp **off**, observability is a genuinely optional capability and a deferral is the _expected_ outcome, not a failure — **soft-continue** (awaiting-user, never PARK), record the deferral in the session summary, and carry on. With auto-ramp **on**, the soak observer is what automatic advancement trusts, so an unbound metrics vendor is a broken promise rather than a preference: name auto-ramp as the reason it is required, and **Refuse/cancel → hard PARK — write nothing**. Never PARK a project for declining an addon it never enabled. On continue, write **no telemetry at all** — the harness never carried any and does not gain any here; **never** emit a half-wired OTLP exporter (empty endpoint, placeholder creds, or ingest proxy). Record the deferral in the session summary, naming what it costs: no bound metrics provider means no guardrail can be read back, so every rollout on this project ramps manually. Always offer the FireWeave local (in-memory + console) provider for the **dev** tier. **3c — Where the credentials will go (no secret is minted anywhere in this skill).** If the profile map has **no prod-tier environment** (dev-only), SKIP this question, print **"prod deferred — no prod-tier environment configured"**, and continue to **3d** (still no disk). Otherwise the **prod control-points path** needs the runtime credential pair in every prod-tier deploy destination: `FW_API_URL` (the fw-server base URL) and `FW_PROJECT_API_KEY` (the bearer the harness sends to fw-server `/v1/control-points/evaluate`) — plus the `PUBLIC_FW_*` pair when a web surface exists, whose key comes from a DIFFERENT panel. **Initialise issues neither.** Both come from the portal's **Project settings → API keys** page: `project-api-key_…` from **Project API keys** (server), `fw_public_…` from **Browser keys** (web). `AskUserQuestion`: for each prod-tier environment, where will it run? Offer only destination **kinds** from the tool union `github_actions`\|`vm_env`\|`docker_compose`\|`other` (map Step 2 labels such as Render → `other`/`vm_env` as appropriate). Default/dev-tier needs NO prod secrets. Confirm the user will set the pair in that destination after issuing the keys. **When 3b classified the env obs-bound**, the same destination also needs the OTLP **endpoint** + **credential** vars the Step 4 harness reads (FireWeave never holds these — the export leg is the operator's, see (2)); name them explicitly in the same question so the operator sets one set of secrets, once. **Refuse → soft-continue (awaiting-user, never PARK):** still call `record-rollout-env-contract` (it writes no secret — only `fireweave.md` and `.env.example` NAMES, which are exactly what an undecided operator needs later), keep every other scaffold, and record in the session summary that the prod branch will refuse to boot until the pair is set — the harness fails loudly, never silently, on missing prod credentials. **3c for a package surface (K11) — one variable, never a pair.** _Server profile_ (ts-server, Python, Go, Java, Rust, a Dart server, a Swift server): `FIREWEAVE_KEY`, the project key (`project-api-key_…`) — still issued by the operator in the portal's **Project API keys** panel, never by this skill — once per prod-tier destination. No `FW_API_URL`: the endpoint is the SDK channel Step 4's install records. Ask about `FIREWEAVE_URL` **only** when `project.json` `server.kind === 'custom'` (self-hosted, bench, or a FireWeave dev stack, whose `dev` channel has no endpoint of its own); it then goes beside the key, never into code. _Client profile_ (web, a Dart client, a Swift app — `detect-surfaces` reports `clientShipped: true` for them, and a client-shipped surface never gets a server key): `FIREWEAVE_BROWSER_KEY`, a browser key (`fw_public_…`), once per **BUILD** destination — CI, the host's build settings, a Docker build arg; Dart: CI `--dart-define` or a git-ignored `fireweave.env` define file; Swift: Info.plist `$(FIREWEAVE_BROWSER_KEY)` fed from a git-ignored `Fireweave.local.xcconfig` or CI. Record **one build destination per prod-tier environment** (slug → destination): each environment gets its own scoped key in 3f, and that key goes only to its own environment's destination. **Never a developer `.env`:** a key there turns every local run remote. Here, only ask where each environment's key goes; the key is issued after Step 3f mints the `surfaceId` it is labelled with (see 3f). **3d — Environment source (project-native, confirm-first; still no disk).** Determine how the harness learns the running environment NAME — see **Environment source** below. Prefer the project's existing env signal; only fall back to `FW_ENV`/`PUBLIC_FW_ENV` if the user opts in. Always `AskUserQuestion` before scaffolding. **A package surface gets ONE question instead:** does the app (web, Dart, Swift: the build) already name its environment in a variable other than `FIREWEAVE_ENV` / `APP_ENV` (ts-server: or `NODE_ENV`)? Yes → Step 4 passes it as the start call's `environment` option in that language's spelling (per-language reference), read from the app's own config; never hand the SDK an app-side default such as `"dev"`. No → leave the option out. **3e — First scaffold write batch (commit-point; only after 3a–3d pass).** Track **scaffold/ship** paths in session-only `sessionWrote[]` (include `.fireweave/.cache/**` when present) — **never** the Step-0 bind `project.json`. (1) Run `fw tool record-rollout-env-contract` — it records the env contract, writes the committed `fireweave.md`, appends `.env.example` NAMES, and **mints nothing** — with `{ apiSurface: true, webSurface: true }` when both ts-server + web harnesses exist; `{ cwd, apiSurface: true }` for API-only (a `java` or `python` surface counts as API here); `{ cwd, webSurface: true, apiSurface: false }` for web-only. Pass `webappUrl` when known, so the operator gets a clickable link instead of a path. **Package surfaces are not in this call** — they get their own call after Step 3f, which mints the `surfaceId` package mode needs (see 3f); this one covers scaffold surfaces, and a repo with none skips it. Call it **whether or not** a prod-tier env exists and whether or not 3c was declined: it is documentation, not provisioning. **On a missing tool → soft-continue**, naming the gap — a missing readme is a worse-documented repo, not a broken one. (There is no `{ ok: false }` PARK here any more: the call that could fail was the key mint, and it is gone.) (2) Then persist in-memory `rolloutReady.environments`, `defaultEnvironment`, resolved `posthogProjectId` fields, and Step 2 `teamAgents` into `.fireweave/project.json` (bind fields stay; do not rewrite org/project ids). **On success, verify on disk:** when a scaffold surface exists, `fireweave.md` exists at the repo root, names every variable the DETECTED surfaces need, and contains **no** value matching a key prefix. Record it in `installedInto[]` — it is committed, not gitignored. Show the tool's `userPrompt`, which names the portal page, which panel issues which key, and the variables for this repo's surfaces. Then **soft-continue (awaiting-user — not PARK)** until the user confirms secrets are set — confirmation is on trust; the prod boot failing loudly on a missing pair is the real gate. |
| **3f-pre — Detect surfaces, then let the user SELECT** | Run `fw tool detect-surfaces` — and on a re-init with the input `{ declared: <project.json surfaces[]> }`. It is the deterministic replacement for the old "detect surface(s)" prose: topology -> language -> deployability -> app-vs-library via the dependency graph. **It PROPOSES; it never declares.** Every row carries a NAMED verdict and the evidence behind it. **Show the user every row, then ask** (one `AskUserQuestion` multi-select, gate `GATE-3F-SURFACE-SELECTION`): pre-tick exactly the rows with `preselect: true`, and leave `ambiguous`, `undecidable` and every library unticked but VISIBLE and selectable — a library the user knows is deployed must be choosable, and an ambiguous row is a question, not a guess. For an `ambiguous` row also show `alternatives` so the user can pick WHICH surface it is. **`unreadable` is not an error channel — print it.** A zone that could not be read contributes no surfaces, which looks exactly like a zone that has none; silently dropping it is how a whole package goes uninstrumented with a green run. If `unreadable` is non-empty, name each path and its reason before asking. **Never auto-declare on a weak verdict** and never declare a row the user did not tick. The selection is recorded by Step 3f's declaration: the declared `surfaces[]` is what a re-run reads back as `declared`, so a re-run starts from the user's choice. **Re-init drift (`drift.needsReview === true`):** a surface that was declared before and is not detected now is **FLAGGED, never auto-retired** (gate `GATE-3F-VANISHED-SURFACES`). It has two indistinguishable causes — genuinely deleted, or invisible this run (moved directory, unreadable manifest, glob that stopped matching, missing submodule) — and the costs are asymmetric: a stale declaration is noise, a wrongly-retired one destroys an `sfc_` id the server issued and a committed harness still references, and it fails at SHIP, not here. Ask; do not decide. A moved surface appears as vanished + added rather than a silent rebind, which is deliberate — the `(surface, path)` pair is the same key the server matches a re-declare on. **Detection is advisory, not a gate:** if the tool is unavailable (older bundle), say so and fall back to asking the user to name the surfaces directly — never PARK on it, and never skip the ASK. **For the start profile, each row also carries** `startProfile` (the suggested `server` / `client` profile — record it for `dart` and `swift`), `clientShipped` (always present; `true` means never wire a server key), `entrypoints[]` (`{ path, detail, clientShipped }` — where Step 6 puts the start call) and, for an Android module, a `refusal` to show rather than declare. Aggregator modules and client-shipped Go / Java / Rust binaries arrive with `preselect: false`. |
| **3f — Declare surfaces (server mints the IDs)** | **The server mints every `sfc_` id. You never do.** When `SKILL.md` Step 4 ran (a `ts-server` or `web` app was ticked too), its one declare call already carried these surfaces: take their ids from it and skip this call. Otherwise run **exactly one** `fw repo declare-surfaces --project {projectId} --json --surfaces '[{"surface":"<ts-server \| web \| python \| go \| rust \| dart \| java>","path":"<harness module path>","entrypoint":"<app entrypoint>","rolloutCredentialEnv":"<FW_PROJECT_API_KEY \| PUBLIC_FW_PROJECT_API_KEY>"}]'` carrying EVERY surface detected in Step 2 — **ONE call carrying EVERY surface**, never one call per surface (the server resolves them against one snapshot and refuses the whole set if any collides; two calls would let the first half land and the second conflict). Pass `surfaceId` only for a surface that already carries one in `project.json` — omit it and the server mints. Read the returned `surfaces[].surfaceId` and carry it into Step 4. **`path` must be the exact path Step 4 will write** — it is half the key the server matches a re-declare on, and both writers treat it as fill-only, so a predicted path that Step 4 then contradicts is sticky: the next `--reinit` declaring the real path misses the key and mints a SECOND id. If Step 4 ends up writing elsewhere, re-run this step with the real path before recording anything. **`outcome` per surface:** `minted` (new), `existing` (already on file for this project at this harness path — the healthy answer for a repo whose pointer was lost), `adopted` (your id, newly claimed), `already-registered` (your id, already ours). **Non-zero exit → PARK.** The command fails closed on an unreachable server, a 5xx, and on `conflict` (a `sfc_` id homed under another project — 409, and NOTHING was declared). There is no local-mint fallback and you must not invent one: an id the server never issued is exactly the unclaimed id this step exists to abolish, and it fails at ship instead, as `SURFACE_PROJECT_CONFLICT`. On `conflict`, name the colliding surface and its incumbent project to the user; the usual cause is a harness copied from another repo. When the failure is **`error: unknown command 'declare-surfaces'`** (exit 1), the repo holds a `fw` binary older than this command — the skill bundle and the CLI ship on independent release paths, so a current bundle with a stale binary is the ordinary case, not an exotic one. Tell the user to run `fw self-update` and re-run; do **not** read that error as a conflict, and do **not** work around it by minting an id locally. This call is also the first server-side evidence that initialise ran against this repository (it records the declaring repo), so it happens BEFORE any harness is written, not after. **Package surfaces:** add `"harnessKind":"package"` to the entry, and set `path` (and `entrypoint`) to the **entrypoint file that carries the start call** — there is no harness module to name, so this is the exact file Step 6 edits — and `rolloutCredentialEnv` to `FIREWEAVE_KEY` (server profile) or `FIREWEAVE_BROWSER_KEY` (client profile). `startProfile` (`dart`, `swift`: `server` or `client`, from `detect-surfaces`) goes on the `project.json` entry. Existing scaffold surfaces are declared exactly as before, with no `harnessKind`. **Then issue each package client surface's browser key** with `fw tool issue-browser-key --input-file .fireweave/tmp/issue-browser-key.json --write-to .fireweave/tmp/browser-key-<slug>` and the input `{ projectId, surfaceId, environment }`, once per prod-tier environment from 3a (its slug; the key serves that environment only and is labelled `fireweave-init:<surfaceId>@<slug>`; omit `environment` only for 3a's `synthesised` placeholder): `issued` → the key is in `.fireweave/tmp/browser-key-<slug>` (git-ignored; it is never printed). Hand it straight to **that environment's** build destination from 3c and no other (offer to set it with that destination's own CLI, only on explicit confirmation), then delete the file before the next environment's key is issued, and never echo it into another file, a log or the session summary; `exists` → a key labelled for this surface and environment is already active and its secret cannot be shown again, so the user reuses it from where they stored it, or — on explicit confirmation — re-run with `rotate: true`; `fallback-portal` → print its `reason` and send the user to the portal's **Browser keys** panel. When a result carries `unscopedPredecessors` (project-wide keys an earlier run issued under `fireweave-init:<surfaceId>`; they serve every environment), tell the user to revoke those ids in **Browser keys** once every environment's destination holds its scoped key. A refusal is a soft-continue, never a PARK; any other tool error is reported as one, never silently replaced by the portal path. **Then record the package surfaces' env contract:** `fw tool record-rollout-env-contract` with `{ packageSurfaces: [{ surfaceId, surface, startProfile?, buildDestinations? }] }` (`startProfile` is required for `dart` / `swift`; `buildDestinations` are the client profile's 3c answers). A server profile gets `FIREWEAVE_KEY=` (plus `FIREWEAVE_URL=` only when `server.kind === 'custom'`) in `.env.example`; a client profile gets `FIREWEAVE_BROWSER_KEY` as a **build** variable with no `.env` entry; neither gets `fireweave.md`. Show the result's `packageSurfaces[]` (`credentialEnv`, `credentialKind`, `envExampleVars`, `buildVariables`, `buildDestinations`) to the user. It creates no `project.json` surface entry — that is Step 9's. |
| **4 — Scaffold harness (environment-keyed, both branches, D26)** | **Package surface → no template.** Install the SDK (`resolve-sdk-install` with `harnessKind: 'package'` and Step 0.0's `channel`, plus `startProfile` for `dart` / `swift` — the four-step flow under **SDK dependencies**), then write that language's control-points file and start call from **Start profile — per-language reference** (web: also the build helper), with the Step 3d `environment` option when there was one; nothing else in this row applies to it. **Scaffold surface →** **Read the surface's templates from `harness/<surface>/` — resolved relative to THIS `SKILL.md`'s own directory, not the target repo — and generate EVERY file the surface's row lists**, never just one: a `ts-server` / `web` surface emits `fireweave/fw-harness.ts` **and** `fireweave/fw-providers.ts` (the harness imports `makeConnectedVendorProvider` / `makeDevProvider` from `./fw-providers` — a single-file harness does not resolve); a `python` surface emits three snake_case modules; a `java` surface emits the three `Fw*.java` classes into the app's `<base package>.fireweave` package (directory must match the package — rewrite the templates' `package fireweave;` line accordingly). Never hand-author a harness from this row's prose; see **Harness templates — where they live (Step 4)** below for the surface→dir map, the substitution list, and what to do when the templates are missing. Emit the `FW_ENV_PROFILES` map + `FW_DEFAULT_ENV` from Step 3a's env→tier profile (do NOT ship the template's placeholder rows unchanged — regenerate them from the project's environments). The harness resolves the running environment NAME (`resolveFwEnvName`), looks up its tier, and selects the control-point provider: `dev` → the SDK's in-memory local mode; `prod` → the connected vendor's real provider. **The harness wires NO telemetry, in either tier.** FireWeave does not initialise an observability SDK in a repo — the templates carry none and `harness-templates.test.ts` asserts they never gain any. Step 3b's observability descriptor is the QUERY leg (how fw-server reads a guardrail metric back during a ramp), not an exporter for FireWeave to write; whether the app emits anything at all is DETECTED at Step 3b, never scaffolded. `isProd()` is retained ONLY as the unknown-env tier fallback and the token `verify-prod-path` greps for. The surface ids Step 3f's `fw repo declare-surfaces` returned are recorded in `project.json` `surfaces[].surfaceId` ONLY (Step 9 / see the `--reinit` surfaces section) — the harness carries no surface-ID block and no attestation wiring (deploy attestation is retired; merge attestation supersedes the boot beacon). **Never mint an `sfc_` id yourself** — not by hand, not with an inline script. The server owns `sfc_` identity (`surface_registry.surface_id` is a global primary key), and a locally-invented id is unclaimed and collides later as `SURFACE_PROJECT_CONFLICT`. The harness resolves `fwEnvName` from **the project's own env signal** — the generated `readEnvSignal()` + `FW_ENV_ALIASES` block (see **Environment source** below / Step 3d) — so **no FireWeave-specific `FW_ENV` / `PUBLIC_FW_ENV` is required**. Do NOT instruct the user to set `FW_ENV` per environment unless they explicitly chose the FireWeave-var option in Step 3d; `FW_ENV` is an optional override only. **TS-server `.mjs` harness:** patch the API package `build` script to copy compiled harness artifacts — see **API Docker build** below. |
| **5 — Scaffold the tracker + `.fireweave/`** | **Package surface (D7):** create its stamps file empty, in exactly this shape — `.fireweave/stamps.ts` (ts-server, web): `export const FW_STAMPS = [];` with the same entry shape as a scaffold `fw-tracker`, surface-tagged; `.fireweave/stamps.py` (Python): `FW_STAMPS: list[str] = []`; `.fireweave/stamps.json` (Go, Java, Rust, Dart, Swift — a file no build compiles): `{ "FW_STAMPS": [] }`, entries `"stmp_…"`. Two surfaces that map to the same file share it. Record it as that surface's `surfaces[].trackerPath` (top-level `surfaces[]`, which `reconcile` and `assert-dev-checklist` read), and write no tracker module and no `.fireweave/PROVIDERS.md` for it. **Scaffold surface:** **Every surface gets ONE tracker MODULE beside its harness in `fireweave/` (`fireweave_harness/` for Python), generated in Step 4 from that surface's own template** — `ts-server` / `web` → `fw-tracker.ts.tpl`, `python` → `fw_tracker.py.tpl`, `java` → `FwTracker.java.tpl`, `swift` → `FwTracker.swift.tpl`, `go` → `fw_tracker.go.tpl`, `rust` → `fw_tracker.rs.tpl`. One shape for every language: do NOT create the old `fw-tracker/` DIRECTORY anywhere. **Record each tracker on its surface's own entry — `surfaces[].trackerPath`** (or `rolloutReady.harnesses[].trackerPath`). **Do NOT write the legacy `rolloutReady.trackerPath` / `webTrackerPath`** — they are a two-surface model, superseded, and writing them creates a second source of truth that drifts. An unrecorded tracker downgrades a stamp BLOCK to a warn in `assert-dev-checklist` check 4. `.fireweave/PROVIDERS.md`. **Create NO `rollout-ready/`, NO `changelog/`, NO `_archive/`, and NO `config.json`** — see _What initialise puts in git_ above; manifests and stamps are server-owned and an empty directory is just a second place a future reader looks. Ensure `.fireweave/.gitignore` covers `local.json`, `.cache/`, `.queue/`, `.lock`, `tmp/` (`.queue/` is where older builds kept unsynced edits; `tmp/` holds the `fw tool` input files — re-check if missing; never tell a user to delete the outbox `.git/fireweave/outbox/` as a cache remedy). The build gate (`.fireweave/hooks/rollout-build-gate.mjs` and its `.sh` wrapper) comes from Step 8's `fw tool install-agent-hooks`; never write it yourself. |
| **6 — Wire the harness into the app entrypoint** | **Package surface:** put the start call FIRST, exactly as the per-language reference's **Start call** column says — exactly one start per process, nothing FireWeave-related before it, never `initFwHarness()`. **Scaffold surface:** Inject `await initFwHarness()` as the FIRST awaited statement in the detected entrypoint, and record the location in `project.json.rolloutReady.harnessEntrypoint`. `fw tool verify-prod-path` asserts this. |
| **6b — Cohort identity wiring (always-on, INIT-S8)** | Locate (or, with the user's confirmation, wire) the identity bind for each surface — see **Cohort identity wiring** below. The bind runs **unconditionally** on auth / sign-out: never inside a control-point branch, never behind a `// @fireweave-controlpoint` anchor. Record the identity module in `installedInto[]` when initialise writes it. A package surface uses its SDK's own call (per-language reference, **Identity** column). |
| **7 — Standing instructions + agent entry files** | Write `.fireweave/agent-instructions.md` (see **Agent instructions template** in `templates.md`; when `SKILL.md` Step 7's `setup-post` already wrote it for the TypeScript and web apps, add only these apps' sections). **Then the agent entry files, from FireWeave's renderer, never by hand:** write `{ "teamAgents": [<Step 2's teamAgents>] }` to `.fireweave/tmp/render-entries.json` and run `fw tool render-entries --input-file .fireweave/tmp/render-entries.json`. It writes the repository-root `AGENTS.md` (FireWeave's gate: when its instructions apply), `.fireweave/instructions/contract.md` (the rollout contract the gate points at), the `CLAUDE.md` block that imports it, the Cursor rule `.cursor/rules/fireweave-rollout-ready.mdc`, for the agents in `teamAgents` one path rule per app, and FireWeave's block in each other coding agent's file the repository already has (`.github/copilot-instructions.md`, `.junie/AGENTS.md`, `AGENTS.override.md`, `GEMINI.md`; see **Agent entry files for other coding agents**): the same bytes FireWeave's cloud setup writes for this tree (see **Agent entry files**). It replaces an older FireWeave block in place (every always-loaded block becomes the `format=3` gate; the contract is `format=2` once the project's capabilities allow it, else `format=1`), moves the gate's Claude copy from the older `.fireweave/agents-core.md` to `.fireweave/agents-gate.md`, and removes the HARD ORDER blocks older skills appended. **Never write or edit `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.fireweave/agents-gate.md`, `.fireweave/instructions/contract.md` or the Cursor rule yourself**, and never add a HARD ORDER block or a hand-written Cursor rule beside them. Record every path in `result.rendered` in `installedInto[]`, and tell the user each line of `result.todos`. When the project's sync mode is outbox, the same call installs the git pre-push hook that runs `fw sync` for the pushed branches (`result.prePushHook`; it is added to an existing hook, never replaces it); tell the user what it says. An entry `skipped` because someone edited FireWeave's block: ask the user whether to replace it, and on yes run the tool again with `"editedBlock": "replace"` added to the input. A non-zero exit writes nothing: report its `reason` and clear the cause (`fw login` for exit `3`, retry for `5`) before Step 9. Steps 7b and 7c then add each host's dev loop for **every agent in Step 2 `teamAgents`**, not only folders present on this machine. |
| **7b — Cursor dev loop (when `cursor` ∈ `teamAgents`)** | The always-on Cursor rule `.cursor/rules/fireweave-rollout-ready.mdc` and the per-app rules come from Step 7's `fw tool render-entries`: this step writes no rule. **No MCP wiring (see **No MCP wiring** below):** the skills run FireWeave's tools as `fw tool …` on every host, so do **NOT** write or merge `.cursor/mcp.json`, do **NOT** copy `mcp/rollout-server/` into the repo, do **NOT** download `bin/server-*`, and do **NOT** set `rolloutReady.mcp.mode`. If initialise runs on a non-Cursor host but `cursor` was selected for teammates, still write the hooks and skills so they are committed. If a repo-local `mcp/rollout-server/launcher.sh` or a `.cursor/mcp.json` rollout-server entry already exists → delete it: that transport is retired. Ensure the FireWeave skills exist under `.cursor/skills/` (copy from the installed plugin bundle only — includes `adopt` + `feedback`). **Copy each skill's WHOLE directory, never `SKILL.md` alone** — initialise's `harness/**` templates live beside it and Step 4 cannot run without them (C27). Record every path in `installedInto[]` — never include `mcp/`. |
| **7c — Claude Code dev loop (when `claude` ∈ `teamAgents`)** | Symmetric with 7b. Claude Code's always-on surface is the `CLAUDE.md` block Step 7's `fw tool render-entries` writes: it imports FireWeave's gate from `AGENTS.md` (from `.fireweave/agents-gate.md` when your `CLAUDE.md` does not import `AGENTS.md`), so never inline a HARD ORDER block beside it or edit it. Record `CLAUDE.md` (from `result.rendered`) in `installedInto[]`. |
| **7d — The merge gate** | Once this repository is set up, FireWeave makes its readiness check, "FireWeave — rollout readiness", required on the repository's environment branches, through its own ruleset of that name. It starts after 14 days' notice, and the PR check's footer shows the date. From then on, pull requests into those branches need the check to pass; repository admins can still merge past a failing check, case by case. There is nothing to configure: do not add a ruleset or branch protection for this check yourself. Never change FireWeave's ruleset, and never merge with `gh pr merge --admin` for the user. To opt out, a repository admin disables or deletes that ruleset in GitHub once it appears; FireWeave records it and never turns it back on by itself. If you uninstall or suspend the FireWeave App, delete the ruleset 'FireWeave — rollout readiness'. `fw doctor` shows the gate under "Merge gate". |
| **8 — Hooks** | **The hooks come from FireWeave's installer, never by hand** (skip this step when `SKILL.md` Step 7 already ran `setup-post`, which ran it). For the `claude` / `cursor` agents in `teamAgents`, write `{ "mode": "install", "hosts": [<them>] }` to `.fireweave/tmp/install-agent-hooks.json` and run `fw tool install-agent-hooks --input-file .fireweave/tmp/install-agent-hooks.json`. It merges FireWeave's entries into `.claude/settings.json` and `.cursor/hooks.json` (team entries never move or change), writes the agent gate, the build gate and each host's stop hook under `.fireweave/hooks/` from the copies in this `fw` and makes them executable, and retires the old intent and session hooks. A `modified` file is kept: ask the user, and on yes run it again with `"editedHooks": "replace"` added. Tell the user each line of `result.todos`. Every path in `result.files` and `result.scripts` whose `change` is `write` goes into `installedInto[]`. |
| **9 — Record + verify** | **Repo-scoped config goes to the server, not into the file.** Do not call `fw tool update-repo-state` here: hand every field these surfaces own to `SKILL.md` Step 9.1, whose ONE call (input `{ "fields": { … } }`) carries them with the setup core's — `sourceRoots`, `scanExclude`, `teamAgents` (Step 2), `installedInto[]`, `language`, `strategy`, `sdkDev`. Do not send `mcp.mode`: it described the retired MCP transport. **Never hand-write those seven into `project.json`:** one writer, one merge policy. Set fields UNION (so two concurrent `--reinit`s cannot clobber each other) and the FIRST write materialises the full derived set — which is why a partial first call is a one-way door for anchor-scan scope. The write is **online-only and fails closed** (a queued field merge would union against a row that moved underneath it); on `outcome: 'refused'` → PARK, do not fall back to editing the file. The tool writes **no file at all** — the seven fields live only in the server row, so do not look for them in `project.json` afterwards and do not hand-write them there when they are absent. **The pointer keeps only what has no server home:** identity (`fw select-project` and `fw init` own `orgId`/`projectId`/`projectName`/`projects{}`), `server.url`, top-level `surfaces[]` (the `sfc_` ids Step 3f's server declaration returned + per-surface `path`/`entrypoint`/`rolloutCredentialEnv`), `defaultEnvironment`, and the residual `rolloutReady` keys listed under **Pointer residue** below. **Add nothing else to `rolloutReady`.** Keep `environments` in sync with the harness `FW_ENV_PROFILES` (scaffold surfaces). A package surface's entry carries `harnessKind: 'package'`, `startProfile` (`dart`, `swift`), `sdk: { name, version, channel }` from the install, its stamps file as `trackerPath`, and `rolloutCredentialEnv`. **Reconcile manifest credential env:** resolve each feature's manifest through the seam and re-author it with `fw tool upsert-rollout-manifest` when `harness.rolloutCredentialEnv` does not match the surface — `ts-server` → `FW_PROJECT_API_KEY`, `web` → `PUBLIC_FW_PROJECT_API_KEY`, `python`/`java` → `FW_PROJECT_API_KEY`; a package surface → `FIREWEAVE_KEY` (server profile) or `FIREWEAVE_BROWSER_KEY` (client profile) (see **Credential env canon**); never edit a manifest file in place. Run `fw tool detect-rollout-ready` (anchor scan works). Run `fw tool reconcile` with `{ "phase": "build" }` (must pass when no orphan anchors exist under `sourceRoots`). **Smoke:** run `fw tool verify-prod-path` on one manifest per surface present with `{ feature }`; fix any **fail** before declaring done. A package surface runs the package check set (`sdk-floor`, `start-first`, `one-start`, `no-hand-rolled-init`, `key-family`, `start-profile`, plus its language's own); a `warn` is advisory and is reported, not fixed by force. **Hard assert (no credential on disk):** `fireweave.md` exists at the repo root when a scaffold surface exists, and no tracked or un-ignored file under the workspace contains a `project-api-key_` / `fw_public_` / `fw_ingest_pub_` / `fw_agk_` prefix followed by key material. Initialise never writes a key into the workspace — an issued browser key goes straight to its build destination — so a match means a credential was pasted into the repo — stop and tell the user to move it to the deploy environment and rotate. **Hard assert (surface IDs are the server's):** every `surfaceId` in `project.json` `surfaces[]` MUST appear in Step 3f's declare output (harnesses carry no surface-ID block — the pointer is the only local record). Fix by re-running `fw repo declare-surfaces` and using what it returns — **never by minting an id** to make the grep pass. **Hard assert (identity never control-point-gated — INIT-S8):** no identity call (`identify` / `reset` / `setContext({ targetingKey })` / `reloadFeatureFlags` / `reload*Flags` / `bind*User`) may sit inside a control-point branch or under a `// @fireweave-controlpoint` anchor. `fw tool assert-dev-checklist` enforces this on every feature; at init, spot-check the surface's auth path — a control point cannot gate the targeting-key bind it depends on. Fix by hoisting the bind out of the branch before declaring done. The gate ships with the FireWeave plugin publish — standing `.cursor/skills` copies refresh via adopt/`--reinit` from the installed bundle. **Hard assert (no MCP launcher):** `mcp/rollout-server/` must not exist under the repo. **Hard assert (feedback reachable):** the `feedback` skill exists in the installed set for every agent in `teamAgents`. It is the only path a user has to report that FireWeave itself misbehaved, so a repo that initialises without it is a repo whose failures are invisible. **Entry files and hooks:** `CLAUDE.md` (or `.claude/CLAUDE.md`) holds FireWeave's `claude-entry` block and `AGENTS.md` its `agents-core` block when `claude` ∈ `teamAgents` (Step 7's `result.rendered`, or a to-do naming why one was left alone), and `fw tool install-agent-hooks` with `{ "mode": "check" }` reports every file and script `current` and no `checks`; anything else that is not a to-do the user was told about → back to Step 8. **Report the harness — FIR-359:** once the smoke above passes, send the report **over the CLI profile**, not the project API key: `fw tool report-harness-migration --input-file .fireweave/tmp/report-harness-migration.json` with the input `{"projectId":"<projectId>","status":"migrated","repo":"<owner/name>","sdkVersion":"<@fireweaveai/server-sdk version installed>","surfaces":[<every surface wired this run>]}` — it posts to `/v1/projects/{projectId}/harness-migration`. `repo` is this repository's `owner/name` (the one Step 0d asked about): the report is per repository, and it is what marks this repository initialised and closes any setup PR FireWeave opened for it. Use `fw tool` (authenticated by the Step-0 profile) rather than a raw `Authorization: Bearer {FW_PROJECT_API_KEY}` POST — `FW_PROJECT_API_KEY` is the runtime ingest plane, and this endpoint does not accept it (`migrate-harness` reports the same way) — **a dev-only project never gets that key.** Initialise never holds `FW_PROJECT_API_KEY` at all — the operator issues it in the portal — so a key-bearing POST has nothing to authenticate with; the profile is always present because Step 0 gated on it. This is not optional bookkeeping: the project page pairs this report against the control-points binding, and auto-bind puts every new environment on managed PostHog, so a project that never reports sits permanently in "FireWeave ramps control points the running app does not read" with no action that clears it. Report `partial` — naming the gap in `notes` — when any detected surface was left reading its provider directly (e.g. a surface whose SDK install `resolve-sdk-install` refused); report `migrated` only when every surface wired this run reads through FireWeave. **Never report `migrated` to make the page green** — the page exists to show when the two halves disagree. On a non-zero exit, say so in the session summary and name the project page as still-warning; do NOT PARK (the harness itself is wired and committed — an unreported success is a stale page, not a broken repo). **Reload notice — INIT-A4:** name **only** the agents whose **reloadable standing-loop artifacts were written this run** (derive from paths appended to `installedInto[]` this run — e.g. Cursor rule/hooks → reload Cursor; Claude's `CLAUDE.md` block + hooks → next Claude session). Do **not** name link-only / experimental hosts that got only a thin agent-instructions link (nothing to reload). Never hardcode Cursor. Mention `/fireweave:adopt` for teammates who later use an agent not in `teamAgents` (`--reinit` may also restore loops — prefer `adopt` for standing-loop-only gaps). |

---

## Pointer residue — the ONLY `rolloutReady` keys initialise may still write

Phase 2 moved the repo-scoped config to `repo_state`. A short list of keys has **no
server column yet**, so they stay in the pointer's `rolloutReady` block and are
written directly. This list is exhaustive — **adding anything else to the block is a
regression**, because a field with two homes is the drift ADR-019 exists to kill.

| Residual key                                                                                                                                    | Why it is still file-only                                                                                                                               | Written by                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `surfaces[].trackerPath` (canonical) · `trackerPath` / `webTrackerPath` (legacy, two-surface)                                                   | Read by `assert-dev-checklist` + `reconcile` to find `FW_STAMPS`. Per-surface is canonical; the legacy pair is a fallback for pre-migration repos.      | Step 5 / 9                    |
| `harnessPath` / `harnessEntrypoint` / `harnesses[]`                                                                                             | Read by `verify-prod-path` and the `normalizeSurfaces` shim; the canonical successor is top-level `surfaces[]`, kept side by side as the rollback path. | Step 4 / 6 / 9                |
| `environments` / `defaultEnvironment` / `promotionEnvironment`                                                                                  | Read by `resolve-project-environment` to pick the prod-tier environment.                                                                                | Step 3a / 9                   |
| `attestUrl` (legacy KEY name; the VALUE is the fw-server base URL that feeds `FW_API_URL`) / `rolloutCredentialEnv` / `webRolloutCredentialEnv` | `repo_state` has **no column** for them — `update-repo-state` hard-errors if you try.                                                                   | `record-rollout-env-contract` |

**`initialized` is gone — do not write it back.** It used to head this table, and it
was the field three separate gates read to decide whether to run at all: the
build-gate wrapper, `adopt`'s Step 1, and `assert-dev-checklist` check 1. Because
Step 9 wrote it _last_, any run that PARKed before Step 9 left a repo whose gate was
installed and switched off, with nothing on stdout, stderr, or the exit code to say
so. All three now decide on **project identity** or on the server's `repo_state`
row — facts somebody positively wrote — and the key is deleted from
`RolloutReadyProjectSchema`. Re-adding it re-creates a silent gate.

**The block is residue, not a store.** A freshly-initialised repo carries a
`rolloutReady` block — the keys above have nowhere else to go — and that fact means
nothing beyond those keys. Nothing branches on the block's presence: `repoShapeOf`
is deleted, and every writer that used to consult it now asks
`isServerOwnedRepoState`, the `repoState: "server"` marker `fw init` stamps.

**Do not hand-strip the block.** The fields would simply be gone, and
`verify-prod-path`, `assert-dev-checklist` and the prod credential resolution
would all start failing for a repo that is otherwise healthy. Keys leave this
table when they get server homes, not when an agent deletes them.

**And there is no file store to fall back to.** `update-repo-state` and
`upsert-rollout-manifest` refuse when they cannot reach fw-server, in every repo —
which is exactly why Step 9 is online-only and says **PARK on `refused`, do not fall
back to editing the file**. `upsert-rollout-manifest` will QUEUE a manifest when the
server merely does not answer (the outbox `.git/fireweave/outbox/`; `fw sync` sends it); it
refuses outright when the write cannot be addressed at all — no profile, no
`projectId`, no `origin`. Neither outcome leaves a manifest on disk.

---

## `--reinit` — declare surfaces + write `surfaces[]` (project.json stays `version: 2`)

`--reinit` lazily upgrades `.fireweave/project.json` to the canonical top-level
**`surfaces[]`** shape while leaving every legacy `rolloutReady` field in place.
The shape is discriminated by **key presence** (`surfaces[]` = canonical), never
by a version number — **`version` STAYS `2`; do NOT write `version: 3`.**

1. Read the current `project.json` and run it through `normalizeSurfaces()` (the
   shim in `packages/rollout-tools/src/tools/project-harnesses.ts`) to get the surface
   list. That one seam reads the new `surfaces[]`, the branch
   `rolloutReady.harnesses[]`, OR the legacy singular fields, so reinit works from
   any prior shape.
2. Declare the whole list to the server in ONE call —
   `fw repo declare-surfaces --project {projectId} --json --surfaces '<the normalized list>'`.
   Pass each entry's existing `surfaceId` where it has one and omit it where it
   does not; **the server mints, you never do.** Take every id from the response.
   Entries that already carry a `surfaceId` come back `already-registered` and keep
   it unchanged — that is what makes reinit idempotent, and it is now checked
   against the registry rather than merely against the file.

   An entry that comes back **`existing`** carried no id in the file but the
   server already had one for that `(surface, path)` in this project: adopt the
   returned id. That is the pointer-was-lost case, and adopting is what stops a
   second registry row shadowing the first forever.

   **Non-zero exit → PARK, write nothing.** A `conflict` means a `sfc_` id in this
   `project.json` is homed under a different project (409; nothing was declared) —
   usually a `project.json` or harness copied from another repo. Report the
   colliding surface and its incumbent project; do NOT "fix" it by minting a
   replacement id.

3. Write the result as the top-level **`surfaces[]`** array, still under
   **`version: 2`**.
4. **Leave the legacy `rolloutReady` fields UNTOUCHED** (`harnessPath`,
   `harnessEntrypoint`, `rolloutCredentialEnv`, `webRolloutCredentialEnv`,
   `harnesses[]`, `environments`, …). They are the **rollback path** and the
   golden backward-compat fixtures still read them — `surfaces[]` is additive,
   never a replacement.
5. Every id in `surfaces[]` must be an id step 2's declaration returned —
   the pointer is the only local record (harnesses carry no surface-ID block).

Example `project.json` after a `--reinit` on a ts-server + web repo —
canonical `surfaces[]` and the **untouched** legacy `rolloutReady`, side by side,
all under `version: 2`:

```json
{
  "version": 2,
  "surfaces": [
    {
      "surface": "ts-server",
      "surfaceId": "sfc_01J8ZQ7M4E5X6Y7Z8A9B0C1D2E",
      "path": "packages/api/src/fireweave/fw-harness.ts",
      "entrypoint": "packages/api/src/main.ts",
      "rolloutCredentialEnv": "FW_PROJECT_API_KEY",
      "metricsClient": "otel-sdk"
    },
    {
      "surface": "web",
      "surfaceId": "sfc_01J8ZQ7M4E5X6Y7Z8A9B0C1D2F",
      "path": "apps/web/src/fireweave/fw-harness.ts",
      "rolloutCredentialEnv": "PUBLIC_FW_PROJECT_API_KEY",
      "metricsClient": "posthog"
    }
  ],
  "rolloutReady": {
    "harnessPath": "packages/api/src/fireweave/fw-harness.ts",
    "harnessEntrypoint": "packages/api/src/main.ts",
    "rolloutCredentialEnv": "FW_PROJECT_API_KEY",
    "webRolloutCredentialEnv": "PUBLIC_FW_PROJECT_API_KEY",
    "environments": {
      "development": { "tier": "dev" },
      "production": { "tier": "prod" }
    }
  }
}
```

After writing `surfaces[]`, run `fw tool verify-rollout-config-schema`
against the repo (a `--reinit` dry-run) and confirm it **passes** — it validates
the `surfaceId` format and the `surfaces[]` / legacy `rolloutReady` coexistence.
Fix any schema finding before declaring the reinit done. **Hard assert (surface
IDs are the server's):** every `surfaceId` written into `surfaces[]` MUST be one
step 2's declaration returned — never a hand-minted value that satisfies the
schema's shape while naming an id the server never issued.

---

## Prod runtime credentials (Step 3 — URL + key, same treatment)

**A package surface needs ONE variable, not a pair (K11).** A server profile reads
`FIREWEAVE_KEY` (the project key, `project-api-key_…`, issued in the portal's
**Project API keys** panel — never by this skill) from the process environment, set
once per prod-tier destination; the endpoint is the SDK channel, so there is no
`FW_API_URL`, and `FIREWEAVE_URL` exists only when `server.kind === 'custom'`. A
client profile (web, a Dart client, a Swift app) is built with
`FIREWEAVE_BROWSER_KEY` (a browser key, `fw_public_…`, from
`fw tool issue-browser-key`, or the **Browser keys** panel when the tool
answers `fallback-portal`), set once per **build** destination and never in a
developer `.env`. The start profile refuses the wrong family at start: a browser key
in a server, a project key in a client. The rest of this section is the scaffold
pair.

`FW_API_URL` (the fw-server base URL) and `FW_PROJECT_API_KEY` (the bearer the prod control-points path sends to fw-server `/v1/control-points/evaluate`, `/v1/capture`, `/v1/targets/register`) are a **pair**. Initialise documents them together — never one without the other. Nothing about this pair is attestation: it is how the PROD CONTROL-POINTS branch authenticates.

**Initialise writes no secret, and mints no project key.** Both key families can be issued by the operator in the portal, on one page — **Project settings → Keys** (`/org/<orgId>/projects/<projectId>/settings/keys`) — which carries a panel for each:

| Panel                | Issues              | Variable                                                                   | Where it may go                                                                       |
| -------------------- | ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Project API keys** | `project-api-key_…` | `FIREWEAVE_KEY` (package) · `FW_PROJECT_API_KEY` (scaffold)                | Server-side only — never a browser bundle, never a commit                             |
| **Browser keys**     | `fw_public_…`       | `FIREWEAVE_BROWSER_KEY` (package) · `PUBLIC_FW_PROJECT_API_KEY` (scaffold) | Designed to ship in a client build; scoped `control-points:evaluate` + `events:write` |

**The two are not interchangeable and never share a key.** A web surface takes the browser key; putting the project key (`project-api-key_…`) in a bundle hands out an unscoped credential. `runtime-proxy/AUTH.md` is the source of truth for the families.

A key that is never written cannot be committed, cannot rot in a stale gitignored file, and never passes through an agent's context window.

| Artifact                              | Purpose                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `fireweave.md` (repo root)            | **Committed.** Names every variable per surface, which panel issues which key, and why a missing credential is a boot failure. No values. |
| `.env.example`                        | Names only (`FW_API_URL=`, `FW_PROJECT_API_KEY=`; `PUBLIC_FW_*` when web surface)                                                         |
| `project.json.rolloutReady.attestUrl` | Committed fw-server base URL (not secret; legacy KEY name, current VALUE)                                                                 |
| Cloud deploy secrets                  | Operator sets both vars in **each prod-tier environment's** runtime, from the portal                                                      |

**Order (SCN-16, relaxed):** Step **3c** still asks where each prod-tier environment runs, so the operator knows where the pair goes — but it is no longer gating a secret write, because there is no secret write. Step **3e** calls `record-rollout-env-contract` after the capability gates, **before** persisting env/`teamAgents` into `project.json`.

**Tool:** `fw tool record-rollout-env-contract` — records the env contract only. It calls no key endpoint and returns no credential. Pass `webappUrl` when the dashboard origin is known: a webapp host **cannot be derived from an API host** (fw-cli records the same limitation in `login.ts`), so without it the tool emits the PATH rather than guessing a URL.

**After the tool returns (soft continue, not PARK):** show its `userPrompt` — it names the portal page, the panel per key, and the variables for the surfaces this repo actually has — and point the user at `fireweave.md` for the full list. **Verification is on trust:** no tool reads back a remote secret store; the enforcing gate is the prod harness refusing to boot when the pair is absent. Await user confirmation as **awaiting-user** — do not label this wait PARK (disk was intentionally written at the commit-point).

**Prod-tier only.** The pair belongs wherever a **prod-tier** environment runs — never in the default/dev environment. If the project has no prod-tier environment, Step 3c skips the destination question entirely (nothing to set yet); `fireweave.md` is still written, because it is the record of what a future prod environment will need. When a prod-tier env exists, set the pair once per prod-tier environment's runtime (a `staging` service and a `production` service each need their own copy). Each service is scoped by **the project's own env signal** (Step 3d) — a separate `FW_ENV` is not required unless the user opted into the FireWeave-var source.

**Local dev needs neither variable.** The dev tier runs the FireWeave local provider in-memory. There is no `mergeRootEnvLocal` option any more — writing a live credential into a repo-root `.env.local` was the thing this change removed.

**Never commit** `FW_PROJECT_API_KEY`, and never write it into any file. The operator holds it from the portal to their deploy environment; nothing in the repo is a staging post for it.

---

## Environment source (Step 3d — the project's own env signal, never a mandated `FW_ENV`)

**Scaffold surfaces only.** A package surface skips this interview: the start
profile reads `FIREWEAVE_ENV` / `APP_ENV` itself, and Step 3d asks it one question.

The harness must learn the running environment NAME from **whatever this repo / its
CI-CD platform already uses** — it must NOT force the developer to introduce a
FireWeave-specific `FW_ENV` (server) / `PUBLIC_FW_ENV` (web) var just so our SDK can
tell environments apart. The generated harness owns detection via a `readEnvSignal()`

- `FW_ENV_ALIASES` block (the `// fw:env-source` region of the template), and uses
  the resolved name (`fwEnvName`) to select the tier.
  `FW_ENV` / `PUBLIC_FW_ENV` remain an **optional override only** (highest precedence
  inside the SDK, but the harness need not read them).

**Always confirm the source with `AskUserQuestion` before scaffolding** — do not
silently pick FireWeave's var. Offer, tailored to the Step-2 deploy-target detection:

| Option                                                       | Generated `readEnvSignal()` reads                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **My app's standard var** (recommended when present)         | `NODE_ENV` (ts-server) / `import.meta.env.MODE` (web)                                                                                            |
| **A platform var**                                           | the detected platform's var — e.g. `VERCEL_ENV`, `RAILWAY_ENVIRONMENT`, `RENDER` / `RENDER_SERVICE_NAME`, `FLY_APP_NAME`, a K8s downward-API var |
| **A function/module in my repo**                             | import + call the user-named resolver (e.g. `getEnvironment()`)                                                                                  |
| **FireWeave's `FW_ENV` / `PUBLIC_FW_ENV`** (opt-in fallback) | the FireWeave var — only when the user has no existing signal                                                                                    |

Then reconcile the source's **raw values** with the `FW_ENV_PROFILES` keys from Step 3a.
When they differ (e.g. the platform emits `production`/`preview` but FireWeave names the
environments `prod`/`uat`), `AskUserQuestion` to confirm the mapping and emit it as
`FW_ENV_ALIASES` (e.g. `{ production: 'prod', preview: 'uat' }`). When they already match,
leave `FW_ENV_ALIASES` empty (identity). Unknown values still fall through to the
`FW_ENV_PROFILES` miss → `isProd()` fallback + warn (unchanged).

On `--reinit`, re-confirm the source and regenerate the `// fw:env-source` block; never
overwrite a user-customised `readEnvSignal()` without surfacing the diff.

---

## Start profile — per-language reference (package surfaces: Steps 3d, 4, 5, 6, 6b)

One row per language. Step 4 writes the control-points file and the start call
below; Step 6 places the start call FIRST; Step 6b wires the identity call; the
read form is what `.fireweave/agent-instructions.md` teaches. The SDK floor is
3.0.0 everywhere (staging: `3.0.0-rc.N`, Python `3.0.0rcN`), resolved by
`fw tool resolve-sdk-install` with `harnessKind: 'package'` and Step 0.0's
`channel` — and, for `dart` / `swift`, `startProfile` from `detect-surfaces` — which records
`surfaces[].sdk = { name, version, channel }`. That channel **is** the endpoint the app
calls (`staging` → `staging-app-server.fireweave.ai`, `production` → `app-server.fireweave.ai`,
`dev` → the bound server, through `FIREWEAVE_URL`); say so in the install summary.

| Language    | SDK + start entry                                                                                                    | Control-points file                                                                                                             | Start call (placed FIRST)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Identity (unconditional, never behind a control point)                                                                 | Read form (default always `false`, RAMP-1)                                                                                     | Local runs                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `@fireweaveai/server-sdk`, `/start`                                                                                  | `src/fireweave/control-points.ts`                                                                                               | `src/fireweave/start.ts` calls `start({ controlPoints })`; the entrypoint's FIRST import is `import './fireweave/start';`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `await fw.identify(user.id, props)` at sign-in; `fw.instanceKey()` only when the server itself is the subject          | `await fw.controlPoints.getBooleanValue('<key>', false, { targetingKey: user.id })`                                            | `NODE_ENV` (or `APP_ENV`, `FIREWEAVE_ENV`) = `development` — usually already set                                                                                                                        |
| `web`       | `@fireweaveai/web-sdk`, `/start` + `/vite` + `/define`                                                               | `src/fireweave/control-points.ts`                                                                                               | `src/fireweave/start.ts` exports `ready = start({ controlPoints })`; the entry module's FIRST import is `import { ready } from './fireweave/start';` and the first render waits with `ready.then(render)` (never a top-level `await`). SvelteKit: `src/hooks.client.ts`. Next.js: `instrumentation-client.ts` (Next ≥ 15.3) or a `'use client'` provider re-rendering through `fw.subscribe`. Angular: `start(...).then(() => bootstrapApplication(...))`. Build config: `fireweave()` (Vite, SvelteKit, React Router 7, Nuxt, Astro) or `fireweaveDefine()` (Next.js as `compiler: { define: fireweaveDefine() }`, webpack, esbuild, Rollup); Angular, Parcel, CRA: `key` / `environment` passed to `start()` | `await fw.identify(user.id, props)` at sign-in AND session restore, `await fw.reset()` at sign-out                     | `fw.controlPoints.getBooleanValue('<key>', false)` — synchronous, never a per-call `targetingKey`                              | `vite dev` and Vitest are local by default; elsewhere `FIREWEAVE_ENV=development` for that run                                                                                                          |
| Python      | `fireweave`, `fireweave.start`                                                                                       | `fireweave_setup/control_points.py` in the entrypoint's import root (`src/` in a src layout); never a package named `fireweave` | `start(control_points=control_points)` as the first lines of EVERY process entrypoint — `main.py`, `wsgi.py`, `asgi.py`, `create_app()`, the Celery app module, a multiprocessing initializer; a root `conftest.py` starts local for tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `fw.identify(user_id, props)` at sign-in (async code: `asyncio.to_thread`); guard anonymous users, whose id is `None`  | `fw.control_points.get_boolean_value('<key>', False, EvaluationContext(user_id))`; async: `await asyncio.to_thread(lambda: …)` | python-dotenv / django-environ: `FIREWEAVE_ENV=development` in `.env`; pydantic-settings / decouple / dynaconf: the dev process exports it                                                              |
| Go          | `github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3`, package `/v3/fw`                                                 | `internal/fireweave/control_points.go`                                                                                          | `fw.Start(fw.Options{ControlPoints: appfw.ControlPoints})` (or `fw.MustStart`) in the serving path of each `main`, AFTER the app's own config loading and flag parsing; functions-framework-go: a `sync.Once` start at the top of each handler, never `init()`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `go func() { _ = fw.Identify(ctx, user.ID, props) }()` at sign-in, off the request path                                | `fw.ControlPoints().GetBooleanValue("<key>", false, fw.For(user.ID))`                                                          | `FIREWEAVE_ENV=development` in the dev run config (Makefile, compose, `.envrc`)                                                                                                                         |
| Java        | `ai.fireweave:fireweave-sdk`, `ai.fireweave.sdk.start.Fw`                                                            | `FireweaveControlPoints.java` (the app's base package)                                                                          | `Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build());` first in `main` after config loading; Spring Boot: before `SpringApplication.run`; servlet apps: `ServletContextListener.contextInitialized`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `Fw.identify(userId, Map.of(...))` at sign-in (it never throws)                                                        | `Fw.controlPoints().getBooleanValue("<key>", false, EvaluationContext.builder().targetingKey(userId).build())`                 | `FIREWEAVE_ENV=development` in the run configuration (Maven `exec` / Gradle `run`, IDE, compose); Spring profiles are not read                                                                          |
| Rust        | crate `fireweave`, `fireweave::start`                                                                                | `src/fireweave_control_points.rs` (never a local `mod fireweave`)                                                               | `fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() }).expect("FireWeave start");` first in each server binary's `main` (`?` only when `main` returns a `Result` that accepts `FireweaveError`)                                                                                                                                                                                                                                                                                                                                                                                                                                           | `let _ = fireweave::start::identify(&user.id, [...]);` at sign-in (async code: `spawn_blocking`)                       | `fireweave::start::control_points().get_boolean_value("<key>", false, Some(&ctx))` — blocking: `spawn_blocking` in async code  | `.cargo/config.toml` `[env] FIREWEAVE_ENV = "development"` at the workspace root (cargo only)                                                                                                           |
| Dart        | `fireweave`; `package:fireweave/client.dart` (Flutter, Dart web) or `package:fireweave/server.dart` (Dart VM server) | `lib/fireweave/control_points.dart`                                                                                             | `await Fireweave.start(controlPoints: controlPoints);` in `main` before `runApp` (Flutter), before serving (shelf), in `init()` (dart_frog); every isolate that reads must start. Never `server.dart` in a Flutter app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | client: `await fw.identify(user.id, properties: {...})` at sign-in and session restore, `await fw.reset()` at sign-out | `fw.controlPoints.getBooleanValue('<key>', false)` — synchronous, safe in `build()`                                            | client: `--dart-define=FIREWEAVE_ENV=development` in DEBUG launch configs only (`.vscode/launch.json`, Android Studio), never a release define file; server: `FIREWEAVE_ENV=development` in the dev run |
| Swift       | product `FireweaveStart`, from the SDK repository (package `fireweave-sdk`)                                          | `FireweaveLocalControlPoints.swift`                                                                                             | app: `startFireweave(controlPoints: appControlPoints)` in SwiftUI `App.init()` or the first line of `didFinishLaunching` (it never throws); server: `try startFireweave(FireweaveStartOptions(controlPoints: appControlPoints))` then `await fw.ready()` in `configure`                                                                                                                                                                                                                                                                                                                                                                                                                                        | app: `await fw.identify(user.id, properties: [...])` at sign-in and session restore, `await fw.reset()` at sign-out    | `fw.controlPoints.getBooleanValue("<key>", default: false)` — synchronous                                                      | app: nothing — a debug build with no key and no environment name is development; server: `FIREWEAVE_ENV=development` in the scheme or run environment                                                   |

**Files Step 4 writes** (the comments are part of the file; uncomment nothing — the
user seeds control points as features arrive):

```ts
// src/fireweave/control-points.ts — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
import { defineControlPoints } from '@fireweaveai/server-sdk/start'; // web: '@fireweaveai/web-sdk/start'

export const controlPoints = defineControlPoints({
  // 'new-checkout': { local: true },
});
```

```ts
// src/fireweave/start.ts — the app's only FireWeave setup. Imported FIRST by the entrypoint.
import { start } from '@fireweaveai/server-sdk/start';
import { controlPoints } from './control-points';

start({ controlPoints });
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides".
//   mode: 'local' | 'remote'          force a mode
//   environment: process.env.STAGE    your own environment variable for mode inference
//   url: 'https://flags.example.com'  self-hosted fw-server
//   key: secrets.fireweaveKey         key from your own secret store
```

```ts
// src/fireweave/start.ts (web) — the app's only FireWeave setup. Imported FIRST by the entry module.
import { start } from '@fireweaveai/web-sdk/start';
import { controlPoints } from './control-points';

export const ready = start({ controlPoints });
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (web)".
//   mode: 'local' | 'remote'          force a mode
//   environment: 'staging'            environment name for mode inference
//   url: '/fw'                        a same-origin proxy, or a self-hosted fw-server URL
//   persistence: 'memory'             store nothing until consent (then fw.setPersistence('localStorage'))
//   deviceId: analytics.anonymousId() reuse your analytics id as the anonymous key
```

```ts
// vite.config.ts (Nuxt / Astro: the same call under `vite: { plugins: [...] }`)
import { fireweave } from '@fireweaveai/web-sdk/vite';
export default defineConfig({
  plugins: [, /* framework plugin */ fireweave()],
});

// next.config.mjs (webpack, esbuild, Rollup: the same object through their define plugin)
import { fireweaveDefine } from '@fireweaveai/web-sdk/define';
export default {
  compiler: { define: fireweaveDefine() }, // never a webpack() DefinePlugin hook: Next 16 builds with Turbopack
};

// the entry module: render after ready, never a top-level `await ready`
import { ready } from './fireweave/start';
ready.then(() => createRoot(el).render(<App />));
```

```python
# <import root>/fireweave_setup/control_points.py (+ __init__.py) — every control point this app reads, with its LOCAL value.
# The import root is the entrypoint's: `src/` in a src layout.
# Production values come from FireWeave rollouts, never from this file.
from fireweave.start import define_control_points

control_points = define_control_points({
    # "new-checkout": {"local": True},
})

# the entrypoint, FIRST statements, before the app's own imports (main.py / wsgi.py / asgi.py / create_app() / the Celery app module)
from fireweave.start import start
from fireweave_setup.control_points import control_points

start(control_points=control_points)
# Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Python)".
#   mode="local" | "remote"           force a mode
#   environment=settings.DEPLOY_STAGE your own environment name for mode inference
#   url="https://flags.example.com"   self-hosted fw-server
#   key=secrets["fireweave"]          key from your own secret store
```

```go
// internal/fireweave/control_points.go — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
package fireweave

import "github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3/fw"

var ControlPoints = fw.DefineControlPoints(fw.LocalControlPoints{
	// "new-checkout": {Local: true},
})

// main.go, in the serving path after the app's own config loading
if err := fw.Start(fw.Options{ControlPoints: appfw.ControlPoints}); err != nil {
	log.Fatal(err)
}
defer fw.Shutdown(context.Background())
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Go)".
//   Mode: fw.ModeLocal | fw.ModeRemote   force a mode
//   Environment: cfg.Stage               your own environment name for mode inference
//   URL: "https://flags.example.com"     self-hosted fw-server
//   Key: secrets.FireweaveKey            key from your own secret store
```

```java
// FireweaveControlPoints.java — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
public final class FireweaveControlPoints {
    public static final LocalControlPoints CONTROL_POINTS = Fw.defineControlPoints(Map.of(
            // "new-checkout", LocalControlPoint.local(true)
    ));
    private FireweaveControlPoints() {}
}

// main(), first thing after the app's own config loading
Fw.start(StartOptions.builder().controlPoints(FireweaveControlPoints.CONTROL_POINTS).build());
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Java)".
//   .mode(Mode.LOCAL | Mode.REMOTE)        force a mode
//   .environment(config.deployStage())      your own environment name for mode inference
//   .url("https://flags.example.com")       self-hosted fw-server
//   .key(secrets.fireweaveKey())            key from your own secret store
```

```rust
// src/fireweave_control_points.rs — every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
use fireweave::start::{define_control_points, LocalControlPoint, LocalControlPoints};

pub fn control_points() -> LocalControlPoints {
    let entries: Vec<(&str, LocalControlPoint)> = vec![
        // ("new-checkout", LocalControlPoint::local(true)),
    ];
    define_control_points(entries)
}

// src/main.rs
mod fireweave_control_points;
use fireweave::start::StartOptions;

// first thing in main (also under #[tokio::main]: the call is synchronous).
// `?` instead of .expect only when main returns a Result whose error accepts FireweaveError
// (Box<dyn Error>, anyhow::Error).
fireweave::start::start(StartOptions { control_points: fireweave_control_points::control_points(), ..Default::default() }).expect("FireWeave start");
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Rust)".
//   mode: Some(Mode::Local | Mode::Remote)     force a mode
//   environment: Some(cfg.stage.clone())       your own environment name for mode inference
//   url: Some("https://flags.example.com".into())  self-hosted fw-server
//   key: Some(secrets.fireweave_key.clone())   key from your own secret store
```

```dart
// lib/fireweave/control_points.dart — every control point this app reads, with its LOCAL value.
import 'package:fireweave/client.dart'; // server.dart on a Dart server

final controlPoints = defineControlPoints({
  // 'new-checkout': LocalControlPoint.local(true),
});

// lib/main.dart
Future<void> main() async {
  await Fireweave.start(controlPoints: controlPoints); // never throws on the client
  runApp(const App());
}
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Dart)".
//   mode: Mode.local | Mode.remote   force a mode
//   environment: 'staging'           environment name for mode inference
//   url: 'https://flags.example.com' self-hosted fw-server
//   deviceId: analyticsId            reuse your analytics anonymous id (client)
```

```swift
// FireweaveLocalControlPoints.swift — every control point this app reads, with its LOCAL value.
import FireweaveStart

// `[:` is the empty dictionary: change it to `[` when you add the first entry.
let appControlPoints = defineControlPoints([:
  // "new-checkout": .local(true),
])

// App.init() / didFinishLaunching (app) — server: `try startFireweave(FireweaveStartOptions(controlPoints: appControlPoints))` in configure
startFireweave(controlPoints: appControlPoints)
// Overrides (all optional). See .fireweave/agent-instructions.md, "FireWeave SDK: configuration and overrides (Swift)".
//   mode: .local | .remote               force a mode
//   environment: "staging"               environment name for mode inference
//   url: "https://flags.example.com"     self-hosted fw-server
//   persistence: .memory                 store nothing until consent (app)
```

When Step 3d found a project-specific environment variable, the `environment`
override is written uncommented, read from the app's own config. A URL is never
written into code: `FIREWEAVE_URL` sits beside the key (Step 3c) when `server.kind
=== 'custom'`.

**Client profiles, three more things.** _Consent:_ if the app has a consent
manager, start with `persistence: 'memory'` (web) / `persistence: .memory` (Swift app)
and wire the stored setting to consent given (`fw.setPersistence('localStorage')` /
`.userDefaults`) and `fw.forget()` to withdrawal; Dart: a `DeviceIdStore` only after
consent, `fw.reset(rotateDeviceId: true)` on withdrawal. Otherwise leave the default.
_Re-render:_ components drawn before the first decisions arrive re-render through
`fw.subscribe(...)` (web), `fw.changes.listen(...)` (Dart) or `fw.updates` /
`await fw.ready()` (Swift). _CSP (web):_ in remote mode the page's `connect-src` must
allow the fw-server origin — add it where initialise can edit the policy
(`index.html` meta, `helmet`, `next.config` headers, SvelteKit `kit.csp`), else name
it to the user; `verify-prod-path` only warns (`csp-connect-src`), since a header set
by a CDN is invisible to it.

**Distributed binaries and client-shipped code never get a server key.**
`detect-surfaces` marks them `clientShipped: true` (Tauri, Leptos `hydrate`,
goreleaser / wails / fyne / gomobile binaries, Flutter apps, Xcode apps): wire them as
a client profile with a browser key, or not at all.

---

## Harness templates — where they live (Step 4)

**Scaffold surfaces only — a package surface uses none of these templates** (its
files are the per-language reference's).

**The harness is generated FROM FILES THAT SHIP WITH THIS SKILL. Read them; do
not write a harness from this prose.** The prose below tells you what to
_substitute_ into a template — it is not a description you can reconstruct a
harness from. Every harness this skill has ever shipped exists as a `.tpl` file
next to this `SKILL.md`.

**Resolve `harness/…` relative to the directory containing THIS `SKILL.md`** —
never relative to the target repo, and never relative to process cwd (which is
often `$HOME` or the plugin-bundle root, the same hazard `ensure-auth` carries a
`cwd` argument for). The `harness/` tree ships next to `SKILL.md` — it is part of
the skill, not a platform-source file you have to go find in
`packages/fw-plugins/`. Look there first, and if it is absent take the STOP below
rather than hunting: a bundle built before the asset-copy fix, or a copy taken at
file granularity, genuinely does not have it.

**This anchor covers the skill's OWN assets (`harness/**`) — not every path in
this document.** Plugin-level artifacts sit a level up, beside the skills dir,
not inside it: `hooks/rollout-build-gate.mjs` (Step 8's installer writes it) is at
the PLUGIN root, so it resolves as `<dir of this SKILL.md>/../../hooks/`, and
each host relocates it again. Do not apply the skill-relative rule to it.

**Do not hardcode this skill's directory NAME.** Hosts rename it from the
frontmatter aliases — `initialise` on Claude Code and OpenCode, `fw-initialise`
on Cursor, `fw_initialise` on Codex. Use the directory you were loaded from;
where this document writes `initialise/` for readability, read it as "this
skill's own directory, whatever this host calls it".

| Surface     | Template dir         | Read → write (into the repo's `fireweave/` dir; `fireweave_harness/` for Python)                                                                                              |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `harness/ts-server/` | `fw-harness.ts.tpl` → `fireweave/fw-harness.ts`; `fw-providers.ts.tpl` → `fireweave/fw-providers.ts`; `fw-tracker.ts.tpl` → `fireweave/fw-tracker.ts`                         |
| `web`       | `harness/web/`       | `fw-harness.ts.tpl` → `fireweave/fw-harness.ts`; `fw-providers.ts.tpl` → `fireweave/fw-providers.ts`; `fw-tracker.ts.tpl` → `fireweave/fw-tracker.ts`                         |
| `python`    | `harness/python/`    | `fw_harness.py.tpl` → `fireweave_harness/fw_harness.py`; `fw_providers.py.tpl` → `fireweave_harness/fw_providers.py`; `fw_tracker.py.tpl` → `fireweave_harness/fw_tracker.py` |
| `java`      | `harness/java/`      | `FwHarness.java.tpl` → `fireweave/FwHarness.java`; `FwProviders.java.tpl` → `fireweave/FwProviders.java`; `FwTracker.java.tpl` → `fireweave/FwTracker.java`                   |
| `swift`     | `harness/swift/`     | `FwHarness.swift.tpl` → `fireweave/FwHarness.swift`; `FwProviders.swift.tpl` → `fireweave/FwProviders.swift`; `FwTracker.swift.tpl` → `fireweave/FwTracker.swift`             |
| `go`        | `harness/go/`        | `fw_harness.go.tpl` → `fireweave/fw_harness.go`; `fw_providers.go.tpl` → `fireweave/fw_providers.go`; `fw_tracker.go.tpl` → `fireweave/fw_tracker.go`                         |
| `rust`      | `harness/rust/`      | `fw_harness.rs.tpl` → `fireweave/fw_harness.rs`; `fw_providers.rs.tpl` → `fireweave/fw_providers.rs`; `fw_tracker.rs.tpl` → `fireweave/fw_tracker.rs`                         |

`.tpl` is stripped on write; the basename is otherwise preserved (Python's
snake_case and Java's PascalCase names are already correct in the template
filenames — see the **Python surface** / **Java surface** sections below; for
Java, `fireweave/` is the `<base package>.fireweave` package directory and the
templates' `package fireweave;` line is rewritten to match). Two files have
**no** template and are authored by their own
step: `fireweave_harness/__init__.py` for Python, and the `fw-tracker` const tree for
`ts-server` / `web` (Step 5 — an empty tree, not a copy of the Python tracker).

**HARD — the split is two files per TS surface, not one.** `fw-harness.ts`
imports `makeConnectedVendorProvider` and `makeDevProvider` from
`./fw-providers`; a harness written as a single file does not resolve its own
imports. That is the whole reason — do not reach for others. A platform-source test pins
the split for both TS surfaces (it does not ship in any host bundle, so do not go
looking for it here) — if you are about to write one file for a `ts-server` or
`web` surface, you have skipped the template.

**Read every `.tpl` you are about to emit, in full, BEFORE writing the first
file.** Then substitute — and substitute only. **The placeholders below live in
the `fw-harness` templates only**; `fw-providers.*` and `fw_tracker.py` carry
none and are written through unchanged, so "nothing to substitute" is the
expected outcome for those files, not a sign you are reading the wrong one:

- `FW_ENV_PROFILES` rows + `FW_DEFAULT_ENV` — regenerate from Step 3a's env→tier
  profile. The template's `development`/`staging`/`production` rows are
  placeholders; shipping them unchanged is a wrong-environment harness.
- the `// fw:env-source` region (`# fw:env-source` in Python; `// fw:env-source`
  in Java) — `readEnvSignal()`
  - `FW_ENV_ALIASES` from the Step 3d answer.
- Java only: the `package fireweave;` line — rewrite to the app's
  `<base package>.fireweave` and place the files in the matching directory.
- the prod branch, per Step 3b: the connected vendor's control-point provider. **This one
  has no placeholder token** — it lives inside `makeConnectedVendorProvider()` in
  the providers template, so there is nothing to grep for.
  **Telemetry is NOT part of this substitution.** FireWeave does not wire an
  observability SDK into a repo, so there is no exporter branch to hand-wire and
  no `signals` to fill: the templates carry no telemetry initialisation at all,
  and `harness-templates.test.ts` asserts they never gain any. What Step 3b's
  observability descriptor is for is the QUERY leg — how fw-server reads a
  guardrail metric back out during a ramp — not an export FireWeave writes.

Everything else in the template — the `isProd()` fallback and
`makeConnectedVendorProvider()` — is load-bearing and pinned by tests. Do not re-derive, re-order, or "tidy" it, and
do not add attestation/beacon wiring: the templates are deliberately free of it
(deploy attestation is retired) and the template tests assert its absence.

**If `harness/` is missing or lacks the surface you need, STOP and say so.** That
is a stale or partial skill copy (C27), not a licence to improvise: a hand-written
harness passes no template test and drifts from every other repo the fleet
initialised. Ask the user to refresh the skill copies (`--reinit`, or re-copy from
the installed plugin bundle) and re-run.

---

## Python surface (Step 2 / 4 / 6 — control points prod-capable)

**Detect (Step 2).** A Python surface is present when the repo has `pyproject.toml`,
`setup.py`/`setup.cfg`, `requirements*.txt`, or a package of `*.py` under the source
root. Classify it as surface `python` — **prod-capable for control points** (`SURFACE_REGISTRY`
lists it with the `fireweave` vendor).

**Scaffold surfaces only** — a new Python surface is a package surface (`fireweave.start`;
see **Start profile — per-language reference**).

**Scaffold (Step 4).** Generate from `harness/python/` (all three `.tpl` files;
path resolved as in **Harness templates — where they live**) into a `fireweave_harness/`
package at the idiomatic source root — **never `fireweave/`, which shadows the
`fireweave` PyPI SDK in a flat layout** (`from fireweave import init_fireweave` would
import the harness package and fail at boot) — using **snake_case module names**
(Python cannot import hyphenated modules): `fireweave_harness/fw_harness.py`,
`fireweave_harness/fw_providers.py`, `fireweave_harness/fw_tracker.py`, plus
`fireweave_harness/__init__.py`. Regenerate `FW_ENV_PROFILES` + `FW_DEFAULT_ENV` from
Step 3a and the `# fw:env-source` block from Step 3d (Python reads `os.environ`;
default `_read_env_signal` prefers `APP_ENV`/`ENVIRONMENT`/`ENV`, FW_ENV last).
**Both branches are real and go through ONE entry point of the `fireweave` PyPI
SDK:** `init_fireweave(mode="local", …)` for dev and `init_fireweave(mode="remote",
…)` for prod. The SDK reads no environment, so `fw_providers.py` resolves `FW_API_URL`

- `FW_PROJECT_API_KEY` from `os.environ` and passes them as explicit `api_url` /
  `api_key` options, refusing loudly when either is missing. The harness wires no
  telemetry on either tier.

**Wire the entrypoint (Step 6).** Inject `init_fw_harness()` as the FIRST statement
of the app's entrypoint — top of `if __name__ == "__main__":` for a script, or the
ASGI/WSGI **app factory** (e.g. `create_app()` before returning) / the module that
constructs the FastAPI/Flask/Django app. It is synchronous (no `await`). Record the
location in `project.json` `rolloutReady` (see harnesses[] below).

**Record (Step 9) — write the `harnesses[]` shape.** Persist this surface into
`project.json` `rolloutReady.harnesses[]` (the surface-keyed list read by the
`normalizeHarnesses` shim), e.g. `{ "surface": "python", "path":
"fireweave_harness/fw_harness.py", "entrypoint": "<detected entrypoint>" }`. Keep writing the
legacy singular `harnessEntrypoint`/`webHarnessEntrypoint` fields for a ts-server/web
surface too until the contract phase; on `--reinit`, lazily upgrade an existing legacy
`project.json` to include `harnesses[]` (never drop the legacy fields — the shim and
the golden backward-compat test depend on them).

---

## Java surface (Step 2 / 4 / 6 — control points prod-capable)

**Detect (Step 2).** A Java surface is present when the repo has `pom.xml`,
`build.gradle`/`build.gradle.kts`/`settings.gradle*`, or `*.java` sources under
`src/main/java/`. Classify it as surface `java` — **prod-capable for control points**
(`SURFACE_REGISTRY` lists it with the `fireweave` vendor, on the `ai.fireweave`
Maven SDK). Kotlin (`.kt`/`.kts`) is NOT this surface — it stays an ungoverned
scan extension pending its own surface decision.

**Scaffold surfaces only** — a new Java surface is a package surface
(`ai.fireweave.sdk.start.Fw`; see **Start profile — per-language reference**).

**Scaffold (Step 4).** Generate from `harness/java/` (all three `.tpl` files;
path resolved as in **Harness templates — where they live**) into the app's
`<base package>.fireweave` package: `FwHarness.java`, `FwProviders.java`,
`FwTracker.java` — **PascalCase class-per-file names** (Java requires the public
class name to match the filename, and the directory to match the package;
rewrite the templates' `package fireweave;` line to the real package).
Regenerate `FW_ENV_PROFILES` + `FW_DEFAULT_ENV` from Step 3a and the
`// fw:env-source` block from Step 3d (default `readEnvSignal()` prefers
`APP_ENV`/`ENVIRONMENT`/`ENV`, `FW_ENV` last; a Spring app usually reads
`SPRING_PROFILES_ACTIVE`). **Both branches are real and both go through ONE
entry point:** `Fireweave.init(InitOptions.builder(Mode.LOCAL)…build())` for dev,
`Fireweave.init(InitOptions.builder(Mode.REMOTE)…build())` for prod — same call,
one enum apart, so the tiers cannot skew. **The Java SDK reads no environment itself** — `FwProviders`
resolves `FW_API_URL` + `FW_PROJECT_API_KEY`, refuses loudly when either is
missing, and passes `allowedHosts` derived from the configured URL (without it a
self-hosted fw-server fails init against the canonical allowlist); do not
"simplify" that resolution away. Telemetry: the Java SDK carries no OTel
dependency — console-free by default; wire `io.opentelemetry` only as a real,
fully-configured exporter, never half-wired. Never scaffold
`fireweave-openfeature` or `fireweave-adapter-posthog`: both are pre-v1
coordinates that still resolve from Maven Central forever (artifacts are
immutable) but are gone from the source tree — a build file naming either one
compiles against the retired surface.

**Wire the entrypoint (Step 6).** Call `FwHarness.initFwHarness()` as the FIRST
statement of `main(String[] args)` — or, for Spring Boot, before
`SpringApplication.run(...)` in the bootstrap class — so the provider is bound
before any control-point read. It is synchronous (no `await`; `verify-prod-path`'s java
token row greps for the bare call). Anchor control-point call sites with
`// @fireweave-controlpoint <key>`.

**Record (Step 9) — write the `harnesses[]` shape.** Persist this surface into
`project.json` `rolloutReady.harnesses[]`, e.g. `{ "surface": "java", "path":
"src/main/java/<base-path>/fireweave/FwHarness.java", "entrypoint": "<main
class path>" }`. Java has NO legacy singular fallback in `harnessEntrypointFor`
— the `harnesses[]` entry is the only place its entrypoint can be recorded.

---

## Swift surface (Step 2 / 4 / 6 — iOS, prod-capable)

**Detect (Step 2).** A Swift surface is present when the repo has
`Package.swift`, an `*.xcodeproj`/`*.xcworkspace`, or `*.swift` sources.
Classify it as surface `swift`.

**Scaffold surfaces only** — a new Swift surface is a package surface (the
`FireweaveStart` product, resolved from the SDK repository (package `fireweave-sdk`); see **Start
profile — per-language reference**). An existing Swift scaffold is **prod-capable**
on the Swift SDK's remote adapter → fw-server `/v1/control-points/evaluate`, through
the `Fireweave` product it already depends on.

**Credentials are BUILD-BAKED, not environment-read.** This is the one thing to
get right on iOS and the reason the surface is not simply "server with different
syntax". A shipped app has no process environment: `ProcessInfo.environment` is
populated by an Xcode _scheme_, so it exists in the simulator and is **empty on
a device**. A harness that resolved its tier from env vars would classify every
TestFlight and App Store build as `development`, bring the SDK up in local mode,
and serve every control point its caller default — with a clean log and a green
launch, indistinguishable from a rollout nobody started.

So the scaffolded harness reads **Info.plist first**, env only as a
dev/simulator override:

| Info.plist key    | Meaning                                   |
| ----------------- | ----------------------------------------- |
| `FWEnvironment`   | environment NAME (keys `FW_ENV_PROFILES`) |
| `FWProjectApiKey` | project key (`project-api-key_…`)         |
| `FWApiUrl`        | fw-server base URL                        |

Populate them from your build configuration (`$(FW_ENVIRONMENT)` etc. in an
xcconfig) so each build carries its own tier. `makeConnectedVendorProvider()`
**throws** when either credential is missing — a prod-tier build must fail
loudly rather than degrade to local evaluation.

**Reads are SYNCHRONOUS** (the SDK prefetches a decision cache at boot), so they
are safe on the main actor. `initFwHarness()` is async — await it from a `Task`
in your bootstrap before the first read.

### Go surface

**Scaffold surfaces only** — a new Go surface is a package surface (`.../sdks/go/v3/fw`;
see **Start profile — per-language reference**). An existing Go scaffold is
**prod-capable** on the Go SDK's remote adapter → fw-server
`/v1/control-points/evaluate`. Go modules resolve from VCS tags rather than a registry:
`go get github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3@latest` (the newest v3
release, ≥ `v3.0.0`; staging: the highest `v3.0.0-rc.N`). `go.mod` records the exact version `go get`
resolved, by design (limit 1 of **SDK installs never pin an exact version**). The
scaffold always uses the **`/v3`** module path — `/v2` is the retired pre-control-points module, and the unsuffixed `.../sdks/go` module is a different, stale module whose newest tag is
`v0.0.1-staging.2`.

**Scaffold (Step 4).** Generate from `harness/go/` (all three `.tpl` files) into the
repo's `fireweave/` package directory. Go exports are initial-capital, so the
harness spells the tier decision `IsProd()` / `MakeConnectedVendorProvider()` —
`verify-prod-path` greps those capitalised tokens, not the TS ones. Reads:

```go
// fwsdk = "github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3/fireweave"
ec := fwsdk.NewEvaluationContext(userID, nil)
// @fireweave-controlpoint <feature-slug>
if fireweave.GetFwClient().ControlPoints().GetBooleanValue("<feature-slug>", false, &ec) {
}
```

The context is passed by pointer: `GetBooleanValue` takes `*EvaluationContext`.

`InitFwHarness()` is synchronous — call it first in `main()` and fail the
process on a non-nil error.

### Rust surface

**Scaffold surfaces only** — a new Rust surface is a package surface (`fireweave::start`
from the `fireweave` crate at ≥ 3.0.0; see **Start profile — per-language reference**).
An existing Rust scaffold is **prod-capable** on the crate's remote adapter.

**Scaffold (Step 4).** Generate from `harness/rust/` (all three `.tpl` files) into the
crate's `fireweave/` module. Rust is snake_case like python: `is_prod()`,
`make_connected_vendor_provider()`, `init_fw_harness()`. Reads:

```rust
// @fireweave-controlpoint <feature-slug>
if get_fw_client().control_points.get_boolean_value("<feature-slug>", false, Some(&ctx)) {
}
```

`init_fw_harness()` is synchronous and returns `Result<(), FireweaveError>` —
call it first in `main()` and propagate the error.

**Scaffold (Step 4).** Generate from `harness/swift/` (all three `.tpl` files)
into the app's `fireweave/` directory: `FwHarness.swift`, `FwProviders.swift`,
`FwTracker.swift`, against the `Fireweave` product. Regenerate `FW_ENV_PROFILES` +
`FW_DEFAULT_ENV` from Step 3a and the `// fw:env-source` block from Step 3d. **Both
branches are wired through `initFireweave`:** `makeDevProvider()` brings the SDK up in
local mode, and `makeConnectedVendorProvider()` in remote mode from the Info.plist
credentials above — it **throws** when either is missing, so a prod-tier build fails
loudly instead of degrading to local evaluation. Leave that throw exactly as
scaffolded.

**Wire the entrypoint (Step 6).** `await FwHarness.initFwHarness()` first in the
app's bootstrap, before the first read — from a `Task { }` where the bootstrap is
not itself async. Reads are SYNCHRONOUS (`FwProviders.getFwClient().controlPoints.getBooleanValue(key, default: false,
targetingKey:)`), safe on the main actor, because the SDK prefetches a decision
cache at boot. Anchor call sites with `// @fireweave-controlpoint <key>`.

**Record (Step 9).** Persist into `project.json` `rolloutReady.harnesses[]`,
e.g. `{ "surface": "swift", "path": "Sources/<Target>/fireweave/FwHarness.swift",
"entrypoint": "<app entry file>" }`.

---

## Credential env canon (Step 3 + Step 9)

FireWeave remote control-point evaluation credential env names differ by harness surface (apps call fw-server `/v1/control-points/evaluate`, never PostHog directly). Initialise must keep **`.env.example`**, **`project.json`**, and **each manifest's `harness.rolloutCredentialEnv`** aligned. Seal still provisions flags on FireWeave-managed PostHog server-side — keep `controlPointTelemetryProvider: "connected:posthog"` for control-plane wiring.

| Surface                                 | `harness.rolloutCredentialEnv`                 | Host env                                                                                     | `project.json` field                   |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ts-server`                             | `FW_PROJECT_API_KEY`                           | `FW_API_URL` (fallback `FW_ATTEST_URL`)                                                      | `rolloutReady.rolloutCredentialEnv`    |
| `web`                                   | `PUBLIC_FW_PROJECT_API_KEY`                    | `PUBLIC_FW_API_URL` (fallback `PUBLIC_FW_ATTEST_URL`)                                        | `rolloutReady.webRolloutCredentialEnv` |
| `python`                                | `FW_PROJECT_API_KEY`                           | `FW_API_URL`                                                                                 | per-surface entry in `harnesses[]`     |
| `java`                                  | `FW_PROJECT_API_KEY`                           | `FW_API_URL`                                                                                 | per-surface entry in `harnesses[]`     |
| `swift`                                 | `FW_PROJECT_API_KEY`                           | `FW_API_URL`                                                                                 | per-surface entry in `harnesses[]`     |
| any **package** surface, server profile | `FIREWEAVE_KEY`                                | none — the SDK channel is the endpoint; `FIREWEAVE_URL` only when `server.kind === 'custom'` | `surfaces[].rolloutCredentialEnv`      |
| any **package** surface, client profile | `FIREWEAVE_BROWSER_KEY` (a **build** variable) | none — as above                                                                              | `surfaces[].rolloutCredentialEnv`      |

The `FW_ATTEST_URL` fallbacks are **legacy names, read but never written.**
Nothing emits them any more; harnesses read `FW_API_URL` first and fall back
only for repos scaffolded before the rename, warning once at boot when the
fallback fires so the deploy environment eventually gets renamed. Never scaffold
the legacy spelling into a new repo. `record-rollout-env-contract` appends all required names to `.env.example` when `apiSurface` / `webSurface` are set, and writes them into `fireweave.md`; for a `python` or `java` surface pass `apiSurface: true` (they use the server pair). **Do not** use a single env name across both TS surfaces — `verify-prod-path` checks the manifest's surface-specific name.

On `--reinit`, resolve every feature's manifest **through the seam** and re-author it with `fw tool upsert-rollout-manifest` (passing the resolved `contentHash` as `baseContentHash`) where `harness.rolloutCredentialEnv` does not match the surface row above. Do **not** patch manifest files in place: there is no manifest file — fw-server holds the row, and anything you write into `.fireweave/rollout-ready/` is a contract no gate, no teammate and no ramp coordinator will ever read. A `conflict` result means a teammate moved the row — re-apply on top of `current` and retry with `baseContentHash = currentContentHash`; never retry with a null base.

---

## API Docker build (Step 4 — ts-server `.mjs` harness)

When the API harness lives under `src/fireweave/*.mjs` (compiled from TypeScript), the package `build` script must copy those files into `dist/` after `tsc`. Without this, Docker images ship without the harness.

Patch `packages/api/package.json` (or the detected API package) `scripts.build`:

```json
"build": "tsc && mkdir -p dist/fireweave && cp src/fireweave/*.mjs dist/fireweave/"
```

Record the patched `package.json` path in `installedInto[]` when changed.

---

## Cohort identity wiring (Step 6b) — always-on, never control-point-gated

Manifests declare `context.targetingKey: "userId"` and upstream `%` ramps hash that
subject id. The code that supplies it — `identify` on auth, `reset` on sign-out, the
`targetingKey` carried in the evaluation context, and the cache re-prefetch that
follows each — is the **precondition** for control-point evaluation, not a feature of it.

**Never place it behind a FireWeave control point (INIT-S8).** It deadlocks: the control point evaluates
with no targeting key, RAMP-1 makes the safe default `false`, the bind never runs, and
the key never arrives. The ramp then shows 0% adoption, so it reads as a product
failure instead of a wiring bug.

At init:

1. **Locate the identity seam.** Run `fw tool detect-surfaces` with
   `{ includeAuthSeams: true }` — it returns candidates per surface with file, line, the
   token that matched (`signIn()`, `onAuthStateChanged`, `req.user`, `better-auth`, …) and
   whether the token implies the client or server plane. It **over-reports on purpose**:
   an extra row costs the user a glance, while a MISSED seam means `syncFireweaveUser` /
   `registerFwTarget` never gets wired and every rule on a durable property matches
   nobody — silently, because a rule matching nobody looks exactly like a rule nobody
   triggered. `truncated: true` means the scan hit its file cap: say so rather than
   reporting "no seam found", which is a different claim. Candidates are a SHORT LIST to
   ask about, never an answer — still ask with `AskUserQuestion`; do not guess.
2. **Assert it is unconditional.** The bind must not sit inside an `if` / `while` / `switch`
   on a control point, a ternary or `&&` on a control point, a `if (!flag) return` guard clause above it, a
   same-file helper whose _call_ is control-point-gated, or under a `// @fireweave-controlpoint` anchor.
   `fw tool assert-dev-checklist` blocks these shapes on every feature — fix
   at init rather than leaving it for the first ship. **Known limits (still escapes):**
   cross-file / imported helpers, multi-hop wrappers (`wrap → doIdentify → identify`),
   dynamic/computed callees (`fns[name]()`), object-literal helpers (`const helpers = {
doBind: () => identify() }` — same-file function/arrow/method/class-property helpers
   and one-hop control-point helpers _are_ covered), and full Svelte template AST (only `<script>`
   bodies are AST-scanned; `{#if}` / `on:click` handlers get a soft warn when the
   condition looks control-point-bound — not a hard block). Non-TS/JS surfaces (Go/Python/Java/
   Dart/Vue/Astro/…) are skipped with an info finding, not silently. Keep identity
   binds direct and same-module.
3. **Never scaffold the anti-pattern.** Any identity code initialise writes is emitted
   unconditionally. Harness templates deliberately contain no control-point-gated identity call;
   keep it that way on `--reinit`.
4. **Gate the consumer, not the bind.** A new _identity strategy_ still ships ungated;
   if you must compare two strategies, gate the feature that reads the identity and keep
   both binds always-on.

Record the identity module in `installedInto[]` when initialise writes or edits it, and
carry the contract into `.fireweave/agent-instructions.md` (**Cohort identity** section
of the template below) so feature agents inherit it.

The INIT-S8 checklist gate ships with the FireWeave plugin publish — standing
`.cursor/skills` copies refresh via `/fireweave:adopt` / `--reinit` from the installed
bundle (dogfood sync on the PR is not a substitute for publish).

---

---

## No MCP wiring (Step 7b)

FireWeave's skills run its tools as `fw tool …` in the shell on every host; the
plugin carries no MCP server (phase 14). So, on every host:

1. **Do NOT** create `mcp/rollout-server/` in the customer repo. **Do NOT** download `bin/server-*`. **Do NOT** write `.cursor/mcp.json` or any other MCP config for FireWeave.
2. If `mcp/rollout-server/launcher.sh` or a workspace `.cursor/mcp.json` rollout-server launcher entry already exists → **delete them**: that transport is retired.
3. **Do NOT** set `rolloutReady.mcp.mode`. It described the retired transport.
4. **Never** walk parents for `fireweaveai-platform`, **never** write `packages/fw-plugins/.../dist/server.js`, **never** inject `packages/fw-cli/bin` into `PATH`, and **never** set `rolloutMcpPlatformPath` in `project.json`.
5. An agent that cannot run `fw` yet is set up by `fw plugins install fireweave` (Step 0.00 says when).

When copying FireWeave skills into `.cursor/skills/` (because `cursor` ∈ `teamAgents`), copy from the **installed plugin bundle only** — never from `packages/fw-plugins/` platform source.

---

## Scan scope (Step 5 + Step 9)

Persist `rolloutReady.sourceRoots` and `rolloutReady.scanExclude` in `.fireweave/project.json`. **The scanner defaults are customer-generic** (`**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**` only) — it does **not** embed monorepo paths.

During **Step 2**, if this repo is the FireWeave platform monorepo (`packages/fw-plugins` and `packages/contracts` both present), **write** these dogfood values into `project.json` (do not rely on runtime auto-detection):

| Field         | Platform dogfood value                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `sourceRoots` | One repo-relative root per application surface detected in Step 2 (server API package + web UI package) |
| `scanExclude` | `**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**`, `packages/fw-plugins/**`, `packages/contracts/**`    |

Customer repos: leave `sourceRoots` empty (scan whole repo) unless the app layout needs narrowing; `scanExclude` can stay at generic test patterns.

`reconcile`, `detect-rollout-ready`, and the build gate read **only** `project.json` via `resolveRolloutScanOptions` in the rollout-server's `scan/` module.

**SDK dependencies: WHAT to install (per surface) × HOW to install it (per repo).** The two axes are independent — resolve them separately and combine. Bare specifiers only.

**What — surface → packages:**

| Surface     | Packages                                                                                            | Why both                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ts-server` | `@fireweaveai/server-sdk`                                                                           | the whole surface — control points, target registration, and both modes the scaffolded providers bring up                         |
| `web`       | `@fireweaveai/web-sdk`                                                                              | the whole surface — browser control points; credential resolution is inlined into the scaffolded `fw-providers.ts`                |
| `python`    | `fireweave`                                                                                         | the whole surface — control points, runtime, target registration                                                                  |
| `java`      | `ai.fireweave:fireweave-sdk` (Maven Central; a range within the major — see the java install table) | the whole surface — control points, runtime, target registration                                                                  |
| `swift`     | `Fireweave` (SwiftPM, git URL + tag from the SDK repo)                                              | control points in local and remote mode; credentials are build-baked via Info.plist, never env-read — see **Swift surface** below |

**A package surface installs at the 3.0.0 floor, through the tool.** The same names
for ts-server, web, Python and Java, plus Go
`github.com/FireWeave-HQ/fireweave-sdk/sdks/go/v3`, Rust `fireweave` (crates.io; on
staging a git dependency on the `rust/v3.0.0-rc.N` tag), Dart `fireweave` (pub:
`flutter pub add` / `dart pub add`) and Swift's `FireweaveStart` product from the
SDK repository `https://github.com/FireWeave-HQ/fireweave-sdk` itself (SwiftPM package
`fireweave-sdk`, resolved from its root `Package.swift` at a plain `X.Y.Z` tag; on
staging the exact plain `X.Y.Z-rc.N` tag).
The flow, exactly:

1. Run `fw tool resolve-sdk-install` with
   `{ surface, channel, harnessKind: 'package', startProfile? }` — `channel` is
   Step 0.0's answer and nothing else; `startProfile` for `dart` / `swift`. It applies
   the floor — prerelease-aware: on staging `3.0.0-rc.N` and
   Python `3.0.0rcN` pass, while the pre-rename `-staging.` builds and Python `a`
   builds are refused; 2.x fails — and preflights the start entry. `{ ok: false }` →
   show its `reason` and stop, as for a scaffold surface. With nothing to install it
   is a stop for **that app only** (a language with no dev build, Swift on staging):
   wire the other surfaces, and name the stopped one in the session summary and in
   Step 9's report (`partial`).
2. `needsVersion: true` (on staging, every language whose base version the tool
   cannot read itself: Python, Java, Go, Rust and Dart; npm reads `next`) → run the
   `preflight[]` entry with check `registry-version` (status `instruction`, its
   `command`), take the highest rc it lists (`-rc.N`, Python `rcN`; never the highest
   pre-release) and call again with that `version`.
3. Run `fw tool sdk-install` with the same input (plus `version` from step 2): it
   runs the result's `command`, bounded, when that is bun, npm, pnpm or yarn adding
   `@fireweaveai/*` packages, and refuses any other plan with the command named —
   run that one yourself. Or apply its `snippets[]` (`{ file, content, note? }`) where
   the install is a build-file edit. A `dependencyRange` (pnpm on staging) goes into that app's `package.json`
   `dependencies` first, exactly as given, then the `command` (`pnpm install`) runs.
   Then run the remaining `preflight[]` entries whose status is `instruction`.
4. Record its `sdk` (`{ name, version?, channel: 'production' | 'staging' | 'dev' }`)
   into `surfaces[].sdk`, and show its `summary`: the channel **is** the endpoint the
   app will call, and `endpoint` names that host (none on `dev`: see **Dev** below).

Without `harnessKind` the tool answers for a scaffold surface; it still needs the
`channel`. For `ts-server` and `web`, production is `<pkg>@latest` and dev
`<pkg>@dev`, in the repo manager's shape (**How** below). Staging installs the
same range as a package surface, from the same builder: `requirement`,
`command`, `installCommands` and, for pnpm, `dependencyRange` (step 3 above),
never an install by the `next` tag. With `skipPreflight` and no `version` it answers
`needsVersion: true`: run `npm view <pkg>@next version --json` and call again with
that rc as `version`. A `next` that is not an rc is refused.

**SDK installs never pin an exact version.** On every channel an SDK install takes
the channel's newest build and records a range wherever the ecosystem can express
the line. Production floats minor and patch within major 3, from the 3.0.0 floor.
Staging admits every release candidate of ONE version `X.Y.Z` (the newest rc's) and
never its release, because a stable build calls production. The tool's commands and
snippets already follow this table; never add an exact-save flag, an `==`
requirement or a plain version to them:

| Ecosystem                       | Production                                             | Staging (`X.Y.Z` from the newest rc)                                                                                       | Dev                                                                             |
| ------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| npm, bun, yarn 1 and 4, deno    | `<pkg>@latest` (refused while `latest` is below 3.0.0) | `'<pkg>@>=X.Y.Z-rc.1 <X.Y.Z-rd'`, quoted and saved verbatim (deno: `'npm:<pkg>@>=X.Y.Z-rc.1 <X.Y.Z-rd'`)                   | `<pkg>@dev` from the dev store; the manifest records `^3.0.0-dev.<stamp>.<sha>` |
| pnpm                            | as npm                                                 | write the range into `package.json`, then `pnpm install` (`pnpm add` rewrites a range to exact)                            | as npm                                                                          |
| Python: uv, poetry, pipenv, pip | `'fireweave>=3,<4'`                                    | `'fireweave>=X.Y.Zrc1,<X.Y.Zrc9999'` (poetry adds `--allow-prereleases`)                                                   | stop for that app                                                               |
| Maven                           | `[3.0.0,4.0.0)`                                        | `[X.Y.Z-rc.1,X.Y.Z)`                                                                                                       | stop for that app                                                               |
| Gradle                          | `[3.0.0,4.0.0)`                                        | the exact `X.Y.Z-rc.N` (in Gradle an exclusive upper bound is a prefix exclude)                                            | stop for that app                                                               |
| Go                              | `go get <module>/v3@latest`                            | the exact `vX.Y.Z-rc.N` (`go.mod` holds no ranges; never the highest pre-release: `v3.0.0-staging.1` sorts above every rc) | stop for that app                                                               |
| Rust                            | `cargo add 'fireweave@3'` (`fireweave = "3"`)          | the exact `rust/vX.Y.Z-rc.N` git tag (crates.io has no rc, and `cargo add fireweave@<rc>` would write a caret range)       | stop for that app                                                               |
| Dart                            | `^3.0.0` from pub.dev                                  | the exact `dart/vX.Y.Z-rc.N` git ref (a `tag_pattern` range needs the app's Dart SDK floor at 3.9 or above)                | stop for that app                                                               |
| Swift                           | `from: "3.0.0"` (SwiftPM's up-to-next-major range)     | the exact plain `X.Y.Z-rc.N` tag (`exact:`; SwiftPM ranges skip pre-releases)                                              | stop for that app                                                               |

Name the limits that apply in the install summary:

1. **Some staging installs record an exact version, by design.** `go.mod` records an exact
   version: Go's minimal version selection writes the version `go get` resolved, and
   there is no range to write. crates.io and pub.dev carry no staging build, so Rust
   and Dart staging depend on an rc git tag, recorded exactly the same way, and Gradle
   records the exact rc. Re-running the channel's install is how such a surface moves.
2. **A staging range holds one version's rcs, never its release.** The npm ceiling is
   `-rd` because `rc` sorts below `rd` and the deprecated pre-rename builds sort above
   every rc: `<X.Y.Z` would still admit `X.Y.Z-staging.1` (bun, yarn 1, Go and Cargo
   pick it), while `<X.Y.Z-rd` admits every rc and stops below those builds, the
   stable release and everything after it. Python's ceiling is `rc9999` because
   PEP 440's `<X.Y.Z` excludes X.Y.Z's own pre-releases. Maven orders every `-rc.N`
   below the release, so `[X.Y.Z-rc.1,X.Y.Z)` needs neither. New rcs of X.Y.Z arrive
   through the range (npm, Python, Maven); the exact-version ecosystems, and the next
   version's rcs everywhere (a new minor's always), need the staging install re-run.
   **Re-running the channel install is how a project stays on staging.**
3. **The production Java range admits a later rc.** Maven and Gradle ranges include
   qualifier versions: once a `3.1.0-rc.1` (or a `4.0.0-rc.1`, which Maven orders
   below `4.0.0`) is on Central, `[3.0.0,4.0.0)` can resolve it, and an rc calls
   `staging-app-server.fireweave.ai`. npm `^3.x.y`, Python `>=3,<4` and Cargo `"3"`
   skip pre-releases; pub prefers a stable version.
4. **Two package-manager commands undo a staging range.** `yarn up <pkg>` without
   `-R` replaces the range with the newest release, which moves a staging app to
   stable (and so onto production); `pnpm update` on pnpm 10 rewrites it to one
   exact version. To take a newer rc, re-run the staging install instead, and tell
   the user so in the summary.

**Dev: install the SDK from the FireWeave dev artifact store.** This applies when
Step 0.0's `channel` is `dev`: the repository is bound to a FireWeave dev stack,
whose fw-server runs with `NODE_ENV=development`. The store holds the two npm SDKs
and nothing else, so **dev is npm only**. For every other surface
`resolve-sdk-install` returns `ok: false` with the reason
"no dev build of the <language> SDK; connect a staging project to test it":
stop for that app, wire the rest, and name it in the session summary. For
`ts-server` and `web`:

1. `FW_DEV_ARTIFACTS_URL` names the store (FireWeave's dev stack sets it; a
   customer's machine or sandbox never has it). Unset → stop for that app with
   "dev store not configured" (the reason cloud setup parks with) and tell the
   user to set it, then run initialise again. Never fall back to another
   channel: a staging or production build calls a hosted fw-server, not this dev
   stack.
2. Point **only the `@fireweaveai` scope** at the store, in the user-level
   `~/.npmrc`: `@fireweaveai:registry=$FW_DEV_ARTIFACTS_URL/`. Never in the
   repository: no project `.npmrc`, no `bunfig.toml`, no manifest field. bun,
   npm and pnpm read it; yarn 2+ and Deno do not, so stop for that app as in step 1.
3. Call `resolve-sdk-install` as in the flow above, with `channel: 'dev'`. It
   preflights the store's `dev` tag (`npm view <pkg>@dev`, which resolves only through
   that `~/.npmrc` line) and returns the install by that tag
   (`bun add @fireweaveai/server-sdk@dev`, or the repo's manager per the table
   below), never an exact version or an exact-save flag; run it through
   `fw tool sdk-install` with the same input. The `dev` tag selects the prerelease
   build; the manifest records `^3.0.0-dev.<stamp>.<sha>`.
4. Record the tool's `sdk` into `surfaces[].sdk`: `{ name, version, channel: 'dev' }`.
5. **The endpoint is the bound server, not a hosted one.** A `-dev.` build has no
   endpoint of its own (SP-13 reads it as production, so left alone it would call
   `app-server.fireweave.ai`), so `FIREWEAVE_URL` goes beside the key, set to the
   project's `server.url`. A dev stack is bound through `fw login --url`, so its
   `server.kind` is `custom` and Step 3c already asks about it; never put it in code.
6. The lockfile now names the store's URL, and the Step 9 smoke's
   `sdk-channel` check FAILS on the `dev` pin: both are correct, because this
   repository does not yet build against a published SDK. Do not fix either.
   Name them in the session summary instead (in cloud setup, one `other`
   to-do: "Built against a FireWeave dev SDK build (`<name>@<version>`):
   reinstall it from the registry and drop the dev pin before this deploys").
   Fix every other failing check as usual.

**The node package was RENAMED, and the rename is a safety feature.** `@fireweaveai/sdk` is still live on npm carrying the pre-v1 OpenFeature surface. v1 ships under the new name `@fireweaveai/server-sdk`, so a repo pinned to the old name can never silently receive the breaking surface. Never install `@fireweaveai/sdk` for a v1 harness.

**The `[openfeature]` python extra is GONE — do not write it.** v1 bans an OpenFeature provider outright, so the `fireweave.openfeature` subpackage that needed the extra no longer exists. Install plain `fireweave`; `'fireweave[openfeature]'` now fails to resolve the extra. (Likewise `ai.fireweave:fireweave-openfeature` on the java side — see below.)

**How — lockfile → package manager.** Detect from the repo, never assume. The command shape differs, the package names do not:

| Detected                  | Install command                                                        |
| ------------------------- | ---------------------------------------------------------------------- |
| `bun.lock` / `bun.lockb`  | `bun add <packages>`                                                   |
| `pnpm-lock.yaml`          | `pnpm add <packages>`                                                  |
| `yarn.lock`               | `yarn add <packages>`                                                  |
| `package-lock.json`       | `npm install <packages>`                                               |
| `deno.lock` / `deno.json` | `deno add npm:<package>` per package (Deno needs the `npm:` specifier) |

That is the production shape (`<packages>` is `<pkg>@latest`). On staging take the tool's `command`: the quoted range for bun, npm, yarn and Deno; for pnpm the range written into `package.json`, then `pnpm install`.

A **python** surface uses its own managers — same detection discipline, different table:

| Detected          | Install command                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uv.lock`         | `uv add 'fireweave>=3,<4'`                                                                                                                                                                         |
| `poetry.lock`     | `poetry add 'fireweave>=3,<4'`                                                                                                                                                                     |
| `Pipfile.lock`    | `pipenv install 'fireweave>=3,<4'`                                                                                                                                                                 |
| none of the above | `pip install 'fireweave>=3,<4'` **and** record it in `pyproject.toml` / `requirements.txt` — a bare `pip install` leaves nothing in the repo, so the next checkout has no record of the dependency |

That is the production range; staging is `'fireweave>=X.Y.Zrc1,<X.Y.Zrc9999'` (poetry adds `--allow-prereleases`), per **SDK installs never pin an exact version**. Never `==`.

A **java** surface has no "install" verb at all — every path is a build-file
edit, which the repo records by construction:

| Detected                              | Add                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pom.xml`                             | ONE `<dependency>` block — `ai.fireweave:fireweave-sdk:<range>`                          |
| `build.gradle` / `build.gradle.kts`   | `implementation("ai.fireweave:fireweave-sdk:<range>")` — `mavenCentral()` is enough      |
| `gradle/libs.versions.toml` (catalog) | a `fireweave` version entry + the one library coordinate, referenced from the build file |

**The `ai.fireweave` artifacts resolve from Maven Central.** **`<range>` is a
range within the major, never a plain version and never copied from this
document:** a package surface takes the tool's snippet (`[3.0.0,4.0.0)` on
production; on staging Maven `[X.Y.Z-rc.1,X.Y.Z)` and Gradle the exact rc — see
**SDK installs never pin an exact version**). For a scaffold surface, Maven has no dist-tags, so read the major's
newest release from Central's metadata —
`https://repo1.maven.org/maven2/ai/fireweave/fireweave-sdk/maven-metadata.xml`,
the highest plain version (no `-` suffix) in `<versions>`; not `<release>` or
`<latest>`, which an rc can occupy — and write `[X.Y.Z,<X+1>.0.0)` in the build
file. A version baked into this doc would freeze every scaffolded repo at
whatever was current the day it was written — the same trap the npm channel
paragraph below records.

**Two `ai.fireweave` artifacts are PERMANENTLY ORPHANED — never scaffold them.**
`fireweave-openfeature` and `fireweave-adapter-posthog` were published to Maven
Central before v1 and are gone from the source tree; Maven artifacts are
immutable, so those coordinates still resolve and will forever. A build file
that lists either one compiles against the retired pre-v1 surface. Only
`fireweave-sdk` is v1. (`fireweave-testing` is optional and
`<scope>test</scope>` only.)

Bun is the default when nothing is detected and the repo is otherwise Node-shaped. **Two or more lockfiles, or none in a repo with no clear shape → `AskUserQuestion`** rather than guessing; installing with the wrong manager writes a second lockfile, which is a mess the user then has to unpick. Every clarification in this skill goes through `AskUserQuestion` — this is not an exception.

**Never write a version from this document into these commands.** They install by the channel's tag or the tool's range (see **SDK installs never pin an exact version**). npm's dist-tags are the source of truth for what "current" means, and a literal pinned here freezes every repo the skill scaffolds at whatever line was current the day the sentence was written — a `0.x` caret caps at the next minor, so those repos stop receiving SDK fixes silently and look deliberately pinned. The FIR-359 harness report carries the installed `@fireweaveai/server-sdk` version.

**The channel comes from the bound server, never asked.** Step 0.0's
`resolve-sdk-channel` read it from the fw-server this repository is bound to,
which decides it from its environment. Run
`fw tool resolve-sdk-install` with `{ surface, channel }`
before installing anything (a package surface adds `harnessKind: 'package'`,
the flow above). The tool refuses a call without a `channel`, or with a retired
name such as `stable` or `next`, rather than defaulting. The installed `fw` build
does not decide it: `fw self-update --channel` and `fw login`'s default target
are about the CLI, not the SDK line.

**Do not ask the user which channel to pin.** That question cost one run 4m20s
of waiting on top of a 1m43s investigation, and its answer was already decided
by the FireWeave environment the project belongs to.

**The tool PREFLIGHTS the line and can refuse.** On `{ ok: false }`, show its
`reason` and stop — do not install anyway and do not fall back to another
channel. A package surface on `production` is refused while npm `latest` is below
the 3.0.0 floor (until stable 3.0.0 is published): that refusal is correct, so say
so plainly.

**Run the install through `fw tool sdk-install`**, with the same input as
`resolve-sdk-install`: it re-resolves the plan and runs the plan's own command —
there is no free argv. Never shell out to a bare `bun add` for an SDK it accepts:
an unbounded install was **63% of all tool time** in the run this instruction
comes from — one package wedged for its full 180s timeout, then needed a manual
`kill -9` and a retry. The tool bounds each attempt, escalates SIGTERM→SIGKILL,
retries exactly once with `--verbose`, and returns a named failure instead of a
silence you cannot distinguish from slowness.

**The per-surface pin.** Record what each surface actually resolved
into `project.json` `surfaces[].sdk` as `{ name, version?, channel }` — take
`resolvedVersion` from the tool's result rather than re-reading the registry:

| `channel`    | Resolves from                                                                               | Use                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production` | the registry's stable line (npm `latest`)                                                   | a project on FireWeave production — install by the tag or the production range, never a literal version                                                                          |
| `staging`    | the newest rc: npm's `next` dist-tag, PyPI's newest `rcN`, the newest `-rc.N` tag elsewhere | a project on FireWeave staging, which runs the next SDK line before it promotes                                                                                                  |
| `dev`        | the dev artifact store, or a LOCAL path (`workspace:*`)                                     | a project on a FireWeave dev stack (npm only, see **Dev: install the SDK from the FireWeave dev artifact store**); or SDK co-development behind `sdkDev` / `FIREWEAVE_SDK_DEV=1` |

A pin recorded before the rename says `stable`: read it as `production`, and write `production`.

**The npm dist-tag is `next`. The prerelease identifier is `-rc.N`. The
channel this skill records is `staging`. Three spellings, one line — do not
assume any of them from another.** A staging release is
`<major>.<minor>.<patch>-rc.<N>` — e.g. `3.0.0-rc.1` — published under
the npm dist-tag **`next`**. `next` tells the tool which rc is newest; the
install is the range of that rc's version, never the tag and never the version:

```
bun add '@fireweaveai/server-sdk@>=X.Y.Z-rc.1 <X.Y.Z-rd'   # or npm/yarn/deno; pnpm: package.json, then pnpm install
```

There is **no `staging` dist-tag** and there never has been. The SDK's own
release workflow explains why the channel does not live in a tag at all:
"a dist-tag is a mutable pointer — the same bytes can be staging today and
production tomorrow … a version suffix puts the channel in the version itself".
npm still requires an explicit `--tag` on every publish, because it defaults
untagged publishes to `latest` even for prereleases, so `--tag next` exists as
"pure syntax to dodge that footgun, not the channel signal"
(`fireweave-sdk/.github/workflows/release.yml`, header and jobs `publish-npm-staging-*`).

Installing the range matters twice over. A literal staging version is the same
freeze trap as pinning a stable one — a repo dogfooding `3.0.0-rc.1` stops
receiving `-rc.2` and looks deliberately pinned. And an install by the tag saves
`^X.Y.Z-rc.N`, which admits the stable `X.Y.Z` (it calls production) and the
deprecated `X.Y.Z-staging.1` (limit 2 of **SDK installs never pin an exact
version**). The range takes every rc of `X.Y.Z` and nothing else; the version
recorded in `surfaces[].sdk` says what it resolved to on the day.

`-rc.N` is a semver PRERELEASE, so it sorts BELOW `3.0.0` and can never be
mistaken for the release it precedes. The channel is read from the version by
one rule in every SDK (fireweave-sdk spec SP-13): a version containing `-rc.` is
a staging build and calls `staging-app-server.fireweave.ai`; any other SemVer
version, other pre-releases included (`-beta.N`, a dev-store `-dev.` build), is
production. Python follows PEP 440: any pre-release or dev release is staging, and
FireWeave publishes only `rcN` ones. Builds published before the rename keep the
rule they shipped with, which is why `resolve-sdk-install` refuses a `-staging.`
version outright instead of reading it.

**Python has no dist-tags, so the channel is the specifier.** Staging and
production both publish to **PyPI**: a staging build is `X.Y.ZrcN` (PEP 440's
spelling of `-rc.N`), a release is plain. pip, uv, poetry and pipenv skip
pre-releases unless the requirement names one, so the range decides the channel:

```
pip install 'fireweave>=3,<4'                      # production: the newest 3.x release, never an rc
pip install 'fireweave>=X.Y.Zrc1,<X.Y.Zrc9999'     # staging: every rc of X.Y.Z, never X.Y.Z itself
```

Never `==` and never a plain version. On staging, poetry also needs
`--allow-prereleases` (the tool's command carries it), and the `rc9999` ceiling
keeps uv, which prefers a final release whenever one satisfies the range, on the
rcs. Record the channel as `staging` — the channel is FireWeave's vocabulary, not
the registry's.

`version` is written AFTER install, recording what actually resolved — never
prescribed before it. A literal range written here freezes every scaffolded repo
at whatever line was current the day it was written; the registry is the source of
truth for "current". Omit `version` and the channel's install decides it: the tag
on production and dev, the newest rc's range on staging.

**`dev` is never a fallback, and that is now mechanical.** `verify-prod-path`
carries an `sdk-channel` check that REFUSES a `dev` pin whenever `CI` is set or
the target environment is prod-tier. A local path does not exist on a runner or a
deploy box, so the install either fails loudly — fine — or silently resolves a
STALE copy vendored into the image once, and then the SDK running in production
is whatever happened to be on disk, behind a green build. A repo initialised
before per-surface pins has none; that reports **skip**, never pass, so an
unreadable pin can never masquerade as a verified one.

### The SDK contract — where providers come from

Every SDK (https://github.com/FireWeave-HQ/fireweave-sdk) has **two tiers over one
core**, and which one a surface uses is its harness kind. They obey opposite rules on
purpose — do not carry a rule from one tier to the other.

#### Tier 1 — the START PROFILE (default for every NEW surface, `harnessKind: 'package'`)

| Surface     | Package                                  | Start entry                                         | Start call                                                                           |
| ----------- | ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ts-server` | `@fireweaveai/server-sdk` ≥ 3.0.0        | `@fireweaveai/server-sdk/start` (or `/register`)    | `start({ controlPoints })`                                                           |
| `web`       | `@fireweaveai/web-sdk` ≥ 3.0.0           | `@fireweaveai/web-sdk/start` + `/vite` or `/define` | `ready = start({ controlPoints })`                                                   |
| `python`    | `fireweave` ≥ 3.0.0                      | `fireweave.start`                                   | `start(control_points=control_points)`                                               |
| `go`        | `.../sdks/go/v3` ≥ v3.0.0                | `.../sdks/go/v3/fw`                                 | `fw.Start(fw.Options{ControlPoints: …})` / `fw.MustStart`                            |
| `java`      | `ai.fireweave:fireweave-sdk` ≥ 3.0.0     | `ai.fireweave.sdk.start.Fw`                         | `Fw.start(StartOptions.builder().controlPoints(…).build())`                          |
| `rust`      | `fireweave` crate ≥ 3.0.0                | `fireweave::start`                                  | `fireweave::start::start(StartOptions { control_points: …, ..Default::default() })?` |
| `dart`      | `fireweave` (pub) ≥ 3.0.0                | `package:fireweave/client.dart` or `server.dart`    | `await Fireweave.start(controlPoints: …)`                                            |
| `swift`     | `FireweaveStart` product, SDK repository | `import FireweaveStart`                             | `startFireweave(controlPoints: …)`                                                   |

- **The mode is INFERRED, by one rule in every SDK:** an explicit `mode` option wins;
  otherwise a key means **remote**; no key and an environment name of `development`,
  `dev`, `local` or `test` means **local**, serving the values in the surface's
  **control-points file** (`defineControlPoints` / `define_control_points` /
  `fw.DefineControlPoints`); anything else **fails closed**, naming the key variable —
  a server's start throws (or returns the error), a web build fails, and a Dart client
  or Swift app marks itself failed and serves defaults without throwing. A deploy that
  lost its key never becomes local evaluation.
- **It reads `FIREWEAVE_*`.** Server profiles read `FIREWEAVE_KEY` (project key,
  `project-api-key_…`), `FIREWEAVE_URL`, `FIREWEAVE_ENV` then `APP_ENV` (ts-server also
  `NODE_ENV`) and `FIREWEAVE_INSTANCE_ID` from the process. Client profiles take
  `FIREWEAVE_BROWSER_KEY` (browser key, `fw_public_…`), `FIREWEAVE_URL` and
  `FIREWEAVE_ENV` as **build** values (the web build helper, Dart defines, Swift
  Info.plist). The legacy `FW_PROJECT_API_KEY` / `FW_API_URL` / `FW_ATTEST_URL` are
  still read with one warning; initialise never writes them for a package surface.
- **The endpoint is the SDK channel**: a `-rc.N` (Python `rcN`) build calls
  `staging-app-server.fireweave.ai`, any other `app-server.fireweave.ai`;
  `FIREWEAVE_URL` is only for a self-hosted or bench fw-server, or a FireWeave dev
  stack (a `-dev.` build has no endpoint of its own).
- **The wrong key family is refused at start** — a browser key in a server, a project
  key in a client — naming where it came from, never the value.
- **One start per process, nothing beside it**: no hand-rolled `initFireweave`, no
  second start, no harness module. Every option and override per language is in the
  **Agent instructions — SDK configuration sections**.

#### Tier 2 — the CORE `initFireweave` (scaffold surfaces, and advanced use)

The core is what a scaffold surface's generated harness calls, and what an app may
call directly for wiring the start profile does not cover (a per-user server client,
a custom adapter). Initialise never writes it for a new surface. The standalone SDKs
are REQUIRED by the scaffolded harness, not optional extras. **Every surface binds BOTH its prod and its dev provider from its OWN standalone SDK** — there is no second package in the harness graph.

| Surface     | Package                      | Entry point      | Prod tier        | Dev tier        |
| ----------- | ---------------------------- | ---------------- | ---------------- | --------------- |
| `ts-server` | `@fireweaveai/server-sdk`    | `initFireweave`  | `mode: 'remote'` | `mode: 'local'` |
| `web`       | `@fireweaveai/web-sdk`       | `initFireweave`  | `mode: 'remote'` | `mode: 'local'` |
| `python`    | `fireweave`                  | `init_fireweave` | `mode="remote"`  | `mode="local"`  |
| `java`      | `ai.fireweave:fireweave-sdk` | `Fireweave.init` | `Mode.REMOTE`    | `Mode.LOCAL`    |
| `swift`     | `Fireweave` (SwiftPM)        | `initFireweave`  | `.remote(…)`     | `.local(…)`     |

**One entry point, two modes — not two constructions.** In the core, `mode` is REQUIRED and never inferred: with inference, a missing or mistyped credential in production silently becomes local evaluation, every control point serves its default, and the boot log stays green. The observable symptom is a feature that never ramps, which is indistinguishable from a rollout nobody started. Because both tiers are the same call differing by one option, they cannot skew in validation, lifecycle gating or context canonicalization.

**Never hand-construct the runtime/adapter/client** to "simplify" a template. It compiles and runs, and it bypasses the initialisation validation that makes a bad credential fail loudly at boot.

**The core SDK reads NO environment variables** — every credential is an explicit option. The HARNESS reads `FW_API_URL` / `FW_PROJECT_API_KEY` (`PUBLIC_FW_*` on web) and passes them in. It also passes `allowedHosts` derived from the configured URL: without it the SDK validates against a canonical `*.fireweave.ai`-plus-loopback allowlist, so a **self-hosted fw-server fails initialisation with a bare `Configuration` error that names nothing**.

**Why this needs a guard and not just this paragraph:** a template that binds a
provider from anywhere other than its own standalone SDK still compiles, runs,
and passes every other test — nothing about a wrong-but-valid provider import is
self-announcing. `harness/sdk-contract.guard.test.ts` reads the templates and
fails on any provider symbol that does not come from the surface's own SDK.

The web template's `resolveFireweaveWebCredentials` is NOT a provider and is not
what the guard bans — it is a local helper defined in `fw-providers.ts` that
reads the build-baked `PUBLIC_FW_*` values and passes them INTO the web SDK's
adapter. It used to be imported from a separate package; it was inlined
when that package was dissolved, so the credentials still resolve exactly the
same way and the SDK still reads no environment of its own.

Only when the user explicitly opts into SDK co-development (`rolloutReady.sdkDev: true` or `FIREWEAVE_SDK_DEV=1`) use `workspace:*` for these packages instead of the registry.
