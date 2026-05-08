import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import { PDFDocument } from "pdf-lib";

if (process.env.DJ_FAST_PDF === "1") {
  if (process.env.DJ_INFINITESTREAMS_SNAPSHOTS === undefined) {
    process.env.DJ_INFINITESTREAMS_SNAPSHOTS = "0";
  }
  if (process.env.DJ_INFINITESTREAMS_MAX === undefined) {
    process.env.DJ_INFINITESTREAMS_MAX = "16";
  }
  if (process.env.DJ_EFFECT_LAYOUTS === undefined) {
    process.env.DJ_EFFECT_LAYOUTS = "spheres";
  }
  if (process.env.DJ_EFFECT_CAPTURE_MS === undefined) {
    process.env.DJ_EFFECT_CAPTURE_MS = "7500";
  }
}

function infinitestreamsSnapshotsEnabled() {
  return process.env.DJ_INFINITESTREAMS_SNAPSHOTS === "1";
}

const PROJECT_ROOT = process.cwd();
const LOOPS_DIR = path.join(PROJECT_ROOT, process.env.DJ_LOOPS_DIR || "loops");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hypermuse-djpdf-"));
const OUTPUT_PDF = path.join(ARTIFACTS_DIR, process.env.DJ_OUTPUT_PDF || "dj-options-deck.pdf");
const MAIN_PDF_OUTPUT = path.join(ARTIFACTS_DIR, process.env.DJ_MAIN_PDF || "dj-options-deck-main.pdf");
const APPENDIX_PDF_OUTPUT = path.join(ARTIFACTS_DIR, process.env.DJ_APPENDIX_PDF || "dj-options-deck-appendix.pdf");
const APPENDIX_ONLY = process.env.DJ_APPENDIX_ONLY === "1";
const MAIN_PDF_INPUT = process.env.DJ_MAIN_PDF_INPUT
  ? path.resolve(PROJECT_ROOT, process.env.DJ_MAIN_PDF_INPUT)
  : MAIN_PDF_OUTPUT;
