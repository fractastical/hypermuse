import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { createWorker } from "tesseract.js";

const PROJECT_ROOT = process.cwd();
const OUTPUT_PATH = process.argv[2] || "sets/mix-bio1-clarafi-other-303040-clean.json";
const TARGET_COUNT = Number.parseInt(process.env.MIX_TARGET_COUNT || "20", 10);
const BIO_RATIO = Number.parseFloat(process.env.MIX_BIO_RATIO || "0.3");
const CLARAFI_RATIO = Number.parseFloat(process.env.MIX_CLARAFI_RATIO || "0.3");
const OTHER_RATIO = Number.parseFloat(process.env.MIX_OTHER_RATIO || "0.4");
const ENABLE_TEXT_FILTER = process.env.MIX_FILTER_TEXT !== "0";
const MAX_CLARAFI_SCAN = Number.parseInt(process.env.MIX_MAX_CLARAFI_SCAN || "80", 10);
const TEXT_SCAN_STEP_SEC = Number.parseFloat(process.env.MIX_TEXT_SCAN_STEP_SEC || "1.0");
const MAX_TEXT_SCAN_SEC = Number.parseFloat(process.env.MIX_TEXT_SCAN_MAX_SEC || "75");
const MIN_TEXT_FREE_SEC = Number.parseFloat(process.env.MIX_MIN_TEXT_FREE_SEC || "8.0");
const TITLE_CARD_SKIP_SEC = Number.parseFloat(process.env.MIX_TITLE_CARD_SKIP_SEC || "2.0");
const ALLOW_UNVETTED_CLARAFI_FALLBACK = process.env.MIX_ALLOW_UNVETTED_CLARAFI_FALLBACK === "1";
const LEFT_TEXT_SAFE_FRACTION = Number.parseFloat(process.env.MIX_LEFT_TEXT_SAFE_FRACTION || "0.2");
const BOTTOM_TEXT_SAFE_FRACTION = Number.parseFloat(process.env.MIX_BOTTOM_TEXT_SAFE_FRACTION || "0.2");
const BANNED_NAME_PATTERNS = (process.env.MIX_BANNED_NAME_PATTERNS || "introduction,hhmi,biointeractive,lecture")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const BIO_DIR = process.env.MIX_BIO_DIR || "loops/bio1";
const CLARAFI_DIR = process.env.MIX_CLARAFI_DIR || "loops/clarafi";
const OTHER_DIRS = (process.env.MIX_OTHER_DIRS || "loops/reactions/cell-image-library,loops/reactions/nikon-smallworld,loops/Nikon Vj Loops Cellular,loops/morpholib,loops/Artbeats-OceanWaterEffects,loops/Artbeats-TimelapseFlowers3,loops/Artbeats-TimelapsePlants,loops/Artbeats-WaterEffects2")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const BASE_MANIFEST_PATH = process.env.MIX_BASE_MANIFEST || "sets/bio1.json";
const CLARAFI_WHITELIST_PATH = process.env.MIX_CLARAFI_WHITELIST || "sets/clarafi-clean-subclips.json";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function collectVideosRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const out = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectVideosRecursive(full));
      continue;
    }
    if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function getDurationSec(videoPath) {
  if (!ffmpegPath) return 0;
  const inspect = spawnSync(ffmpegPath, ["-i", videoPath], { encoding: "utf8" });
  const output = `${inspect.stdout || ""}\n${inspect.stderr || ""}`;
  const m = output.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return 0;
  return (Number.parseInt(m[1], 10) * 3600) + (Number.parseInt(m[2], 10) * 60) + Number.parseFloat(m[3]);
}

function extractFrame(videoPath, seekSec, outputPng) {
  if (!ffmpegPath) return false;
  const seek = Math.max(0.05, seekSec || 0.5).toFixed(3);
  const args = [
    "-y",
    "-ss",
    seek,
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=1280:-1",
    outputPng
  ];
  const result = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  return result.status === 0 && fs.existsSync(outputPng);
}

function looksLikeText(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  return words.length >= 2 || letters.length >= 8;
}

