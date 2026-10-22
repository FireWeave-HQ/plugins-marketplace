#!/usr/bin/env bash
# fw-shell-gate.sh — FireWeave's shell-command hook (0656 W6; 1230 §5, layer 3).
#
#   fw-shell-gate.sh claude|cursor|cline|exit     (the hook input JSON on stdin)
#
# It judges two kinds of shell command and stays out of every other one.
#
# 1. `fw tool …` (W6). FireWeave's tools may run without a prompt only as ONE
#    plain command: `fw tool <op> [args]` (or `fw.exe`, `~/.fireweave/bin/fw`,
#    `~/.fireweave/bin/fw.exe`), each argument made of letters, digits and
#    `. _ / : = , @ + % ^ -`. Nothing else: no redirection (`<`, `>`), no `;`,
#    no `&` (`&&`, a background job), no `|`, no `$` (`$(…)`, `$VAR`), no
#    backticks, no `VAR=` prefix, no glob (`*`, `?`, `[`, `]`, `{`, `}`), no
#    quotes, no `\`, no line break. A plain command is ALLOWED: that is the
#    plugin-shipped pre-approval. A command that runs `fw tool` any other way
#    is DENIED, and the reason gives the plain form: a pre-approval for
#    `fw tool` must never carry a second command along with it.
# 2. `gh pr merge … --admin` and `gh api … rulesets` (1230 §5, layer 3). The
#    agent contract forbids merging past a failing readiness check and
#    changing a ruleset. Under any cloud, CI or machine-credential signal
#    below the command is DENIED; on a developer's machine the person is ASKED.
#
# Signals, each one enough on its own (only variable NAMES are read, never
# values): any CLAUDE_CODE_REMOTE* variable, CURSOR_AGENT_SOCKET, CI,
# GITHUB_ACTIONS, FW_JOB_TOKEN, FW_ORG_API_KEY, any FW_AGENT_* variable,
# FW_AUTH_MODE (set at all, whatever its value), and the file
# /etc/fw-sandbox/tools.json.
#
# Hosts (the argument):
#   claude  Claude Code PreToolUse(Bash): `hookSpecificOutput` JSON with
#           allow | ask | deny; no output for any other command.
#   cursor  Cursor beforeShellExecution: `{ permission, user_message,
#           agent_message }` (its matcher only sends FireWeave's commands).
#   cline   Cline PreToolUse: `{ cancel, errorMessage }`.
#   exit    Codex PreToolUse(Bash) and opencode: exit 2 with the reason on
#           stderr to refuse; exit 0 otherwise, and the host's own rules
#           decide the rest (neither can ask from a hook).
# On cursor, cline and exit, a plain `fw tool` first runs
# `fw-auth-gate-core.sh` beside this script, outside cloud and CI: it signs
# the person in inline when needed, as it did before every rollout MCP tool.
#
# Bash 3.2 and BWK awk safe (macOS defaults). No jq required.

set -u

host="${1:-}"
case "$host" in
  claude | cursor | cline | exit) ;;
  *)
    echo "usage: fw-shell-gate.sh claude|cursor|cline|exit (the hook input JSON on stdin)" >&2
    exit 1
    ;;
esac

SANDBOX_MARKER="/etc/fw-sandbox/tools.json"
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

HOOK_INPUT=""
if [ ! -t 0 ]; then
  HOOK_INPUT="$(cat)"
fi

# The command the host is about to run: Claude Code and Codex send
# `tool_input.command`, Cursor `command`, Cline `preToolUse.parameters.command`.
# Without jq: the first "command" string in the input, still JSON-escaped. A
# plain command has no character JSON escapes, so both readings judge it alike.
command_of() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$HOOK_INPUT" | jq -r '
      [.tool_input.command?, .command?, .preToolUse.parameters.command?,
       .parameters.command?]
      | map(select(type == "string")) | .[0] // empty
    ' 2>/dev/null && return 0
  fi
  printf '%s' "$HOOK_INPUT" |
    tr '\n' ' ' |
    grep -oE '"command"[[:space:]]*:[[:space:]]*"(\\.|[^"\\])*"' |
    head -1 |
    sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

CMD="$(command_of)"
[ -n "$CMD" ] || {
  [ "$host" = "cline" ] && printf '%s\n' '{"cancel": false}'
  exit 0
}
# One line for the pattern checks: real line breaks and escaped ones alike.
FLAT="$(printf '%s' "$CMD" | tr '\n\r\t' '   ' | sed 's/\\[nrt]/ /g')"

matches() {
  printf '%s' "$FLAT" | grep -Eq -- "$1"
}

