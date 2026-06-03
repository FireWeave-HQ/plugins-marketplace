#!/usr/bin/env bash
# fw-auth-gate-core.sh
#
# Host-agnostic Fireweave auth gate. Runs the L3 -> L1 -> L2 escalation
# (silent token rotate, fast `fw status`, then inline OAuth device flow) and
# returns:
#   0  — auth ready (or restored inline). Caller proceeds.
#   2  — auth required but could not be obtained. Caller blocks.
#
# It reads NO stdin and makes NO decision about WHETHER to gate — the caller
# (a host-specific hook wrapper) decides that and invokes this only when the
# Fireweave rollout surface is about to run. Idempotent: a no-op when already
# authenticated. Used by the Claude `fw-auth-gate.sh` wrapper and by the
# Codex/Cursor/OpenCode/Cline hook sidecars.

set -e

# ── Preflight: is `fw` even on the PATH? ─────────────────────────────────
if ! command -v fw >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✗ Fireweave CLI (`fw`) is not installed or not on your PATH.

This skill requires the `fw` CLI for deterministic preflight (auth,
project binding, token rotation). Install it and retry:

  # via bun (recommended)
  bun install -g @fireweaveai/cli

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
  exit 0          # already authenticated → caller proceeds
fi

# ── Level 2: inline device flow ──────────────────────────────────────────
# `fw login --inline-device-flow` opens the verification URL in the user's
# browser (or prints it to stderr when headless), then polls for completion
# and persists the token.
echo "🔐 Fireweave authentication required. Opening browser..." >&2

if fw login --inline-device-flow --timeout 300; then
  echo "✓ Authenticated. Continuing..." >&2
  exit 0          # caller proceeds
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