const CACHE_DIR = path.join(ARTIFACTS_DIR, "dj-pdf-cache");
const CACHE_FRAMES_DIR = path.join(CACHE_DIR, "frames");
const CACHE_META_PATH = path.join(CACHE_DIR, "metadata.json");
const DURATION_CACHE_PATH = path.join(CACHE_DIR, "durations.json");
const COLOR_DATASET_PATH = path.join(ARTIFACTS_DIR, "color-dataset.json");
const FORCE_RECAPTURE = process.env.DJ_FORCE_RECAPTURE === "1";
const ROWS_PER_SLIDE = Math.max(4, Number.parseInt(process.env.DJ_ROWS_PER_SLIDE || "8", 10));
const MAX_VIDEOS_PER_FOLDER = Math.max(1, Number.parseInt(process.env.DJ_VIDEOS_PER_FOLDER || "16", 10));
const FRAME_FRACTIONS = [0.12, 0.38, 0.62, 0.86];
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);
const EXCLUDE_FOLDER_NAMES = new Set(
  (process.env.DJ_EXCLUDE_FOLDERS || "prepped")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const EFFECT_LAYOUTS = (process.env.DJ_EFFECT_LAYOUTS || "spheres,thirds-2d")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const EFFECT_PROFILES_ALL = [
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
const EFFECT_PROFILES = (() => {
  const raw = String(process.env.DJ_EFFECT_PROFILES || "").trim();
  if (!raw) {
    return EFFECT_PROFILES_ALL;
  }
  const requested = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(EFFECT_PROFILES_ALL);
  const resolved = requested.filter((name) => allowed.has(name));
  if (resolved.length === 0) {
    console.warn("[dj-pdf] DJ_EFFECT_PROFILES had no valid names; using full set.");
    return EFFECT_PROFILES_ALL;
  }
  return resolved;
})();
const INFINITESTREAMS_VJ_URLS = [
  {
    label: "OBS Browser Source (single sketch, no UI)",
    url: "https://infinitestreams.io/?artist=Snow&sketch=Arc+Noise&controls=0&fullscreen=1&cycle=0"
  },
  {
    label: "Auto-cycling showcase (every 8s, no UI)",
    url: "https://infinitestreams.io/?controls=0&cycle=8&size=1080"
  },
  {
    label: "Single artist cycle",
    url: "https://infinitestreams.io/?artist=Snow&controls=0&cycle=8&fullscreen=1"
  }
];
const INFINITESTREAMS_FALLBACK_SKETCH_PATHS = [
  "yuruyurau/dots",
  "yuruyurau/waves",
  "yuruyurau/magnets",
  "yuruyurau/orbits",
  "yuruyurau/shear",
  "yuruyurau/pulse",
  "yuruyurau/flow1",
  "yuruyurau/flow2",
  "snow/lines",
  "snow/grid",
  "snow/spiral",
  "snow/spiralLines",
  "snow/rotatingPattern",
  "snow/rotatingBlobs",
  "snow/rotatingRects",
  "snow/rotatingSquares",
  "snow/rotatingStars",
  "snow/noiseColumns",
  "snow/noiseBlobs",
  "snow/noiseCircles",
  "snow/noiseCircles4",
  "snow/noiseCircles5",
  "snow/pieArcs",
  "snow/pieArcs3",
  "snow/circles",
  "snow/colorLines",
  "snow/morphingShapes",
  "snow/musicalExplosions",
  "snow/waveEllipses"
];
const KEY_FILES_FOR_EFFECT_CACHE = [
  path.join(PROJECT_ROOT, "sonicsphere.html"),
  path.join(PROJECT_ROOT, "scripts", "generate-sample-video.mjs")
];
function getFolderClass(folderName) {
  const normalized = String(folderName || "").toLowerCase();
  if (normalized.includes("bio")) return "bio";
  if (normalized.includes("reaction")) return "reaction";
  return "other";
}

function getFolderClassPriority(folderName) {
  const folderClass = getFolderClass(folderName);
  if (folderClass === "bio") return 0;
  if (folderClass === "reaction") return 1;
  return 2;
}

function getCellsPriority(folderName) {
  const n = String(folderName || "").trim().toLowerCase();
  if (n === "cells1") return 0;
  if (n === "cells2") return 1;
  return 10;
}

function compareFolderOrder(a, b) {
  const ca = getCellsPriority(a.name);
  const cb = getCellsPriority(b.name);
  if (ca !== cb) return ca - cb;
  const pa = getFolderClassPriority(a.name);
  const pb = getFolderClassPriority(b.name);
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name);
}

function getDisplayFolderTitle(folderName) {
  const raw = String(folderName || "").trim();
  const withoutBrand = raw
    .replace(/\bartbeats\b/ig, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .trim();
  return withoutBrand || "Visual Options";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function hashText(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 20);
}

function getFileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${path.relative(PROJECT_ROOT, filePath)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch (_error) {
    return `${path.relative(PROJECT_ROOT, filePath)}:missing`;
  }
}

function loadCacheMeta() {
  try {
    if (!fs.existsSync(CACHE_META_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(CACHE_META_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function saveCacheMeta(cacheMeta) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(CACHE_META_PATH, JSON.stringify(cacheMeta || {}, null, 2));
}

function loadDurationCache() {
  try {
    if (!fs.existsSync(DURATION_CACHE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(DURATION_CACHE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function saveDurationCache(durationCache) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(DURATION_CACHE_PATH, JSON.stringify(durationCache || {}, null, 2));
}

function durationCacheKey(relVideoPath, stat) {
  return `${relVideoPath}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
}

function getDurationSecondsCached(relVideoPath, videoPath, stat, durationCache, stats) {
  const key = durationCacheKey(relVideoPath, stat);
  const cached = durationCache[key];
  if (cached != null && Number.isFinite(Number(cached))) {
    stats.durationCacheHits += 1;
    return Number(cached);
  }
  const d = getDurationSeconds(videoPath);
  if (Number.isFinite(d) && d > 0) {
    durationCache[key] = d;
  }
  stats.durationProbes += 1;
  return d;
}

function collectVideosRecursive(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) {
    return acc;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
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

function pickEvenlySpaced(items, count) {
  if (items.length <= count) {
    return [...items];
  }
  const selected = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor((i * (items.length - 1)) / Math.max(1, count - 1));
    selected.push(items[index]);
  }
  return selected;
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || "ffmpeg failed").trim()
    };
  }
  return { ok: true };
}

function getDurationSeconds(videoPath) {
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-i", videoPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  const stderr = result.stderr || "";
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const hh = Number.parseInt(match[1], 10);
  const mm = Number.parseInt(match[2], 10);
  const ss = Number.parseFloat(match[3]);
  const total = (hh * 3600) + (mm * 60) + ss;
  return Number.isFinite(total) ? total : null;
}

function makeSafeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function extractFrameImage(videoPath, timestampSec, outputPath) {
  const args = [
    "-y",
    "-ss",
    timestampSec.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=560:-1",
    outputPath
  ];
  const firstTry = runFfmpeg(args);
  if (firstTry.ok) {
    return true;
  }
  // Fallback seek strategy for files that dislike input seeking.
  const fallbackArgs = [
    "-y",
    "-i",
    videoPath,
    "-ss",
    timestampSec.toFixed(3),
    "-frames:v",
    "1",
    "-vf",
    "scale=560:-1",
    outputPath
  ];
  const secondTry = runFfmpeg(fallbackArgs);
  return secondTry.ok;
}

function imageToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}

function fetchJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const trimmed = String(body || "").replace(/^\uFEFF/, "").trim();
          resolve(JSON.parse(trimmed));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

function normalizeInfinitestreamsCatalog(raw) {
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (Array.isArray(raw?.sketches)) {
    items = raw.sketches;
  } else if (Array.isArray(raw?.catalog)) {
    items = raw.catalog;
  } else if (Array.isArray(raw?.registry)) {
    items = raw.registry;
  }
  return items
    .map((entry) => {
      const pathPair = String(entry?.path || entry?.id || "").trim();
      let artist = String(entry?.artist || entry?.author || "").trim();
      let sketch = String(entry?.sketch || entry?.name || entry?.title || "").trim();
      if (!artist && !sketch && pathPair.includes("/")) {
        const parts = pathPair.split("/").filter(Boolean);
        artist = parts[0] || "";
        sketch = parts.slice(1).join("/") || "";
      }
      if (!artist && !sketch) return null;
      const qp = new URLSearchParams();
      if (artist) qp.set("artist", artist);
      if (sketch) qp.set("sketch", sketch);
      qp.set("controls", "0");
      qp.set("cycle", "0");
      return {
        artist: artist || "unknown",
        sketch: sketch || "untitled",
        url: `https://infinitestreams.io/?${qp.toString()}`
      };
    })
    .filter(Boolean);
}

async function getInfinitestreamsCatalog() {
  const endpoint = process.env.DJ_INFINITESTREAMS_CATALOG_URL || "https://infinitestreams.io/?format=json";
  const maxItems = Math.max(1, Number.parseInt(process.env.DJ_INFINITESTREAMS_MAX || "120", 10));
  try {
    const raw = await fetchJson(endpoint);
    const normalized = normalizeInfinitestreamsCatalog(raw).slice(0, maxItems);
    if (normalized.length > 0) {
      return normalized;
    }
  } catch (error) {
    console.warn(`Failed to load Infinitestreams catalog: ${error.message}`);
  }
  return INFINITESTREAMS_FALLBACK_SKETCH_PATHS
    .map((entry) => {
      const parts = String(entry).split("/").filter(Boolean);
      const artist = parts[0] || "unknown";
      const sketch = parts[1] || "untitled";
      const qp = new URLSearchParams();
      qp.set("artist", artist);
      qp.set("sketch", sketch);
      qp.set("controls", "0");
      qp.set("cycle", "0");
      return {
        artist,
        sketch,
        url: `https://infinitestreams.io/?${qp.toString()}`
      };
    })
    .slice(0, maxItems);
}

async function delayMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function gotoInfinitestreamsSketch(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch (_e) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await delayMs(4000);
  }
}

async function captureInfinitestreamsCatalogSnapshots(catalog = []) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return catalog;
  }
  if (!infinitestreamsSnapshotsEnabled()) {
    return catalog;
  }
  ensureDir(CACHE_FRAMES_DIR);
  const limit = Math.max(0, Number.parseInt(process.env.DJ_INFINITESTREAMS_SNAPSHOT_MAX || "24", 10));
  if (limit <= 0) {
    return catalog;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: {
        width: Number.parseInt(process.env.DJ_INFINITESTREAMS_SNAPSHOT_WIDTH || "960", 10),
        height: Number.parseInt(process.env.DJ_INFINITESTREAMS_SNAPSHOT_HEIGHT || "540", 10)
      }
    });
    const page = await context.newPage();
    for (let i = 0; i < catalog.length; i++) {
      if (i >= limit) break;
      const item = catalog[i];
      if (!item || !item.url) continue;
      const snapKey = hashText(`infinitestreams:${item.url}`);
      const snapPath = path.join(CACHE_FRAMES_DIR, `infstream-${snapKey}.jpg`);
      if (!FORCE_RECAPTURE && fs.existsSync(snapPath) && fs.statSync(snapPath).size > 800) {
        item.snapshotDataUri = imageToDataUri(snapPath);
        continue;
      }
      try {
        await gotoInfinitestreamsSketch(page, item.url);
        await page.locator("canvas").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
        await delayMs(Number.parseInt(process.env.DJ_INFINITESTREAMS_SNAPSHOT_DELAY_MS || "2200", 10));
        await page.screenshot({ path: snapPath, type: "jpeg", quality: 72, fullPage: false });
        if (fs.existsSync(snapPath)) {
          const stat = fs.statSync(snapPath);
          if (stat.size > 800) {
            item.snapshotDataUri = imageToDataUri(snapPath);
          }
        }
      } catch (_error) {
        // Keep catalog row without snapshot if capture fails.
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return catalog;
}

async function captureInfinitestreamsUrlSnapshots(urlEntries = []) {
  const out = [];
  if (!infinitestreamsSnapshotsEnabled()) {
    return urlEntries.map((e) => ({ ...e }));
  }
  ensureDir(CACHE_FRAMES_DIR);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 960, height: 540 }
    });
    const page = await context.newPage();
    for (const entry of urlEntries) {
      const next = { ...entry };
      const snapKey = hashText(`infstream-vj:${entry.url}`);
      const snapPath = path.join(CACHE_FRAMES_DIR, `infstream-vj-${snapKey}.jpg`);
      if (!FORCE_RECAPTURE && fs.existsSync(snapPath) && fs.statSync(snapPath).size > 800) {
        next.snapshotDataUri = imageToDataUri(snapPath);
        out.push(next);
        continue;
      }
      try {
        await gotoInfinitestreamsSketch(page, entry.url);
        await page.locator("canvas").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
        await delayMs(2200);
        await page.screenshot({ path: snapPath, type: "jpeg", quality: 72 });
        if (fs.existsSync(snapPath) && fs.statSync(snapPath).size > 800) {
          next.snapshotDataUri = imageToDataUri(snapPath);
        }
      } catch (_e) {
        // no snapshot
      }
      out.push(next);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return out;
}

function getColorDatasetSummary() {
  if (!fs.existsSync(COLOR_DATASET_PATH)) {
    return null;
  }
  try {
    const dataset = JSON.parse(fs.readFileSync(COLOR_DATASET_PATH, "utf8"));
    const items = Array.isArray(dataset.items) ? dataset.items : [];
    const familyMap = new Map();
    let videos = 0;
    let effects = 0;
    for (const item of items) {
      if (item.type === "video") videos += 1;
      if (item.type === "effect") effects += 1;
      const topFamilies = Array.isArray(item.topFamilies) ? item.topFamilies : [];
      for (const fam of topFamilies) {
        const name = String(fam?.name || "").trim().toLowerCase();
        if (!name) continue;
        const ratio = Number(fam?.ratio || 0);
        const curr = familyMap.get(name) || { weightedCount: 0, videos: 0, effects: 0 };
        curr.weightedCount += ratio;
        if (item.type === "video") curr.videos += ratio;
        if (item.type === "effect") curr.effects += ratio;
        familyMap.set(name, curr);
      }
    }
    let families = [...familyMap.entries()]
      .map(([name, val]) => ({
        name,
        weightedCount: Number(val.weightedCount.toFixed(1)),
        videoWeight: Number(val.videos.toFixed(1)),
        effectWeight: Number(val.effects.toFixed(1)),
        videoCount: null
      }))
      .sort((a, b) => b.weightedCount - a.weightedCount)
      .slice(0, 20);

    const tagIndex = dataset.tagIndex && typeof dataset.tagIndex === "object" ? dataset.tagIndex : null;
    if (tagIndex && Object.keys(tagIndex).length > 0) {
      const byTagCount = Object.entries(tagIndex)
        .map(([name, ids]) => ({
          name: String(name).toLowerCase(),
          videoCount: Array.isArray(ids) ? ids.length : 0
        }))
        .filter((row) => row.videoCount > 0)
        .sort((a, b) => b.videoCount - a.videoCount)
        .slice(0, 20);
      if (families.length === 0) {
        families = byTagCount.map((row) => ({
          name: row.name,
          weightedCount: row.videoCount,
          videoWeight: row.videoCount,
          effectWeight: 0,
          videoCount: row.videoCount
        }));
      } else {
        const countByName = new Map(byTagCount.map((r) => [r.name, r.videoCount]));
        families = families.map((row) => ({
          ...row,
          videoCount: countByName.has(row.name) ? countByName.get(row.name) : null
        }));
      }
    }

    return {
      generatedAt: dataset.generatedAt || "",
      datasetPath: path.relative(PROJECT_ROOT, COLOR_DATASET_PATH),
      totals: { videos, effects, items: items.length },
      families
    };
  } catch (_error) {
    return null;
  }
}

function buildFolderDeckPlan() {
  const folderEntries = fs.readdirSync(LOOPS_DIR, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory() || entry.name.startsWith(".")) return false;
      if (EXCLUDE_FOLDER_NAMES.has(entry.name.trim().toLowerCase())) return false;
      return true;
    })
    .sort(compareFolderOrder);

  const pages = [];
  for (const folderEntry of folderEntries) {
    const folderPath = path.join(LOOPS_DIR, folderEntry.name);
    const videos = collectVideosRecursive(folderPath).sort();
    if (videos.length === 0) {
      continue;
    }
    const selectedVideos = pickEvenlySpaced(videos, MAX_VIDEOS_PER_FOLDER);
    pages.push({
      folderName: folderEntry.name,
      folderPath,
      totalVideosInFolder: videos.length,
      videos: selectedVideos
    });
  }
  return pages;
}

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function startHttpServer(port) {
  const proc = spawn("npx", ["http-server", "-c-1", "-p", String(port), "."], {
    cwd: PROJECT_ROOT,
    stdio: "ignore"
  });
  return proc;
}

async function captureEffectImages(cacheMeta) {
  if (process.env.DJ_SKIP_EFFECT_SLIDES === "1") {
    console.log("[dj-pdf] DJ_SKIP_EFFECT_SLIDES=1 — skipping effect captures (loop slides only).");
    return [];
  }
  const effectImages = [];
  const outputVideo = path.join(PROJECT_ROOT, "artifacts", "sample-sonicsphere.webm");
  const captureMs = Math.max(6000, Number.parseInt(process.env.DJ_EFFECT_CAPTURE_MS || "9000", 10));
  const serverPort = Number.parseInt(process.env.DJ_SERVER_PORT || "8080", 10);
  const effectCacheOnly = process.env.DJ_EFFECT_CACHE_ONLY === "1";
  ensureDir(CACHE_FRAMES_DIR);
  const keySignature = KEY_FILES_FOR_EFFECT_CACHE.map(getFileSignature).join("|");
  const jobs = [];
  const layouts = EFFECT_LAYOUTS.length > 0 ? EFFECT_LAYOUTS : ["spheres"];
  for (const layout of layouts) {
    const fxLayout = layout === "thirds-2d" ? "thirds-2d" : "spheres";
    for (const effect of EFFECT_PROFILES) {
      const cacheKey = hashText(`effect|${effect}|${fxLayout}|${captureMs}|${keySignature}`);
      const entry = cacheMeta?.effects?.[cacheKey];
      const framePaths = [0, 1, 2, 3].map((i) => path.join(CACHE_FRAMES_DIR, `effect-${cacheKey}-${i}.png`));
      const sidecarPath = path.join(CACHE_DIR, `effect-${cacheKey}.json`);
      const sidecar = fs.existsSync(sidecarPath)
        ? JSON.parse(fs.readFileSync(sidecarPath, "utf8"))
        : null;
      const isCached = !FORCE_RECAPTURE
        && framePaths.every((p) => fs.existsSync(p))
        && Number.isFinite((entry && entry.durationSec) || (sidecar && sidecar.durationSec) || captureMs / 1000);
      jobs.push({ effect, fxLayout, cacheKey, framePaths, cached: isCached, entry });
    }
  }
  let server = null;
  try {
    if (effectCacheOnly) {
      for (const job of jobs) {
        if (!job.cached) {
          continue;
        }
        const sidecarPath = path.join(CACHE_DIR, `effect-${job.cacheKey}.json`);
        const sidecar = fs.existsSync(sidecarPath)
          ? JSON.parse(fs.readFileSync(sidecarPath, "utf8"))
          : null;
        const frames = job.framePaths.map((imagePath) => ({ imagePath, timestampLabel: "" }));
        effectImages.push({
          effect: job.effect,
          layout: job.fxLayout,
          frames,
          durationSec: Number((job.entry && job.entry.durationSec) || (sidecar && sidecar.durationSec) || (captureMs / 1000))
        });
      }
      return effectImages;
    }
    const missesForServer = jobs.filter((j) => !j.cached);
    if (missesForServer.length > 0) {
      server = startHttpServer(serverPort);
      const ready = await waitForServer(`http://127.0.0.1:${serverPort}/sonicsphere.html`);
      if (!ready) {
        return effectImages;
      }
    }
    for (const job of jobs) {
      if (!job.cached) {
        const render = spawnSync("node", ["scripts/generate-sample-video.mjs"], {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            CAPTURE_MS: String(captureMs),
            EFFECT_TIMELINE_PHASES: job.effect,
            EFFECT_TIMELINE_PHASE_SEC: "30",
            AUTO_BUILD_SET_MANIFEST: "0",
            SET_HOLD_MS: "1400",
            SET_TRANSITION_MS: "280",
            BASIC_VIDEO_RATIO: "0",
            EXPORT_VIDEO_REEL: "0",
            FX_LAYOUT: job.fxLayout
          },
          encoding: "utf8",
          maxBuffer: 24 * 1024 * 1024,
          timeout: Math.max(180000, captureMs * 20)
        });
        if (render.status !== 0 || !fs.existsSync(outputVideo)) {
          continue;
        }
        const durationSec = getDurationSeconds(outputVideo) || (captureMs / 1000) || 8;
        const frameFractions = [0.2, 0.42, 0.64, 0.84];
        const frames = [];
        for (let i = 0; i < frameFractions.length; i++) {
          const framePath = job.framePaths[i];
          const seekSec = Math.max(0.6, Math.min(durationSec - 0.1, durationSec * frameFractions[i]));
          const ok = extractFrameImage(outputVideo, seekSec, framePath);
          if (!ok || !fs.existsSync(framePath)) {
            continue;
          }
          const stat = fs.statSync(framePath);
          if (!Number.isFinite(stat.size) || stat.size < 1024) {
            continue;
          }
          frames.push({ imagePath: framePath, timestampLabel: `${seekSec.toFixed(1)}s` });
        }
        if (frames.length > 0) {
          const effectMeta = {
            effect: job.effect,
            layout: job.fxLayout,
            durationSec,
            frameCount: frames.length
          };
          cacheMeta.effects = cacheMeta.effects || {};
          cacheMeta.effects[job.cacheKey] = effectMeta;
          fs.writeFileSync(path.join(CACHE_DIR, `effect-${job.cacheKey}.json`), JSON.stringify(effectMeta));
          effectImages.push({ effect: job.effect, layout: job.fxLayout, frames, durationSec });
        }
      } else {
        const sidecarPath = path.join(CACHE_DIR, `effect-${job.cacheKey}.json`);
        const sidecar = fs.existsSync(sidecarPath)
          ? JSON.parse(fs.readFileSync(sidecarPath, "utf8"))
          : null;
        const frames = job.framePaths.map((imagePath) => ({ imagePath, timestampLabel: "" }));
        effectImages.push({
          effect: job.effect,
          layout: job.fxLayout,
          frames,
          durationSec: Number((job.entry && job.entry.durationSec) || (sidecar && sidecar.durationSec) || (captureMs / 1000))
        });
      }
    }
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }
  return effectImages;
}

