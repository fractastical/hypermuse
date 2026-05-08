import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const LOOPS_DIR = path.join(PROJECT_ROOT, process.env.COLOR_DATASET_LOOPS_DIR || "loops");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const OUTPUT_PATH = path.join(ARTIFACTS_DIR, process.env.COLOR_DATASET_OUTPUT || "color-dataset.json");
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hypermuse-colors-"));
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);
const SAMPLES_PER_FRAME = Math.max(16, Number.parseInt(process.env.COLOR_SAMPLES_PER_FRAME || "100", 10));
const SAMPLE_GRID_SIZE = Math.max(4, Math.round(Math.sqrt(SAMPLES_PER_FRAME)));
const FRAME_WIDTH = Math.max(4, Number.parseInt(process.env.COLOR_FRAME_WIDTH || String(SAMPLE_GRID_SIZE), 10));
const FRAME_HEIGHT = Math.max(4, Number.parseInt(process.env.COLOR_FRAME_HEIGHT || String(SAMPLE_GRID_SIZE), 10));
const SAMPLE_FRAMES = Math.max(2, Number.parseInt(process.env.COLOR_SAMPLE_FRAMES || "10", 10));
const SAMPLE_FPS = process.env.COLOR_SAMPLE_FPS || "1/4";
const INCLUDE_EFFECTS = process.env.COLOR_INCLUDE_EFFECTS !== "0";
const EFFECT_LAYOUTS = (process.env.COLOR_EFFECT_LAYOUTS || "spheres,thirds-2d")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const EFFECT_PROFILES = [
  "classic",
  "life",
  "hierarchical-life",
  "kuramoto",
  "gray-scott",
  "physarum",
  "molecule",
  "rewrite",
  "word-cloud",
  "stacked"
];
const EFFECT_COLOR_SEEDS = {
  classic: [[140, 255, 168], [185, 255, 210], [160, 238, 255]],
  life: [[110, 255, 150], [164, 255, 188], [148, 230, 255]],
  "hierarchical-life": [[136, 232, 255], [182, 242, 220], [152, 220, 255]],
  kuramoto: [[78, 232, 255], [255, 132, 242], [176, 255, 208]],
  "gray-scott": [[64, 238, 255], [154, 255, 84], [255, 88, 216], [255, 222, 74], [88, 146, 255]],
  physarum: [[132, 255, 196], [196, 236, 255], [255, 206, 168], [228, 188, 255]],
  molecule: [[245, 255, 246], [200, 248, 216], [168, 232, 250]],
  rewrite: [[252, 255, 246], [186, 244, 222], [146, 220, 255]],
  "word-cloud": [[126, 255, 182], [188, 248, 230], [160, 226, 255]],
  stacked: [[120, 250, 158], [108, 245, 184], [206, 255, 222], [172, 240, 255]]
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function collectVideosRecursive(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectVideosRecursive(fullPath, acc);
      continue;
    }
    if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      acc.push(fullPath);
    }
  }
  return acc;
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
  const s = max === 0 ? 0 : (delta / max);
  const v = max;
  return { h, s, v };
}

function hueFamily(hue, saturation, value) {
  if (value < 0.14) return "black";
  if (saturation < 0.16 && value > 0.78) return "white";
  if (saturation < 0.16) return "gray";
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 160) return "green";
  if (hue < 205) return "cyan";
  if (hue < 255) return "blue";
  if (hue < 300) return "purple";
  if (hue < 345) return "magenta";
  return "red";
}

function dominantFamiliesFromRaw(rawBuffer) {
  const familyScores = new Map();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < rawBuffer.length; i += 3) {
    const r = rawBuffer[i];
    const g = rawBuffer[i + 1];
    const b = rawBuffer[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    count += 1;
    const hsv = rgbToHsv(r, g, b);
    const family = hueFamily(hsv.h, hsv.s, hsv.v);
    const weight = (0.15 + hsv.s) * (0.2 + hsv.v);
    familyScores.set(family, (familyScores.get(family) || 0) + weight);
  }
  const ranked = [...familyScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, score]) => ({ name, score }));
  const totalScore = ranked.reduce((sum, item) => sum + item.score, 0) || 1;
  const topFamilies = ranked.slice(0, 4).map((item) => ({
    name: item.name,
    ratio: Number((item.score / totalScore).toFixed(4))
  }));
  return {
    topFamilies,
    avgRgb: [
      Math.round(sumR / Math.max(1, count)),
      Math.round(sumG / Math.max(1, count)),
      Math.round(sumB / Math.max(1, count))
    ]
  };
}

