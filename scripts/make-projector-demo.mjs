#!/usr/bin/env node
// The two-projector show, rendered at the size it will be shown at.
//
//   npm run demo:projectors
//
// Writes three files into artifacts/demos:
//
//   moon-1920x1080.mp4          what goes on the first output
//   poem-triangle-1920x1080.mp4 what goes on the second
//   dual-projector-preview.mp4  the pair side by side, for looking at here
//
// Both projectors are 402 x 226 cm, which is 16:9 to within a millimetre, so
// 1920x1080 fills them without bars. Each render is left alone if it is already
// there - the moon takes a couple of minutes - so pass FORCE=1 to redo them.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const OUT = path.resolve("artifacts/demos");
fs.mkdirSync(OUT, { recursive: true });
const FORCE = process.env.FORCE === "1";
const SECONDS = Number(process.env.SECONDS || 60);

const MOON = path.join(OUT, "moon-1920x1080.mp4");
const POEM = path.join(OUT, "poem-triangle-1920x1080.mp4");
const PAIR = path.join(OUT, "dual-projector-preview.mp4");

function render(label, out, env) {
  if (fs.existsSync(out) && !FORCE) { console.log(`${label}: already there, keeping it`); return; }
  console.log(`${label}: rendering ${SECONDS}s at 1920x1080`);
  const r = spawnSync("node", ["scripts/export-hyperstition-moon-video.mjs"], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      CAPTURE_MS: String(SECONDS * 1000),
      EXPORT_WIDTH: "1920", EXPORT_HEIGHT: "1080",
      BUILD_MOON_CUBES: "0", OUTPUT_VIDEO: out,
      ...env
    }
  });
  if (r.status !== 0) throw new Error(`${label} failed`);
}

render("moon", MOON, {
  HYPERSTITION_PAGE: "hypermoon.html",
  HYPERSTITION_EXTRA_QUERY: "program=carousel&ui=0"
});
render("poem", POEM, {
  HYPERSTITION_PAGE: "crt-terminal.html",
  // What the controller's own "open poem output" sends, plus the turn that
  // keeps the line being written along the bottom.
  HYPERSTITION_EXTRA_QUERY: "poem=trinitypoem.txt&group=3&layout=triangle&trifollow=1" +
    "&triease=1.2&trighost=6&color=white&fx=0&cps=13&hold=1.6" +
    "&safe=0.06&fit=0.97&align=center&vcenter=1"
});

// Side by side at a size that fits on a screen, captioned, with a gap standing
// in for the wall between the two surfaces.
console.log("pair: stacking");
const W = 1240, H = Math.round((W * 9) / 16); // 698
const cap = (text, x) =>
  `drawtext=text='${text}':fontcolor=0xcfe9ff@0.72:fontsize=22:x=${x}:y=h-34:` +
  `font='Menlo':box=0`;
const filter = [
  `[0:v]scale=${W}:${H},pad=${W}:${H + 62}:0:0:black[a]`,
  `[1:v]scale=${W}:${H},pad=${W}:${H + 62}:0:0:black[b]`,
  `[a][b]hstack=inputs=2,pad=2560:760:(ow-iw)/2:0:black[s]`,
  `[s]${cap("projector 1 — the moon", 60)},${cap("projector 2 — the poem", 1380)}[v]`
].join(";");
const r = spawnSync(ffmpegPath, [
  "-y", "-i", MOON, "-i", POEM,
  "-filter_complex", filter, "-map", "[v]",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium",
  PAIR
], { stdio: ["ignore", "ignore", "inherit"] });
if (r.status !== 0) throw new Error("stacking failed");
console.log(`\nwrote\n  ${MOON}\n  ${POEM}\n  ${PAIR}\n`);
