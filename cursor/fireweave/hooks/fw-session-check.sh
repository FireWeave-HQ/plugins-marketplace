#!/usr/bin/env bash
# fw-session-check.sh — FireWeave's session-start check (0656 W12; 0049 Stage D).
#
#   fw-session-check.sh claude|cursor|codex|cline   (the hook input JSON on stdin)
#
# When a session starts in a FireWeave repository (one with
# `.fireweave/project.json`), it looks for what an older plugin, adopt or setup
# run left behind, and prints ONE line naming the fix. It never blocks, never
# asks, and never writes into the repository.
#
# 1. Stale instruction text, in the coding-agent instruction files `fw doctor`
#    reads (`isInstructionFile` in `@fireweaveai/rollout-engine`), with the same
#    rules as its `findStaleInstructions` (a parity test keeps them equal):
#      - a FireWeave entry block from before the gate (any role but
#        `agents-contract` below `format=3`): it loads the contract whether or
#        not FireWeave is on, and `fw tool render-entries` writes the gate;
#      - a FireWeave contract (`agents-contract`) in `format=1` (the interim
#        text). This plugin ships once the merge path registers per
#        environment, so `format=2` is the norm and `fw tool render-entries`
#        rewrites the block in place;
#      - the HARD ORDER block an older `/fireweave:adopt` appended;
#      - a retired rollout-server MCP tool: `mcp__rollout-server__…` anywhere, a
#        bare name inside a current FireWeave block or a FireWeave skill copy;
#      - an instruction to run the removed safe-rollout.
#    Fix: `fw tool render-entries`, or `/fireweave:adopt`.
# 2. Older FireWeave hooks: the repository's `.fireweave/hooks/rollout-build-gate.
#    {mjs,sh}` or `agent-gate.sh` differ from the copies beside this script, a
#    FireWeave stop hook lacks the `# fireweave-stop-hook: 3` line (it honours
#    the agent gate), or the retired intent gate / Cursor session hook is still
#    there. Fix: `/fireweave:adopt`, which refreshes them.
#
# Hosts (the argument):
#   claude  Claude Code SessionStart: `systemMessage` (the person sees it) and
#           `hookSpecificOutput.additionalContext` (the agent knows the text is
#           stale and does not follow it).
#   cursor  Cursor sessionStart: `{ additional_context }`.
#   codex   Codex SessionStart: the line on stdout.
#   cline   Cline TaskStart: `{ cancel: false, contextModification }`.
#
# Bash 3.2 and BWK awk safe (macOS defaults). No jq, no node.

set -u

host="${1:-}"
case "$host" in
  claude | cursor | codex | cline) ;;
  *)
    echo "usage: fw-session-check.sh claude|cursor|codex|cline (the hook input JSON on stdin)" >&2
    exit 0
    ;;
esac

HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

quiet() {
  [ "$host" = "cline" ] && printf '%s\n' '{"cancel": false}'
  exit 0
}

HOOK_INPUT=""
if [ ! -t 0 ]; then
  HOOK_INPUT="$(cat 2>/dev/null || true)"
fi
FLAT="$(printf '%s' "$HOOK_INPUT" | tr '\n\r' '  ')"

# The first "<key>": "<string>" in the input, and the first string of
# "<key>": [ … ]. Without jq; a path's JSON escapes are undone after.
json_str() {
  printf '%s' "$FLAT" |
    grep -oE '"'"$1"'"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' |
    head -1 |
    sed 's/^[^:]*:[[:space:]]*"//; s/"$//'
}
json_first() {
  printf '%s' "$FLAT" |
    grep -oE '"'"$1"'"[[:space:]]*:[[:space:]]*\[[[:space:]]*"([^"\\]|\\.)*"' |
    head -1 |
    sed 's/^[^[]*\[[[:space:]]*"//; s/"$//'
}

