#!/usr/bin/env bash
# fw-shell-gate.sh — FireWeave's shell-command hook (0656 W6; 1230 §5, layer 3).
#
#   fw-shell-gate.sh claude|cursor|cline|exit     (the hook input JSON on stdin)
#
# It judges three kinds of shell command and stays out of every other one.
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
#    The repo's own fw counts too: the exact `cliPath` that
#    `agent-gate.sh cli` resolves from .fireweave/local.json, under the same
#    rules. Before a plain call to a tool that writes (WRITE_OPS), it asks
#    `agent-gate.sh state`: `off` and `sign-in` refuse it on every host, `ask`
#    refuses it on Claude Code (elsewhere the inline sign-in below runs). No
#    agent gate, or one that fails, changes nothing.
# 0. `fw agents update|on|off` anywhere in a command, by any path to fw or by
#    cliPath, is DENIED on every host whatever the signals: a person runs
#    those in a terminal. A deterrent, not a lock.
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

# agent_gate state|cli: the agent gate's answer for the repo at $root, or
# nothing (no gate, or it failed). The copy beside this script is FireWeave's
# own, so it runs rather than a file the repo controls; it finds the repo from
# its $0, so $0 is the repo's .fireweave/hooks/agent-gate.sh. Without it, the
# repo's copy runs.
agent_gate() {
  repo_gate="$root/.fireweave/hooks/agent-gate.sh"
  if [ -f "$HERE/agent-gate.sh" ]; then
    (cd "$root" 2>/dev/null &&
      bash -c '. "$1" "$2"' "$repo_gate" "$HERE/agent-gate.sh" "$1" </dev/null 2>/dev/null | head -1)
  elif [ -f "$repo_gate" ]; then
    (cd "$root" 2>/dev/null && bash "$repo_gate" "$1" </dev/null 2>/dev/null | head -1)
  fi
}

# The repo the command runs in (the hook input's cwd, else this process's)
# and its cliPath, regex-escaped. Only looked up for a command that mentions
# `tool` or `agents`.
root=""
CLI_PATH=""
CLI_RE=""
case "$FLAT" in
  *tool* | *agents*)
    start="$(printf '%s' "$HOOK_INPUT" | tr '\n' ' ' |
      grep -oE '"cwd"[[:space:]]*:[[:space:]]*"[^"\\]*"' | head -1 |
      sed 's/^"cwd"[[:space:]]*:[[:space:]]*"//; s/"$//')"
    [ -n "$start" ] && [ -d "$start" ] || start="$(pwd)"
    root="$(git -C "$start" rev-parse --show-toplevel 2>/dev/null)"
    [ -n "$root" ] || root="$start"
    CLI_PATH="$(agent_gate cli)"
    case "$CLI_PATH" in
      /*) printf '%s' "$CLI_PATH" | grep -qE '^[A-Za-z0-9._/:~-]+$' || CLI_PATH="" ;;
      *) CLI_PATH="" ;;
    esac
    CLI_RE="$(printf '%s' "$CLI_PATH" | sed 's/\./\\./g')"
    ;;
esac

# The plain form: the whole command, nothing around it.
FW_NAMES='fw|fw\.exe|~/\.fireweave/bin/fw|~/\.fireweave/bin/fw\.exe'
[ -n "$CLI_RE" ] && FW_NAMES="$FW_NAMES|$CLI_RE"
PLAIN_RE='^ *('"$FW_NAMES"') +tool( +[A-Za-z0-9._/:=,@+%^-]+)* *$'
# Any command that runs `fw tool`: at the start, after a separator, a
# subshell, a substitution or `VAR=` prefixes, by any path to an `fw`.
FW_PROG='([^[:space:];&|(){}`]*/)?fw(\.exe)?'
[ -n "$CLI_RE" ] && FW_PROG="($FW_PROG|$CLI_RE)"
INVOKE_RE='(^|[;&|({`]|\$\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'"$FW_PROG"'[[:space:]]+tool([[:space:]]|$)'
# `fw agents update|on|off` anywhere: after separators, in `bash -c "…"`,
# behind `env`, `script` or `sudo`, by any path to fw.
AGENTS_RE='(^|[^A-Za-z0-9_.-])fw(\.exe)?[[:space:]]+agents[[:space:]]+(update|on|off)([^A-Za-z0-9_-]|$)'
CLI_AGENTS_RE=""
[ -n "$CLI_RE" ] && CLI_AGENTS_RE='(^|[^A-Za-z0-9_.-])'"$CLI_RE"'[[:space:]]+agents[[:space:]]+(update|on|off)([^A-Za-z0-9_-]|$)'
# `gh … pr merge … --admin` and `gh … api … ruleset`. Cursor's matcher
# (`CURSOR_SHELL_MATCHER`, build/lib/hook-config.ts) spells INVOKE_RE (without
# a cliPath), AGENTS_RE and these two with `\s`; a test keeps them equal.
ADMIN_RE='(^|[^A-Za-z0-9_./-])gh([[:space:]].*)?[[:space:]]pr[[:space:]]+merge([[:space:]].*)?[[:space:]]--admin([[:space:]=]|$)'
RULESET_RE='(^|[^A-Za-z0-9_./-])gh([[:space:]].*)?[[:space:]]api[[:space:]].*[Rr]uleset'

# The tools that change something (every effect but `read` in
# rollout-tools' fw-tool/registry.ts, except install-agent-hooks, which only
# wires the agent gate itself); a test keeps this list equal to it.
WRITE_OPS="apply-setup-artifacts issue-browser-key prepare-local-setup record-rollout-env-contract refresh-agent-skills render-entries report-harness-migration sdk-install select-project setup-post setup-pre stop-feature-claim update-repo-state upsert-rollout-manifest"

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

# ── 0. fw agents update|on|off: a person's commands ──────────────────────
if matches "$AGENTS_RE" || { [ -n "$CLI_AGENTS_RE" ] && matches "$CLI_AGENTS_RE"; }; then
  decide deny "fw agents update/on/off are run by a person in a terminal, not by an agent."
fi

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
  op="$(printf '%s' "$CMD" | sed -E 's/^ *[^ ]+ +tool *//; s/ .*//')"
  case " $WRITE_OPS " in
    *" $op "*)
      state="$(agent_gate state)"
      fwc="${CLI_PATH:-fw}"
      case "$state" in
        off)
          decide deny "FireWeave is off for this repo on this machine (switched off, or not set up here); build without FireWeave: no manifest, no control point."
          ;;
        sign-in)
          decide deny "FireWeave: this project requires FireWeave for changes, and nobody is signed in to fw here. Ask the person to sign in ($fwc login, then $fwc init if needed), and make no change until they have."
          ;;
        ask)
          if [ "$host" = "claude" ]; then
            decide deny "FireWeave: the person set FireWeave up in this repo but is signed out, so its tools that write wait. Ask them once: sign in to continue ($fwc login in a terminal) or skip and continue without FireWeave, writing no manifest or control point."
          fi
          ;;
      esac
      ;;
  esac
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
