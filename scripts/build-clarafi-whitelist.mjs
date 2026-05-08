import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { createWorker } from "tesseract.js";

const PROJECT_ROOT = process.cwd();
const CLARAFI_DIR = path.resolve(PROJECT_ROOT, process.env.CLARAFI_DIR || "loops/clarafi");
const OUTPUT_JSON = path.resolve(PROJECT_ROOT, process.env.OUTPUT_JSON || "sets/clarafi-clean-subclips.json");
const OUTPUT_MD = path.resolve(PROJECT_ROOT, process.env.OUTPUT_MD || "sets/clarafi-clean-subclips.md");
const MAX_SCAN_SEC = Number.parseFloat(process.env.WHITELIST_TEXT_SCAN_MAX_SEC || "60");
const STEP_SEC = Number.parseFloat(process.env.WHITELIST_TEXT_SCAN_STEP_SEC || "1.0");
const MIN_CLEAN_SEC = Number.parseFloat(process.env.WHITELIST_MIN_CLEAN_SEC || "8.0");
const TITLE_SKIP_SEC = Number.parseFloat(process.env.WHITELIST_TITLE_SKIP_SEC || "2.0");
const FRAME_CROP_FRACTIONS = String(process.env.WHITELIST_FRAME_CROP || "").trim();
const BANNED_NAME_PATTERNS = (process.env.WHITELIST_BANNED_NAME_PATTERNS || "introduction,hhmi,biointeractive,lecture")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
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
  return out.sort();
}

function getDurationSec(videoPath) {
  const probe = spawnSync(ffmpegPath, ["-i", videoPath], { encoding: "utf8" });
  const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
  const m = output.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return 0;
  return (Number.parseInt(m[1], 10) * 3600) + (Number.parseInt(m[2], 10) * 60) + Number.parseFloat(m[3]);
}

function extractFrame(videoPath, seekSec, outputPath) {
  const filters = ["scale=1280:-1"];
  if (FRAME_CROP_FRACTIONS) {
    const parts = FRAME_CROP_FRACTIONS.split(":").map((value) => Number.parseFloat(value));
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      const [x, y, w, h] = parts;
      const cx = Math.max(0, Math.min(1, x));
      const cy = Math.max(0, Math.min(1, y));
      const cw = Math.max(0.2, Math.min(1, w));
      const ch = Math.max(0.2, Math.min(1, h));
      const maxX = Math.max(0, 1 - cw);
      const maxY = Math.max(0, 1 - ch);
      const ox = Math.max(0, Math.min(maxX, cx));
      const oy = Math.max(0, Math.min(maxY, cy));
      filters.push(`crop=iw*${cw}:ih*${ch}:iw*${ox}:ih*${oy}`);
    }
  }
  const args = [
    "-y",
    "-ss",
    Math.max(0.05, seekSec).toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    filters.join(","),
    outputPath
  ];
  const res = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  return res.status === 0 && fs.existsSync(outputPath);
}

function looksLikeText(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  return words.length >= 2 || letters.length >= 8;
}

async function frameHasText(worker, framePath) {
  const cropFilters = [
    "scale=1280:-1",
    "scale=1280:-1,crop=iw:ih*0.35:0:0",
    "scale=1280:-1,crop=iw:ih*0.35:0:ih*0.65"
  ];
  for (let i = 0; i < cropFilters.length; i++) {
    const cropped = path.join(os.tmpdir(), `hypermuse-whitelist-crop-${process.pid}-${Date.now()}-${i}.png`);
    try {
      const r = spawnSync(ffmpegPath, ["-y", "-i", framePath, "-frames:v", "1", "-vf", cropFilters[i], cropped], { encoding: "utf8" });
      if (r.status !== 0 || !fs.existsSync(cropped)) {
        continue;
      }
      const ocr = await worker.recognize(cropped);
      if (looksLikeText(ocr?.data?.text)) {
        return true;
      }
    } catch {
      // ignore OCR crop failure
    } finally {
      if (fs.existsSync(cropped)) fs.unlinkSync(cropped);
    }
  }
  return false;
}

