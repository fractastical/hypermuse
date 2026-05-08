#!/usr/bin/env node
/**
 * Smoke test for the core hypermuse VJ flows. Run with `npm run test:smoke`.
 *
 * Regression checks (each step prints PASS/FAIL and the script exits non-zero on any failure):
 *   1. Plain sonicsphere.html loads without console errors and the menu is visible.
 *   2. Pressing "h" hides the menu, pressing "h" again restores it.
 *   3. Preset URL (cells1+cells2 autoplay + logo) loads the set, enables basic mode,
 *      starts playing a video, and shows the SynBioBeta logo.
 *   4. The basic-mode black backdrop element exists and sits at z-index 1 (the fix
 *      that prevents the menu from peeking through fade transitions).
 *   5. VJ commands via window.postMessage update logo opacity, triangle (mosaic), and blackout.
 *   6. controller.html loads without console errors and exposes the new preset/logo/triangle buttons.
 */

import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const PROJECT_ROOT = process.cwd();
const PORT = Number.parseInt(process.env.SMOKE_PORT || "8090", 10);
const HEADLESS = process.env.SMOKE_HEADLESS !== "0";
const BASE = `http://127.0.0.1:${PORT}`;

const SET_URL = `${BASE}/sonicsphere.html?basicvideo=1&fullbg=1&aspect=16x9&videofit=cover&set=sets/set-cells1-cells2-autoplay.json&logo=1&logoposition=top&logoopacity=0.92`;
const PLAIN_URL = `${BASE}/sonicsphere.html`;
const CONTROLLER_URL = `${BASE}/controller.html`;

function waitForServer(url, timeoutMs = 25000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve(true);
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if ((Date.now() - started) >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

function startHttpServer(port) {
  return spawn("npx", ["http-server", "-c-1", "-p", String(port), "."], {
    cwd: PROJECT_ROOT,
    stdio: "ignore"
  });
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const line = detail ? `[${tag}] ${name} — ${detail}` : `[${tag}] ${name}`;
  if (ok) console.log(line);
  else console.error(line);
}

async function withConsoleCapture(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter out noise that's expected in the headless environment.
      if (/Failed to load resource/.test(text)) return;
      if (/AudioContext was not allowed/.test(text)) return;
      if (/getUserMedia|NotAllowedError|Permission/.test(text)) return;
      errors.push(`console.error: ${text}`);
    }
  });
  return errors;
}

async function isVisible(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, selector);
}

