#!/usr/bin/env bash
# After agent work, nudge when rollout-ready artifacts drift.
# fireweave-stop-hook: 3
#
# Cursor submits a stop hook's `followup_message` as the next prompt, up to
# five times, so every follow-up is a forced turn (0049 Stage D):
#   - setup state is not drift: when `cache-required` (a fresh clone has no
#     .fireweave/.cache/) or `gate-outdated` are the only blocking findings,
#     there is no follow-up; one line goes to stderr (Cursor's hook output),
#     once per conversation. The gate still refuses to pass on them;
#   - drift sends one follow-up, and none while `loop_count` says this hook
#     already sent one.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
gate="$root/.fireweave/hooks/rollout-build-gate.sh"
payload=""
if [[ ! -t 0 ]]; then payload="$(cat 2>/dev/null || true)"; fi
flat="$(printf '%s' "$payload" | tr '\n\r' '  ')"
loops="$(printf '%s' "$flat" | grep -oE '"loop_count"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -1 || true)"
if [[ -n "$loops" && "$loops" -gt 0 ]]; then exit 0; fi
conversation="$(printf '%s' "$flat" | grep -oE '"conversation_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^.*:[[:space:]]*"//; s/"$//' || true)"
# The project requires FireWeave and nobody is signed in: a conversation that
# edited files (afterFileEdit) gets the sign-in follow-up instead of the build
# gate. The agent gate decides and words it. (When FireWeave is off here or
# waiting on the person, the build gate below passes quietly.)
agent_gate="$root/.fireweave/hooks/agent-gate.sh"
if [[ -f "$agent_gate" ]]; then
  signin="$(printf '%s' "$payload" | bash "$agent_gate" cursor stop 2>/dev/null || true)"
  if [[ -n "$signin" ]]; then
    printf '%s\n' "$signin"
    exit 0
  fi
fi
# No gate ⇒ nothing to run. A gate that is PRESENT but not executable used to
# mean the same thing SILENTLY — a repo that believes it is gated and is not.
# Say so, and run it through bash rather than skipping the check. Likewise never
# discard the gate's stderr: a wrapper that refuses to run explains itself there.
if [[ ! -f "$gate" ]]; then exit 0; fi
if [[ ! -x "$gate" ]]; then
  echo "fireweave-rollout-stop: $gate is not executable — running it via bash. Repair with: chmod +x $gate" >&2
fi
out="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$out" "$err"' EXIT
# Capture the gate's stderr — never discard it. A wrapper that refuses to run
# (unreadable or identity-less pointer) exits non-zero with an explanation there
# and NO JSON on stdout; `2>/dev/null` turned that into the generic
# "drift detected" line, which reads as an ordinary finding rather than as
# "this repo is not being gated".
if bash "$gate" >"$out" 2>"$err"; then exit 0; fi
rules="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log([...new Set((j.findings||[]).filter(f=>f.severity==='block').map(f=>f.rule))].sort().join(','))" "$out" 2>/dev/null || true)"
findings="$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log((j.findings||[]).filter(f=>f.severity!=='info').map(f=>f.fix?f.message+' Fix: '+f.fix:f.message).join('; '))" "$out" 2>/dev/null || true)"
if [[ -z "$findings" ]]; then
  findings="the gate produced no verdict: $(tr '\n' ' ' <"$err")"
fi
case ",$rules," in
  ,cache-required, | ,gate-outdated, | ,cache-required,gate-outdated,)
    marks="${TMPDIR:-/tmp}/fireweave-stop-hook.$(id -u 2>/dev/null || echo 0)"
    key="$(printf '%s|%s|setup:%s' "$root" "$conversation" "$rules" | cksum | awk '{print $1}')"
    if [[ ! -e "$marks/$key" ]]; then
      { mkdir -p "$marks" && : >"$marks/$key"; } 2>/dev/null || true
      echo "FireWeave build gate: not green, and nothing to fix in code (shown once this conversation): ${findings}" >&2
    fi
    exit 0
    ;;
esac
msg="FireWeave rollout-ready drift: ${findings}. Follow FireWeave's contract in .fireweave/instructions/contract.md (the manifest on this branch, one anchor, where the key is read), then run fw tool reconcile with phase build."
printf '%s\n' "{\"followup_message\":$(node -e "console.log(JSON.stringify(process.argv[1]))" "$msg")}"