function buildEmbedUrls() {
  const baseHost = process.env.DJ_PUBLIC_BASE_URL || "https://yoursite.com";
  const encodedObsUrl = encodeURIComponent(INFINITESTREAMS_VJ_URLS[0].url);
  const encodedCycleUrl = encodeURIComponent(INFINITESTREAMS_VJ_URLS[1].url);
  const hypermuseEmbedBase = `${baseHost.replace(/\/+$/g, "")}/sonicsphere.html`;
  return {
    hypermuseEmbedLocked: `${hypermuseEmbedBase}?hideui=1&infinitestreams=1&infinitestreamsopacity=0.7&infinitestreamsurl=${encodedObsUrl}`,
    hypermuseEmbedCycle: `${hypermuseEmbedBase}?hideui=1&infinitestreams=1&infinitestreamsopacity=0.65&infinitestreamsurl=${encodedCycleUrl}`
  };
}

function getPdfDocumentCss() {
  return `
      @page { size: letter landscape; margin: 0.35in; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; color: #111; }
      .page { page-break-after: always; width: 100%; min-height: 7.7in; }
      h1, h2 { margin: 0 0 0.1in 0; }
      .cover { display: flex; flex-direction: column; justify-content: center; gap: 0.1in; }
      .morphosonic-cover {
        background: linear-gradient(135deg, #0a1628 0%, #0d2832 45%, #122a38 100%);
        color: #e8fbff;
        padding: 0.35in;
        border-radius: 10px;
      }
      .morphosonic-cover h1 { font-size: 34px; font-weight: 700; letter-spacing: 0.02em; color: #7ef0d4; }
      .brand-mark {
        font-size: 13px;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: #5cd9c8;
        margin-bottom: 0.06in;
      }
      .cover-sub { font-size: 15px; color: #b8e8e0; margin: 0; }
      .cover-meta { font-size: 12px; color: #8ec9c0; margin: 0; }
      .morphosonic-cover .note { color: #9dd5cc; }
      .cover h1 { font-size: 36px; }
      .note { color: #444; font-size: 14px; }
      .meta { color: #555; margin-bottom: 0.08in; font-size: 11px; }
      .cards { display: flex; flex-direction: column; gap: 0.06in; }
      .video-card {
        border: 1px solid #d5d5d5;
        border-radius: 6px;
        padding: 0.04in;
      }
      .frame-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
      .frame { border: 1px solid #ececec; border-radius: 4px; overflow: hidden; }
      .frame img { width: 100%; height: 0.72in; object-fit: cover; display: block; background: #111; }
      .effect-page { display: flex; flex-direction: column; }
      .effect-card .frame img {
        height: 2.2in;
        filter: brightness(1.45) contrast(1.18) saturate(1.25);
      }
      .vj-usage-page { padding-top: 0.06in; }
      .url-row {
        border: 1px solid #d7d7d7;
        border-radius: 6px;
        padding: 0.08in 0.1in;
        margin: 0 0 0.08in 0;
        background: #fbfbfc;
      }
      .url-label {
        font-size: 12px;
        font-weight: 700;
        color: #28363b;
        margin-bottom: 0.03in;
      }
      .url-value {
        font-family: "Courier New", Courier, monospace;
        font-size: 9px;
        line-height: 1.25;
        color: #1a1f24;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .catalog-snapshot {
        display: block;
        width: 100%;
        height: 1.05in;
        object-fit: cover;
        border-radius: 4px;
        border: 1px solid #dce4ea;
        margin: 0.04in 0 0.05in 0;
        background: #0f1216;
      }
      .color-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.08in;
      }
      .color-table th, .color-table td {
        border: 1px solid #d9d9d9;
        padding: 0.07in 0.08in;
        text-align: left;
        font-size: 11px;
      }
      .color-table thead th {
        background: #eef5f8;
      }`;
}

