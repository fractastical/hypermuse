#!/usr/bin/env node
/**
 * Scan loops/ videos and extract square color "cubes" per hue family (black, silver, …).
 * Writes artifacts/color-cube-index.json + artifacts/color-cubes/{family}/*.jpg
 *
 * Usage: node scripts/build-color-cube-index.mjs
 * Env:  COLOR_CUBE_MAX_VIDEOS=0 (0=all), COLOR_CUBE_SIZE=64, COLOR_CUBE_MAX_PER_FAMILY=40
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const LOOPS_DIR = path.join(PROJECT_ROOT, process.env.COLOR_CUBE_LOOPS_DIR || "loops");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const CUBES_DIR = path.join(ARTIFACTS_DIR, "color-cubes");
const OUTPUT_PATH = path.join(ARTIFACTS_DIR, process.env.COLOR_CUBE_INDEX || "color-cube-index.json");

const CUBE_SIZE = Math.max(32, Number.parseInt(process.env.COLOR_CUBE_SIZE || "64", 10));
const MAX_PER_FAMILY = Math.max(4, Number.parseInt(process.env.COLOR_CUBE_MAX_PER_FAMILY || "40", 10));
const MAX_VIDEOS = Number.parseInt(process.env.COLOR_CUBE_MAX_VIDEOS || "0", 10);
const SAMPLE_FRAMES = Math.max(2, Number.parseInt(process.env.COLOR_CUBE_SAMPLE_FRAMES || "6", 10));
const ANALYSIS_SIZE = Math.max(64, Number.parseInt(process.env.COLOR_CUBE_ANALYSIS_SIZE || "128", 10));

const FAMILY_ORDER = [
  "black", "silver", "gray", "white",
  "red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"
];

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = ((bn - rn) / delta) + 2;
    else h = ((rn - gn) / delta) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function classifyRgbColorFamily(r, g, b) {
  const hsv = rgbToHsv(r, g, b);
  if (hsv.v < 0.14) return "black";
  if (hsv.s < 0.10 && hsv.v >= 0.42 && hsv.v <= 0.82) return "silver";
  if (hsv.s < 0.16 && hsv.v > 0.78) return "white";
  if (hsv.s < 0.16) return "gray";
  if (hsv.h < 15 || hsv.h >= 345) return "red";
  if (hsv.h < 40) return "orange";
  if (hsv.h < 70) return "yellow";
  if (hsv.h < 160) return "green";
  if (hsv.h < 205) return "cyan";
  if (hsv.h < 255) return "blue";
  if (hsv.h < 300) return "purple";
  if (hsv.h < 345) return "magenta";
  return "red";
}

function collectVideos(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      collectVideos(full, acc);
      continue;
    }
    if (VIDEO_EXTENSIONS.has(path.extname(ent.name).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

function sampleVideoRgb(videoPath) {
  if (!ffmpegPath) return null;
  const frameBytes = ANALYSIS_SIZE * ANALYSIS_SIZE * 3;
  const proc = spawnSync(ffmpegPath, [
    "-v", "error",
    "-i", videoPath,
    "-vf", `fps=1/3,scale=${ANALYSIS_SIZE}:${ANALYSIS_SIZE}:flags=fast_bilinear,format=rgb24`,
    "-frames:v", String(SAMPLE_FRAMES),
    "-f", "rawvideo",
    "pipe:1"
  ], { encoding: null, maxBuffer: frameBytes * SAMPLE_FRAMES * 2 });
  if (proc.status !== 0 || !proc.stdout || proc.stdout.length < frameBytes) {
    return null;
  }
  const frames = Math.floor(proc.stdout.length / frameBytes);
  if (frames <= 0) return null;
  const merged = Buffer.alloc(frameBytes);
  for (let f = 0; f < frames; f++) {
    const off = f * frameBytes;
    for (let i = 0; i < frameBytes; i++) {
      merged[i] += proc.stdout[off + i];
    }
  }
  for (let i = 0; i < frameBytes; i++) {
    merged[i] = Math.round(merged[i] / frames);
  }
  return merged;
}

function familyScoresFromBuffer(buf) {
  const scores = new Map();
  FAMILY_ORDER.forEach((f) => scores.set(f, 0));
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const lum = (r + g + b) / 3;
    if (lum < 8) continue;
    const family = classifyRgbColorFamily(r, g, b);
    const hsv = rgbToHsv(r, g, b);
    const weight = (0.15 + hsv.s) * (0.2 + hsv.v);
    scores.set(family, (scores.get(family) || 0) + weight);
  }
  const total = [...scores.values()].reduce((a, b) => a + b, 0) || 1;
  return [...scores.entries()]
    .map(([name, score]) => ({ name, ratio: score / total }))
    .filter((row) => row.ratio > 0.02)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 4);
}

function findBestPointForFamily(buf, family) {
  let bestScore = -1;
  let bestX = 0;
  let bestY = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let hits = 0;
  for (let y = 0; y < ANALYSIS_SIZE; y++) {
    for (let x = 0; x < ANALYSIS_SIZE; x++) {
      const idx = (y * ANALYSIS_SIZE + x) * 3;
      const r = buf[idx];
      const g = buf[idx + 1];
      const b = buf[idx + 2];
      const fam = classifyRgbColorFamily(r, g, b);
      if (fam !== family) continue;
      const hsv = rgbToHsv(r, g, b);
      const score = (0.15 + hsv.s) * (0.2 + hsv.v);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
      sumR += r;
      sumG += g;
      sumB += b;
      hits += 1;
    }
  }
  if (bestScore < 0) return null;
  return {
    x: bestX,
    y: bestY,
    score: bestScore,
    avgRgb: hits > 0
      ? [Math.round(sumR / hits), Math.round(sumG / hits), Math.round(sumB / hits)]
      : [0, 0, 0]
  };
}

function extractCropBuffer(buf, cx, cy, size) {
  const half = Math.floor(size / 2);
  const crop = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.max(0, Math.min(ANALYSIS_SIZE - 1, cx - half + x));
      const sy = Math.max(0, Math.min(ANALYSIS_SIZE - 1, cy - half + y));
      const si = (sy * ANALYSIS_SIZE + sx) * 3;
      const di = (y * size + x) * 3;
      crop[di] = buf[si];
      crop[di + 1] = buf[si + 1];
      crop[di + 2] = buf[si + 2];
    }
  }
  return crop;
}

function writeJpegFromRgb(rgbBuf, width, height, outPath) {
  if (!ffmpegPath) return false;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const proc = spawnSync(ffmpegPath, [
    "-y",
    "-v", "error",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-s", `${width}x${height}`,
    "-i", "pipe:0",
    "-frames:v", "1",
    "-q:v", "3",
    outPath
  ], { input: rgbBuf });
  return proc.status === 0 && fs.existsSync(outPath);
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "cube";
}

function main() {
  if (!ffmpegPath) {
    console.error("ffmpeg-static not available");
    process.exit(1);
  }
  ensureDir(ARTIFACTS_DIR);
  ensureDir(CUBES_DIR);

  const videos = collectVideos(LOOPS_DIR).sort((a, b) => a.localeCompare(b));
  const slice = MAX_VIDEOS > 0 ? videos.slice(0, MAX_VIDEOS) : videos;
  const families = {};
  FAMILY_ORDER.forEach((f) => { families[f] = []; });

  let processed = 0;
  for (const absVideo of slice) {
    const rel = toPosix(path.relative(PROJECT_ROOT, absVideo));
    const rgb = sampleVideoRgb(absVideo);
    if (!rgb) continue;

    const ranked = familyScoresFromBuffer(rgb);
    if (ranked.length === 0) continue;

    for (const row of ranked.slice(0, 2)) {
      const family = row.name;
      if (families[family].length >= MAX_PER_FAMILY) continue;

      const hit = findBestPointForFamily(rgb, family);
      if (!hit || hit.score < 0.05) continue;

      const crop = extractCropBuffer(rgb, hit.x, hit.y, CUBE_SIZE);
      const base = slugify(path.basename(absVideo, path.extname(absVideo)));
      const fileName = `${base}-${processed}.jpg`;
      const outAbs = path.join(CUBES_DIR, family, fileName);
      if (!writeJpegFromRgb(crop, CUBE_SIZE, CUBE_SIZE, outAbs)) continue;

      families[family].push({
        sourceUrl: rel,
        cubeUrl: toPosix(path.relative(PROJECT_ROOT, outAbs)),
        avgRgb: hit.avgRgb,
        familyScore: Number(row.ratio.toFixed(4)),
        patchScore: Number(hit.score.toFixed(4))
      });
    }
    processed += 1;
    if (processed % 25 === 0) {
      console.log(`processed ${processed}/${slice.length} videos…`);
    }
  }

  const stats = {};
  FAMILY_ORDER.forEach((f) => { stats[f] = families[f].length; });

  const payload = {
    generatedAt: new Date().toISOString(),
    cubeSize: CUBE_SIZE,
    analysisSize: ANALYSIS_SIZE,
    familyOrder: FAMILY_ORDER,
    families,
    stats,
    videosScanned: processed
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: toPosix(path.relative(PROJECT_ROOT, OUTPUT_PATH)),
    videosScanned: processed,
    stats
  }, null, 2));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

main();
