# Hypermuse

Hypermuse is a browser-based audio and VJ visualization project built with Three.js.
It turns audio energy into animated 3D geometry around a sphere and can map uploaded
video frames onto those geometries for live performance visuals.

> **Just want to run the show, not read code?** Jump to
> [Using Hypermuse (plain-language guide)](#using-hypermuse-plain-language-guide).

## Using Hypermuse (plain-language guide)

This section is for performing with Hypermuse without touching any code. If someone
technical set it up for you, you can ignore everything else in this README and just
follow along here.

### The big picture: two windows

Hypermuse runs as **two windows**:

- **The controller** (`controller.html`) — your "remote control." This is where you
  click buttons. The audience never sees this.
- **The visual** (`sonicsphere.html`) — the actual art that reacts to music. This is
  what you put on the big screen / projector.

The controller opens the visual for you and sends it commands. Think of it like a
lighting desk (controller) driving a stage (visual).

### Step 1: Start it up

If the app is already running on the computer, open a web browser (Chrome works best)
and go to:

```
http://localhost:8080/controller.html
```

If nothing loads, someone needs to start the app once. A technical helper can do this
by opening a terminal in the project folder and running `npm install` (first time only)
then `npm start`. After that, the link above will work.

### Step 2: Open the visual

On the controller, click **`open/reopen visual`** (top of the page). A second window
opens — that's your art. Drag it onto your projector/second screen and make it
fullscreen.

> Tip: the easiest way to start with something good-looking is to click one of the
> **Presets** buttons (for example `cells1+cells2 autoplay (with logo)`). It opens the
> visual already configured.

### Step 3: Play music

The visuals react to sound. You have two options:

- **Easiest:** just play music out loud / through the venue — but the visual needs the
  audio fed into it. For a reliable signal, load an audio file directly: in the visual
  window there's a **`Music`** file picker — choose an `.mp3`/`.wav` and it starts
  reacting.
- Press **`h`** in the visual window to hide or show its control panel.

### Step 4: Drive the look from the controller

Here's what each section of the controller does, in plain terms:

- **FX Mode** — the overall "style" of the visuals. Click one anytime to switch:
  - `classic` — the original glowing geometric shapes and lines
  - `life` — cells being born and dying (classic "game of life" feel)
  - `hier life` — layered living patterns
  - `hex life` — honeycomb cellular patterns that sweep down the screen
  - `kuramoto` — pulsing waves that fall in and out of sync
  - `gray-scott` — organic, blobby coral/spot patterns
  - `physarum` — slime-mold-like flowing trails
  - `molecule` — rotating 3D molecule structures
  - `next mode` — just jump to the next style
- **Hex CA** — fine-tunes the honeycomb "hex life" style:
  - `speed` — how fast the pattern evolves (1.0 is normal)
  - `sync audio` — when checked, the pattern speeds up/down with the music
  - `rule` — the "recipe" for the pattern (try `bloom`, `maze`, `coral` for different
    looks)
  - `cycle rule` — flips to the next recipe automatically
  - `aperiodic` — adds non-repeating randomness (0 = clean, higher = more chaotic)
  - `palette` — the color scheme (`aurora`, `magma`, `violet`, `mono`, `neon`)
  - `apply hex` — switches to hex mode and applies your settings
- **Basic Video Mode** — show your loaded video clips fullscreen with little/no effects.
  Good for a clean break.
- **Bridge** — `fade to black` and `fade in`. Your safety buttons for transitions.
- **SynBioBeta Logo** — show/hide a logo overlay and set its position/opacity.
- **Triangle (mosaic) vids** — tiles video clips into a mosaic; `triangle + fx` adds
  effects on top.
- **Loop Rating** — `like loop` keeps a clip around; `dislike & skip` drops it and moves
  on. Use this to curate what plays during the show.
- **Folder loops (playlist)** — tick/untick which folders of clips are allowed to play.
- **Color board / Color cube board** — filter or display clips by color family.

### A typical live flow

1. Click a **Preset** to open the visual, then make it fullscreen on the projector.
2. Start your **music** (load an audio file in the visual window).
3. Pick an **FX Mode** that fits the song (e.g. `hex life` for builds,
   `gray-scott` for ambient moments).
4. For hex mode, leave **`sync audio`** on so it moves with the beat; tweak `palette`
   to match the mood.
5. Use **`next mode`** or click another FX button to change the vibe between sections.
6. Use **`fade to black`** / **`fade in`** for clean transitions.
7. `like` / `dislike & skip` clips as they play to shape the set.

That's the whole job — pick a mode, match the palette to the music, and use fades for
transitions. Everything below is for people who want to build sets, export videos, or
modify the code.

## What the project does

- Analyzes incoming audio with the Web Audio API (`AnalyserNode`).
- Splits the frequency spectrum into bands and tracks per-band energy.
- Maps those bands to points distributed on a sphere.
- Creates reactive shapes, lines, and polygons when band thresholds are exceeded.
- Optionally textures geometry with video frames for VJ-style visuals.
- Exposes many live controls (thresholds, hue, camera/light, rotation, density)
  through a controller window.

## How it is structured

The app is mostly multi-page HTML + inline script, with shared helpers in `js/`.

- `controller.html` -> opens `sonicsphere.html` in a second window and sends control
  updates with `postMessage`.
- `sonicsphere.html` -> main audio-reactive sphere renderer.
- `colorsphere.html` + `colorcontroller.html` -> color-focused variant.
- `poetsphere.html` + `poetcontroller.html` -> poetry-related variant.
- `polysphere.html`, `videosphere.html`, `venus.html`, `kurasphere.html` -> alternate
  visualizer experiments.
- `prototypes/` -> older or experimental variants.

Shared utility scripts:

- `js/video_processor.js` -> video queueing, frame capture, texture updates.
- `js/message_controller.js` -> message handling for live parameter changes.
- `js/audio_controller.js` -> audio queue playback helpers and MIDI playback logic.
- `js/sonic_geometries.js` -> reusable geometry-building utilities.
- `js/note_analyzer.js` -> note/frequency mapping and peak detection helpers.

Layered simulation scaffold:

- `js/layers/audio_engine.js` -> emits normalized audio frames (`low`, `mid`, `high`,
  `beat`, `barPhase`) from analyser data.
- `js/layers/sim_compositor.js` -> combines one or more simulation plugins into a
  texture layer for Three.js materials.
- `js/simulations/life_sim.js` -> Conway-style cellular plugin with audio-reactive
  speed/rules and beat-triggered spawning.
- `js/simulations/hierarchical_life_sim.js` -> multi-layer Life variant with coupled
  low/mid/high lanes.
- `js/simulations/hex_life_sim.js` -> hexagonal cellular automata with selectable
  `B/S` rules, color palettes, top-to-bottom reveal sweep, music sync, and an
  aperiodic modulation option.
- `js/simulations/kuramoto_sim.js` -> coupled-oscillator "communication" plugin
  (Kuramoto-inspired local neighbor sync).
- `js/simulations/gray_scott_sim.js` -> Gray-Scott reaction-diffusion plugin
  (organic coral/spot patterns with presets).
- `js/simulations/physarum_sim.js` -> Physarum (slime-mold) agent-trail plugin.
- `js/simulations/molecule_graph_sim.js` -> molecule communication graph plugin
  (SDF atom/bond topology with audio-driven diffusion + PubChem fetch support).

## Run locally

Because browsers restrict file/media APIs on `file://`, run a local server.

### Option 1: npm scripts

```bash
npm install
npm start
```

Then open:

- `http://localhost:8080/controller.html` (main controller -> opens visualizer)
- or `http://localhost:8080/colorcontroller.html`
- or `http://localhost:8080/poetcontroller.html`

### Option 2: Python server with CORS headers

```bash
python3 pyserver.py
```

Then open `http://localhost:8000/controller.html`.

## Basic usage

1. Open a controller page.
2. Click `Start`.
3. Load audio files (`audio/*`, `.mid`, `.midi`) and optional videos.
4. Adjust threshold sliders and other controls to shape the reaction.
5. Use keyboard shortcuts in visualizer pages:
   - `h` toggle control panel
   - `v` toggle video list panel (where supported)

## VJ set preload workflow

To preload a folder of loops (for example `loops/bio1`) and reuse it as a startup set:

1. Put your loops in `loops/bio1` (nested folders are supported).
2. Build a manifest:

```bash
npm run build:vj-set
```

3. In `sonicsphere.html`, use `Video Set Manifest` (`sets/bio1.json`) and click
   `Load Set`.

The manifest can also be loaded automatically by the sample export script.

Each loop entry includes transition controls:

```json
{
  "url": "loops/bio1/clip01.mp4",
  "label": "clip01.mp4",
  "transition": {
    "type": "fade",
    "durationMs": 900,
    "holdMs": 8000
  }
}
```

Set-level playback can be `pingpong` (back-and-forth) or `loop`:

```json
{
  "playbackMode": "pingpong"
}
```

You can tune defaults when building:

```bash
VJ_HOLD_MS=10000 VJ_TRANSITION_MS=1200 VJ_TRANSITION_TYPE=fade npm run build:vj-set
```

Useful set-build options:

```bash
VJ_MAX_LOOPS=20 VJ_PLAYBACK_MODE=pingpong npm run build:vj-set
```

Set manifests can also carry an effect schedule:

```json
{
  "effectTimeline": {
    "enabled": true,
    "phases": [
      { "name": "classic", "durationSec": 16 },
      { "name": "life", "durationSec": 16 },
      { "name": "kuramoto", "durationSec": 16 },
      { "name": "molecule", "durationSec": 16 },
      { "name": "stacked", "durationSec": 16 }
    ]
  }
}
```

When you click `Load Set`, this schedule is applied automatically.

Set manifests can optionally specify a real molecule source:

```json
{
  "moleculeGraph": {
    "name": "caffeine",
    "names": ["caffeine", "serotonin", "dopamine", "glucose"],
    "cycleOnPhaseChange": true
  }
}
```

When present, the molecule source is loaded from PubChem automatically.
If `names` is provided, the set can rotate through the list as phases change.

You can also edit timeline behavior live in `sonicsphere.html` controls:

- `Effect phases` (comma-separated)
- `sec/phase`
- `timeline on`
- `Apply FX Timeline`

`classic` preserves the original triangle/polygon visual style before layered variants.

## Sample video export

Generate a short sample output recording:

```bash
npm run export:sample
```

By default it tries to preload `sets/bio1.json`, injects generated test audio, and
writes `artifacts/sample-sonicsphere.webm`.

To target a different set manifest:

```bash
VJ_SET_MANIFEST=sets/another-set.json npm run export:sample
```

To force a specific real molecule during export:

```bash
MOLECULE_NAME=caffeine npm run export:sample
```

For the 6.5ft x 4.5ft wall target (13:9 aspect ratio), use the dedicated preset:

```bash
npm run export:sample:13x9
```

Or override with explicit frame size:

```bash
EXPORT_WIDTH=1872 EXPORT_HEIGHT=1296 npm run export:sample
```

Exporter note:

- If source is an audio file (`.wav`, `.mp3`, etc.), audio is muxed into the output video.
- If source is MIDI (`.mid`/`.midi`), visuals still render, but export stays silent unless
  you provide an audio render of that MIDI.

You can also export directly from the UI using `Start Export` / `Stop Export` in
`sonicsphere.html` (uses browser `MediaRecorder` from the render canvas).

## Core visualization idea

Frequency bands are mapped across a sphere using a golden-ratio-style angular step.
When a band crosses its threshold, the corresponding point(s) activate and geometry
is generated between active points, producing a live "music topology" effect.

## Layered simulation mode

`sonicsphere.html` runs a layered simulation pass:

- Audio analysis -> `HypermuseAudioEngine`
- Simulation plugin updates -> Life, Hierarchical-Life, Hex-Life, Kuramoto,
  Gray-Scott, Physarum, and Molecule-Graph plugins
- Texture composition -> `HypermuseSimulationCompositor`
- Rendered as an additive "simulation shell" mesh in the scene

This is intended as the base architecture for integrating Morpholib-style and other
cellular systems with the same music sync pipeline.

The molecule plugin directly adapts the `parseSDF` approach used in
`fractastical/metajargon` and turns bonds into a communication network for signal
propagation.

You can load real molecule data live from controls in `sonicsphere.html`:

- `Molecule (PubChem name)` input (examples: `caffeine`, `serotonin`, `dopamine`)
- `Load Molecule` button
- status text showing loaded atom/bond counts

`sonicsphere.html` also runs a timed effect scheduler (while audio is active) that
cycles through effect profiles (about every 16 seconds by default, configurable via
the timeline controls). Available profiles:

- `classic` -> original triangle/polygon geometry look
- `life` -> Conway-style cellular look
- `hierarchical-life` -> multi-layer Life look
- `hex-life` -> hexagonal cellular automata (rules/palettes/aperiodic; music-synced)
- `kuramoto` -> oscillator-dominant sync look
- `gray-scott` -> reaction-diffusion (coral/spots) look
- `physarum` -> slime-mold trail look
- `molecule` -> molecule-graph diffusion look
- `rewrite` -> molecule-graph rewrite variant
- `word-cloud` -> floating phrase overlay
- `stacked` -> all simulation layers combined

### Hex cellular automata (hex-life)

The `hex-life` profile is a 6-neighbor hexagonal CA you can control live from
`controller.html` (the **FX Mode** + **Hex CA** panels) or via the VJ command API:

- Rule presets: `hexlife` (B2/S34), `bloom` (B2/S3), `maze` (B3/S12345),
  `pulse` (B13/S24), `coral` (B2/S2); plus `cycle rule` to advance automatically.
- `speed`, `sync audio` (sync evolution to the beat), `sweep rows` (top-to-bottom
  reveal rate), `aperiodic` (non-repeating modulation), and `palette`
  (`aurora`/`magma`/`violet`/`mono`/`neon`).
- URL boot params: `hexpalette`, `hexspeed`, `hexsync`, `hexsweeprows`, `hexrule`,
  `hexaperiodic` (e.g. `sonicsphere.html?mode=hex-life&hexrule=maze&hexpalette=violet`).

## VJ command API

The controller drives the visual by sending `postMessage({ type: 'vj', ... })` to
`sonicsphere.html` (`window.vjControl(cmd)` does the same in-page). Common fields:

- `mode` -> effect profile or alias (`classic`, `life`, `hierarchical-life`,
  `hex-life`/`hex`, `kuramoto`, `gray-scott`, `physarum`, `molecule`/`morphospace`,
  `rewrite`, `word-cloud`, or `next` to advance)
- `hexRule`, `hexRuleCycle`, `hexSpeed`, `hexSync`, `hexSweepRows`, `hexAperiodic`,
  `palette` -> hex CA controls
- `speed`, `hue`, `intensity`, `paused`/`play`/`pause`
- `basicVideo`, `mosaic`, `mosaicFx`, `blackout`/`blackoutFadeMs`
- `logo`, `logoOpacity`, `logoPosition`
- `loopPreference` (`like`/`dislike`), `wordList`

## Notes

- This repo contains multiple experimental pages with overlapping logic.
- Some scripts are in-progress or partially wired; `controller.html` +
  `sonicsphere.html` is the primary path.
- Live control mapping doc: `LIVE_CONTROLS_MIXER.md`

## Related work

The theoretical background is in the Hypermusic repository:
[https://github.com/fractastical/hypermusic](https://github.com/fractastical/hypermusic)