function wrapPdfHtml(documentTitle, sectionBodies) {
  const joined = sectionBodies.join("\n");
  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(documentTitle)}</title>
    <style>${getPdfDocumentCss()}
    </style>
  </head>
  <body>
    ${joined}
  </body>
  </html>`;
}

function appendColorDatasetPages(sections, colorSummary) {
  if (colorSummary && Array.isArray(colorSummary.families) && colorSummary.families.length > 0) {
    const rows = colorSummary.families
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.videoCount != null ? String(item.videoCount) : "—")}</td>
          <td>${escapeHtml(String(item.weightedCount))}</td>
          <td>${escapeHtml(String(item.videoWeight))}</td>
          <td>${escapeHtml(String(item.effectWeight))}</td>
        </tr>
      `)
      .join("");
    sections.push(`
      <section class="page">
        <h2>Color families summary</h2>
        <p class="meta">From ${escapeHtml(colorSummary.datasetPath || "artifacts/color-dataset.json")} · generated ${escapeHtml(colorSummary.generatedAt || "")}</p>
        <p class="meta">Totals — videos: ${colorSummary.totals.videos} | effects: ${colorSummary.totals.effects} | items: ${colorSummary.totals.items}</p>
        <p class="meta">Clips = number of loop files tagged with that family (tagIndex). Weight = summed palette ratios from sampling.</p>
        <table class="color-table">
          <thead>
            <tr><th>Family</th><th>Clips</th><th>Weight sum</th><th>Video palette wt</th><th>Effect palette wt</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `);
    return;
  }
  if (colorSummary && Array.isArray(colorSummary.families) && colorSummary.families.length === 0) {
    sections.push(`
      <section class="page">
        <h2>Color families summary</h2>
        <p class="note">Dataset exists but produced no family breakdown. Re-run <code>npm run build:color:dataset</code>.</p>
      </section>
    `);
    return;
  }
  if (!fs.existsSync(COLOR_DATASET_PATH)) {
    sections.push(`
      <section class="page">
        <h2>Color families summary</h2>
        <p class="note">No color dataset found. Run <code>npm run build:color:dataset</code> then re-export this PDF.</p>
      </section>
    `);
    return;
  }
  sections.push(`
    <section class="page">
      <h2>Color families summary</h2>
      <p class="note"><code>artifacts/color-dataset.json</code> is present but could not be read for this deck. Re-run <code>npm run build:color:dataset</code>.</p>
    </section>
  `);
}