# Where the session runs: Claude Code and Codex send `cwd`, Cursor
# `workspace_roots`, Cline `workspaceRoots`.
dir="$(json_str cwd)"
[ -n "$dir" ] || dir="$(json_first workspace_roots)"
[ -n "$dir" ] || dir="$(json_first workspaceRoots)"
dir="$(printf '%s' "$dir" | sed 's/\\\//\//g; s/\\\\/\\/g')"
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-${PWD:-.}}"
[ -d "$dir" ] || quiet

root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || root="$dir"
[ -f "$root/.fireweave/project.json" ] || quiet

# ── 1. Stale instruction text ────────────────────────────────────────────────

# rollout-engine's INSTRUCTION_FILES, as one ERE.
INSTRUCTION_RE='(^|/)AGENTS(\.override)?\.md$|(^|/)CLAUDE(\.local)?\.md$|^\.claude/rules/.+\.md$|^\.cursor/rules/.+\.mdc?$|^\.cursorrules$|^\.cursor/skills/[^/]+/SKILL\.md$|^\.github/copilot-instructions\.md$|^\.github/instructions/.+\.instructions\.md$|(^|/)GEMINI\.md$|^\.junie/guidelines\.md$|^\.windsurfrules$|^\.clinerules(/.+\.md)?$|^\.fireweave/agents-core\.md$|^\.fireweave/agents-gate\.md$|^\.fireweave/agent-instructions\.md$|^\.fireweave/instructions/.+\.md$'

listed="$(git -C "$root" ls-files --cached --others --exclude-standard 2>/dev/null || true)"
if [ -z "$listed" ]; then
  listed="AGENTS.md
AGENTS.override.md
CLAUDE.md
.claude/CLAUDE.md
.cursor/rules/fireweave-rollout-ready.mdc
.github/copilot-instructions.md
GEMINI.md
.junie/AGENTS.md
.junie/guidelines.md
.fireweave/agents-gate.md
.fireweave/agents-core.md
.fireweave/instructions/contract.md
.fireweave/agent-instructions.md"
fi

set --
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$root/$f" ] || continue
  # Files over 1 MiB are not read (the renderer and fw doctor skip them too).
  size="$(wc -c <"$root/$f" 2>/dev/null | tr -d ' ')"
  [ -n "$size" ] && [ "$size" -le 1048576 ] || continue
  set -- "$@" "$f"
done <<EOF
$(printf '%s\n' "$listed" | grep -E "$INSTRUCTION_RE" | sort -u)
EOF

