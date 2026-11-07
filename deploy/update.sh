#!/usr/bin/env bash
# =============================================================================
#  Panel updater. Not run by hand: when the panel asks for an update, systemd
#  (panel-updater.path -> panel-updater.service) runs it as the admin user.
#
#  Request: /opt/panel/data/updater/request     ("check" or "update")
#  Result:  /opt/panel/data/updater/status.json (read by the panel)
#
#  check : git fetch, list pending commits
#  update: git merge --ff-only + docker compose up -d --build
#
#  Dependencies: bash, git, jq, docker compose. No GNU-only flags.
# =============================================================================
set -uo pipefail

SRC="${PANEL_SRC:-/opt/panel/src}"
DIR="${PANEL_UPDATER_DIR:-/opt/panel/data/updater}"
REQ="$DIR/request"
STATUS="$DIR/status.json"
LOG="$DIR/update.log"

[[ -f "$REQ" ]] || exit 0
# shellcheck disable=SC2018 # ASCII letters only, on purpose
ACTION=$(tr -cd 'a-z' <"$REQ" | cut -c1-10)
rm -f "$REQ"
case "$ACTION" in check | update) ;; *) exit 0 ;; esac

# Milliseconds since the epoch. %N is not portable (BSD prints "N", busybox prints nothing),
# so use it only when the result really has nanoseconds; otherwise fall back to seconds.
now_ms() {
  local n
  n=$(date +%s%N 2>/dev/null)
  if [[ "$n" =~ ^[0-9]{19,}$ ]]; then
    echo "${n%??????}"
  else
    echo "$(($(date +%s) * 1000))"
  fi
}
STARTED=$(now_ms)
BRANCH=""
: >"$LOG"

commit_json() { # $1: ref
  git -C "$SRC" log -1 --format='%H%x1f%s%x1f%cI' "$1" 2>/dev/null |
    jq -R 'split("\u001f") | {sha: .[0], message: .[1], date: .[2]}'
}

env_keys() { # $1: file -> sorted variable names
  grep -oE '^[A-Z_][A-Z0-9_]*=' "$1" | tr -d = | sort -u
}

write_status() { # $1: state  $2: error message (optional)
  local state="$1" err="${2:-}" finished=null pending="[]" current=null missing="[]" tmp
  [[ "$state" != running ]] && finished=$(now_ms)
  if [[ -n "$BRANCH" ]]; then
    current=$(commit_json HEAD)
    pending=$(git -C "$SRC" log --format='%H%x1f%s%x1f%cI' "HEAD..origin/$BRANCH" 2>/dev/null |
      jq -R -s 'split("\n") | map(select(length > 0) | split("\u001f") | {sha: .[0], message: .[1], date: .[2]})')
  fi
  # Variables in .env.example that are missing from .env (a new version wants a new setting)
  if [[ -f "$SRC/deploy/.env.example" && -f "$SRC/deploy/.env" ]]; then
    tmp=$(mktemp -d)
    env_keys "$SRC/deploy/.env.example" >"$tmp/example"
    env_keys "$SRC/deploy/.env" >"$tmp/env"
    missing=$(comm -23 "$tmp/example" "$tmp/env" | jq -R -s 'split("\n") | map(select(length > 0))')
    rm -rf "$tmp"
  fi
  jq -n \
    --arg state "$state" --arg action "$ACTION" --arg branch "$BRANCH" --arg err "$err" \
    --argjson started "$STARTED" --argjson finished "$finished" \
    --argjson current "${current:-null}" --argjson pending "${pending:-[]}" --argjson missing "${missing:-[]}" \
    --rawfile log "$LOG" \
    '{state: $state, action: $action, branch: (if $branch == "" then null else $branch end),
      startedAt: $started, finishedAt: $finished, current: $current, pending: $pending, missingEnv: $missing,
      log: ($log | .[-20000:]), error: (if $err == "" then null else $err end)}' >"$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

fail() {
  echo "ERROR: $1" >>"$LOG"
  write_status failed "$1"
  exit 1
}

write_status running
cd "$SRC" || fail "$SRC not found"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "\$ git fetch origin $BRANCH" >>"$LOG"
git fetch --quiet origin "$BRANCH" >>"$LOG" 2>&1 || fail "git fetch failed (check the server's access to the git remote)"

if [[ "$ACTION" == update ]]; then
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git status --short >>"$LOG"
    fail "The code on the server has local changes; nothing was updated"
  fi
  echo "\$ git merge --ff-only origin/$BRANCH" >>"$LOG"
  git merge --ff-only "origin/$BRANCH" >>"$LOG" 2>&1 || fail "git merge failed"
  write_status running
  cd "$SRC/deploy" || fail "deploy directory missing"
  echo "\$ docker compose up -d --build" >>"$LOG"
  # The panel restarts meanwhile; this script runs on the host, so it is not affected
  docker compose up -d --build >>"$LOG" 2>&1 || fail "docker compose up failed"
  docker image prune -f >/dev/null 2>&1 || true
  echo "Update finished." >>"$LOG"
fi

write_status "done"
