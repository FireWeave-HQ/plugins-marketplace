#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/.fireweave/project.json"
# No pointer at all ⇒ not a FireWeave repo. Nothing to gate.
if [[ ! -f "$proj" ]]; then exit 0; fi
# `run` is one of: legacy-initialised | pointer | not-initialised.
# Field PRESENCE, never `version` — a pointer-shaped repo has no `rolloutReady`.
run="$(node -e "
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (j.rolloutReady !== undefined && j.rolloutReady !== null) {
  process.stdout.write(j.rolloutReady.initialized ? 'yes' : 'no');
} else {
  // Pointer shape: bound iff it carries identity. The gate itself decides what
  // an absent manifest means (D-C); the wrapper must not pre-empt that with a
  // silent exit 0.
  process.stdout.write(j.projectId || j.projects ? 'yes' : 'no');
}
" "$proj")" || {
  echo "rollout-build-gate: cannot read $proj" >&2
  exit 1
}
[[ "$run" == "yes" ]] || exit 0
node "$root/.fireweave/hooks/rollout-build-gate.mjs"
