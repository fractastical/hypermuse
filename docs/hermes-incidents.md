# What wasn't working, and when

Two records, doing different jobs.

**This file** is the written one: what was seen, what it actually turned out to
be, and what fixed it. It is worth keeping by hand because the useful part of an
incident is almost never in the error message. Nothing in the logs would have
said "the QR code points at a domain that does not exist" — the domain simply
did not answer, and the reason was two layers away from the symptom.

**`data/hermes/faults.jsonl`** is the automatic one, written by the server
through `scripts/lib/hermes-faults.mjs`. Every `[hermes]` error, every crash,
and every degraded startup check lands there with a time on it. Readable over
http at `/api/hermes/faults`, because the moments this matters most are the
moments there is no shell on the box. It is gitignored: it is a record of one
machine's bad days, not source.

A note on the dates below. Anything from the event week is dated from file
timestamps and commits rather than from a log, because there was no log — which
is the reason this file and the fault log now exist. Where the day is all that
can be honestly claimed, only the day is given.

---

## 2026-09-12 — the public page invented a location

**Seen:** minutes after the apex was moved to Railway, the tracker read
**"Live: mock"**, "Updated 1m ago", with a marker drawn near 1200 Promenade.

**Actually:** with no track log to resume from, the server falls back to the fix
in `data/hermes/sample-state.json` — `40.78645, -119.20332`, a coordinate nobody
has ever been at. That fallback takes the boot time as its `updatedAt`, so it is
permanently a few seconds old and passes every freshness test put to it,
including the staleness check added hours earlier the same day. That check
compares ages, and the seed's age is truthful. It was the position that was
fiction, and no amount of age arithmetic could have caught it.

**Why it had never shown up here:** this laptop always has a track log, so the
seed appears for a moment at startup and is immediately replaced. A fresh
container has no track log at all, so the seed is not a transient state — it is
the steady state until a phone reports in. Moving to a host with an empty disk
turned a one-second glitch into the front page.

**Fixed:** the fallback fix is tagged `seed: true` where it is constructed, and
the page refuses to describe a seed as a position — it says no position has been
reported, and will not cache one as a last known location. Tagging at
construction rather than tracking a flag works because any genuine fix replaces
the whole fix object and takes the tag with it.

**Caught now by:** nothing automatic, and that gap is worth naming. A degraded
startup check cannot tell a seed from a real fix, because on a box that has
genuinely never had a phone report in, serving the seed is not an error. The
honest guard is the one now in place: label it, and never let the label be lost.

## 2026-09-11 — returnofhermes.com had never resolved

**Seen:** the QR code on the moon display went nowhere.

**Actually:** the apex domain had no DNS record of any kind — no A, no CNAME.
Only `request.returnofhermes.com` had ever been routed. The QR had been
repointed to `returnofhermes.com` earlier on the assumption the apex worked,
and it never had.

**Fixed:** CNAMEs for the apex and `www` onto the existing `hermes-return`
tunnel, via `cloudflared tunnel route dns`.

**Caught now by:** nothing on the server — this is a DNS fact, invisible from
inside. Check all three hostnames after any DNS change, per
`docs/hermes-railway.md` §6.

## 2026-09-11 — the apex served the wrong product

**Seen:** once the apex resolved, it opened "HyperMuse · a holographic fan you
can book" rather than the tracker.

**Actually:** the redirect to `/hermes-live.html` tested for the exact host
`request.returnofhermes.com`, so every other hostname fell through to the
static `index.html`. A scanned rider got a product page for a different
product.

**Fixed:** the test now matches the apex and any `*.returnofhermes.com`.

## 2026-09-11 — a three-day-old position was labelled "Live"

**Seen:** "Live: Joel · Updated 5293m ago" on the public tracker.

**Actually:** freshness was set from whether the poll succeeded, not from the
age of the fix it returned. The server always answers with the last fix it
heard, so any reachable server read as live.

**Fixed:** `LIVE_MAX_AGE_SEC` in `hermes-live.html`; older than five minutes
reads "Last known".

## 2026-09-11 — a performer was announced who was not playing

**Seen:** "Now playing: Seth Schwarz" on the public page, days after the event.

**Actually:** `HERMES_NOW_PLAYING_DEFAULT` defaulted to a name in code, so the
server announced him whenever no real approved DJ request was live. The kiosk
side had been reverted earlier; the server side had not.

**Fixed:** the default is now empty. A real approved `dj-set` request still
overrides it.

## 2026-09-11 — the repo could not have deployed at all

**Seen:** nothing. This was found by audit, not by failure.

**Actually:** four of the five modules `hermes-server.mjs` imports had never
been committed — `playa-places.mjs`, `journeys.mjs`, `hermes-tls.mjs`,
`hermes-answers.mjs` — along with both scripts `hermes-live.html` loads and
`railway.json` itself. It ran here because the files exist on this laptop. Any
deploy from the repo would have died on the first import, with a stack trace
pointing at a missing file rather than at the reason it was missing.

**Fixed:** committed in `3a0d336`, verified by cloning the pushed repo into a
clean directory, installing, and booting it.