function getTextRegionSummary(ocrResult) {
  const data = ocrResult?.data || {};
  const words = Array.isArray(data.words) ? data.words : [];
  const candidates = words.filter((word) => looksLikeText(word?.text || ""));
  if (candidates.length === 0) {
    return { hasText: false, onlyInSafeZones: true };
  }

  const maxX = candidates.reduce((acc, word) => Math.max(acc, Number(word?.bbox?.x1 || 0)), 0);
  const maxY = candidates.reduce((acc, word) => Math.max(acc, Number(word?.bbox?.y1 || 0)), 0);
  const frameWidth = Number(data?.imageSize?.width || data?.imageWidth || maxX || 1);
  const frameHeight = Number(data?.imageSize?.height || data?.imageHeight || maxY || 1);
  const leftBoundary = frameWidth * Math.max(0, Math.min(0.45, LEFT_TEXT_SAFE_FRACTION));
  const bottomBoundary = frameHeight * (1 - Math.max(0, Math.min(0.45, BOTTOM_TEXT_SAFE_FRACTION)));

  const onlyInSafeZones = candidates.every((word) => {
    const x0 = Number(word?.bbox?.x0 || 0);
    const x1 = Number(word?.bbox?.x1 || 0);
    const y0 = Number(word?.bbox?.y0 || 0);
    const y1 = Number(word?.bbox?.y1 || 0);
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    return cx <= leftBoundary || cy >= bottomBoundary;
  });

  return { hasText: true, onlyInSafeZones };
}

function ocrHasLikelyText(worker, imagePath) {
  return worker.recognize(imagePath).then((result) => {
    return getTextRegionSummary(result);
  }).catch(() => ({ hasText: false, onlyInSafeZones: true }));
}

async function frameHasText(worker, framePath) {
  return ocrHasLikelyText(worker, framePath);
}

async function analyzeVideoTextWindow(worker, videoPath) {
  const duration = getDurationSec(videoPath);
  if (!Number.isFinite(duration) || duration <= 0.5) {
    return { rejected: false, hasText: false, clipStartSec: null, clipEndSec: null };
  }
  const maxScan = Math.min(Math.max(4, MAX_TEXT_SCAN_SEC), duration);
  const step = Math.max(0.6, TEXT_SCAN_STEP_SEC);
  const checks = [];
  for (let t = Math.max(0.4, TITLE_CARD_SKIP_SEC); t < maxScan; t += step) {
    checks.push(t);
  }
  const observations = [];
  for (let i = 0; i < checks.length; i++) {
    const tmp = path.join(os.tmpdir(), `hypermuse-ocr-${process.pid}-${Date.now()}-${i}.png`);
    try {
      const ok = extractFrame(videoPath, checks[i], tmp);
      if (!ok) {
        observations.push({ t: checks[i], hasText: false });
        continue;
      }
      const frameText = await frameHasText(worker, tmp);
      observations.push({
        t: checks[i],
        hasText: !!frameText.hasText,
        onlyInSafeZones: !!frameText.onlyInSafeZones
      });
    } catch {
      // Ignore individual OCR failures.
      observations.push({ t: checks[i], hasText: false });
    } finally {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
    }
  }
  if (observations.length === 0) {
    return { rejected: false, hasText: false, clipStartSec: null, clipEndSec: null };
  }

  const hasText = observations.some((entry) => entry.hasText);
  const hasUnsafeText = observations.some((entry) => entry.hasText && !entry.onlyInSafeZones);
  const hasSafeZoneText = observations.some((entry) => entry.hasText && entry.onlyInSafeZones);
  if (!hasText) {
    return { rejected: false, hasText: false, cropNeeded: false, clipStartSec: null, clipEndSec: null };
  }

  let bestStartIdx = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i < observations.length; i++) {
    const blocked = observations[i].hasText && !observations[i].onlyInSafeZones;
    if (!blocked) {
      if (runStart < 0) {
        runStart = i;
      }
      const len = i - runStart + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStartIdx = runStart;
      }
    } else {
      runStart = -1;
    }
  }

  const bestSec = bestLen * step;
  if (bestStartIdx < 0 || bestSec < MIN_TEXT_FREE_SEC) {
    return { rejected: true, hasText: true, clipStartSec: null, clipEndSec: null };
  }
  const start = Math.max(0, observations[bestStartIdx].t - (step * 0.2));
  const endIdx = Math.min(observations.length - 1, bestStartIdx + bestLen - 1);
  const end = Math.min(duration, observations[endIdx].t + (step * 0.8));
  // Final guard: verify start/mid/end of selected window are text-free.
  const guardPoints = [
    start + 0.4,
    start + ((end - start) * 0.5),
    Math.max(start + 0.8, end - 0.4)
  ].filter((value, idx, arr) => Number.isFinite(value) && value < duration && arr.indexOf(value) === idx);
  for (let i = 0; i < guardPoints.length; i++) {
    const tmp = path.join(os.tmpdir(), `hypermuse-ocr-guard-${process.pid}-${Date.now()}-${i}.png`);
    try {
      const ok = extractFrame(videoPath, guardPoints[i], tmp);
      if (!ok) continue;
      const frameText = await frameHasText(worker, tmp);
      if (frameText.hasText && !frameText.onlyInSafeZones) {
        return { rejected: true, hasText: true, clipStartSec: null, clipEndSec: null };
      }
    } finally {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
    }
  }
  return {
    rejected: false,
    hasText: hasText || hasUnsafeText,
    cropNeeded: hasSafeZoneText || !hasUnsafeText,
    clipStartSec: start,
    clipEndSec: end
  };
}