function buildMainSectionBodies({ folderSlides, effectSlides, colorSummary }) {
  const generatedAt = new Date().toISOString();
  const sections = [];
  sections.push(`
    <section class="page cover morphosonic-cover">
      <div class="brand-mark">Morphosonic</div>
      <h1>Visual options deck</h1>
      <p class="cover-sub">DJ / VJ reference — loops, reactions, and effect profiles</p>
      <p class="cover-meta">Generated: ${escapeHtml(generatedAt)}</p>
      <p class="cover-meta">Folders: ${folderSlides.length} · Effect rows: ${effectSlides.length}</p>
      <p class="note">Video rows: four frames per clip. Effect rows: four frames per profile × layout (spheres / thirds-2d).</p>
      <p class="cover-meta">Palette weights from <code>artifacts/color-dataset.json</code> are summarized on the next page(s), before loop folders.</p>
    </section>
  `);

  appendColorDatasetPages(sections, colorSummary);

  for (const folder of folderSlides) {
    const pages = chunkArray(folder.videoCards, ROWS_PER_SLIDE);
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageCards = pages[pageIndex];
      const cards = pageCards.map((videoCard) => {
        const frameImages = videoCard.frames
          .map((frame, idx) => `<div class="frame"><img src="${frame.dataUri}" alt="frame ${idx + 1}" /></div>`)
          .join("");
        return `
          <article class="video-card">
            <div class="frame-grid">${frameImages}</div>
          </article>
        `;
      }).join("");
      const folderClass = getFolderClass(folder.folderName);
      const categoryLabel = folderClass === "bio"
        ? "Bio"
        : (folderClass === "reaction" ? "Reaction" : "Other");
      const sectionLabel = `${categoryLabel}: ${getDisplayFolderTitle(folder.folderName)}`;
      sections.push(`
        <section class="page">
          <h2>${sectionLabel}</h2>
          <p class="meta">${folder.totalVideosInFolder} clips | showing ${folder.videoCards.length} | page ${pageIndex + 1}/${pages.length} | represented: ${formatMinutesLabel(pageCards.reduce((sum, card) => sum + (card.durationSec || 0), 0))}</p>
          <div class="cards">${cards}</div>
        </section>
      `);
    }
  }

  for (const effect of effectSlides) {
    const layoutLabel = effect.layout === "thirds-2d" ? "Layout: thirds-2d" : "Layout: spheres";
    const frameImages = (effect.frames || [])
      .map((frame, idx) => `<div class="frame"><img src="${frame.dataUri}" alt="${escapeHtml(effect.effect)} frame ${idx + 1}" /></div>`)
      .join("");
    sections.push(`
      <section class="page effect-page">
        <h2>Effect: ${escapeHtml(effect.effect)} · ${escapeHtml(layoutLabel)}</h2>
        <p class="meta">represented: ${formatMinutesLabel(effect.durationSec || 0)}</p>
        <article class="video-card effect-card">
          <div class="frame-grid">${frameImages}</div>
        </article>
      </section>
    `);
  }

  return sections;
}