**Caught now by:** clone-and-boot before trusting a deploy. The fault log
records the crash, but the cheaper check is upstream of it.

## 2026-09-11 — the art listing was missing from a clean clone

**Seen:** `art: 0 pieces from none` in a clean-clone boot. No error.

**Actually:** `data/hermes/art/2025-art.json` was untracked, so nearby-art
ranking was silently absent — the exact shape of failure that is worst to
diagnose later, because everything else works.

**Fixed:** committed in `80c4402`. A clean clone now loads 341 pieces and 22
big art cars.

**Caught now by:** the degraded startup check, which logs
`art listing missing — nothing will be ranked as nearby art`.

## 2026-09-11 — OPEN: the site dies with the laptop

**Seen:** the site is only up when this machine is.

**Actually:** `cloudflared` tunnels all three hostnames to `127.0.0.1:8124` on
this laptop, so the laptop *is* the origin. Not a fault, a topology.

**Fix:** deploy to Railway and repoint DNS — `docs/hermes-railway.md`. Not done
yet; it needs an account and a DNS change.

---

## 2026-09-06 — video loops stalled, sometimes to a white screen

**Seen:** the backdrop stopped rotating; once, a white screen.

**Actually:** one unplayable source stalled the whole loop, because a layer
that failed was still the layer the rotation was waiting on. One bad path took
the show down rather than being skipped.

**Fixed:** `makeBackdropLayer` now reports failure, `showBackdrop` skips failed
layers, and `setBackdrop` advances past the current one if it dies.

## 2026-09-06 — a clip outside the repo could never load

**Seen:** a newly added video did not appear in the sequence.

**Actually:** the file was in a folder outside the served repo path, so no URL
could reach it. Renamed into `assets/butt/1.mp4` and added to the SHOW list.

**Worth remembering:** two separate problems presented identically — a path the
server cannot serve, and a clip the player cannot decode. The failover above
distinguishes them.

## 2026-09-06 — the Leave Timer showed with nothing to count

**Seen:** a permanent "—" panel on the kiosk.

**Fixed:** the panel is hidden unless `leaveAtMs` is set, and hides itself again
when the countdown reaches zero.

## ~2026-09-02 — the public tracker appeared to be down

**Seen:** `request.returnofhermes.com` returning `not found` for
`/api/hermes/fix`, while Cloudflare returned 200.

**Actually:** Cloudflare and the tunnel were both fine. The origin process on
the laptop was a stale build that no longer had the route. The 200 from the
edge made it look like a working site serving a broken page.

**Fixed:** killed the old PID and restarted the server.

**Caught now by:** `/api/hermes/faults` shows a `start` entry per run, with pid
and node version, so "which build is actually answering" is answerable.

## 2026-09-11 — `npm run hermes:restart` was racing launchd, not itself

**Seen:** `EADDRINUSE: address already in use 0.0.0.0:8124` on restart. 22
launches in `~/Library/Logs/hypermuse/hermes-server.out.log`.

**First diagnosed as** a race in the script's own `sleep 1` being too short.
That was wrong, and the wrong version is kept here because the correct answer
is the more useful thing to know.

**Actually:** `com.hypermuse.hermes-server` is a loaded launchd agent with
`KeepAlive` set. Killing the listener does not free the port — launchd notices
within milliseconds and starts its own replacement. The kill and the sleep then
race a process that has already won, so the new copy dies on `EADDRINUSE` while
the old one carries on serving. It looks like a failed restart when in fact the
server is already back; just not the copy that was asked for.

**Fixed:** `scripts/hermes-restart.sh` asks launchd when launchd owns the
process (`launchctl kickstart -k`) and waits for the port to answer rather than
trusting a fixed sleep. It falls back to killing by hand when no agent is
loaded.

**Worth remembering:** a manual `kill` on anything under `KeepAlive` is not a
stop, it is a restart request. Use `launchctl bootout` to actually stop it.

## 2026-08-30 — the PixLite would not take Art-Net

**Seen:** LEDs running an internal pattern and ignoring everything sent.

**Actually:** the laptop's transmission was healthy throughout — 0 send errors,
240–400 packets/s. The controller was not listening for Art-Net: the input
protocol had not been selected, and standalone/test patterns were still
enabled. It answered ICMP "port unreachable" and did not reply to ArtPoll.

**Fixed:** set Art-Net in the Advatek config, disabled the test patterns, saved
**and rebooted** — the reboot was required.

**Worth remembering:** the lights were never dark. They were on an internal
cycle the whole time, which read as "working but unresponsive" and sent the
diagnosis toward the sender for longer than it should have. Also: the
photographed MFL fixture turned out to be a separate stage light, not on the
pixel chain at all.

## 2026-08-29 to 2026-09-08 — the record has holes, by nature

**Seen:** whole days nearly absent from the track log: 5 fixes on 2026-09-05,
8 on 2026-09-07, against 677 on 2026-09-02.

**Actually:** not a fault. The handheld spends most of its life unplugged and
the phones only feed while someone has the page open. The gaps are a fact about
the record, and `npm run hermes:annals` says so rather than joining across
them.
