#!/usr/bin/env bash
# fw-auth-gate.sh
#
# Triggered by:
#   - PreToolUse  (matcher: Skill, if: Skill(skill='safe-rollout'|'create-task'))
#     This covers both typed plugin slash commands (e.g. /fireweave:create-task,
#     which dispatch through the Skill tool) and model-dispatched skill calls.
#
# Implements the L3 -> L2 -> L1 escalation: silent token rotate, then
# fast happy-path `fw status`, then inline OAuth device flow on failure.
#
# Exits:
#   0  — auth ready (or restored inline). Tool proceeds.
#   2  — auth required but could not be obtained. Tool blocked.
#
# This script is idempotent: if the user is already authenticated,
# it returns 0 without prompting or rotating.

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
    safe-rollout|create-task) ;;   # target skill — proceed with auth gate
    "") ;;                         # no skill arg in payload — defensive accept
    *) exit 0 ;;                   # other skill — silently skip auth gate
  esac
fi

# ── Preflight: is `fw` even on the PATH? ─────────────────────────────────
if ! command -v fw >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✗ Fireweave CLI (`fw`) is not installed or not on your PATH.

This skill requires the `fw` CLI for deterministic preflight (auth,
project binding, token rotation). Install it and retry:

  # via bun (recommended)
  bun install -g @fireweaveai/cli

  # or follow the setup guide
  cat ${CLAUDE_PLUGIN_ROOT:-<plugin>}/.claude-plugin/SETUP.md

After installing, run `fw login` (or just retry — the hook will start
the inline device flow for you).
EOF
  exit 2
fi

# ── Level 3: silent token rotate if near expiry ──────────────────────────
# No-op if the token isn't near expiry. Failures here are non-fatal —
# Level 1's `fw status` will catch any real problem next.
fw token rotate --silent 2>/dev/null || true

# ── Level 1: fast happy-path check ───────────────────────────────────────
if fw status --silent 2>/dev/null; then
  exit 0          # already authenticated → prompt proceeds
fi

# ── Level 2: inline device flow ──────────────────────────────────────────
# `fw login --inline-device-flow` does:
#   1. POST /api/cli/auth/device  → { user_code, verification_uri, device_code }
#   2. Open the verification_uri in the user's default browser via
#      xdg-open / open / wsl-open. If no GUI is available (devcontainer,
#      SSH, headless), prints the URL + code to stderr for manual
#      completion on a different machine and continues polling.
#   3. Poll /api/cli/auth/token until success or timeout (default 300s).
#   4. On success: persist token to keyring (Tier 1) or
#      ~/.fireweave/auth.json (Tier 2 fallback).
echo "🔐 Fireweave authentication required. Opening browser..." >&2

if fw login --inline-device-flow --timeout 300; then
  echo "✓ Authenticated. Continuing..." >&2
  exit 0          # prompt proceeds
fi

# ── Level 1 fallback: block + ask user to run `fw login` manually ────────
cat >&2 <<'EOF'
✗ Fireweave authentication failed or timed out.

Run `fw login` manually in a terminal, then retry your request:

  fw login --cloud      # for production
  fw login --local      # for local dev (Fireweave engineers)

For diagnostics: `fw doctor`
EOF
exit 2
