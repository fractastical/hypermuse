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
- **A program never stops.** The output walks the schedule one entry per
  rotation and wraps back to the first act forever, so leaving it running all
  night is the intended way to use it — nothing has to be restarted and
  nothing gets cut off. The hour is a *framing* target, not a cutoff: it is
  how often you want the whole arc to come round. The program editor says
  which side of that you're on ("fits the hour" / "repeats 2.4× per hour" /
  an amber "comes round every 1.4 h, past the hour"), and `fit to hour`
  rescales every act's cycles to land on it. The two timed effects (the
  eclipse transit and the blood fade) default to 45 minutes for the same
  reason, and the eclipse can be set to recur. At the nominal 18 s
  rotation: `hour` is 201 rotations ≈ 60 min, `library` ≈ 13.5 min (so it
  comes round 4× an hour), `folds` ≈ 11 min, `nightfishing` ≈ 4.5 min, `eye10`
  and `eyefolds` ≈ 3 min.
- **Program presets** in the program dropdown: `library` (the whole effect
  library, a different one every 3rd rotation — the good unattended default),
  `carousel` (the same library with no word-only rotation between the acts, so
  every single rotation is a different effect — 15 rotations ≈ 4.5 min a lap,
  the one to run when the moon is the centrepiece rather than the wallpaper),
  `eye10` (word-only moon, the eye seal irises open every 10th rotation),
  `folds` (the bucky fold repertoire every 3rd rotation), `eyefolds` (folds +
  the eye every 10th), plus the original `hour`. In the custom program editor,
  `eye` is a valid act content — it triggers the iris reveal instead of the
  window.
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
- **Earth's shadow** (`?eclipse=0..1`): the eclipse as an event rather than a
  grade. The umbra is a disc 2.6 moon radii across inside a 4.6-radius
  penumbra — the real proportions — and the moon drifts through it along a
  chord, so 0 is first contact on one side and 1 is last contact on the
  other. The shadow's curved edge cuts across the craters on the way in;
  inside it the surface is lit only by sunlight refracted through the earth's
  atmosphere, copper and brighter toward the rim, with the turquoise fringe
  the ozone layer puts just inside the edge. Controls: the `earth's shadow`
  slider scrubs the transit by hand, `▶ run eclipse` runs it over N minutes
  (default 45) and, with `again every N min` set (`?eclipseevery=`), leaves a
  clear sky for that long and then brings the shadow round again — otherwise
  it is a single pass, which is a lot of nothing across a long night. Both
  ends of a transit are a clear moon, so the rewind is invisible. Also
  `● jump to totality`, `✖ hold`, `clear shadow`. The value
  readout names the phase (penumbral / partial / totality). `shadow path`
  (`?eclipsepath=`) is how centrally it passes — 0 is dead through the
  middle, past about 1.6 it never goes total — and `totality depth`
  (`?eclipsedeep=`, default 0.7) is how dark totality gets, since the real
  thing is far darker than a show wants. Like the blood fade, the transit
  runs in the output window and survives the controller closing, and the
  export query resumes it mid-eclipse.
- **Starfield** (`?stars=N`): a parallax sky painted under everything, so the
  moon and the orbiting vajras have something to move against instead of flat
  black. Stars sit at their own depths — the near ones drift faster and carry
  a faint diffraction cross — and each twinkles on its own phase, a little
  harder when the music's highs are up. `meteors / min` (`?meteors=`, default
  5) sets how often one crosses, `sky drift` (`?stardrift=`) scales the whole
  sky's pace (near stars cross the screen in about ten minutes at 1×). The
  moon occludes it, so the disc still reads as solid.
- **Dancing mumins** (`?content=mumins`, or "dancing mumins" in the window
  content dropdown): a ring of little round trolls hopping in a circle on the
  dark side. Drawn in-page, so there's no asset to copy — `?mumins=1..9` sets
  the troupe size and `?muminbpm=` the dance tempo. The window opens wider
  than usual for them; the `window size ×` slider trims it.
- **The star fisher** (`?content=fisher`, or "star fisher" in the window
  content dropdown): one mumin sits out on a crescent with a line in the
  dark, hooks a drifting star, cups it and lets it go — and every third catch
  the freed stars swing into a heart over its head while it waves. Also drawn
  in-page: `?fishersec=` sets how long a catch takes (default 15s),
  `?fisherheart=` how many catches per heart (3), `?fisherzoom=` the size.
  The `nightfishing` program keeps it in rotation with the mumins and the eye.
- **Fisher companion** (`?fisherlive=1`, or the `fisher companion` checkbox):
  the same little scene hung in the sky beside the moon on its own layer
  instead of inside the window — so he keeps fishing while the window runs the
  sonic sphere, the folds, anything. Everything else carries on untouched.
  `size` (`?fisherlivesize=`, in disc radii), `angle` (`?fisherliveangle=`,
  degrees round the disc, 200 puts him at the lower left) and `out`
  (`?fisherlivedist=`, how far from the centre) place him. He follows the moon
  when you resize it.
- **Sonic sphere** (`?content=harmonics`, or "sonic sphere" in the window
  content dropdown): the actual normal modes of a vibrating sphere. A lattice
  sphere is displaced by a real spherical harmonic Y(l,m) and rings in place —
  the lobes swing out, pass through round, and come back inverted, trading
  warm for cold, with the nodal lines staying dark because that is where the
  surface never moves. It walks up the harmonic series, morphing each mode
  into the next; `?harmsec=` sets how long a mode is held (default 5s). Bass
  drives it harder. Drawn in-page, no assets.
