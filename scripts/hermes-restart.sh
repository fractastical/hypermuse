#!/usr/bin/env bash
# Restart the Hermes server, whoever happens to be in charge of it.
#
# This used to be `kill the listener; sleep 1; start a new one`, which worked
# until a launchd agent was put in front of it. Now com.hypermuse.hermes-server
# has KeepAlive set, so killing the listener does not free the port — launchd
# notices within milliseconds and starts its own replacement. The kill and the
# sleep then race a process that has already won, and the new copy dies on
# EADDRINUSE while the old one carries on serving. Worse, it looks like the
# restart failed when in fact the restart was never needed: the server is
# already back, just not the one that was asked for.
#
# So ask launchd when launchd owns it, and only fall back to doing it by hand.
set -u

LABEL="com.hypermuse.hermes-server"
PORT="${PORT:-8124}"

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  echo "[hermes] ${LABEL} is managed by launchd — asking it to restart"
  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
  # kickstart returns as soon as it has signalled, not once the port is back.
  for _ in $(seq 1 20); do
    sleep 0.5
    if curl -fsS -o /dev/null -m 2 "http://127.0.0.1:${PORT}/api/hermes/state"; then
      echo "[hermes] back on :${PORT} as pid $(pgrep -f hermes-server.mjs | head -1)"
      exit 0
    fi
  done
  echo "[hermes] restarted but :${PORT} did not answer in 10s — check ~/Library/Logs/hypermuse/hermes-server.err.log" >&2
  exit 1
fi

echo "[hermes] no launchd agent — restarting by hand"
lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
# Wait for the port rather than trusting a fixed sleep, which is the other half
# of the original bug: one second is usually enough and occasionally is not.
for _ in $(seq 1 20); do
  lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.5
done
exec node scripts/hermes-server.mjs
