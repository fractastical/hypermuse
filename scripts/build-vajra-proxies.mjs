#!/usr/bin/env node
/**
 * Bake small web proxies of the dorje clips.
 *
 * The masters are 1920x1080 at ~32 Mbit/s each. A vajra sprite renders about
 * 120 px tall, so nothing is gained from that — but asking the browser to
 * decode four or six of them at once (on top of the moon loop) overruns the
 * decoder and the sprites tear into macroblock garbage. These proxies are
 * 360p and roughly a thousandth of the size, which also makes the dorjes
 * small enough to travel in the live kit.
 *
 *   node scripts/build-vajra-proxies.mjs
 *   PROXY_HEIGHT=480 node scripts/build-vajra-proxies.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const SRC_DIR = "loops/VAJRA DORJE ANIMATIONS";
const OUT_DIR = path.join(SRC_DIR, "web");
const HEIGHT = Number.parseInt(process.env.PROXY_HEIGHT || "360", 10);
const CRF = process.env.PROXY_CRF || "26";

if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  console.error("ffmpeg-static binary missing — run: node node_modules/ffmpeg-static/install.js");
  process.exit(1);
}
if (!fs.existsSync(SRC_DIR)) {
  console.error(`no ${SRC_DIR} on this machine — nothing to do`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const clips = fs.readdirSync(SRC_DIR).filter((f) => /\.mp4$/i.test(f));
let built = 0;

for (const clip of clips) {
  const src = path.join(SRC_DIR, clip);
  const out = path.join(OUT_DIR, clip);
  if (fs.existsSync(out) && process.env.FORCE !== "1") {
    console.log(`skip  ${clip} (exists)`);
    continue;
  }
  const args = [
    "-y", "-i", src,
    "-vf", `scale=-2:${HEIGHT}`,
    "-c:v", "libx264", "-crf", CRF, "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    // Frequent keyframes: the sprites loop constantly and a long GOP makes
    // the wrap-around hitch.
    "-g", "60",
    "-movflags", "+faststart",
    "-an",
    out
  ];
  const res = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`FAIL  ${clip}\n${(res.stderr || "").split("\n").slice(-6).join("\n")}`);
    continue;
  }
  const before = fs.statSync(src).size, after = fs.statSync(out).size;
  console.log(`built ${clip}  ${(before / 1e6).toFixed(0)}MB -> ${(after / 1e6).toFixed(1)}MB`);
  built++;
}

console.log(`\n${built} proxy clip(s) in ${OUT_DIR}`);
