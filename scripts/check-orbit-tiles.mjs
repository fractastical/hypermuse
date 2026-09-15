#!/usr/bin/env node
// Proves the mosaic's hypermoon tiles orbit the gifs they were asked for.
//
//   node scripts/check-orbit-tiles.mjs
//
// Two checks, because the tile token and the theme names fail independently: the
// moon page alone with a plural orbit sequence, then a mosaic whose tiles were
// pinned through the same path the controller uses.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = "artifacts/orbit-check";
mkdirSync(OUT, { recursive: true });

// Installed Chrome rather than a bundled build: this repo's gifs and clips are
// checked against the browser the show actually runs in.
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
let failures = 0;

function report(name, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

// The gif paths carry their theme as the folder, so what is flying is readable
// from the network log without reaching into the scene graph.
async function orbitThemesLoaded(page, ms) {
  const seen = new Set();
  page.on("response", (r) => {
    const m = /\/assets\/gifcities\/([^/]+)\//.exec(r.url());
    if (m && r.status() < 400) seen.add(m[1]);
  });
  await page.waitForTimeout(ms);
  return seen;
}

{
  const page = await context.newPage();
  // orbitact is seconds an act holds, so three acts need three times it plus the
  // fades. At its floor of 4 that is inside a twenty second watch.
  const seenPromise = page.goto(
    `${BASE}/hypermoon.html?kiosk=1&content=orbit&orbitseq=wizards|wands|pyramids&orbitact=4&giforbit=8`
  );
  const themes = await orbitThemesLoaded(page, 20000);
  await seenPromise;
  await page.screenshot({ path: join(OUT, "moon-orbit.png") });
  const wanted = ["wizard", "wand", "pyramid"];
  const missing = wanted.filter((t) => !themes.has(t));
  report(
    "plural orbit names resolve",
    missing.length === 0,
    missing.length ? `never loaded ${missing.join(", ")}; saw ${[...themes].join(", ") || "nothing"}`
      : `loaded ${wanted.join(", ")}`
  );
  await page.close();
}

{
  const page = await context.newPage();
  // Six tiles, which is what the golden-ratio subdivision yields. ";" between them so
  // the commas inside an orbit's theme list stay part of that orbit.
  const tiles = ["video", "hypermoon:wizard", "video", "hypermoon:wands,pyramids", "video", "hypermoon"];
  const reported = page.waitForEvent("console", {
    predicate: (m) => m.text().startsWith("tilecount "),
    timeout: 20000
  }).catch(() => null);
  // The controller hears the visual over the 'sonicsphere' channel when it did not
  // open the window itself, so listen where it listens rather than for a message
  // event the page would never post to itself.
  await page.addInitScript(() => {
    new BroadcastChannel("sonicsphere").addEventListener("message", (e) => {
      if (e.data && e.data.type === "vjMosaicTileCount") console.log("tilecount " + e.data.count);
    });
  });
  await page.goto(`${BASE}/sonicsphere.html?mode=classic&fxtimeline=0&mosaic=1&mosaictiles=${encodeURIComponent(tiles.join(";"))}&set=sets/set-live-default-all-loops.json`);
  await page.waitForTimeout(10000);
  const frames = await page.evaluate(() =>
    [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src") || "")
  );
  const moonFrames = frames.filter((s) => s.includes("hypermoon.html"));
  report("mosaic builds every pinned moon tile", moonFrames.length === 3, `${moonFrames.length} moon iframes`);
  report(
    "orbit sequence reaches the tile url",
    moonFrames.some((s) => /orbitseq=wizard(&|$)/.test(s)) &&
      moonFrames.some((s) => /orbitseq=wands%2Cpyramids/.test(s)) &&
      moonFrames.some((s) => !s.includes("orbitseq")),
    moonFrames.join("  ") || "none"
  );
  const countMessage = await reported;
  report(
    "tile count is reported to the controller",
    !!countMessage && countMessage.text() === "tilecount " + tiles.length,
    countMessage ? countMessage.text() : "no vjMosaicTileCount message"
  );
  await page.screenshot({ path: join(OUT, "mosaic-orbit.png") });
  await page.close();
}

await browser.close();
console.log(failures ? `\n  ${failures} check(s) failed` : "\n  all checks passed");
process.exit(failures ? 1 : 0);
