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
