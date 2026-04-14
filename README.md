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

## Core visualization idea

Frequency bands are mapped across a sphere using a golden-ratio-style angular step.
When a band crosses its threshold, the corresponding point(s) activate and geometry
is generated between active points, producing a live "music topology" effect.

## Layered simulation mode

`sonicsphere.html` now includes a first layered simulation pass:

- Audio analysis -> `HypermuseAudioEngine`
- Simulation plugin update -> `HypermuseLifeSimulationPlugin` +
  `HypermuseKuramotoSimulationPlugin`
- Texture composition -> `HypermuseSimulationCompositor`
- Rendered as an additive "simulation shell" mesh in the scene

This is intended as the base architecture for integrating Morpholib-style and other
cellular systems with the same music sync pipeline.

## Notes

- This repo contains multiple experimental pages with overlapping logic.
- Some scripts are in-progress or partially wired; `controller.html` +
  `sonicsphere.html` is the primary path.

## Related work

The theoretical background is in the Hypermusic repository:
[https://github.com/fractastical/hypermusic](https://github.com/fractastical/hypermusic)
