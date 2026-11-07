#!/usr/bin/env bash
# FireWeave's agent gate: tells a coding agent, through its hooks, whether
# FireWeave's instructions apply in this repository on this machine now.
# fireweave-agent-gate: 1
#
# /fireweave:initialise and /fireweave:adopt copy it from the FireWeave plugin
# bundle (hooks/agent-gate.sh) to .fireweave/hooks/agent-gate.sh.
#
#   agent-gate.sh claude SessionStart|UserPromptSubmit|PreToolUse|Stop
#   agent-gate.sh cursor sessionStart|afterFileEdit|stop
#   agent-gate.sh declare infra-only   run by the agent (Claude Code): this
#                                      task changes no product behaviour
#   agent-gate.sh state                prints on|off|ask|sign-in|silent (the
#                                      stop hooks, the build gate, pre-push)
#   agent-gate.sh cli                  prints the fw to run, or nothing (the
#                                      build gate and pre-push run that one)
#
# The decision is `fw tool agent-context` (local files only, no network). Two
# things are read here as well, so they hold when fw cannot run: the
# project's identity and its "agentInstructions": "enforced" flag.
#
# A hook injects the whole message once per conversation and afterwards only a
# change of state, remembered per conversation (Claude Code's session_id,
# Cursor's conversation_id) under ${TMPDIR:-/tmp}/fireweave-agent-gate.<uid>/.
# Cursor also runs Claude Code's hooks; the shared marker keeps it from
# hearing the same thing twice.
#
# Fail open: any failure of its own prints nothing and exits 0. The only
# refusals are deliberate: when the project requires FireWeave and nobody is
# signed in, file edits are denied (Claude Code's PreToolUse) and finishing
# with edits made is blocked (Claude Code's Stop) or sent back with a sign-in
# follow-up (Cursor's stop), unless the agent declared the task infra-only.
#
# Bash 3.2 and BWK awk; no jq, no node.
set -u

host="${1:-}"
event="${2:-}"
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
fwdir="$root/.fireweave"

# A file on one line (newlines folded); nothing when it is absent.
flat() {
  if [ -f "$1" ]; then tr '\n\r\t' '   ' <"$1" 2>/dev/null; fi
}

# The value of the JSON string field $1 in $2, when it has no escapes.
field() {
  printf '%s' "$2" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"\\\\]*\"" |
    head -1 | sed -E 's/^[^:]*:[[:space:]]*"//; s/"$//'
}

