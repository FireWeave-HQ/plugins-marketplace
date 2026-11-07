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
# writer (`fw select-project`, `fw init`) puts identity in before anything else.
# Fail closed and name it, exactly as an unparseable pointer does.
if [[ "$bound" != "yes" ]]; then
  echo "rollout-build-gate: $proj carries no project identity (projectId / projects) — refusing to report a pass on a repo this gate cannot scope. Bind the repo with \`fw init\`, then run /fireweave:initialise." >&2
  exit 1
fi
# FireWeave off on this machine, or waiting on the person (signed out: sign in
# or skip), per the agent gate beside this script: nothing gates here, by
# design, and the readiness check on the pull request still runs. Said on
# stderr, never silent. CI and FireWeave-hosted reviewers are always on.
if [[ -f "$root/.fireweave/hooks/agent-gate.sh" ]]; then
  state="$(bash "$root/.fireweave/hooks/agent-gate.sh" state </dev/null 2>/dev/null || true)"
  case "$state" in
    off | ask | silent)
      echo "rollout-build-gate: FireWeave is $state for this repo on this machine (.fireweave/hooks/agent-gate.sh state), so the gate does not run." >&2
      exit 0
      ;;
  esac
fi
# The gate itself decides what an absent manifest means (D-C); the wrapper must
# not pre-empt that verdict.
#
# `fw gate` (0656 M10) is the same gate built into `fw`, so it cannot fall
# behind the `fw` that writes the projection it reads. It answers when `fw` is
# installed and this root holds `.git` (the root `fw gate` resolves, so both
# gates read the same tree). Otherwise the copied gate beside this script
# answers, exactly as before: an `fw` older than the command gives no verdict,
# and a machine without `fw` is told so once. Which `fw`: the agent gate's
# one rule (`cliPath` from .fireweave/local.json, else `fw` on PATH), then the
# default install location.
fw=""
if [[ -f "$root/.fireweave/hooks/agent-gate.sh" ]]; then
  fw="$(bash "$root/.fireweave/hooks/agent-gate.sh" cli </dev/null 2>/dev/null || true)"
elif command -v fw >/dev/null 2>&1; then
  fw="fw"
fi
if [[ -z "$fw" && -x "${HOME:-}/.fireweave/bin/fw" ]]; then
  fw="${HOME:-}/.fireweave/bin/fw"
fi
if [[ -n "$fw" && -e "$root/.git" ]]; then
  verdict="$("$fw" gate --cwd "$root" 2>/dev/null)" && rc=0 || rc=$?
  case "$verdict" in
    '{"pass":'*)
      printf '%s\n' "$verdict"
      exit "$rc"
      ;;
  esac
  echo "rollout-build-gate: \`fw gate\` gave no verdict (an fw older than the command?), so the copied gate answers. Update with \`fw self-update\`." >&2
elif [[ -z "$fw" ]]; then
  notice="${TMPDIR:-/tmp}/fireweave-build-gate-no-fw.$(id -u 2>/dev/null || echo 0)"
  if [[ ! -e "$notice" ]]; then
    echo "rollout-build-gate: \`fw\` is not installed here, so the copied gate answers. With \`fw\` installed, \`fw gate\` answers and keeps up with \`fw sync\`. (Shown once.)" >&2
    { : >"$notice"; } 2>/dev/null || true
  fi
fi
node "$root/.fireweave/hooks/rollout-build-gate.mjs"
