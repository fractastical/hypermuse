#!/usr/bin/env node
/**
 * Joins art cuts into an edit, in the order given. All inputs must share size
 * and frame rate (everything out of export-art-cuts.mjs does).
 *
 *   node scripts/join-cuts.mjs word cymatics eye fisher eclipse blood
 *   OUT=artifacts/art-cuts/my-edit.mp4 XFADE=0.5 node scripts/join-cuts.mjs eye blood
 *   LOOP=1 node scripts/join-cuts.mjs eye blood     # fade up/down for a gallery loop
 *
 * LOOP fades from and to black rather than trying to blend the tail into the
 * head: the cuts end on wildly different images (a red eclipse, a grey disc),
 * so a black seam is the only one that reads as deliberate on repeat.
 *
 * Bare names resolve to artifacts/art-cuts/<name>.mp4; paths are used as given.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const CUTS_DIR = process.env.CUTS_DIR || "artifacts/art-cuts";
const OUT = process.env.OUT || path.join(CUTS_DIR, "hypermoon-art-edit.mp4");
const XFADE = Number.parseFloat(process.env.XFADE || "0");
const LOOP = process.env.LOOP === "1";
const FPS = Number.parseInt(process.env.FPS || "30", 10);

const names = process.argv.slice(2);
if (!names.length) { console.error("usage: join-cuts.mjs <cut|path>…"); process.exit(1); }

const files = names.map((n) => {
  const p = n.includes("/") || n.endsWith(".mp4") ? n : path.join(CUTS_DIR, `${n}.mp4`);
  if (!fs.existsSync(p)) throw new Error(`missing cut: ${p}`);
  return path.resolve(p);
});

const probe = (f) => {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration", "-of", "json", f], { encoding: "utf8" });
  const j = JSON.parse(out.stdout);
  return { w: j.streams[0].width, h: j.streams[0].height, dur: Number.parseFloat(j.format.duration) };
};
const metas = files.map(probe);
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });

let args;
if (XFADE > 0 || LOOP) {
  // Chain xfades; each transition consumes XFADE seconds of overlap.
  const fade = XFADE > 0 ? XFADE : 0.5;
  args = [];
  files.forEach((f) => args.push("-i", f));
  let filter = "";
  let prev = "0:v";
  let offset = 0;
  for (let i = 1; i < files.length; i++) {
    offset += metas[i - 1].dur - fade;
    const label = i === files.length - 1 && !LOOP ? "v" : `x${i}`;
    filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[${label}];`;
    prev = label;
  }
  if (LOOP) {
    const total = metas.reduce((a, m) => a + m.dur, 0) - fade * (files.length - 1);
    filter += `[${prev}]fade=t=in:st=0:d=${fade}` +
      `,fade=t=out:st=${(total - fade).toFixed(3)}:d=${fade}[v];`;
    prev = "v";
  }
  args.push("-filter_complex", filter.replace(/;$/, ""), "-map", `[${prev}]`,
    "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-movflags", "+faststart", OUT);
} else {
  const list = path.join(path.dirname(path.resolve(OUT)), ".join.txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  args = ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", OUT];
}

const enc = spawnSync(ffmpegPath, ["-y", ...args.filter((a) => a !== "-y")], { encoding: "utf8" });
if (enc.status !== 0) throw new Error(enc.stderr || "join failed");
const out = probe(OUT);
console.log(`${OUT}  ${out.dur.toFixed(2)}s  ${out.w}x${out.h}  (${files.length} cuts${XFADE > 0 || LOOP ? `, ${XFADE || 0.5}s crossfades` : ", hard cuts"}${LOOP ? ", looping" : ""})`);