# The plain form: the whole command, nothing around it.
PLAIN_RE='^ *(fw|fw\.exe|~/\.fireweave/bin/fw|~/\.fireweave/bin/fw\.exe) +tool( +[A-Za-z0-9._/:=,@+%^-]+)* *$'
# Any command that runs `fw tool`: at the start, after a separator, a
# subshell, a substitution or `VAR=` prefixes, by any path to an `fw`.
INVOKE_RE='(^|[;&|({`]|\$\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:];&|(){}`]*/)?fw(\.exe)?[[:space:]]+tool([[:space:]]|$)'
# `gh … pr merge … --admin` and `gh … api … ruleset`. Cursor's matcher
# (`CURSOR_SHELL_MATCHER`, build/lib/hook-config.ts) spells all three of these
# patterns with `\s`; a test keeps them equal.
ADMIN_RE='(^|[^A-Za-z0-9_./-])gh([[:space:]].*)?[[:space:]]pr[[:space:]]+merge([[:space:]].*)?[[:space:]]--admin([[:space:]=]|$)'
RULESET_RE='(^|[^A-Za-z0-9_./-])gh([[:space:]].*)?[[:space:]]api[[:space:]].*[Rr]uleset'

plain_fw_tool() {
  case "$CMD" in
    *"
"* | *"$(printf '\r')"*) return 1 ;;
  esac
  printf '%s' "$CMD" | grep -Eq "$PLAIN_RE"
}

# Names of the signals present, space-separated; empty when there are none.
signals() {
  found=""
  for name in $(compgen -e); do
    case "$name" in
      CLAUDE_CODE_REMOTE* | CURSOR_AGENT_SOCKET | CI | GITHUB_ACTIONS | \
        FW_JOB_TOKEN | FW_ORG_API_KEY | FW_AGENT_* | FW_AUTH_MODE)
        found="$found $name"
        ;;
    esac
  done
  if [ -e "$SANDBOX_MARKER" ]; then
    found="$found $SANDBOX_MARKER"
  fi
  printf '%s' "${found# }"
}

PLAIN_HINT="Run FireWeave's tools as one plain command per shell call: fw tool <name> --input-file .fireweave/tmp/<name>.json, from the repository root, with no redirection, no ; && | or &, no \$( or backticks, no VAR= prefix, no globs, no quotes and no line breaks."

# decide <allow|ask|deny> <reason>: answer in the host's own form.
decide() {
  decision="$1"
  reason="$2"
  case "$host" in
    claude)
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' \
        "$decision" "$reason"
      ;;
    cursor)
      if [ "$decision" = "allow" ]; then
        printf '%s\n' '{"permission":"allow"}'
      else
        printf '{"permission":"%s","user_message":"%s","agent_message":"%s"}\n' \
          "$decision" "$reason" "$reason"
      fi
      ;;
    cline)
      if [ "$decision" = "deny" ]; then
        printf '{"cancel": true, "errorMessage": "%s"}\n' "$reason"
      else
        printf '%s\n' '{"cancel": false}'
      fi
      ;;
    exit)
      if [ "$decision" = "deny" ]; then
        printf '%s\n' "$reason" >&2
        exit 2
      fi
      ;;
  esac
  exit 0
}

# No opinion: Claude Code and the exit hosts say nothing; Cursor's matcher sent
# this command, so it asks rather than allow what it does not judge; Cline
# lets it through to its own approval.
pass() {
  case "$host" in
    cursor)
      printf '%s\n' '{"permission":"ask","user_message":"FireWeave did not judge this command.","agent_message":"FireWeave did not judge this command."}'
      ;;
    cline) printf '%s\n' '{"cancel": false}' ;;
  esac
  exit 0
}

# ── 2. gh: merging past the gate, rulesets ───────────────────────────────
what=""
if matches "$ADMIN_RE"; then
  what="gh pr merge --admin"
  why="it merges past a failing readiness check"
elif matches "$RULESET_RE"; then
  what="gh api … rulesets"
  why="it can create, edit, disable or delete a repository ruleset"
fi
if [ -n "$what" ]; then
  found="$(signals)"
  if [ -n "$found" ]; then
    decide deny "FireWeave's rollout contract forbids $what: $why. Refused here: this is a cloud agent, CI or a machine credential (signals: $found)."
  fi
  decide ask "FireWeave's rollout contract forbids agents to run $what: $why. Allow it only if you, a repository admin, asked for it yourself."
fi

# ── 1. fw tool: only the plain form ──────────────────────────────────────
if plain_fw_tool; then
  if [ "$host" != "claude" ] && [ -z "$(signals)" ] &&
    [ -f "$HERE/fw-auth-gate-core.sh" ]; then
    if ! bash "$HERE/fw-auth-gate-core.sh" </dev/null >&2; then
      decide deny "FireWeave sign-in failed or timed out: run fw login in a terminal, then retry."
    fi
  fi
  decide allow "A plain fw tool command: FireWeave's plugin pre-approves it."
fi
if matches "$INVOKE_RE"; then
  decide deny "FireWeave refused this command: it runs fw tool in a form its plugin does not pre-approve. $PLAIN_HINT"
fi
pass
