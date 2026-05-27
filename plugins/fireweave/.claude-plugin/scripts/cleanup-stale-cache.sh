#!/usr/bin/env bash
# Cleans up Claude Code plugin cache temp_local_* orphans from failed installs.
#
# Symptom this fixes:
#   "Failed to reconnect to plugin:fireweave:rollout-server"
# during plugin reload — usually caused by a stale temp_local_*
# directory from an interrupted install.
#
# Safe to run any time; idempotent.

set -e

CACHE_DIR="${HOME}/.claude/plugins/cache"

if [[ ! -d "${CACHE_DIR}" ]]; then
  echo "No Claude Code plugin cache found at ${CACHE_DIR} — nothing to clean."
  exit 0
fi

# Count first (so we can report accurately even after rm).
COUNT=0
shopt -s nullglob
for entry in "${CACHE_DIR}"/temp_local_*; do
  COUNT=$((COUNT + 1))
done
shopt -u nullglob

rm -rf "${CACHE_DIR}"/temp_local_* 2>/dev/null || true

echo "Cleaned ${COUNT} stale entries from ${CACHE_DIR} (already gone or just removed)."
echo "Now reload the plugin: /plugin disable fireweave@fireweave && /plugin enable fireweave@fireweave"