async function runPlainMenuChecks(browser) {
  const page = await browser.newPage();
  const errors = await withConsoleCapture(page);
  try {
    await page.goto(PLAIN_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    record("plain: page loaded", true);

    const menuVisible = await isVisible(page, "#app");
    record("plain: menu (#app) visible by default", menuVisible);

    await page.keyboard.press("h");
    await page.waitForTimeout(250);
    const hiddenAfterH = !(await isVisible(page, "#app"));
    record("plain: h hides menu", hiddenAfterH);

    await page.keyboard.press("h");
    await page.waitForTimeout(250);
    const visibleAfterSecondH = await isVisible(page, "#app");
    record("plain: second h shows menu", visibleAfterSecondH);

    record("plain: no console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await page.close();
  }
}

async function runSetAndLogoChecks(browser) {
  const page = await browser.newPage();
  const errors = await withConsoleCapture(page);
  try {
    await page.goto(SET_URL, { waitUntil: "domcontentloaded", timeout: 25000 });

    // Wait for set manifest to load and for video element to acquire a src.
    const ready = await page.waitForFunction(() => {
      const v = document.querySelector("video");
      const setLoaded = window.__hypermuseLoadedSetCount && window.__hypermuseLoadedSetCount > 0;
      return setLoaded && v && (v.currentSrc || v.src);
    }, { timeout: 20000 }).catch(() => null);
    record("set: manifest + video.src ready", !!ready);

    // Give the video a moment to actually start playing.
    await page.waitForTimeout(2500);
    const playing = await page.evaluate(() => {
      const v = document.querySelector("video");
      if (!v) return false;
      return !v.paused && !v.ended && v.readyState >= 2 && v.currentTime > 0;
    });
    record("set: video element is playing", playing);

    const basicOn = await page.evaluate(() => {
      try { return !!window.vjControl({}).basicVideo; } catch (_) { return false; }
    });
    record("set: basic video mode active", basicOn);

    // Black backdrop regression check — must exist, be displayed, and z-index 1.
    const backdrop = await page.evaluate(() => {
      const el = document.getElementById("basicVideoBlackBackdrop");
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return { display: cs.display, zIndex: cs.zIndex, position: cs.position };
    });
    record(
      "set: black backdrop present (prevents menu peek-through during fades)",
      !!(backdrop && backdrop.display !== "none" && backdrop.position === "fixed" && backdrop.zIndex === "1"),
      backdrop ? JSON.stringify(backdrop) : "element missing"
    );

    // Logo overlay should be present and visible when ?logo=1.
    const logo = await page.evaluate(() => {
      const el = document.getElementById("synbiobetaLogoLayer");
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        opacity: parseFloat(cs.opacity),
        bgImage: cs.backgroundImage,
        zIndex: cs.zIndex
      };
    });
    record(
      "set: synbiobeta logo overlay visible",
      !!(logo && logo.opacity > 0.5 && /synbiobeta-logo\.png/.test(logo.bgImage)),
      logo ? JSON.stringify(logo) : "element missing"
    );

    // VJ command: hide logo via postMessage (same path the controller uses).
    await page.evaluate(() => {
      window.postMessage({ type: "vj", logo: false }, "*");
    });
    await page.waitForTimeout(800);
    const logoHidden = await page.evaluate(() => {
      const el = document.getElementById("synbiobetaLogoLayer");
      return el ? parseFloat(window.getComputedStyle(el).opacity) < 0.05 : false;
    });
    record("set: VJ command logo:false hides the logo", logoHidden);

    // VJ command: triangle (mosaic) on, then off.
    await page.evaluate(() => {
      window.postMessage({ type: "vj", mosaic: true, mosaicFx: false }, "*");
    });
    await page.waitForTimeout(400);
    const mosaicOn = await page.evaluate(() => {
      try { return !!window.vjControl({}).mosaic; } catch (_) { return false; }
    });
    record("set: VJ command mosaic:true enables triangle/mosaic layer", mosaicOn);

    await page.evaluate(() => {
      window.postMessage({ type: "vj", mosaic: false, mosaicFx: false }, "*");
    });
    await page.waitForTimeout(400);
    const mosaicOff = await page.evaluate(() => {
      try { return !window.vjControl({}).mosaic; } catch (_) { return true; }
    });
    record("set: VJ command mosaic:false disables triangle/mosaic layer", mosaicOff);

    // VJ command: blackout fade.
    await page.evaluate(() => {
      window.postMessage({ type: "vj", blackout: 1, blackoutFadeMs: 100 }, "*");
    });
    await page.waitForTimeout(400);
    const blackedOut = await page.evaluate(() => {
      const el = document.getElementById("blackoutLayer");
      return el ? parseFloat(window.getComputedStyle(el).opacity) > 0.9 : false;
    });
    record("set: VJ command blackout:1 raises blackout overlay", blackedOut);

    await page.evaluate(() => {
      window.postMessage({ type: "vj", blackout: 0, blackoutFadeMs: 100 }, "*");
    });
    await page.waitForTimeout(400);
    const blackoutCleared = await page.evaluate(() => {
      const el = document.getElementById("blackoutLayer");
      return el ? parseFloat(window.getComputedStyle(el).opacity) < 0.05 : true;
    });
    record("set: VJ command blackout:0 clears blackout overlay", blackoutCleared);

    record("set: no console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await page.close();
  }
}

async function runControllerChecks(browser) {
  const page = await browser.newPage();
  const errors = await withConsoleCapture(page);
  try {
    await page.goto(CONTROLLER_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(800);

    const expectedIds = [
      "presetCells12AutoplayButton",
      "presetCells12NoLogoButton",
      "logoShowButton",
      "logoHideButton",
      "logoPositionSelect",
      "logoOpacityInput",
      "triangleOnButton",
      "triangleFxButton",
      "triangleOffButton",
      "folderLoopGroupsHost",
      "loopGroupsRefreshButton",
      "loopGroupsEnableAllButton",
      "loopGroupsDisableAllButton",
      "bridgeFadeOutButton",
      "bridgeFadeInButton",
      "basicVideoOnButton",
      "basicVideoOffButton",
      "likeLoopButton",
      "dislikeLoopButton",
      "openVisualButton",
      "visualUrl"
    ];

    const presence = await page.evaluate((ids) => {
      return ids.map((id) => ({ id, found: !!document.getElementById(id) }));
    }, expectedIds);

    const missing = presence.filter((p) => !p.found).map((p) => p.id);
    record(
      "controller: required UI elements present",
      missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : ""
    );

    record("controller: no console errors", errors.length === 0, errors.join(" | "));
  } finally {
    await page.close();
  }
}

async function main() {
  let serverProcess = null;
  const alreadyRunning = await waitForServer(`${BASE}/sonicsphere.html`, 1500);
  if (!alreadyRunning) {
    console.log(`[smoke] starting http-server on :${PORT}`);
    serverProcess = startHttpServer(PORT);
    const ok = await waitForServer(`${BASE}/sonicsphere.html`, 25000);
    if (!ok) {
      console.error(`[smoke] http-server did not become ready on ${BASE}`);
      if (serverProcess) serverProcess.kill();
      process.exit(2);
    }
  } else {
    console.log(`[smoke] reusing existing http-server on :${PORT}`);
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"]
  });

  try {
    await runPlainMenuChecks(browser);
    await runSetAndLogoChecks(browser);
    await runControllerChecks(browser);
  } catch (err) {
    record("smoke: unexpected exception", false, String(err && err.message || err));
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill();
    }
  }

  const failures = results.filter((r) => !r.ok);
  console.log("");
  console.log(`[smoke] ${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) {
    console.error("");
    console.error("FAILED CHECKS:");
    for (const f of failures) {
      console.error(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(2);
});
