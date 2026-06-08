# Hypermuse Live Controls + Mixer Labels

This document is the quick-reference for live performance control mapping,
especially when labeling a physical mixer/OSC/MIDI board.

## Current visual layout

- **Left sphere**: base/low tone energy lane
- **Right sphere**: mid + high energy lane
- **Simulation shell**: layered field over both lanes, blending the active
  simulation plugins (Life, Hierarchical-Life, Hex-Life, Kuramoto, Gray-Scott,
  Physarum, Molecule-Graph)

## Recommended board labels (16 channels)

Use this as a default label strip on the board:

1. `MASTER THRESH`
2. `LOW LANE GAIN`
3. `MID/HIGH LANE GAIN`
4. `HUE SPEED`
5. `SAT`
6. `BRIGHT`
7. `X ROT`
8. `Y ROT`
9. `FX MODE / NEXT`
10. `HEX RULE / CYCLE`
11. `HEX SPEED`
12. `SHELL OPACITY`
13. `VIDEO HOLD`
14. `VIDEO XFADE`
15. `MOLECULE NEXT`
16. `EXPORT ARM`

## In-app controls (sonicsphere panel)

These are visible directly in `sonicsphere.html`:

- `audioInput`: load audio (`audio/*`, `.mid`, `.midi`)
- `videoInput`: load manual loop files
- `videoSetManifest` + `loadVideoSetButton`: load set JSON
- `effectTimelinePhases`, `effectTimelinePhaseSec`, `effectTimelineEnabled`, `applyEffectTimelineButton`
- `moleculeNameInput` + `loadMoleculeButton`
- `startExportButton`, `stopExportButton`
- `master`: threshold bank offset
- `volumeSlider`: output level control

## Message/automation control names

### Legacy name/value bridge (`js/message_controller.js`)

- `master`
- `xrotation`, `yrotation`
- `hueoffset`, `hueoffset1..5`, `hueoffsetspeed`
- `saturation`, `brightness`, `volumemagnification`
- `activegeometrieslimit`, `activegeometriesagedeath`, `activegeometriesopacityreduction`
- `pointlightx`, `pointlighty`, `pointlightz`, `pointlightintensity`
- `cxposition`, `cyposition`, `czposition`
- `videochange`, `videochangeloop`, `playbackrate`
- `threshold0..threshold47`

### VJ command bridge (`postMessage({ type: 'vj', ... })`)

This is the primary live-control path. `window.vjControl(cmd)` does the same in-page.

- `mode` -> effect profile / alias: `classic`, `life`, `hierarchical-life`,
  `hex-life` (alias `hex`), `kuramoto`, `gray-scott`, `physarum`,
  `molecule` (alias `morphospace`), `rewrite`, `word-cloud`, or `next`
- Hex CA: `hexRule`, `hexRuleCycle`, `hexSpeed`, `hexSync`, `hexSweepRows`,
  `hexAperiodic`, `palette` (`aurora`/`magma`/`violet`/`mono`/`neon`)
- Look/playback: `speed`, `hue`, `intensity`, `paused`/`play`/`pause`
- Layers/overlays: `basicVideo`, `mosaic`, `mosaicFx`, `blackout`/`blackoutFadeMs`,
  `logo`/`logoOpacity`/`logoPosition`
- Curation: `loopPreference` (`like`/`dislike`), `wordList`

> Note: the old `mode` values `color`/`video`/`mixed` are deprecated. Mode now
> selects an effect profile (see list above).

## Setlist controls that affect live playback

In `sets/*.json`:

- `playbackMode`: `pingpong` or `loop`
- `defaultTransition`: `type`, `durationMs`, `holdMs`
- `effectTimeline`: phase sequence + durations
- `moleculeGraph`:
  - `name`
  - `names` (sequence)
  - `cycleOnPhaseChange`

## Fast sanity check before show

1. Load `sets/bio1.json`.
2. Confirm `moleculeStatus` shows loaded atoms/bonds.
3. Confirm clips advance automatically (pingpong).
4. Confirm effect phases visibly change every configured phase duration.
5. Run a short export test and check audio + video are same duration.