# One "<kind><TAB><file>" line per kind per file: rollout-engine's
# findStaleInstructions, line for line.
AWK='
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function wordch(c) { return c != "" && c ~ /[a-z0-9_]/ }
function report(kind) {
  if (!((kind, FILENAME) in seen)) { seen[kind, FILENAME] = 1; print kind "\t" FILENAME }
}
# The first place in s where needle stands as a word (\b on both sides;
# `pre` 0 checks only the end, for a needle that starts with "/").
function bounded(s, needle, pre,    off, i, p, n) {
  off = 0; n = length(needle)
  while ((i = index(substr(s, off + 1), needle)) > 0) {
    p = off + i; off = p
    if (pre && p > 1 && wordch(substr(s, p - 1, 1))) continue
    if (wordch(substr(s, p + n, 1))) continue
    return p
  }
  return 0
}
# /\/fireweave:safe-rollout\b|\/fw-rollout\b|\bfw_rollout\b|\b(?:run|runs|invoke|use|call|via|through|with)\b[^.;\n]{0,40}\bsafe-rollout\b/i
function saferun(l,    s, off, i, p, k, c, v, nv, vlen, verbs, lo) {
  s = tolower(l)
  if (bounded(s, "/fireweave:safe-rollout", 0) || bounded(s, "/fw-rollout", 0) || bounded(s, "fw_rollout", 1)) return 1
  nv = split("run runs invoke use call via through with", verbs, " ")
  off = 0
  while ((i = index(substr(s, off + 1), "safe-rollout")) > 0) {
    p = off + i; off = p
    if (p > 1 && wordch(substr(s, p - 1, 1))) continue
    if (wordch(substr(s, p + 12, 1))) continue
    lo = p - 40; if (lo < 1) lo = 1
    for (k = p - 1; k >= lo; k--) {
      c = substr(s, k, 1)
      if (c == "." || c == ";") break
      if (wordch(c)) continue
      for (v = 1; v <= nv; v++) {
        vlen = length(verbs[v])
        if (k - vlen < 1) continue
        if (substr(s, k - vlen, vlen) != verbs[v]) continue
        if (k - vlen > 1 && wordch(substr(s, k - vlen - 1, 1))) continue
        return 1
      }
    }
  }
  return 0
}
BEGIN { LEGACY = "## \360\237\224\264 FireWeave rollout-ready \342\200\224 HARD ORDER" }
FNR == 1 {
  fence = ""; fencelen = 0; inblock = 0; covered = 0
  skill = (FILENAME ~ /^\.cursor\/skills\/fw[-_][^\/]+\/SKILL\.md$/)
  sub(/^\357\273\277/, "")
}
{
  sub(/\r$/, "")
  line = $0
  code = 0
  isfence = match(line, /^ ? ? ?(```+|~~~+)/)
  if (isfence) { run = substr(line, RSTART, RLENGTH); gsub(/ /, "", run) }
  if (fence != "") {
    code = 1
    if (isfence && substr(run, 1, 1) == fence && length(run) >= fencelen && trim(line) == run) fence = ""
  } else if (isfence) {
    fence = substr(run, 1, 1); fencelen = length(run); code = 1
  }
  t = trim(line)
  if (!code && t ~ /^<!-- fireweave:begin role=[a-z][a-z-]* format=[0-9]+ sha256=[0-9a-f]+ -->$/) {
    sha = t; sub(/^.* sha256=/, "", sha); sub(/ -->$/, "", sha)
    if (length(sha) == 64) {
      fmt = t; sub(/^.* format=/, "", fmt); sub(/ .*$/, "", fmt)
      role = t; sub(/^<!-- fireweave:begin role=/, "", role); sub(/ .*$/, "", role)
      # The contract is current at 2; every other block at 3, the gate.
      if (role == "agents-contract" && fmt + 0 < 2) { report("format-1-block"); covered = 1 }
      else if (role != "agents-contract" && fmt + 0 < 3) { report("ungated-block"); covered = 1 }
      else inblock = 1
      next
    }
  }
  if (!code && t ~ /^<!-- fireweave:end role=[a-z][a-z-]* -->$/) {
    if (covered) { covered = 0; next }
    inblock = 0
  }
  if (covered) next
  if (!code && (index(line, LEGACY) == 1 && !wordch(tolower(substr(line, length(LEGACY) + 1, 1))) || trim(line) == "# FireWeave rollout-ready (promote-not-wrap)" && index(line, "#") == 1)) {
    report("legacy-block"); next
  }
  if (index(line, "mcp__rollout-server__") > 0) report("mcp-tool-name")
  else if ((skill || inblock) && line ~ /(^|[^A-Za-z0-9_])(apply_setup_artifacts|assert_dev_checklist|assert_register_rollout_args|build_register_rollout_from_manifest|detect_rollout_ready|detect_surfaces|ensure_auth|find_cleanup_candidates|get_project_capabilities|guarded_call|issue_browser_key|list_project_environments|list_registered_tools|promote_repo_manifest|provision_deploy_beacon_env|record_rollout_env_contract|refresh_agent_skills|register_rollout|resolve_sdk_channel|resolve_sdk_install|retire_repo_manifest|run_bounded_install|select_project|update_repo_state|upsert_rollout_manifest|verify_no_mixed_provider_calls|verify_prod_path|verify_rollout_config_schema)([^A-Za-z0-9_]|$)/) report("mcp-tool-name")
  if (saferun(line)) report("safe-rollout")
}
'

found=""
if [ "$#" -gt 0 ]; then
  found="$(cd "$root" && awk "$AWK" "$@" 2>/dev/null || true)"
fi

# ── 2. Older FireWeave hooks ─────────────────────────────────────────────────

hooks=""
add_hook() {
  if [ -z "$hooks" ]; then hooks="$1"; else hooks="$hooks, $1"; fi
}
gate_old=""
for g in rollout-build-gate.mjs rollout-build-gate.sh agent-gate.sh; do
  if [ -f "$root/.fireweave/hooks/$g" ] && [ -f "$HERE/$g" ] &&
    ! cmp -s "$root/.fireweave/hooks/$g" "$HERE/$g"; then
    gate_old=1
  fi
done
[ -n "$gate_old" ] && add_hook "the build gate (.fireweave/hooks/)"
if [ -f "$root/.claude/hooks/rollout-build-gate-stop.sh" ] &&
  ! grep -q '^# fireweave-stop-hook: 3$' "$root/.claude/hooks/rollout-build-gate-stop.sh"; then
  add_hook "the Claude Code stop hook"
fi
if [ -f "$root/.cursor/hooks/fireweave-rollout-stop.sh" ] &&
  ! grep -q '^# fireweave-stop-hook: 3$' "$root/.cursor/hooks/fireweave-rollout-stop.sh"; then
  add_hook "the Cursor stop hook"
fi
if [ -f "$root/.claude/hooks/rollout-intent-gate.sh" ] ||
  [ -f "$root/.cursor/hooks/fireweave-rollout-session.sh" ]; then
  add_hook "the retired session hooks (the agent gate replaces them)"
fi

[ -n "$found" ] || [ -n "$hooks" ] || quiet

# ── The one line ─────────────────────────────────────────────────────────────

line="FireWeave:"
if [ -n "$found" ]; then
  files="$(printf '%s\n' "$found" | cut -f2 | sort -u)"
  n="$(printf '%s\n' "$files" | grep -c .)"
  first="$(printf '%s\n' "$files" | head -1)"
  second="$(printf '%s\n' "$files" | sed -n 2p)"
  case "$n" in
    1) where="$first holds" ;;
    2) where="$first and $second hold" ;;
    *) where="$first, $second and $((n - 2)) more files hold" ;;
  esac
  kinds=""
  for k in ungated-block format-1-block legacy-block mcp-tool-name safe-rollout; do
    printf '%s\n' "$found" | cut -f1 | grep -qx "$k" || continue
    case "$k" in
      ungated-block) w="FireWeave blocks from before its gate" ;;
      format-1-block) w="a format=1 FireWeave contract" ;;
      legacy-block) w="an older HARD ORDER block" ;;
      mcp-tool-name) w="retired MCP tool names" ;;
      safe-rollout) w="safe-rollout instructions" ;;
    esac
    if [ -z "$kinds" ]; then kinds="$w"; else kinds="$kinds, $w"; fi
  done
  line="$line $where older FireWeave instructions ($kinds): run \`fw tool render-entries\` or /fireweave:adopt to rewrite FireWeave's blocks in place; FireWeave's tools run as \`fw tool <name>\`, and safe-rollout has been removed."
fi
if [ -n "$hooks" ]; then
  line="$line This repository's $hooks differ from this plugin's: update the FireWeave plugin, then /fireweave:adopt refreshes them."
fi

line="$(printf '%s' "$line" | tr -d '\000-\037')"
esc="$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')"
case "$host" in
  claude)
    printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$esc" "$esc"
    ;;
  cursor) printf '{"additional_context":"%s"}\n' "$esc" ;;
  cline) printf '{"cancel":false,"contextModification":"%s"}\n' "$esc" ;;
  codex) printf '%s\n' "$line" ;;
esac
exit 0