function buildAppendixSectionBodies({ infinitestreamsCatalog, infinitestreamsVjExamples }) {
  const { hypermuseEmbedLocked, hypermuseEmbedCycle } = buildEmbedUrls();
  const sections = [];
  sections.push(`
    <section class="page">
      <h2>Appendix — Infinitestreams.io</h2>
      <p class="meta">External sketch catalog, OBS URLs, and embed snippets (placed at end for faster PDF iteration on loop/effect pages).</p>
    </section>
  `);
  if (Array.isArray(infinitestreamsCatalog) && infinitestreamsCatalog.length > 0) {
    const perPage = 16;
    const pages = chunkArray(infinitestreamsCatalog, perPage);
    for (let i = 0; i < pages.length; i++) {
      const rows = pages[i]
        .map((item) => `
          <div class="url-row">
            <div class="url-label">${escapeHtml(item.artist)} / ${escapeHtml(item.sketch)}</div>
            ${item.snapshotDataUri ? `<img class="catalog-snapshot" src="${item.snapshotDataUri}" alt="${escapeHtml(item.artist)} ${escapeHtml(item.sketch)} snapshot" />` : ""}
            <div class="url-value">${escapeHtml(item.url)}</div>
          </div>
        `)
        .join("");
      sections.push(`
        <section class="page vj-usage-page">
          <h2>Infinitestreams catalog effects</h2>
          <p class="meta">Showing ${infinitestreamsCatalog.length} sketches | page ${i + 1}/${pages.length}</p>
          ${rows}
        </section>
      `);
    }
  }
  const vjBase = Array.isArray(infinitestreamsVjExamples) && infinitestreamsVjExamples.length > 0
    ? infinitestreamsVjExamples
    : INFINITESTREAMS_VJ_URLS;
  const infinitestreamsRows = vjBase
    .map((entry) => `
      <div class="url-row">
        <div class="url-label">${escapeHtml(entry.label)}</div>
        ${entry.snapshotDataUri ? `<img class="catalog-snapshot" src="${entry.snapshotDataUri}" alt="" />` : ""}
        <div class="url-value">${escapeHtml(entry.url)}</div>
      </div>
    `)
    .join("");
  sections.push(`
    <section class="page vj-usage-page">
      <h2>Infinitestreams.io VJ usage examples</h2>
      <p class="meta">Direct URLs for OBS / browser sources and Hypermuse iframe integration.</p>
      ${infinitestreamsRows}
      <div class="url-row">
        <div class="url-label">Hypermuse embed (locked sketch)</div>
        <div class="url-value">${escapeHtml(hypermuseEmbedLocked)}</div>
      </div>
      <div class="url-row">
        <div class="url-label">Hypermuse embed (auto cycle)</div>
        <div class="url-value">${escapeHtml(hypermuseEmbedCycle)}</div>
      </div>
      <p class="note">Tip: set DJ_PUBLIC_BASE_URL to your hosted domain when exporting to auto-fill your own embed base URL.</p>
    </section>
  `);
  return sections;
}

