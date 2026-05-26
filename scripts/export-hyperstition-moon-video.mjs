#!/usr/bin/env node
/**
 * Export a video spelling "hyperstition" with moon-loop color cubes.
 *
 * Usage:
 *   npm run export:hyperstition:moon
 * Env:
 *   CAPTURE_MS=15000  OUTPUT_VIDEO=artifacts/hyperstition-moon.webm
 *   EXPORT_WIDTH=1920  EXPORT_HEIGHT=1080
 *   BUILD_MOON_CUBES=1  (default: build index if missing)
 *   HYPERSTITION_PAGE=hyperstition-moon-halo.html  (or hyperstition-moon.html)
 *   ORBIT_SHAPE=vajra  (ellipse default)
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const MOON_INDEX = path.join(ARTIFACTS_DIR, "moon-cube-index.json");
const CAPTURE_MS = Number.parseInt(process.env.CAPTURE_MS || "15000", 10);
const EXPORT_WIDTH = Number.parseInt(process.env.EXPORT_WIDTH || "1920", 10);
const EXPORT_HEIGHT = Number.parseInt(process.env.EXPORT_HEIGHT || "1080", 10);
const SERVER_PORT = Number.parseInt(process.env.SERVER_PORT || "8080", 10);
const BUILD_MOON_CUBES = process.env.BUILD_MOON_CUBES !== "0";
const HYPERSTITION_PAGE = String(process.env.HYPERSTITION_PAGE || "hyperstition-moon.html").trim();
const MOON_VIDEO = String(process.env.MOON_VIDEO || "").trim();
const ORBIT_SHAPE = String(process.env.ORBIT_SHAPE || "").trim().toLowerCase();
const VAJRAS = process.env.VAJRAS === "1";
const VAJRA_COUNT = String(process.env.VAJRA_COUNT || "").trim();
const OUTPUT_VIDEO = process.env.OUTPUT_VIDEO
  ? path.resolve(PROJECT_ROOT, process.env.OUTPUT_VIDEO)
  : path.join(
    ARTIFACTS_DIR,
    VAJRAS
      ? "hyperstition-moon-vajra.mp4"
      : HYPERSTITION_PAGE.includes("halo")
        ? "hyperstition-moon-halo.mp4"
        : "hyperstition-moon.mp4"
  );
const WORD = process.env.HYPERSTITION_WORD || "hyperstition";
const EXPORT_FPS = Number.parseInt(process.env.EXPORT_FPS || "30", 10);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function waitForServer(url, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function startHttpServer(port) {
  return spawn("npx", ["http-server", "-c-1", "-p", String(port), "."], {
    cwd: PROJECT_ROOT,
    stdio: "ignore"
  });
}

function ensureMoonCubeIndex() {
  if (fs.existsSync(MOON_INDEX) && process.env.FORCE_MOON_CUBES !== "1") {
    console.log("[hyperstition] Using existing moon-cube-index.json");
    return;
  }
  if (!BUILD_MOON_CUBES) {
    console.warn("[hyperstition] moon-cube-index.json missing and BUILD_MOON_CUBES=0");
    return;
  }
  console.log("[hyperstition] Building moon cube index from loops/Moon and Astronauts …");
  const result = spawnSync(process.execPath, ["scripts/build-moon-cube-index.mjs"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error("build-moon-cube-index.mjs failed");
  }
}

function encodeFramesToVideo(framesDir, outputPath, fps) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static not available");
  }
  const ext = path.extname(outputPath).toLowerCase();
  const args = [
    "-y",
    "-framerate", String(fps),
    "-i", path.join(framesDir, "frame-%05d.png"),
    "-c:v", ext === ".webm" ? "libvpx-vp9" : "libx264",
    "-pix_fmt", "yuv420p"
  ];
  if (ext === ".webm") {
    args.push("-b:v", "6M");
  } else {
    args.push("-crf", "18", "-preset", "medium");
  }
  args.push(outputPath);
  const proc = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(proc.stderr || "ffmpeg encode failed");
  }
}

async function runExport() {
  ensureDir(ARTIFACTS_DIR);
  ensureMoonCubeIndex();

  const query = new URLSearchParams({ word: WORD });
  if (MOON_VIDEO) {
    query.set("moon", MOON_VIDEO);
  }
  if (ORBIT_SHAPE) {
    query.set("orbit", ORBIT_SHAPE);
  }
  if (VAJRAS) {
    query.set("vajras", "1");
  }
  if (VAJRA_COUNT) {
    query.set("vajraCount", VAJRA_COUNT);
  }
  const pageUrl = `http://127.0.0.1:${SERVER_PORT}/${HYPERSTITION_PAGE}?${query.toString()}`;
  let server = null;
  const probe = `http://127.0.0.1:${SERVER_PORT}/${HYPERSTITION_PAGE}`;
  if (!(await waitForServer(probe, 2000))) {
    console.log(`[hyperstition] Starting http-server on :${SERVER_PORT}`);
    server = startHttpServer(SERVER_PORT);
    if (!(await waitForServer(probe, 30000))) {
      if (server && !server.killed) server.kill("SIGTERM");
      throw new Error(`Could not reach ${probe}. Run: npm start`);
    }
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  const framesDir = path.join(ARTIFACTS_DIR, "hyperstition-frames");
  try {
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
    ensureDir(framesDir);

    const context = await browser.newContext({
      viewport: { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.warn("[hyperstition] page error:", err.message));
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => window.__hyperstitionReady === true, undefined, { timeout: 120000 });
    if (HYPERSTITION_PAGE.includes("halo")) {
      await page.waitForFunction(() => {
        const stats = window.__hyperstitionStats || {};
        return stats.moonReady === true;
      }, undefined, { timeout: 90000 });
      if (ORBIT_SHAPE === "vajra" || VAJRAS) {
        await page.waitForFunction(() => {
          const stats = window.__hyperstitionStats || {};
          return stats.vajraReady === true;
        }, undefined, { timeout: 120000 });
      }
      await page.waitForTimeout(800);
    }
    const stats = await page.evaluate(() => window.__hyperstitionStats || {});
    console.log("[hyperstition] Render stats:", JSON.stringify(stats));

    const frameCount = Math.max(1, Math.ceil((CAPTURE_MS / 1000) * EXPORT_FPS));
    const frameDelayMs = 1000 / EXPORT_FPS;
    console.log(`[hyperstition] Capturing ${frameCount} frames @ ${EXPORT_FPS}fps …`);
    for (let i = 0; i < frameCount; i++) {
      const framePath = path.join(framesDir, `frame-${String(i).padStart(5, "0")}.png`);
      await page.screenshot({ path: framePath, type: "png" });
      if (i < frameCount - 1) {
        await page.waitForTimeout(frameDelayMs);
      }
      if (i > 0 && i % EXPORT_FPS === 0) {
        console.log(`[hyperstition] … ${i}/${frameCount} frames`);
      }
    }

    await context.close();
    console.log("[hyperstition] Encoding video …");
    encodeFramesToVideo(framesDir, OUTPUT_VIDEO, EXPORT_FPS);
    console.log(JSON.stringify({
      output: path.relative(PROJECT_ROOT, OUTPUT_VIDEO),
      page: HYPERSTITION_PAGE,
      word: WORD,
      orbitShape: ORBIT_SHAPE || null,
      moonVideo: MOON_VIDEO || null,
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      captureMs: CAPTURE_MS,
      fps: EXPORT_FPS,
      frameCount,
      stats
    }, null, 2));
  } finally {
    await browser.close();
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }
}

runExport().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