function analyzeVideoColors(videoPath) {
  const frameBytes = FRAME_WIDTH * FRAME_HEIGHT * 3;
  const ffmpegArgs = [
    "-v", "error",
    "-i", videoPath,
    "-vf", `fps=${SAMPLE_FPS},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=fast_bilinear,format=rgb24`,
    "-frames:v", String(SAMPLE_FRAMES),
    "-f", "rawvideo",
    "pipe:1"
  ];
  const proc = spawnSync(ffmpegPath, ffmpegArgs, {
    encoding: null,
    maxBuffer: Math.max(1024 * 1024 * 24, frameBytes * SAMPLE_FRAMES * 2)
  });
  if (proc.status !== 0 || !proc.stdout || proc.stdout.length < frameBytes) {
    return null;
  }
  const detectedFrames = Math.floor(proc.stdout.length / frameBytes);
  if (detectedFrames <= 0) return null;
  const trimmed = proc.stdout.subarray(0, detectedFrames * frameBytes);
  const analysis = dominantFamiliesFromRaw(trimmed);
  return {
    ...analysis,
    framesAnalyzed: detectedFrames
  };
}

function buildCompositeTags(topFamilies) {
  if (!Array.isArray(topFamilies) || topFamilies.length === 0) return [];
  const primary = topFamilies[0]?.name;
  const secondary = topFamilies[1]?.name;
  const tags = [];
  if (primary) tags.push(primary);
  if (primary && secondary && primary !== secondary) {
    tags.push(`${primary}-${secondary}`);
  }
  return tags;
}

function summarizeByTag(items) {
  const index = {};
  for (const item of items) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    for (const tag of tags) {
      if (!index[tag]) index[tag] = [];
      index[tag].push(item.id);
    }
  }
  return index;
}

function analyzeRgbPalette(colors) {
  const familyScores = new Map();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (const color of colors) {
    if (!Array.isArray(color) || color.length < 3) continue;
    const r = Math.max(0, Math.min(255, Number(color[0]) || 0));
    const g = Math.max(0, Math.min(255, Number(color[1]) || 0));
    const b = Math.max(0, Math.min(255, Number(color[2]) || 0));
    sumR += r;
    sumG += g;
    sumB += b;
    count += 1;
    const hsv = rgbToHsv(r, g, b);
    const family = hueFamily(hsv.h, hsv.s, hsv.v);
    const weight = (0.15 + hsv.s) * (0.2 + hsv.v);
    familyScores.set(family, (familyScores.get(family) || 0) + weight);
  }
  const ranked = [...familyScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, score]) => ({ name, score }));
  const totalScore = ranked.reduce((sum, item) => sum + item.score, 0) || 1;
  return {
    topFamilies: ranked.slice(0, 4).map((item) => ({
      name: item.name,
      ratio: Number((item.score / totalScore).toFixed(4))
    })),
    avgRgb: [
      Math.round(sumR / Math.max(1, count)),
      Math.round(sumG / Math.max(1, count)),
      Math.round(sumB / Math.max(1, count))
    ]
  };
}

async function main() {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not available");
  ensureDir(ARTIFACTS_DIR);
  const videos = collectVideosRecursive(LOOPS_DIR).sort();
  const items = [];

  for (let i = 0; i < videos.length; i++) {
    const fullPath = videos[i];
    const relativePath = path.relative(PROJECT_ROOT, fullPath);
    const colorInfo = analyzeVideoColors(fullPath);
    if (!colorInfo) continue;
    items.push({
      id: `video:${relativePath}`,
      type: "video",
      path: relativePath,
      topFamilies: colorInfo.topFamilies,
      avgRgb: colorInfo.avgRgb,
      framesAnalyzed: colorInfo.framesAnalyzed,
      tags: buildCompositeTags(colorInfo.topFamilies)
    });
  }

  if (INCLUDE_EFFECTS) {
    for (const layout of EFFECT_LAYOUTS) {
      for (const effect of EFFECT_PROFILES) {
        const seedPalette = EFFECT_COLOR_SEEDS[effect] || EFFECT_COLOR_SEEDS.classic;
        const colorInfo = analyzeRgbPalette(seedPalette);
        if (!colorInfo) continue;
        items.push({
          id: `effect:${effect}:${layout}`,
          type: "effect",
          effect,
          layout,
          source: "palette-seed",
          topFamilies: colorInfo.topFamilies,
          avgRgb: colorInfo.avgRgb,
          framesAnalyzed: seedPalette.length,
          tags: buildCompositeTags(colorInfo.topFamilies)
        });
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sampleConfig: {
      samplesPerFrame: FRAME_WIDTH * FRAME_HEIGHT,
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
      sampleFrames: SAMPLE_FRAMES,
      sampleFps: SAMPLE_FPS,
      includeEffects: INCLUDE_EFFECTS
    },
    counts: {
      total: items.length,
      videos: items.filter((i) => i.type === "video").length,
      effects: items.filter((i) => i.type === "effect").length
    },
    tagIndex: summarizeByTag(items),
    items
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: path.relative(PROJECT_ROOT, OUTPUT_PATH),
    counts: payload.counts,
    tags: Object.keys(payload.tagIndex).length,
    tmpDir: TMP_DIR
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
