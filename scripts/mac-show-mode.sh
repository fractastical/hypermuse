#!/usr/bin/env bash
# Unattended-show mode for macOS.
#
# The failure this exists to prevent: the Mac idles, the HDMI display sleeps,
# and because the screen lock delay is "immediate" the session locks — the
# login window takes over every display and the show is gone until someone
# types a password. macOS gives no supported way to draw over the login
# window, so the fix is to stop the machine reaching it: hold a power
# assertion for as long as the show runs, and launch Chrome with the
# throttling behaviours that starve an occluded window disabled.
#
#   ./scripts/mac-show-mode.sh status        what the machine will do right now
#   ./scripts/mac-show-mode.sh on            hold the assertion + launch kiosk
#   ./scripts/mac-show-mode.sh on --no-launch    assertion only
#   ./scripts/mac-show-mode.sh on --harden   also disable screensaver/display sleep
#   ./scripts/mac-show-mode.sh off           release everything, restore settings

set -euo pipefail

PIDFILE="/tmp/hypermoon-showmode.pid"
STATEFILE="/tmp/hypermoon-showmode.state"
PROFILE="/tmp/hypermoon-kiosk"
URL=""            # empty = probe for whichever port is serving this repo
CHROME="/Applications/Google Chrome.app"
POSITION=""
LAUNCH=1
HARDEN=0

log() { printf '  %s\n' "$*"; }

# Don't assume port 8080: another project's server may already own it, in
# which case /hypermoon.html 404s and the show launches into someone else's
# app. Probe for a port that actually serves this page.
detect_url() {
  local port
  for port in 8080 8123 8000 3000; do
    if curl -fsS -o /dev/null "http://localhost:$port/hypermoon.html" 2>/dev/null; then
      echo "http://localhost:$port/hypermoon.html?kiosk=1"
      return 0
    fi
  done
  return 1
}

assertion_running() {
  [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

cmd_status() {
  echo "hypermoon show mode"
  if assertion_running; then
    log "assertion:    HELD (caffeinate pid $(cat "$PIDFILE"))"
  else
    log "assertion:    not held — the machine can idle into the lock screen"
  fi
  local ds slp
  ds=$(pmset -g | awk '/ displaysleep /{print $2}')
  slp=$(pmset -g | awk '/^ sleep /{print $2}')
  log "displaysleep: ${ds:-?} min   (0 = never)"
  log "system sleep: ${slp:-?} min   (0 = never)"
  log "screen lock:  $(sysadminctl -screenLock status 2>&1 | sed -n 's/.*screenLock \(.*\)/\1/p' | head -1)"
  local idle
  idle=$(defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null || echo "default")
  log "screensaver:  idleTime ${idle} (0 = off)"
  echo
  echo "holding the display awake right now:"
  # "Blink Wake Lock" here is the hypermoon page's own navigator.wakeLock —
  # seeing Chrome in this list means the output tab is protecting itself.
  pmset -g assertions \
    | grep -E 'NoDisplaySleepAssertion|PreventUserIdleDisplaySleep' \
    | grep -v 'powerd' \
    | sed 's/^ */  /' \
    || echo "  (nothing — the display can idle off)"
}

cmd_on() {
  if assertion_running; then
    log "assertion already held (pid $(cat "$PIDFILE"))"
  else
    # -d display, -i idle, -m disk, -s system, -u count as user activity.
    # nohup + disown so the assertion outlives this shell: started from a
    # terminal that later closes (or a task runner that reaps its process
    # group) a plain background job dies and takes the show's safety net.
    nohup caffeinate -dimsu >/dev/null 2>&1 &
    echo $! > "$PIDFILE"
    disown %% 2>/dev/null || true
    sleep 0.3
    if assertion_running; then
      log "assertion held (caffeinate pid $(cat "$PIDFILE")) — display and system sleep blocked"
    else
      rm -f "$PIDFILE"
      log "WARNING: caffeinate did not stay up; display sleep is NOT blocked"
    fi
  fi

  if [[ "$HARDEN" == "1" ]]; then
    # Belt and braces for a dedicated show machine: these outlive a crash of
    # this script, so the previous values are saved for `off` to put back.
    if [[ ! -f "$STATEFILE" ]]; then
      {
        echo "displaysleep=$(pmset -g custom | awk '/^AC Power/{f=1} f && / displaysleep /{print $2; exit}')"
        echo "screensaver=$(defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null || echo unset)"
      } > "$STATEFILE"
    fi
    log "disabling screensaver idle"
    defaults -currentHost write com.apple.screensaver idleTime -int 0
    log "setting displaysleep=0 (sudo will prompt)"
    sudo pmset -a displaysleep 0
    log "to also stop the lock itself: sysadminctl -screenLock off -password <yours>"
  fi

  if [[ "$LAUNCH" == "1" ]]; then
    if [[ ! -d "$CHROME" ]]; then
      log "Chrome not found at $CHROME — skipping launch"
      return
    fi
    if [[ -z "$URL" ]]; then
      if ! URL="$(detect_url)"; then
        log "no local server is serving hypermoon.html — run 'npm start' first"
        log "(or pass --url http://localhost:PORT/hypermoon.html?kiosk=1)"
        return
      fi
    fi
    local args=(
      --kiosk
      --user-data-dir="$PROFILE"
      --autoplay-policy=no-user-gesture-required
      # Keep rendering when the window is occluded or the display blanks;
      # without these Chrome starves the tab and the canvas (and the LAN
      # broadcast captured off it) freezes.
      --disable-background-timer-throttling
      --disable-backgrounding-occluded-windows
      --disable-renderer-backgrounding
      --disable-features=CalculateNativeWinOcclusion
    )
    [[ -n "$POSITION" ]] && args+=(--window-position="$POSITION")
    log "launching kiosk: $URL"
    open -na "$CHROME" --args "${args[@]}" "$URL"
  fi

  echo
  log "show mode ON. Leave this machine unlocked; run 'off' when the show ends."
}

cmd_off() {
  if assertion_running; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    log "assertion released"
  else
    [[ -f "$PIDFILE" ]] && log "stale pidfile (caffeinate already gone)"
    rm -f "$PIDFILE"
    # An earlier run whose pidfile was lost can still be holding the display
    # awake; only ours matches this exact flag set.
    if pgrep -f "caffeinate -dimsu" >/dev/null 2>&1; then
      pkill -f "caffeinate -dimsu" || true
      log "released an orphaned caffeinate -dimsu"
    else
      log "no assertion held"
    fi
  fi
  if [[ -f "$STATEFILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATEFILE"
    if [[ "${screensaver:-unset}" == "unset" ]]; then
      defaults -currentHost delete com.apple.screensaver idleTime 2>/dev/null || true
    else
      defaults -currentHost write com.apple.screensaver idleTime -int "$screensaver"
    fi
    if [[ -n "${displaysleep:-}" ]]; then
      log "restoring displaysleep=$displaysleep (sudo will prompt)"
      sudo pmset -a displaysleep "$displaysleep"
    fi
    rm -f "$STATEFILE"
    log "hardened settings restored"
  fi
}

action="${1:-status}"
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-launch) LAUNCH=0 ;;
    --harden) HARDEN=1 ;;
    --url) URL="$2"; shift ;;
    --position) POSITION="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

case "$action" in
  status) cmd_status ;;
  on) cmd_on ;;
  off) cmd_off ;;
  *) echo "usage: $0 {status|on|off} [--no-launch] [--harden] [--url URL] [--position X,Y]" >&2; exit 1 ;;
esac
