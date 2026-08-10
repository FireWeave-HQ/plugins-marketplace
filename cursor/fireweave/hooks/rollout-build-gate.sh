#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
# No pointer at all ⇒ not a FireWeave repo. Nothing to gate.
#
# This is the ONLY silent exit 0 in this script, and that is the whole contract:
# a stop hook reads "exit 0, no output" as a PASS, so every other reason not to
# run has to say so. The wrapper used to read `rolloutReady.initialized`, which
# gave two more silent exits — a block that never wrote the key, and a block
# carrying `initialized: false` — and both switched the gate off fleet-wide with
# nothing on stdout, stderr, or the exit code to distinguish them from a clean run.
if [[ ! -f "$proj" ]]; then exit 0; fi
# Bound iff the pointer carries identity. Nothing about the `rolloutReady` block
# is consulted: whether the repo has one is a shape question (catalog PROJ-3),
# never a gating question, and `version` is advisory.
bound="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(j.projectId || j.projects ? 'yes' : 'no');
" "$proj")" || {
  echo "rollout-build-gate: cannot read $proj" >&2
  exit 1
}
# Present but identity-less is a MALFORMED binding, not an ungated repo: every
# writer (`select_project`, `fw init`) puts identity in before anything else.
# Fail closed and name it, exactly as an unparseable pointer does.
if [[ "$bound" != "yes" ]]; then
  echo "rollout-build-gate: $proj carries no project identity (projectId / projects) — refusing to report a pass on a repo this gate cannot scope. Bind the repo with \`fw init\` or /fireweave:initialise." >&2
  exit 1
fi
# The gate itself decides what an absent manifest means (D-C); the wrapper must
# not pre-empt that verdict.
node "$root/.fireweave/hooks/rollout-build-gate.mjs"