async function analyzeCleanWindow(worker, videoPath) {
  const durationSec = getDurationSec(videoPath);
  if (!Number.isFinite(durationSec) || durationSec <= 1) {
    return null;
  }

  const maxScan = Math.min(Math.max(4, MAX_SCAN_SEC), durationSec);
  const step = Math.max(0.6, STEP_SEC);
  const checks = [];
  for (let t = Math.max(0.4, TITLE_SKIP_SEC); t < maxScan; t += step) {
    checks.push(t);
  }

  if (checks.length === 0) return null;
  const observations = [];
  for (let i = 0; i < checks.length; i++) {
    const framePath = path.join(os.tmpdir(), `hypermuse-whitelist-frame-${process.pid}-${Date.now()}-${i}.png`);
    try {
      const ok = extractFrame(videoPath, checks[i], framePath);
      if (!ok) {
        observations.push({ t: checks[i], hasText: false });
        continue;
      }
      const hasText = await frameHasText(worker, framePath);
      observations.push({ t: checks[i], hasText });
    } finally {
      if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
    }
  }

  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i < observations.length; i++) {
    if (!observations[i].hasText) {
      if (runStart < 0) runStart = i;
      const len = i - runStart + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }

  if (bestStart < 0) return null;
  const cleanSec = bestLen * step;
  if (cleanSec < MIN_CLEAN_SEC) return null;

  const startSec = Math.max(0, observations[bestStart].t - (step * 0.2));
  const endIdx = Math.min(observations.length - 1, bestStart + bestLen - 1);
  const endSec = Math.min(durationSec, observations[endIdx].t + (step * 0.8));
  if (endSec - startSec < MIN_CLEAN_SEC) return null;

  const guardPoints = [
    startSec + 0.4,
    startSec + ((endSec - startSec) * 0.5),
    Math.max(startSec + 0.8, endSec - 0.4)
  ].filter((value, idx, arr) => Number.isFinite(value) && value < durationSec && arr.indexOf(value) === idx);

  for (let i = 0; i < guardPoints.length; i++) {
    const guardFrame = path.join(os.tmpdir(), `hypermuse-whitelist-guard-${process.pid}-${Date.now()}-${i}.png`);
    try {
      const ok = extractFrame(videoPath, guardPoints[i], guardFrame);
      if (!ok) continue;
      const hasText = await frameHasText(worker, guardFrame);
      if (hasText) return null;
    } finally {
      if (fs.existsSync(guardFrame)) fs.unlinkSync(guardFrame);
    }
  }

  return {
    clipStartSec: Number(startSec.toFixed(2)),
    clipEndSec: Number(endSec.toFixed(2)),
    cleanDurationSec: Number((endSec - startSec).toFixed(2)),
    durationSec: Number(durationSec.toFixed(2))
  };
}

async function main() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is unavailable.");
  }
  const videos = collectVideosRecursive(CLARAFI_DIR);
  if (videos.length === 0) {
    throw new Error(`No videos found in ${toPosix(path.relative(PROJECT_ROOT, CLARAFI_DIR))}`);
  }

  const worker = await createWorker("eng");
  const whitelist = [];
  const rejected = [];
  try {
    for (const abs of videos) {
      const loweredName = path.basename(abs).toLowerCase();
      if (BANNED_NAME_PATTERNS.some((pattern) => loweredName.includes(pattern))) {
        rejected.push(path.basename(abs));
        continue;
      }
      const analysis = await analyzeCleanWindow(worker, abs);
      if (!analysis) {
        rejected.push(path.basename(abs));
        continue;
      }
      whitelist.push({
        url: toPosix(path.relative(PROJECT_ROOT, abs)),
        label: path.basename(abs),
        ...analysis
      });
    }
  } finally {
    await worker.terminate();
  }

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDirectory: toPosix(path.relative(PROJECT_ROOT, CLARAFI_DIR)),
    scanConfig: {
      maxScanSec: MAX_SCAN_SEC,
      stepSec: STEP_SEC,
      minCleanSec: MIN_CLEAN_SEC,
      titleSkipSec: TITLE_SKIP_SEC
    },
    totalVideosScanned: videos.length,
    acceptedCount: whitelist.length,
    rejectedCount: rejected.length,
    whitelist
  };
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2) + "\n");

  const md = [
    "# Clarafi Clean Subclip Whitelist",
    "",
    `- Generated: ${payload.generatedAt}`,
    `- Source: \`${payload.sourceDirectory}\``,
    `- Scanned: ${payload.totalVideosScanned}`,
    `- Accepted: ${payload.acceptedCount}`,
    `- Rejected: ${payload.rejectedCount}`,
    "",
    "| Clip | Start (s) | End (s) | Clean Dur (s) |",
    "|---|---:|---:|---:|",
    ...whitelist.map((row) => `| ${row.label} | ${row.clipStartSec} | ${row.clipEndSec} | ${row.cleanDurationSec} |`)
  ].join("\n");
  fs.writeFileSync(OUTPUT_MD, md + "\n");

  console.log(`Wrote ${toPosix(path.relative(PROJECT_ROOT, OUTPUT_JSON))}`);
  console.log(`Wrote ${toPosix(path.relative(PROJECT_ROOT, OUTPUT_MD))}`);
  console.log(`Accepted ${whitelist.length} / ${videos.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