function interleaveBuckets(buckets, maxCount) {
  const out = [];
  for (let i = 0; out.length < maxCount; i++) {
    let pushed = false;
    for (const bucket of buckets) {
      if (i < bucket.length) {
        out.push(bucket[i]);
        pushed = true;
        if (out.length >= maxCount) break;
      }
    }
    if (!pushed) break;
  }
  return out.slice(0, maxCount);
}

function loadClarafiWhitelist() {
  const abs = path.resolve(PROJECT_ROOT, CLARAFI_WHITELIST_PATH);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
    const rows = Array.isArray(parsed?.whitelist) ? parsed.whitelist : [];
    const byUrl = new Map();
    for (const row of rows) {
      if (!row?.url) continue;
      const clipStartSec = Number(row.clipStartSec);
      const clipEndSec = Number(row.clipEndSec);
      byUrl.set(path.resolve(PROJECT_ROOT, row.url), {
        clipStartSec: Number.isFinite(clipStartSec) ? clipStartSec : undefined,
        clipEndSec: Number.isFinite(clipEndSec) ? clipEndSec : undefined
      });
    }
    return { byUrl, rawCount: rows.length };
  } catch {
    return null;
  }
}

async function main() {
  const targetCount = Math.max(3, TARGET_COUNT);
  const bioTarget = Math.max(0, Math.round(targetCount * BIO_RATIO));
  const clarafiTarget = Math.max(0, Math.round(targetCount * CLARAFI_RATIO));
  const otherTarget = Math.max(0, targetCount - bioTarget - clarafiTarget);

  const bioPool = collectVideosRecursive(path.join(PROJECT_ROOT, BIO_DIR)).sort();
  const clarafiPool = collectVideosRecursive(path.join(PROJECT_ROOT, CLARAFI_DIR)).sort();
  const otherPoolsByDir = OTHER_DIRS.map((dir) => collectVideosRecursive(path.join(PROJECT_ROOT, dir)).sort());
  const otherPool = otherPoolsByDir.flat().sort();
  const clarafiWhitelist = loadClarafiWhitelist();
  const clarafiWhitelistMap = clarafiWhitelist?.byUrl || null;

  const clarafiEligiblePool = clarafiWhitelistMap
    ? clarafiPool.filter((videoPath) => clarafiWhitelistMap.has(path.resolve(videoPath)))
    : clarafiPool;

  const bioSelected = bioPool.slice(0, bioTarget);
  let clarafiSelected = [];
  const clarafiRejected = [];
  const clarafiWindows = new Map();

  if (ENABLE_TEXT_FILTER && clarafiTarget > 0 && clarafiEligiblePool.length > 0) {
    const worker = await createWorker("eng");
    try {
      for (let i = 0; i < clarafiEligiblePool.length && clarafiSelected.length < clarafiTarget && i < MAX_CLARAFI_SCAN; i++) {
        const file = clarafiEligiblePool[i];
        const loweredName = path.basename(file).toLowerCase();
        if (BANNED_NAME_PATTERNS.some((pattern) => loweredName.includes(pattern))) {
          clarafiRejected.push(file);
          continue;
        }
        const analysis = await analyzeVideoTextWindow(worker, file);
        if (analysis.rejected) {
          clarafiRejected.push(file);
        } else {
          clarafiSelected.push(file);
          const whitelistWindow = clarafiWhitelistMap?.get(path.resolve(file));
          clarafiWindows.set(file, {
            clipStartSec: Number.isFinite(whitelistWindow?.clipStartSec) ? whitelistWindow.clipStartSec : analysis.clipStartSec,
            clipEndSec: Number.isFinite(whitelistWindow?.clipEndSec) ? whitelistWindow.clipEndSec : analysis.clipEndSec
          });
        }
      }
    } finally {
      await worker.terminate();
    }
  } else {
    clarafiSelected = clarafiEligiblePool.slice(0, clarafiTarget);
    for (const file of clarafiSelected) {
      const whitelistWindow = clarafiWhitelistMap?.get(path.resolve(file));
      if (whitelistWindow) {
        clarafiWindows.set(file, whitelistWindow);
      }
    }
  }

  // Do not backfill Clarafi with unscanned/unvetted clips when text filtering is enabled.
  // If we cannot find enough clean Clarafi clips, we intentionally underfill this bucket and
  // let fallback composition come from other pools.

  const otherSelected = interleaveBuckets(otherPoolsByDir, otherTarget);
  let loopsAbs = interleaveBuckets([bioSelected, clarafiSelected, otherSelected], targetCount);

  if (loopsAbs.length < targetCount) {
    const used = new Set(loopsAbs);
    const fallbackClarafiPool = clarafiEligiblePool;
    const fallbackPools = ENABLE_TEXT_FILTER && !ALLOW_UNVETTED_CLARAFI_FALLBACK
      ? [...bioPool, ...otherPool]
      : [...bioPool, ...fallbackClarafiPool, ...otherPool];
    const fallback = fallbackPools.filter((video) => !used.has(video));
    loopsAbs = loopsAbs.concat(fallback.slice(0, targetCount - loopsAbs.length));
  }

  const baseManifest = JSON.parse(fs.readFileSync(path.resolve(PROJECT_ROOT, BASE_MANIFEST_PATH), "utf8"));
  const defaultTransition = baseManifest.defaultTransition || { type: "fade", durationMs: 900, holdMs: 8000 };
  const loops = loopsAbs.map((absPath) => ({
    url: toPosix(path.relative(PROJECT_ROOT, absPath)),
    label: path.basename(absPath),
    transition: (() => {
      const windowData = clarafiWindows.get(absPath);
      const isClarafi = toPosix(path.relative(PROJECT_ROOT, absPath)).startsWith(`${toPosix(CLARAFI_DIR)}/`);
      const cropForSafeZones = !!windowData?.cropNeeded;
      return {
      type: defaultTransition.type || "fade",
      durationMs: Number.isFinite(defaultTransition.durationMs) ? defaultTransition.durationMs : 900,
      holdMs: Number.isFinite(defaultTransition.holdMs) ? defaultTransition.holdMs : 8000,
      clipStartSec: Number.isFinite(windowData?.clipStartSec) ? windowData.clipStartSec : undefined,
      clipEndSec: Number.isFinite(windowData?.clipEndSec) ? windowData.clipEndSec : undefined,
      crop: (isClarafi && cropForSafeZones) ? { x: 0.2, y: 0.2, width: 0.8, height: 0.8 } : undefined,
      holdLastFrameOnClipEnd: true
    };
    })()
  }));

  const manifest = {
    ...baseManifest,
    setName: "mix-bio1-clarafi-other-303040-clean",
    sourceDirectory: "loops",
    sourceDirectories: [BIO_DIR, CLARAFI_DIR, ...OTHER_DIRS].map((d) => toPosix(d)),
    generatedAt: new Date().toISOString(),
    count: loops.length,
    loops
  };

  const outputAbs = path.resolve(PROJECT_ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, JSON.stringify(manifest, null, 2) + "\n");

  const counts = { bio1: 0, clarafi: 0, other: 0 };
  for (const loop of loops) {
    if (loop.url.startsWith(`${toPosix(BIO_DIR)}/`)) counts.bio1++;
    else if (loop.url.startsWith(`${toPosix(CLARAFI_DIR)}/`)) counts.clarafi++;
    else counts.other++;
  }
  console.log(`Wrote ${toPosix(path.relative(PROJECT_ROOT, outputAbs))}`);
  console.log(`Mix counts: ${JSON.stringify(counts)}`);
  if (ENABLE_TEXT_FILTER) {
    console.log(`Clarafi OCR filtered out: ${clarafiRejected.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

