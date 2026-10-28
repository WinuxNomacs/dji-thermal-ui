#!/usr/bin/env bash
# Builds, starts and stops dji-thermal-ui from this clone (Linux, WSL and macOS).
#
#   dji-thermal-ui.sh build      set up or update the environment: uv sync, npm ci, npm run build
#   dji-thermal-ui.sh rebuild    the same as build
#   dji-thermal-ui.sh start      start the app in the background (building it first if it was never built);
#                                options after start go to dji-thermal-ui: --port, --data-dir, --no-browser
#   dji-thermal-ui.sh stop       stop the app that start started
#   dji-thermal-ui.sh restart    stop, then start (with the options given)
#   dji-thermal-ui.sh status     say whether it runs, and where
#   dji-thermal-ui.sh logs       the end of its log (logs -f follows it)
#
# The PID file and the log are in .run/ (DJI_THERMAL_UI_RUN_DIR to put them elsewhere).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${DJI_THERMAL_UI_RUN_DIR:-$ROOT/.run}"
PID_FILE="$RUN_DIR/dji-thermal-ui.pid"
LOG_FILE="$RUN_DIR/dji-thermal-ui.log"
APP="$ROOT/.venv/bin/dji-thermal-ui"
MANIFEST="$ROOT/src/dji_thermal_ui/static/dist/manifest.json"
UV_VERSION="0.12.5"           # the version CI uses
NODE_HELP="https://nodejs.org/en/download (Node.js 20.19+ or 22.12+, with npm)"
START_TIMEOUT=60
STOP_TIMEOUT=15

say() { printf '%s\n' "$*"; }
fail() { printf 'dji-thermal-ui.sh: %s\n' "$*" >&2; exit 1; }

usage() {
    sed -n '2,13s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
}

install_uv() {
    say "uv is not installed: installing uv $UV_VERSION into ~/.local/bin"
    local installer="https://astral.sh/uv/$UV_VERSION/install.sh"
    if command -v curl >/dev/null; then
        curl -LsSf "$installer" | env UV_NO_MODIFY_PATH=1 sh
    elif command -v wget >/dev/null; then
        wget -qO- "$installer" | env UV_NO_MODIFY_PATH=1 sh
    else
        fail "installing uv needs curl or wget; or install uv yourself: https://docs.astral.sh/uv/"
    fi
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) export PATH="$HOME/.local/bin:$PATH"
           say "uv is in ~/.local/bin, which is not on your PATH: add it there to run uv yourself" ;;
    esac
    command -v uv >/dev/null || fail "uv was installed but is not found in ~/.local/bin"
}

build() {
    command -v uv >/dev/null || install_uv
    command -v npm >/dev/null || fail "npm is not installed: get it with Node.js from $NODE_HELP"
    cd "$ROOT"
    say "== uv sync"
    uv sync --locked
    say "== npm ci"
    npm ci
    say "== npm run build"
    npm run build
    say "Built. Start it with: $0 start"
}

built() {
    [[ -x "$APP" && -d "$ROOT/node_modules" && -f "$MANIFEST" ]]
}

running_pid() {
    # the PID of the app start started, when it is still running
    [[ -f "$PID_FILE" ]] || return 1
    local pid
    pid="$(cat "$PID_FILE")"
    # (and not another process given the same PID since)
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= | grep -q dji-thermal-ui; then
        printf '%s' "$pid"
        return 0
    fi
    rm -f "$PID_FILE"
    return 1
}

served_url() {
    # the URL in the log's "serving" line
    grep -o 'serving http://[^ ]*' "$LOG_FILE" 2>/dev/null | tail -n 1 | cut -d' ' -f2
}

start() {
    local pid
    if pid="$(running_pid)"; then
        say "dji-thermal-ui is already running (PID $pid) at $(served_url)"
        return 0
    fi
    built || build
    mkdir -p "$RUN_DIR"
    : > "$LOG_FILE"
    PYTHONUNBUFFERED=1 nohup "$APP" "$@" < /dev/null >> "$LOG_FILE" 2>&1 &
    pid=$!
    printf '%s\n' "$pid" > "$PID_FILE"
    local waited=0
    while (( waited < START_TIMEOUT * 5 )); do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$PID_FILE"
            cat "$LOG_FILE" >&2
            fail "dji-thermal-ui did not start (its log is above, and in $LOG_FILE)"
        fi
        if [[ -n "$(served_url)" ]]; then
            say "dji-thermal-ui is running (PID $pid) at $(served_url). Stop it with: $0 stop"
            return 0
        fi
        sleep 0.2
        waited=$(( waited + 1 ))
    done
    fail "dji-thermal-ui has not started after ${START_TIMEOUT}s: see $LOG_FILE"
}

stop() {
    local pid
    if ! pid="$(running_pid)"; then
        say "dji-thermal-ui is not running"
        return 0
    fi
    kill -TERM "$pid"
    local waited=0
    while kill -0 "$pid" 2>/dev/null; do
        if (( waited >= STOP_TIMEOUT * 5 )); then
            say "dji-thermal-ui did not stop after ${STOP_TIMEOUT}s: killing it"
            kill -KILL "$pid" 2>/dev/null || true
            break
        fi
        sleep 0.2
        waited=$(( waited + 1 ))
    done
    rm -f "$PID_FILE"
    say "dji-thermal-ui stopped"
}

status() {
    local pid
    if pid="$(running_pid)"; then
        say "dji-thermal-ui is running (PID $pid) at $(served_url)"
    else
        say "dji-thermal-ui is not running"
        return 3
    fi
}

logs() {
    [[ -f "$LOG_FILE" ]] || fail "no log yet: $LOG_FILE"
    tail -n 50 "$@" "$LOG_FILE"
}

command="${1:-}"
[[ $# -gt 0 ]] && shift
case "$command" in
    build|rebuild) build ;;
    start) start "$@" ;;
    stop) stop ;;
    restart) stop; start "$@" ;;
    status) status ;;
    logs) logs "$@" ;;
    help|-h|--help) usage ;;
    *) usage >&2; exit 2 ;;
esac
