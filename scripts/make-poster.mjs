#!/usr/bin/env node
/**
 * A one-sheet poster of the rig, with a guest's mark on the moon.
 *
 * Two steps, both of them renders. First export-holofan shoots the hire tower
 * at night in portrait with its spec-sheet annotations off and one person
 * beside it, carrying whatever mark was asked for on the disc. Then poster.html
 * sets the headline under it and the sheet is screenshotted.
 *
 *   npm run poster
 *   MARK=assets/marks/monogram.svg npm run poster
 *   HEAD="I'm putting *my name* on the moon." npm run poster
 *   REPLATE=1 npm run poster        # reshoot the render, not just the type
 *
 * The plate is the slow half - about a minute, because the moon has to be
 * filmed square and then played back through the simulated LED arm - so it is
 * kept on disk and reused until the mark or REPLATE says otherwise.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, process.env.OUT || "artifacts/poster/hypermoon-poster.png");
const PLATE = path.resolve(ROOT, process.env.PLATE || "artifacts/poster/plate.png");
const MARK = process.env.MARK || "assets/marks/yourname.svg";
const W = Number.parseInt(process.env.POSTER_W || "1080", 10);
const H = Number.parseInt(process.env.POSTER_H || "1350", 10);
// Twice the layout size, so the sheet holds up printed as well as posted.
const SCALE = Number.parseFloat(process.env.POSTER_SCALE || "2");

const WORDS = {
  kicker: process.env.KICKER || "HYPERMOON",
  tag: process.env.TAG ?? "ON A Ø180 CM FAN",
  head: process.env.HEAD || "I'm putting my name on the *dark side of the moon*.",
  sub: process.env.SUB ||
    "A Ø180 cm holographic fan on a 4.3 m tower, turning your mark over the floor all night.",
  accent: process.env.ACCENT || "#6fd3ff"
};

// Which mark the plate on disk was shot with. Changing the mark has to reshoot
// it, and forgetting that is how you end up shipping somebody else's name.
const STAMP = PLATE.replace(/\.png$/, ".json");
const wantStamp = JSON.stringify({ mark: MARK, w: W, h: H });
const stale = () => {
  if (!fs.existsSync(PLATE)) return true;
  try { return fs.readFileSync(STAMP, "utf8") !== wantStamp; } catch { return true; }
};

function renderPlate() {
  console.log(`[poster] shooting the rig with ${MARK}`);
  const r = spawnSync(process.execPath, ["scripts/export-holofan.mjs"], {
    cwd: ROOT, stdio: "inherit",
    env: {
      ...process.env,
      SHOT: "rig", STILL: "1", FACE: "1", SRC_MS: "9000",
      // Nearly stopped: the mark is waited for until it is square to the
      // camera, and then it has to still be there when the frame is taken.
      MOON_SPEED: "0.05",
      SOURCE_VIDEO: "artifacts/poster-source.mp4",
      MOON_QUERY: new URLSearchParams({
        logo: MARK, logomode: "plain", peek: "0",
        // Bigger and denser than the disc normally carries a guest. A poster is
        // read across a room, and the LED grid eats fine strokes.
        logoscale: "2.4", logoink: "0.62"
      }).toString(),
      EXPORT_WIDTH: String(W), EXPORT_HEIGHT: String(H),
      OUTPUT_STILL: path.relative(ROOT, PLATE),
      FAN_QUERY: new URLSearchParams({
        // No dimension arrows and no caption: this is the photograph, not the
        // drawing. The person stays, because the tower means nothing without.
        label: "0", rigdim: "0", dim: "0", people: "1",
        personx: "-1.95", personz: "0.6",
        // Aimed low so the disc rides the top third and the floor is left
        // clear for the words.
        aim: "0.5", haze: "0.8"
      }).toString()
    }
  });
  if (r.status !== 0) throw new Error("the plate render failed");
  fs.writeFileSync(STAMP, wantStamp);
}

(async () => {
  fs.mkdirSync(path.dirname(PLATE), { recursive: true });
  if (stale() || process.env.REPLATE === "1") renderPlate();
  else console.log(`[poster] reusing ${path.relative(ROOT, PLATE)} (REPLATE=1 to reshoot)`);

  const q = new URLSearchParams({ plate: path.relative(ROOT, PLATE), ...WORDS });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: W, height: H }, deviceScaleFactor: SCALE
  });
  await page.goto(`file://${path.join(ROOT, "poster.html")}?${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__posterReady === true, undefined, { timeout: 20000 });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log(`[poster] ${path.relative(ROOT, OUT)}  ${W * SCALE}x${H * SCALE}`);
})();
