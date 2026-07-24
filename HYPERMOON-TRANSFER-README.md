# Hypermoon live-show transfer

Unzip this archive **into the repo root** on the live machine (it mirrors the
repo layout and safely overwrites `hypermoon.html` / `controller.html` with the
latest versions). Then:

    npm start          # http-server on :8080  (or: npx http-server -c-1 -p 8080 .)

- Output window: `http://localhost:8080/hypermoon.html?kiosk=1`
  (or open it from the controller's "open output" button)
- Controller: `http://localhost:8080/controller.html`

## What's new in this build

- **Backdrop layer**: gifs/images pinned exactly behind the moon disc
  (`backdrop` field in the controller, or `?backdrop=` URL param).
- **Moon opacity** slider: fades the whole moon to reveal the backdrop.
- **Iris reveal**: `◉ reveal eye seal` / `● seal moon` buttons + `iris reveal`,
  `iris size` sliders — opens a fully transparent hole (inner 70% of the disc
  by default) so the eye-seal gif shows through while the limb stays.
- **Reveal zoom** slider: zooms the gif into its centre as the iris opens, so
  at full open only the eye fills the aperture (`?iriszoom=`, default 2.5×).
- **Backdrop gif speed** slider: replays the gif's whole loop faster/slower
  (`?backspeed=`, needs Chrome for ImageDecoder — kiosk Chrome is fine).
- **Moon size** slider (`?moonscale=`): shrinks/grows the whole moon while it
  stays pinned to the screen centre.
- **Program presets** in the program dropdown: `eye10` (word-only moon, the
  eye seal irises open every 10th rotation), `folds` (the bucky fold
  repertoire every 3rd rotation), `eyefolds` (folds + the eye every 10th),
  plus the original `hour`. In the custom program editor, `eye` is a valid
  act content — it triggers the iris reveal instead of the window.
- **Sub-pixel disc centering**: the iris hole / backdrop alignment no longer
  drifts by a few pixels at fullscreen.
- **Blood moon**: `🌕→🔴 blood moon` / `natural moon` buttons + a strength
  slider and tint color picker — grades the whole disc to a copper-red
  eclipse look, live, on any of the moon videos (`?bloodmoon=0..1`,
  `?bloodtint=RRGGBB`). Craters and the word mosaic keep their relief.
- **Blood fade timer**: `▶ fade to blood` / `▶ fade to natural` over N
  minutes (default 120 — a two-hour eclipse), `✖ hold` freezes it where it
  is. The fade runs inside the output window, so the controller can be
  closed once it's started; the export query resumes a mid-fade eclipse
  after a reload (`?bloodmoon=&bloodtarget=&bloodfade=`).
- **Dancing mumins** (`?content=mumins`, or "dancing mumins" in the window
  content dropdown): a ring of little round trolls hopping in a circle on the
  dark side. Drawn in-page, so there's no asset to copy — `?mumins=1..9` sets
  the troupe size and `?muminbpm=` the dance tempo. The window opens wider
  than usual for them; the `window size ×` slider trims it.
- **Window solidity** slider (`?winsolid=0..1`): window content is normally
  added as *light*, which is right for glowing screens and wireframes but
  turns drawn figures into ghosts. At 1 the content is painted opaque onto
  the surface instead. Defaults to solid for the mumins, glow for everything
  else, and is not carried across a content switch.
- **Unattended-show survival** (macOS): `npm run show:mac` holds a power
  assertion and launches the kiosk with occlusion/throttling disabled;
  `npm run show:mac:status` reports what the machine will do, and
  `npm run show:mac:off` releases it. The output page also takes a screen
  wake lock on its own (`?awake=0` opts out) and keeps rendering off a timer
  if the compositor stops calling it (`?ticker=`, `?keepfps=`), so the LAN
  broadcast survives a blanked or occluded display. See "Locking" below.
- **Fold loop clips** (`artifacts/fold-loops/*.mp4`): the fold repertoire
  pre-baked as square videos incl. red wireframe variants — usable as window
  content or backdrops on machines without the live makers.

## Included assets

| Path | Purpose |
|------|---------|
| `hypermoon.html`, `controller.html` | latest show + control panel |
| `js/threejs.org_build_three.js`, `js/cdn.jsdelivr.net_npm_tone.js`, `js/cdn.jsdelivr.net_npm_@tonejs_midi.js` | vendored libs |
| `loops/3d moon/web/*.webm` | the rotating alpha moon videos (all 4 variants) |
| `assets/esoteric-geometries-circles-warp.gif` | the eye-seal backdrop gif |
| `artifacts/moon-cube-index.json`, `artifacts/color-cubes/` | letter-mosaic tiles |
| `assets/estoteric/web/` | sutra-pages slideshow preset |
| `artifacts/crt-terminal-green.mp4` | CRT window preset |
| `artifacts/sample-sonicsphere-silent.webm` | sonicsphere window preset |
| `audio-manifest.json`, `video-manifest.json` | controller pickers |
| `package.json` | `npm start` server script |
| `js/stream-broadcast.js`, `stream-view.html`, `scripts/stream-server.mjs` | LAN streaming (see below) |

## LAN streaming ("stream to LAN" toggle)

Run the signaling relay alongside the web server, then flip the toggle in the
controller (or open the moon with `?stream=1`):

    npm install            # once - needs the "ws" package
    npm run stream:server  # ws relay on :8081

Other devices watch at `http://<live-machine-ip>:8080/stream-view.html`.
The video flows peer-to-peer; the relay only handles the handshake.

## Locking, sleep, and unattended runs (macOS)

macOS gives no supported way to draw over the login window: once the session
locks, the login window owns every display and the show is off screen until
someone types the password. Screen recording is blocked there too. So the
whole strategy is to keep the machine from reaching that state.

    npm run show:mac:status   # displaysleep, lock delay, who's holding the display awake
    npm run show:mac          # hold the assertion + launch the kiosk
    npm run show:mac:off      # release it

`show:mac` holds a `caffeinate -dimsu` assertion (no sudo, nothing on the
system is modified) and launches Chrome with
`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
`--disable-background-timer-throttling` and
`--disable-features=CalculateNativeWinOcclusion`, without which Chrome starves
an occluded window and the canvas freezes. It probes for whichever local port
is actually serving `hypermoon.html` rather than assuming 8080 — worth knowing
if another project already owns that port. `--harden` additionally disables the
screensaver and sets `displaysleep 0` (sudo, restored by `off`).

Two things still lock a Mac that this cannot prevent: locking it by hand
(Ctrl-Cmd-Q, Apple menu) and closing the lid. Check `sysadminctl -screenLock
status` — if the delay is "immediate", any display sleep locks the session
instantly.

The output page defends itself too. It takes a screen wake lock (visible as
Chrome's "Blink Wake Lock" in `show:mac:status`) and re-takes it whenever the
page becomes visible again. Its frame pump prefers `requestAnimationFrame` but
falls back to a timer whenever the compositor stops answering, so the canvas —
and the LAN broadcast captured from it — keeps producing frames even while the
window is occluded or the display is blanked. `window.__hyperstitionStats.pump`
reports `frames`, `timerFrames`, `stalls` and the wake lock state if you need
to prove it is still alive.

## NOT included (too large)

- `loops/VAJRA DORJE ANIMATIONS/` (~734 MB) — only needed if you turn the
  orbiting-vajras slider up or use the vajra cave content. Copy that folder
  separately if the show calls for it.
