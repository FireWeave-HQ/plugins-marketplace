#!/usr/bin/env bash
# fw-auth-gate.sh — Claude Code PreToolUse wrapper.
#
# Triggered by:
#   - PreToolUse  (matcher: Skill, if: Skill(skill='safe-rollout'))
#     This covers both typed plugin slash commands (e.g. /fireweave:safe-rollout,
#     which dispatch through the Skill tool) and model-dispatched skill calls.
#
# Parses the Skill payload defensively, then delegates the actual auth check to
# the host-agnostic fw-auth-gate-core.sh. Exits 0 (proceed) / 2 (blocked) —
# same contract as the core.

set -e

# ── Defense-in-depth: gate on tool_input.skill ───────────────────────────
# The PreToolUse hook entry's `if` clause is the primary scoping mechanism.
# This stdin-JSON check is a belt-and-braces guard: if a future Claude Code
# release changes `if` semantics OR an older harness ignores it, we still
# exit 0 cleanly when invoked on a non-fireweave Skill call.
HOOK_INPUT=""
if [[ ! -t 0 ]]; then
  HOOK_INPUT="$(cat)"
fi

if [[ -n "$HOOK_INPUT" ]]; then
  if command -v jq >/dev/null 2>&1; then
    skill="$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null || true)"
  else
    # Pure-bash fallback: extract the first "skill": "<value>" pair.
    skill="$(printf '%s' "$HOOK_INPUT" | grep -oE '"skill"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
  fi
  case "$skill" in
    safe-rollout) ;;               # target skill — proceed with auth gate
    "") ;;                         # no skill arg in payload — defensive accept
    *) exit 0 ;;                   # other skill — silently skip auth gate
  esac
fi

# Delegate to the host-agnostic core (reads no stdin).
exec bash "$(dirname "$0")/fw-auth-gate-core.sh" </dev/null
