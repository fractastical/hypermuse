# Hypermuse

Hypermuse is a browser-based audio and VJ visualization project built with Three.js.
It turns audio energy into animated 3D geometry around a sphere and can map uploaded
video frames onto those geometries for live performance visuals.

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

Layered simulation scaffold (new):

- `js/layers/audio_engine.js` -> emits normalized audio frames (`low`, `mid`, `high`,
  `beat`, `barPhase`) from analyser data.
- `js/layers/sim_compositor.js` -> combines one or more simulation plugins into a
  texture layer for Three.js materials.
- `js/simulations/life_sim.js` -> first cellular plugin (Conway-style variant) with
  audio-reactive speed/rules and beat-triggered spawning.
- `js/simulations/kuramoto_sim.js` -> coupled-oscillator "communication" plugin
  (Kuramoto-inspired local neighbor sync).
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

`sonicsphere.html` now includes a first layered simulation pass:

- Audio analysis -> `HypermuseAudioEngine`
- Simulation plugin update -> `HypermuseLifeSimulationPlugin` +
  `HypermuseKuramotoSimulationPlugin` +
  `HypermuseMoleculeGraphSimulationPlugin`
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

`sonicsphere.html` also runs a timed effect scheduler (while audio is active), cycling
through four profiles about every 16 seconds:

- `life` -> Life-dominant cellular look
- `kuramoto` -> oscillator-dominant sync look
- `molecule` -> molecule-graph-dominant diffusion look
- `stacked` -> all simulation layers combined

## Notes

- This repo contains multiple experimental pages with overlapping logic.
- Some scripts are in-progress or partially wired; `controller.html` +
  `sonicsphere.html` is the primary path.
- Live control mapping doc: `LIVE_CONTROLS_MIXER.md`

## Related work

The theoretical background is in the Hypermusic repository:
[https://github.com/fractastical/hypermusic](https://github.com/fractastical/hypermusic)