- **Cymatics plate** (`?content=cymatics`, or "cymatics plate"): a Chladni
  figure. The glowing curves are the nodes of a driven square plate and the
  sand walks downhill until it settles on them, because those are the only
  places that are still. The mode changes every `?cymsec=` seconds (default 7)
  and the grains scatter and re-gather; how violently they are thrown about
  follows the music. `?cymgrains=` sets the amount of sand (default 4200).
- **The jitterbug listens** (`?content=foldjitter`): Fuller's vector
  equilibrium has exactly one degree of freedom — the whole collapse through
  the icosahedron to the octahedron is a single number — so the bass can drive
  it directly. A hit slams it shut and it springs back open, which turns the
  geometry into a readout of the room rather than a clock. It is on a spring,
  not a tracker, so the rebound is what you see on the beat. Scaled by the
  `intensity` control like everything else musical; in silence it falls back
  to the timed VE → icosa → octa cycle, so an unattended moon still moves.
- **Window depth** slider (`?winparallax=0..1`): how far inside the shell the
  content hangs. Above zero it slides against its own frame as the window
  turns away, the way something at depth would, and the walls of the opening
  shade it toward the rim — which is what makes the sonic sphere read as
  suspended inside a hollow moon rather than screened on its surface.
  Defaults low for the drawn figures and half open for everything else.
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

- **Vajras that actually orbit.** A dorje in front of the moon now *covers*
  the surface (the clips are keyed off their black background and composited
  properly, instead of being added as light, which made them look painted on)
  and the far half of each lane is clipped per pixel against the disc, so a
  dorje is eaten by the limb, vanishes behind the moon and comes out the
  other side. The **vajra lane opening** slider (`?vajratilt=0.05..1`) sets
  how far a lane opens vertically, measured against the disc rather than
  against the lane's width — that is what guarantees every lane turns inside
  the limb instead of only the innermost one. `vajra orbit radius` still sets
  how wide they swing at the sides.

## Dorje clips

The orbiting vajras and the vajra cave play from
`loops/VAJRA DORJE ANIMATIONS/web/` — 360p proxies, about 6 MB for the set,
which travel with the kit. They exist because the masters are 1080p at
32 Mbit/s each: decoding four or six of those at once tears the sprites into
macroblock garbage, and nothing is gained when a sprite renders 120 px tall.
Rebuild them from the masters with `npm run build:vajra:proxies`. The full
`loops/VAJRA DORJE ANIMATIONS/` masters (~734 MB) are *not* included; if a
proxy is missing the sprite falls back to the master path automatically.

## Making a demo reel

`npm run export:reel` walks every effect in turn — word mosaic, mumins, star
fisher, CRT, incantation, vajra cave, the folds, the sonic sphere, the
cymatics plate, orbiting vajras, the eye iris, blood moon, earth's shadow,
starfield, moon size — captions each one and writes
`artifacts/hypermoon-effects-reel.mp4` (about a minute). `SCENES=fisher,blood`
renders just those, `SCENE_MS=` changes the time per scene.

`npm run export:clips` captures the same pass but writes one little video per
effect into `artifacts/demos/effects/` instead of the montage — handy for
showing a single effect without scrubbing. `CLIPS=1 npm run export:reel`
writes both.

## Rendering it onto a holographic fan

`npm run export:holofan` shows what the moon looks like on one of those
spinning LED "3D hologram" fans, at a size worth having: a 180 cm disc in a
dark room with a figure beside it for scale.

It runs in two passes. First it films the moon square, the way a clip would be
loaded onto the fan's own controller, cueing a short sequence by hand — the
iris opening on the eye seal, the sonic sphere in the window, blood moon, then
a slow earth's shadow that is at its deepest as the shot ends. Then
`holofan.html` plays that clip back through a simulated arm of LEDs and the
result is filmed in turn, ending at
`artifacts/demos/hypermoon-holofan-180cm.mp4` (about 45 s).

What the simulation actually does: the picture is resampled into polar
coordinates, so it arrives as concentric rings of light on the LED pitch rather
than as square pixels; unlit pixels are simply air, so the room shows straight
through the dark side of the moon; the arm leaves a faint update seam chasing
the rotation; and the LED rings are band-limited against the pixel footprint,
so they are crisp when the camera is close and dissolve into an even glow when
it is not — which is what a camera does and what stops the whole thing turning
into a moire starburst.

Worth knowing:

- `SKIP_SOURCE=1` reuses `artifacts/holofan-source.mp4` instead of re-filming
  the moon, which is most of the runtime.
- `STILL=1` writes a single frame instead of a video, for eyeballing changes.
- `DIAM=` in centimetres. The dimension line and the caption follow it, and so
  does everything physical, so `DIAM=65` really does look like a desk fan.
- `FAN_QUERY=` passes anything through to the page, e.g.
  `FAN_QUERY="leds=448&rpm=900&dollysec=0&orbit=0"`.
- `MOON_QUERY=` does the same for the moon pass.

`holofan.html` also runs on its own against any clip:
`holofan.html?src=artifacts/demos/effects/hypermoon-eye.mp4&diam=180`. Useful
knobs are `leds` (per arm), `steps` (angular samples a turn), `rpm`, `gain`,
`glow`, `haze`, `duty`, `zoom`, and `person`, `dim`, `room`, `label` to strip
the room back to just the disc.
