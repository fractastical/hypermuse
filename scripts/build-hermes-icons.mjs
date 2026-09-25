#!/usr/bin/env node
// Picks the event icons for the playa overlay out of the scraped GifCities
// library and copies them somewhere a fresh clone can find them.
//
//   node scripts/build-hermes-icons.mjs            # fill any empty slots
//   FORCE=1 node scripts/build-hermes-icons.mjs    # re-pick everything
//   node scripts/build-hermes-icons.mjs portal man # re-pick named slots
//
// The library itself is ignored by git and fetched back by npm run gifs, which
// is fine for a swarm of a few hundred interchangeable sprites but not for this:
// an icon is referenced by name from the overlay, so it has to be there on a
// clone that has never run the scraper. These land in hermes/icons/ beside the
// logo — tracked, a few hundred KB for the set — with a manifest recording which
// GifCities gif each one came from, so a pick can be argued with later.
//
// A slot is a meaning, not a picture: the overlay maps an event's words to a slot
// ("stargate", "portal", "deep playa" all mean PORTAL) and the slot decides which
// animation shows. Themes are listed in preference order, so a slot still fills
// if the first theme was never scraped.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const LIB = "assets/gifcities";
const OUT = "hermes/icons";
const FORCE = process.env.FORCE === "1";
const wanted = process.argv.slice(2);

const SLOTS = [
  { slot: "message", themes: ["angel", "ankh"], note: "Hermes' own trade: dispatches, letters, things undelivered" },
  { slot: "cells", themes: ["jellyfish", "octopus", "coral"], note: "morphogenesis, mitochondria, anything cellular" },
  { slot: "dance", themes: ["flame", "spiral", "rainbow"], note: "bass, movement, sound systems" },
  { slot: "portal", themes: ["ufo", "spaceship", "galaxy"], note: "stargates, deep playa, leaving the known map" },
  { slot: "chance", themes: ["crystal", "pentagram", "saturn"], note: "casinos, bets, hypotheses, poker" },
  { slot: "mask", themes: ["skull", "wizard", "dragon"], note: "villains, balls, masks, monologues" },
  { slot: "question", themes: ["eye", "telescope"], note: "salons, one weird question, staring into it" },
  { slot: "poem", themes: ["butterfly", "flower", "heart"], note: "poetry, skin, manuscripts, tenderness" },
  { slot: "shrine", themes: ["candle", "peace", "pyramid"], note: "churches, confessions, absolution" },
  { slot: "heart", themes: ["heart"], note: "dating, romance, consent" },
  { slot: "moon", themes: ["moon"], note: "the moon, and anything named for it" },
  { slot: "man", themes: ["flame"], note: "the Man, fire, burns" },
  { slot: "temple", themes: ["pyramid", "candle"], note: "the Temple, grief, quiet" },
  { slot: "music", themes: ["rainbow", "spiral", "star"], note: "choirs, opera, singing" },
  { slot: "art", themes: ["spinning-globe", "planet", "earth"], note: "art cars, installations, the city itself" },
  { slot: "food", themes: ["smiley", "mushroom"], note: "coffee, diners, anything served" },
  { slot: "water", themes: ["dolphin", "fish", "seahorse"], note: "the reef acts, aquatic anything" },
  { slot: "default", themes: ["star", "comet", "sun"], note: "everything the words did not place" }
];

if (!existsSync(join(LIB, "index.json"))) {
  console.error(`no ${LIB}/index.json — run npm run gifs first`);
  process.exit(1);
}
const themes = JSON.parse(readFileSync(join(LIB, "index.json"), "utf8")).themes || {};
const curation = existsSync(join(LIB, "curation.json"))
  ? JSON.parse(readFileSync(join(LIB, "curation.json"), "utf8"))
  : {};

// What makes a good icon is not what makes a good orbiting sprite. It is shown at
// about the height of a line of text, so it has to read tiny: roughly square,
// actually animated, and not a 300px banner scaled into a smear. Starred picks
// from the hand triage win outright, rejects are out, and past that the score
// prefers square, moving and small.
function score(theme, gif) {
  const path = `${LIB}/${theme}/${gif.file}`;
  const mark = curation[path];
  if (mark === "reject") return -1;
  const w = Number(gif.w) || 0;
  const h = Number(gif.h) || 0;
  if (!w || !h) return -1;
  const ratio = Math.min(w, h) / Math.max(w, h);
  if (ratio < 0.55) return -1;              // banners and rules, not icons
  if (Math.max(w, h) > 260) return -1;       // scaled down to a line height it is mush
  if ((Number(gif.frames) || 1) < 2) return -1; // a still icon among animated ones looks broken
  let value = ratio * 55;
  value += Math.min(Number(gif.frames) || 0, 24) * 1.2;
  value += Math.max(0, 60 - Math.abs(64 - Math.max(w, h))) * 0.35;
  value += Math.min(Number(gif.weight) || 0, 120) * 0.06;
  if (mark === "star") value += 1000;
  return value;
}