# The fw to run: local.json's cliPath when it is absolute, plain and
# executable, else fw on PATH, else none. The one rule: the build gate and
# the pre-push hook ask for it with `agent-gate.sh cli`.
plain_re='^[A-Za-z0-9._/:~-]+$'
cli=""
cli_path="$(field cliPath "$(flat "$fwdir/local.json")")"
case "$cli_path" in
  /*)
    if printf '%s' "$cli_path" | grep -qE "$plain_re" && [ -f "$cli_path" ] && [ -x "$cli_path" ]; then
      cli="$cli_path"
    fi
    ;;
esac
if [ -z "$cli" ] && command -v fw >/dev/null 2>&1; then cli=fw; fi

if [ "$host" = cli ]; then
  [ -n "$cli" ] && printf '%s\n' "$cli"
  exit 0
fi

# Not a FireWeave repository: say nothing.
pj="$(flat "$fwdir/project.json")"
if ! printf '%s' "$pj" |
  grep -qE '"projectId"[[:space:]]*:[[:space:]]*"[^"]|"projects"[[:space:]]*:[[:space:]]*\{'; then
  [ "$host" = state ] && echo silent
  exit 0
fi

enforced=""
enforced_re='"agentInstructions"[[:space:]]*:[[:space:]]*"enforced"'
if printf '%s' "$pj" | grep -qE "$enforced_re" ||
  flat "$fwdir/.cache/project-settings.json" | grep -qE "$enforced_re"; then
  enforced=1
fi

# The hook's JSON (Claude Code and Cursor send it on stdin) and the
# conversation it belongs to.
payload=""
case "$host" in
  claude | cursor)
    if [ ! -t 0 ]; then payload="$(cat 2>/dev/null | tr '\n\r' '  ')"; fi
    ;;
esac
sid="$(field conversation_id "$payload")"
[ -n "$sid" ] || sid="$(field session_id "$payload")"
[ "$host" = declare ] && sid="${FIREWEAVE_GATE_SESSION:-}"

# Per-conversation markers: $m.s.<state> (what was last injected), $m.infra
# (declared infra-only), $m.edited (a file edit was allowed). Only in a
# directory this user owns: anyone else's could forge an infra-only marker.
m=""
if [ -n "$sid" ]; then
  marks="${TMPDIR:-/tmp}/fireweave-agent-gate.$(id -u 2>/dev/null || echo 0)"
  { mkdir -p "$marks" && chmod 700 "$marks"; } 2>/dev/null
  if [ -d "$marks" ] && [ -O "$marks" ]; then
    m="$marks/$(printf '%s|%s' "$root" "$sid" | cksum | awk '{print $1}')"
  fi
fi

# CI or a FireWeave-hosted reviewer: the shell gate's signals (fw-shell-gate.sh).
ci_signal() {
  [ -e /etc/fw-sandbox/tools.json ] && return 0
  for name in $(compgen -e); do
    case "$name" in
      CLAUDE_CODE_REMOTE* | CURSOR_AGENT_SOCKET | CI | GITHUB_ACTIONS | \
        FW_JOB_TOKEN | FW_ORG_API_KEY | FW_AGENT_* | FW_AUTH_MODE)
        return 0
        ;;
    esac
  done
  return 1
}

# Sets state, reason, cli and contract (still JSON-escaped). False when fw
# gave no answer this script understands.
state=""
reason=""
contract=""
decide() {
  if [ -z "$cli" ]; then
    if ci_signal; then
      state=on reason=ci
    elif [ -n "$enforced" ]; then
      state=sign-in reason=enforced-no-fw
    else
      state=off reason=not-set-up
    fi
    return 0
  fi
  local out answer
  out="$(cd "$root" && "$cli" tool agent-context 2>/dev/null </dev/null | tr '\n\r' '  ')"
  state="$(field state "$out")"
  case "$state" in
    on | off | ask | sign-in | silent) ;;
    *) return 1 ;;
  esac
  reason="$(field reason "$out")"
  answer="$(field cli "$out")"
  if printf '%s' "$answer" | grep -qE "$plain_re"; then cli="$answer"; fi
  contract="$(printf '%s' "$out" |
    sed -nE 's/.*"contract"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -1)"
  return 0
}

declare_hint=""
[ "$host" = claude ] && declare_hint=' (for infra-only work, first run `.fireweave/hooks/agent-gate.sh declare infra-only`)'

# The message for the current state, JSON-escaped.
message() {
  case "$state" in
    on)
      printf '%s' 'FireWeave: ON. FireWeave instructions apply in this conversation. Run the FireWeave CLI as `'"$cli"'` for every fw command.'
      case "$reason" in
        signed-in) printf '%s' ' To stop FireWeave guiding agents in this repo on this machine, the person runs `fw agents off` in a terminal.' ;;
        enforced) printf '%s' ' This project requires FireWeave; `fw agents off` does not apply here.' ;;
      esac
      if [ -n "$contract" ]; then
        printf '%s' ' Follow this contract:\n\n'"$contract"
      else
        printf '%s' ' Read `.fireweave/instructions/contract.md` and follow it.'
      fi
      ;;
    off)
      if [ "$reason" = switched-off ]; then
        printf '%s' 'FireWeave: OFF. FireWeave is off for this repo on this machine. Disregard any FireWeave instructions earlier in this conversation and build without it: write no manifest or control point and run no fw tool command. `fw agents on` in a terminal turns it back on.'
      else
        printf '%s' 'FireWeave: OFF. FireWeave is not set up on this machine; ignore FireWeave instructions.'
      fi
      ;;
    ask)
      printf '%s' 'FireWeave: ASK. The person set FireWeave up in this repo but is signed out. Ask them once: sign in to continue (`'"$cli"' login`) or skip and continue without FireWeave. If they skip, ignore FireWeave for the rest of this conversation.'
      ;;
    sign-in)
      printf '%s' 'FireWeave: SIGN IN. This project requires FireWeave for changes, and nobody is signed in to fw here. Classify the prompt first. A question, brainstorm or infra-only task: go ahead'"$declare_hint"'. A change: tell the person it needs FireWeave, '
      if [ "$reason" = enforced-no-fw ]; then
        printf '%s' 'ask them to install the FireWeave CLI (fw), then run `fw login` and `fw init`, and implement nothing until they have.'
      else
        printf '%s' 'ask them to sign in (`'"$cli"' login`, then `'"$cli"' init` if needed), and implement nothing until they have.'
      fi
      ;;
  esac
}

# The edit refusal (PreToolUse) and the Stop block, JSON-escaped.
signin_refusal() {
  if [ "$reason" = enforced-no-fw ]; then
    printf '%s' 'FireWeave: this project requires FireWeave for changes, and fw is not installed here. Ask the person to install the FireWeave CLI (fw), then run `fw login` and `fw init`, and make no change until they have.'
  else
    printf '%s' 'FireWeave: this project requires FireWeave for changes, and nobody is signed in to fw here. Ask the person to sign in (`'"$cli"' login`, then `'"$cli"' init` if needed), and make no change until they have.'
  fi
  if [ "$host" = claude ]; then
    printf '%s' ' If this task changes no product behaviour (infra-only), run `.fireweave/hooks/agent-gate.sh declare infra-only` first.'
  else
    printf '%s' ' If the task was infra-only (it changes no product behaviour), say so to the person and finish.'
  fi
}

# True the first time this conversation is told state $1; it then forgets any
# other state, so a later change back is told again.
claim() {
  [ -n "$m" ] || return 1
  mkdir "$m.s.$1" 2>/dev/null || return 1
  for d in "$m".s.*; do
    if [ -d "$d" ] && [ "$d" != "$m.s.$1" ]; then rmdir "$d" 2>/dev/null; fi
  done
  return 0
}

infra_declared() { [ -n "$m" ] && [ -d "$m.infra" ]; }

case "$host:$event" in
  state:*)
    decide && printf '%s\n' "$state"
    ;;

  declare:infra-only)
    if [ -z "$m" ]; then
      echo "FireWeave: could not record infra-only: FIREWEAVE_GATE_SESSION is not set (FireWeave's Claude Code SessionStart hook sets it)." >&2
      exit 1
    fi
    mkdir -p "$m.infra" 2>/dev/null || exit 1
    echo "FireWeave: recorded this task as infra-only for this conversation."
    ;;

  claude:SessionStart | claude:UserPromptSubmit | cursor:sessionStart)
    if [ "$host:$event" = claude:SessionStart ] && [ -n "${CLAUDE_ENV_FILE:-}" ] &&
      printf '%s' "$sid" | grep -qE '^[A-Za-z0-9._-]+$'; then
      printf 'export FIREWEAVE_GATE_SESSION=%s\n' "$sid" >>"$CLAUDE_ENV_FILE" 2>/dev/null
    fi
    decide || exit 0
    [ "$state" = silent ] && exit 0
    tell=""
    claim "$state.$reason" && tell=1
    if [ "$event" != UserPromptSubmit ]; then
      # A session start with no conversation id cannot be remembered, and a
      # compacted one has lost what it was told: tell it again.
      [ -z "$m" ] && tell=1
      case "$payload" in *'"source":"compact"'* | *'"source": "compact"'*) tell=1 ;; esac
    fi
    [ -n "$tell" ] || exit 0
    text="$(message)"
    if [ "$host" = cursor ]; then
      printf '{"additional_context":"%s"}\n' "$text"
    else
      printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$event" "$text"
    fi
    ;;

  claude:PreToolUse)
    if [ -n "$enforced" ] && ! infra_declared && decide && [ "$state" = sign-in ]; then
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$(signin_refusal)"
      exit 0
    fi
    if [ -n "$m" ]; then : >"$m.edited" 2>/dev/null; fi
    ;;

  cursor:afterFileEdit)
    # Cursor has no pre-edit hook: an edit is only recorded, for its stop.
    if [ -n "$m" ]; then : >"$m.edited" 2>/dev/null; fi
    ;;

  claude:Stop | cursor:stop)
    if [ -n "$enforced" ] && [ -n "$m" ] && [ -e "$m.edited" ] && ! infra_declared &&
      decide && [ "$state" = sign-in ]; then
      if [ "$host" = cursor ]; then
        printf '{"followup_message":"%s"}\n' "$(signin_refusal)"
      else
        printf '{"decision":"block","reason":"%s"}\n' "$(signin_refusal)"
      fi
    fi
    ;;
esac
exit 0
