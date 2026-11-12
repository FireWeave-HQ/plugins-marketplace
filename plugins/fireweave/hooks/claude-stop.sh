#!/usr/bin/env bash
# Claude Code Stop-hook parity for the rollout-ready build gate.
# fireweave-stop-hook: 3
#
# Cursor has run this gate on every stop since initialise. Claude Code ran only
# the ADVISORY intent gate (a reminder on SessionStart / UserPromptSubmit), so a
# Claude-only host had no build gate at all — the manifest ⇄ anchor check simply
# did not happen, and nothing said so. This closes that asymmetry.
#
# Fail-open on everything EXCEPT a gate that ran and failed: a missing node, a
# missing gate, an unreadable temp file must never wedge a session. The one
# fail-open that is now VISIBLE is a gate present but not executable — that used
# to skip the check silently, which is a repo that believes it is gated and is
# not.
#
# Setup state is not drift (0049 Stage D). A fresh clone has no
# .fireweave/.cache/ (it is gitignored), and a copied gate can be older than the
# cache `fw` wrote. The gate still refuses to pass on either (`cache-required`,
# `gate-outdated`: a missing cache is never green), but blocking on them forced
# a turn on every reply for something no code edit fixes. So when those are the
# only blocking findings, the person is told ONCE per session (`systemMessage`)
# and the stop is not blocked. Drift (an orphan anchor, a manifest control
# point with no anchor, RAMP-1, an unreplayable queue entry) still blocks.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
gate="$root/.fireweave/hooks/rollout-build-gate.sh"

payload=""
if [ ! -t 0 ]; then payload="$(cat 2>/dev/null || true)"; fi
flat="$(printf '%s' "$payload" | tr '\n\r' '  ')"
# Claude sets `stop_hook_active` once this hook has already blocked. Blocking a
# second time loops the agent against a gate it may not be able to clear (e.g.
# `fw sync` needs a network this session does not have).
case "$flat" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
# Cursor runs this hook too (it imports Claude Code's hooks) and sends no
# `stop_hook_active`. Its `loop_count` says it already sent a follow-up.
loops="$(printf '%s' "$flat" | grep -oE '"loop_count"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -1)"
if [ -n "$loops" ] && [ "$loops" -gt 0 ]; then exit 0; fi
session="$(printf '%s' "$flat" | grep -oE '"(session_id|conversation_id)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^.*:[[:space:]]*"//; s/"$//')"

# True the first time `$1` is seen in this session (per repository); a marker
# file under $TMPDIR remembers it.
once() {
  marks="${TMPDIR:-/tmp}/fireweave-stop-hook.$(id -u 2>/dev/null || echo 0)"
  key="$(printf '%s|%s|%s' "$root" "$session" "$1" | cksum | awk '{print $1}')"
  [ -e "$marks/$key" ] && return 1
  { mkdir -p "$marks" && : >"$marks/$key"; } 2>/dev/null || true
  return 0
}

# The project requires FireWeave and nobody is signed in: finishing with file
# edits made waits for a sign-in, unless the agent declared the task
# infra-only. The agent gate decides and words it. (When FireWeave is off here
# or waiting on the person, the build gate below passes quietly.)
agent_gate="$root/.fireweave/hooks/agent-gate.sh"
if [ -f "$agent_gate" ]; then
  signin="$(printf '%s' "$payload" | bash "$agent_gate" claude Stop 2>/dev/null || true)"
  if [ -n "$signin" ]; then
    printf '%s\n' "$signin"
    exit 0
  fi
fi

[ -f "$gate" ] || exit 0
if [ ! -x "$gate" ]; then
  echo "rollout-build-gate-stop: $gate is not executable — running it via bash. Repair with: chmod +x $gate" >&2
fi

out="$(mktemp 2>/dev/null)" || exit 0
err="$(mktemp 2>/dev/null)" || exit 0
trap 'rm -f "$out" "$err"' EXIT
# Capture the gate's stderr — never discard it. A wrapper that refuses to run
# (unreadable or identity-less pointer) exits non-zero with an explanation there
# and NO JSON on stdout; `2>/dev/null` turned that into the generic
# "drift detected" line, which reads as an ordinary finding rather than as
# "this repo is not being gated".
if bash "$gate" >"$out" 2>"$err"; then exit 0; fi

rules="$(node -e "
const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
console.log([...new Set((j.findings || []).filter((f) => f.severity === 'block').map((f) => f.rule))].sort().join(','));
" "$out" 2>/dev/null || true)"
reason="$(node -e "
const j = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'));
console.log((j.findings || []).filter((f) => f.severity !== 'info').map((f) => (f.fix ? f.message + ' Fix: ' + f.fix : f.message)).join('; '));
" "$out" 2>/dev/null || true)"
if [ -z "$reason" ]; then
  reason="the gate produced no verdict: $(tr '\n' ' ' <"$err")"
fi

case ",$rules," in
  ,cache-required, | ,gate-outdated, | ,cache-required,gate-outdated,)
    once "setup:$rules" || exit 0
    msg="FireWeave build gate: not green, and nothing to fix in code (shown once this session): ${reason}"
    node -e "console.log(JSON.stringify({ systemMessage: process.argv[1] }))" "$msg" 2>/dev/null \
      || printf '%s\n' "$msg" >&2
    exit 0
    ;;
esac

# A host that sends no `stop_hook_active` (Cursor) blocks once per conversation
# for the same findings, never in a loop.
case "$flat" in
  *'"stop_hook_active"'*) ;;
  *) once "drift:$reason" || exit 0 ;;
esac
msg="FireWeave rollout-ready build gate FAILED: ${reason} Follow FireWeave's contract in .fireweave/instructions/contract.md — author the manifest on this branch with fw tool upsert-rollout-manifest and put one // @fireweave-controlpoint <key> where the key is read — then re-run the gate. If a finding says \`fw sync\`, this worktree has no server projection and absence is NOT evidence: fetch it rather than authoring over a contract you cannot see."
node -e "console.log(JSON.stringify({ decision: 'block', reason: process.argv[1] }))" "$msg" 2>/dev/null \
  || printf '%s\n' "$msg"
exit 0