// How much of the outer edge is see-through. An icon sits on the night sky next
// to white text, so a gif carrying its own background arrives as a coloured box
// with a picture in it — which is exactly what the first pass of this script
// produced: a fine ankh in a navy tile. GIF transparency is a palette index
// rather than a channel, so the only honest test is to decode a frame and look.
function edgeClear(file, w, h) {
  if (!w || !h) return 0;
  let raw;
  try {
    raw = execFileSync(ffmpegPath, [
      "-nostdin", "-v", "error", "-i", file,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"
    ], { maxBuffer: 64 << 20 });
  } catch {
    return 0;
  }
  if (raw.length < w * h * 4) return 0;
  const alpha = (x, y) => raw[(y * w + x) * 4 + 3];
  let clear = 0;
  let total = 0;
  // The outer two rings rather than the four corners: plenty of these gifs are a
  // picture with a transparent corner and a solid band down one side.
  for (let x = 0; x < w; x++) {
    for (const y of [0, 1, h - 2, h - 1]) {
      if (y < 0 || y >= h) continue;
      total++;
      if (alpha(x, y) < 24) clear++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, 1, w - 2, w - 1]) {
      if (x < 0 || x >= w) continue;
      total++;
      if (alpha(x, y) < 24) clear++;
    }
  }
  return total ? clear / total : 0;
}

const CLEAR_ENOUGH = 0.75;

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { icons: {} };
const icons = { ...(previous.icons || {}) };
// One gif cannot be two icons: a repeat reads as a bug rather than a motif.
const taken = new Set(Object.values(icons).map((icon) => icon && icon.from).filter(Boolean));

let filled = 0;
let missing = 0;
for (const entry of SLOTS) {
  const target = join(OUT, `${entry.slot}.gif`);
  const keep = !FORCE && (!wanted.length || !wanted.includes(entry.slot)) &&
    existsSync(target) && icons[entry.slot];
  if (keep) continue;
  if (icons[entry.slot] && icons[entry.slot].from) taken.delete(icons[entry.slot].from);

  const candidates = [];
  for (const theme of entry.themes) {
    const pool = (themes[theme] && themes[theme].gifs) || [];
    for (const gif of pool) {
      const from = `${theme}/${gif.file}`;
      if (taken.has(from)) continue;
      const path = join(LIB, theme, gif.file);
      if (!existsSync(path)) continue;
      const value = score(theme, gif);
      if (value < 0) continue;
      // Earlier themes are the preference, so a later theme has to be clearly
      // better rather than merely better to take the slot.
      const bias = entry.themes.indexOf(theme) * 12;
      candidates.push({ from, theme, gif, path, rank: value - bias });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank);

  // Decoding is not free, so the field is tried in order and the first one that
  // is actually a cut-out wins, rather than decoding every gif in three themes.
  let best = null;
  let boxed = 0;
  for (const candidate of candidates) {
    const clear = edgeClear(candidate.path, candidate.gif.w, candidate.gif.h);
    if (clear < CLEAR_ENOUGH) { boxed++; continue; }
    best = { ...candidate, clear };
    break;
  }
  if (!best) {
    console.error(`  ${entry.slot}: nothing transparent in ${entry.themes.join(", ")} ` +
      `(${candidates.length} tried, ${boxed} came with a background)`);
    missing++;
    continue;
  }
  copyFileSync(best.path, target);
  taken.add(best.from);
  icons[entry.slot] = {
    file: `${OUT}/${entry.slot}.gif`,
    from: best.from,
    theme: best.theme,
    w: best.gif.w,
    h: best.gif.h,
    frames: best.gif.frames,
    edgeClear: Number(best.clear.toFixed(2)),
    source: best.gif.source || "",
    note: entry.note
  };
  filled++;
  console.log(`  ${entry.slot.padEnd(8)} ${best.theme}/${basename(best.gif.file)}  ` +
    `${best.gif.w}x${best.gif.h} ${best.gif.frames}f  ${Math.round(best.clear * 100)}% clear edge  ` +
    `${Math.round(statSync(target).size / 1024)}KB` +
    (boxed ? `  (${boxed} boxed one${boxed === 1 ? "" : "s"} skipped)` : ""));
}

writeFileSync(manifestPath, JSON.stringify({
  note: "Event icons for the playa overlay, picked out of assets/gifcities by " +
    "scripts/build-hermes-icons.mjs. A slot is a meaning; js/hermes-overlay.js maps " +
    "an event's words onto one. Tracked in git because the library itself is not.",
  built: new Date().toISOString(),
  icons
}, null, 2) + "\n");

const total = Object.keys(icons).length;
const bytes = Object.keys(icons)
  .map((slot) => join(OUT, `${slot}.gif`))
  .filter(existsSync)
  .reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`\n${filled} picked, ${total} slot(s) filled, ${Math.round(bytes / 1024)}KB total -> ${OUT}`);
if (missing) console.log(`${missing} slot(s) unfilled — the overlay falls back to the default icon`);