function renderMainPdfHtml(data) {
  return wrapPdfHtml(
    "Morphosonic — Visual options deck",
    buildMainSectionBodies({
      folderSlides: data.folderSlides,
      effectSlides: data.effectSlides,
      colorSummary: data.colorSummary
    })
  );
}

function renderAppendixPdfHtml(data) {
  return wrapPdfHtml(
    "Morphosonic — Infinitestreams appendix",
    buildAppendixSectionBodies({
      infinitestreamsCatalog: data.infinitestreamsCatalog,
      infinitestreamsVjExamples: data.infinitestreamsVjExamples
    })
  );
}

function renderHtml(data) {
  return wrapPdfHtml(
    "Morphosonic — Visual options deck",
    [
      ...buildMainSectionBodies({
        folderSlides: data.folderSlides,
        effectSlides: data.effectSlides,
        colorSummary: data.colorSummary
      }),
      ...buildAppendixSectionBodies({
        infinitestreamsCatalog: data.infinitestreamsCatalog,
        infinitestreamsVjExamples: data.infinitestreamsVjExamples
      })
    ]
  );
}

function formatDurationLabel(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return "";
  }
  const total = Math.floor(durationSec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${hh}h ${mm}m ${ss}s`;
  }
  return `${mm}m ${ss}s`;
}

function formatMinutesLabel(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return "0.0 min";
  }
  return `${(durationSec / 60).toFixed(1)} min`;
}

async function buildDeckData(cacheMeta) {
  const folderPlan = buildFolderDeckPlan();
  const folderSlides = [];
  let videoCacheHits = 0;
  let videoRecaptures = 0;
  const durationCache = loadDurationCache();
  const durationStats = { durationCacheHits: 0, durationProbes: 0 };
  for (const folder of folderPlan) {
    const videoCards = [];
    for (let i = 0; i < folder.videos.length; i++) {
      const videoPath = folder.videos[i];
      const videoBase = makeSafeName(path.basename(videoPath, path.extname(videoPath)));
      const relVideoPath = path.relative(PROJECT_ROOT, videoPath);
      const vStat = fs.statSync(videoPath);
      const durationSec = getDurationSecondsCached(relVideoPath, videoPath, vStat, durationCache, durationStats);
      const usableDuration = Number.isFinite(durationSec) && durationSec > 1
        ? durationSec
        : 20;
      const frames = [];
      for (let j = 0; j < FRAME_FRACTIONS.length; j++) {
        const ts = Math.max(0, Math.min(usableDuration - 0.1, usableDuration * FRAME_FRACTIONS[j]));
        const frameKey = hashText(`video|${relVideoPath}|${Math.floor(vStat.mtimeMs)}|${vStat.size}|${ts.toFixed(3)}|scale560`);
        const outPath = path.join(CACHE_FRAMES_DIR, `video-${frameKey}.jpg`);
        const exists = fs.existsSync(outPath);
        if (exists && !FORCE_RECAPTURE) {
          videoCacheHits += 1;
        } else {
          videoRecaptures += 1;
        }
        const ok = (exists && !FORCE_RECAPTURE) ? true : extractFrameImage(videoPath, ts, outPath);
        if (!ok || !fs.existsSync(outPath)) {
          continue;
        }
        frames.push({
          dataUri: imageToDataUri(outPath),
          timestampLabel: `${ts.toFixed(1)}s`
        });
      }
      if (frames.length === 0) {
        continue;
      }
      videoCards.push({
        displayName: path.basename(videoPath),
        relativePath: relVideoPath,
        durationSec,
        durationLabel: formatDurationLabel(durationSec),
        frames
      });
    }
    if (videoCards.length > 0) {
      folderSlides.push({
        folderName: folder.folderName,
        totalVideosInFolder: folder.totalVideosInFolder,
        videoCards
      });
    }
  }

  saveDurationCache(durationCache);

  const effectImages = await captureEffectImages(cacheMeta);
  const effectSlides = effectImages.map((entry) => ({
    effect: entry.effect,
    layout: entry.layout,
    durationSec: entry.durationSec,
    frames: entry.frames.map((frame) => ({
      dataUri: imageToDataUri(frame.imagePath),
      timestampLabel: frame.timestampLabel
    }))
  }));
  let infinitestreamsCatalog = await getInfinitestreamsCatalog();
  infinitestreamsCatalog = await captureInfinitestreamsCatalogSnapshots(infinitestreamsCatalog);
  const infinitestreamsVjExamples = await captureInfinitestreamsUrlSnapshots(INFINITESTREAMS_VJ_URLS);
  const colorSummary = getColorDatasetSummary();
  return {
    folderSlides,
    effectSlides,
    infinitestreamsCatalog,
    infinitestreamsVjExamples,
    colorSummary,
    cacheStats: {
      videoCacheHits,
      videoRecaptures,
      durationCacheHits: durationStats.durationCacheHits,
      durationProbes: durationStats.durationProbes
    }
  };
}

async function buildAppendixDeckData() {
  let infinitestreamsCatalog = await getInfinitestreamsCatalog();
  infinitestreamsCatalog = await captureInfinitestreamsCatalogSnapshots(infinitestreamsCatalog);
  const infinitestreamsVjExamples = await captureInfinitestreamsUrlSnapshots(INFINITESTREAMS_VJ_URLS);
  return { infinitestreamsCatalog, infinitestreamsVjExamples };
}

async function mergePdfFiles(inputPaths, outputPath) {
  const mergedPdf = await PDFDocument.create();
  for (const inputPath of inputPaths) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`mergePdfFiles: missing file ${inputPath}`);
    }
    const bytes = fs.readFileSync(inputPath);
    const doc = await PDFDocument.load(bytes);
    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  fs.writeFileSync(outputPath, await mergedPdf.save());
}

async function renderPdfFromHtml(html, outputPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      printBackground: true,
      format: "Letter",
      landscape: true,
      margin: {
        top: "0.3in",
        right: "0.3in",
        bottom: "0.3in",
        left: "0.3in"
      }
    });
  } finally {
    await browser.close();
  }
}

async function renderPdfJobs(jobs) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { html, outputPath } of jobs) {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({
        path: outputPath,
        printBackground: true,
        format: "Letter",
        landscape: true,
        margin: {
          top: "0.3in",
          right: "0.3in",
          bottom: "0.3in",
          left: "0.3in"
        }
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!ffmpegPath && !APPENDIX_ONLY) {
    throw new Error("ffmpeg-static binary not available");
  }
  if (!APPENDIX_ONLY && !fs.existsSync(LOOPS_DIR)) {
    throw new Error(`Loops directory not found: ${LOOPS_DIR}`);
  }
  const usePdfMerge = process.env.DJ_PDF_MERGE !== "0";
  console.log(`[dj-pdf] DJ_APPENDIX_ONLY=${APPENDIX_ONLY ? "1" : "0"} | DJ_PDF_MERGE=${usePdfMerge ? "1" : "0"} | DJ_FAST_PDF=${process.env.DJ_FAST_PDF || "0"} | Infinitestreams snapshots: ${infinitestreamsSnapshotsEnabled() ? "on" : "off (set DJ_INFINITESTREAMS_SNAPSHOTS=1 for thumbnails)"} | DJ_EFFECT_CACHE_ONLY=${process.env.DJ_EFFECT_CACHE_ONLY || "0"}`);
  ensureDir(ARTIFACTS_DIR);
  ensureDir(CACHE_DIR);
  ensureDir(CACHE_FRAMES_DIR);

  if (APPENDIX_ONLY) {
    if (!fs.existsSync(MAIN_PDF_INPUT)) {
      throw new Error(
        `Appendix-only export needs an existing main deck PDF at ${MAIN_PDF_INPUT}. Run a full export first (npm run export:dj:pdf), or set DJ_MAIN_PDF_INPUT to that file.`
      );
    }
    const cacheMeta = loadCacheMeta();
    const appendixData = await buildAppendixDeckData();
    saveCacheMeta(cacheMeta);
    const appendixHtml = renderAppendixPdfHtml(appendixData);
    await renderPdfFromHtml(appendixHtml, APPENDIX_PDF_OUTPUT);
    await mergePdfFiles([MAIN_PDF_INPUT, APPENDIX_PDF_OUTPUT], OUTPUT_PDF);
    console.log(JSON.stringify({
      outputPdf: path.relative(PROJECT_ROOT, OUTPUT_PDF),
      mergedFrom: [
        path.relative(PROJECT_ROOT, MAIN_PDF_INPUT),
        path.relative(PROJECT_ROOT, APPENDIX_PDF_OUTPUT)
      ],
      appendixOnly: true,
      hint: "Loop/effect/color PDF pages were not regenerated; only Infinitestreams appendix was rebuilt and appended."
    }, null, 2));
    return;
  }

  const cacheMeta = loadCacheMeta();
  const deck = await buildDeckData(cacheMeta);
  if (deck.folderSlides.length === 0) {
    throw new Error("No folder slides generated. Check loops content.");
  }
  saveCacheMeta(cacheMeta);

  if (!usePdfMerge) {
    const html = renderHtml(deck);
    await renderPdfFromHtml(html, OUTPUT_PDF);
    console.log(JSON.stringify({
      outputPdf: path.relative(PROJECT_ROOT, OUTPUT_PDF),
      folderSlides: deck.folderSlides.length,
      effectRows: deck.effectSlides.length,
      pdfMerge: false,
      cache: {
        forceRecapture: FORCE_RECAPTURE,
        videoFrameHits: deck.cacheStats.videoCacheHits,
        videoFrameRecaptures: deck.cacheStats.videoRecaptures,
        durationCacheHits: deck.cacheStats.durationCacheHits,
        durationProbes: deck.cacheStats.durationProbes
      },
      effectLayouts: EFFECT_LAYOUTS,
      exportMode: {
        fastPdf: process.env.DJ_FAST_PDF === "1",
        infinitestreamsSnapshots: infinitestreamsSnapshotsEnabled(),
        effectCacheOnly: process.env.DJ_EFFECT_CACHE_ONLY === "1"
      },
      hint: "Single-pass PDF (DJ_PDF_MERGE=0). Default merged export writes dj-options-deck-main.pdf for appendix-only updates.",
      excludedFolders: [...EXCLUDE_FOLDER_NAMES],
      tmpDir: TMP_DIR
    }, null, 2));
    return;
  }

  await renderPdfJobs([
    { html: renderMainPdfHtml(deck), outputPath: MAIN_PDF_OUTPUT },
    { html: renderAppendixPdfHtml(deck), outputPath: APPENDIX_PDF_OUTPUT }
  ]);
  await mergePdfFiles([MAIN_PDF_OUTPUT, APPENDIX_PDF_OUTPUT], OUTPUT_PDF);

  console.log(JSON.stringify({
    outputPdf: path.relative(PROJECT_ROOT, OUTPUT_PDF),
    mainPdf: path.relative(PROJECT_ROOT, MAIN_PDF_OUTPUT),
    appendixPdf: path.relative(PROJECT_ROOT, APPENDIX_PDF_OUTPUT),
    folderSlides: deck.folderSlides.length,
    effectRows: deck.effectSlides.length,
    pdfMerge: true,
    cache: {
      forceRecapture: FORCE_RECAPTURE,
      videoFrameHits: deck.cacheStats.videoCacheHits,
      videoFrameRecaptures: deck.cacheStats.videoRecaptures,
      durationCacheHits: deck.cacheStats.durationCacheHits,
      durationProbes: deck.cacheStats.durationProbes
    },
    effectLayouts: EFFECT_LAYOUTS,
    exportMode: {
      fastPdf: process.env.DJ_FAST_PDF === "1",
      infinitestreamsSnapshots: infinitestreamsSnapshotsEnabled(),
      effectCacheOnly: process.env.DJ_EFFECT_CACHE_ONLY === "1"
    },
    hint: "Re-export Infinitestreams only: DJ_APPENDIX_ONLY=1 npm run export:dj:pdf (reuses dj-options-deck-main.pdf). Full deck: export:dj:pdf:full in package.json",
    excludedFolders: [...EXCLUDE_FOLDER_NAMES],
    tmpDir: TMP_DIR
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
