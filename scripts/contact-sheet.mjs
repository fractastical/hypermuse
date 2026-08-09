#!/usr/bin/env node
/**
 * Contact sheets for reviewing clips: samples N frames across each input video,
 * labels them, and tiles everything into one or more sheets.
 *
 *   node scripts/contact-sheet.mjs artifacts/demos/effects/*.mp4
 *   SHOTS=3 COLS=4 OUT=artifacts/review/sheet node scripts/contact-sheet.mjs <files…>
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

// The bundled build carries drawtext (libfreetype); a stock Homebrew ffmpeg
// often doesn't, so labels would fail on the system binary.
const FFMPEG = ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : "ffmpeg";

const SHOTS = Number.parseInt(process.env.SHOTS || "1", 10);
const COLS = Number.parseInt(process.env.COLS || "4", 10);
const ROWS = Number.parseInt(process.env.ROWS || "3", 10);
const CELL_W = Number.parseInt(process.env.CELL_W || "440", 10);
const OUT = process.env.OUT || "artifacts/review/sheet";
// Paths without spaces: escaping them through ffmpeg's filter parser is a
// three-level quoting fight not worth having.
const FONTS = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf"
];
const FONT = FONTS.find((f) => fs.existsSync(f));

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: contact-sheet.mjs <video…>"); process.exit(1); }

const tmp = path.join("artifacts", "review", ".frames");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const duration = (f) => {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", f], { encoding: "utf8" });
  return Number.parseFloat(JSON.parse(out).format.duration) || 0;
};

const cells = [];
for (const f of files) {
  const label = path.basename(f, path.extname(f)).replace(/^hypermoon-/, "");
  const dur = duration(f);
  for (let s = 0; s < SHOTS; s++) {
    // Spread samples across the clip, avoiding the very first/last frames.
    const at = dur * (SHOTS === 1 ? 0.55 : 0.12 + (0.76 * s) / Math.max(1, SHOTS - 1));
    const text = SHOTS === 1 ? label : `${label} ${at.toFixed(1)}s`;
    const cell = path.join(tmp, `${String(cells.length).padStart(3, "0")}.png`);
    const vf = [`scale=${CELL_W}:-2`];
    if (FONT) {
      vf.push(
        `drawtext=fontfile=${FONT}:text='${text.replace(/'/g, "")}':x=10:y=10:` +
        `fontsize=24:fontcolor=0xFFE066:box=1:boxcolor=black@0.65:boxborderw=6`
      );
    }
    execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", f, "-frames:v", "1", "-vf", vf.join(","), cell]);
    cells.push(cell);
  }
}

const perSheet = COLS * ROWS;
const sheets = [];
for (let i = 0; i < cells.length; i += perSheet) {
  const group = cells.slice(i, i + perSheet);
  const out = `${OUT}-${sheets.length + 1}.png`;
  const args = [];
  group.forEach((c) => args.push("-i", c));
  const n = group.length;
  const rows = Math.ceil(n / COLS);
  // xstack layout only understands sums of w#/h# terms, not products.
  const sum = (term, times) => (times === 0 ? "0" : Array(times).fill(term).join("+"));
  args.push("-filter_complex", `${group.map((_, k) => `[${k}:v]`).join("")}xstack=inputs=${n}:layout=${
    group.map((_, k) => `${sum("w0", k % COLS)}_${sum("h0", Math.floor(k / COLS))}`).join("|")
  }:fill=black[v]`, "-map", "[v]", "-frames:v", "1", out);
  if (n === 1) {
    fs.copyFileSync(group[0], out);
  } else {
    execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);
  }
  console.log(`${out}  (${n} cells, ${COLS}x${rows})`);
  sheets.push(out);
}
fs.rmSync(tmp, { recursive: true, force: true });
