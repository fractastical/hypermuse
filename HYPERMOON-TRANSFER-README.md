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

## NOT included (too large)

- `loops/VAJRA DORJE ANIMATIONS/` (~734 MB) — only needed if you turn the
  orbiting-vajras slider up or use the vajra cave content. Copy that folder
  separately if the show calls for it.
