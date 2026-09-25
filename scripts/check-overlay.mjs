#!/usr/bin/env node
// Shoots the overlay at the kiosk's real size, with an optional band drawn where
// something physically covers the screen — a ratchet strap over the glass, the
// edge of a frame — so the panels can be moved clear of it by looking rather than
// by carrying a laptop back and forth to the installation.
//
//   npm run hermes:overlay
//   STRAP=340,120 npm run hermes:overlay          # a band 120px tall, 340px down
//   EXTRA="&hermesbartop=470&hermesbarh=96" npm run hermes:overlay
//   SIZE=3840x2160 npm run hermes:overlay
//
// The band is drawn on top of the shot and is not part of the page. Needs the
// server: npm start.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.env.OUT || "artifacts/overlay";
mkdirSync(OUT, { recursive: true });

const [w, h] = (process.env.SIZE || "1920x1080").split("x").map(Number);
const strap = (process.env.STRAP || "").split(",").map(Number).filter(Number.isFinite);
const port = process.env.PORT || 8124;
const q = "hermes=1&content=orbit&orbitseq=metavillan&nosound=1&stars=0&meteors=0" +
  (process.env.EXTRA || "");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on("console", (m) => { if (m.type() === "error") console.log("  page:", m.text()); });
await page.goto(`http://127.0.0.1:${port}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });
// The overlay only exists once the listings have been fetched, so waiting on the
// element is also waiting on the server having answered.
// Attached rather than visible: the panels are transparent by design and a card
// mid-transition is at zero opacity, both of which read as invisible.
await page.waitForSelector(".hermes-panel", { state: "attached", timeout: 20000 });
await page.waitForTimeout(2500);

// What the layout is actually doing, which the picture cannot tell you: whether
// a line is clipped is invisible when the clipped part is the part you cannot see.
const report = await page.evaluate(() => {
  const out = [];
  for (const sel of [".hermes-bar", ".hermes-right", ".hermes-map-panel",
    ".hermes-event-title", ".hermes-event-meta", ".hermes-event-desc",
    ".hermes-place", ".hermes-kicker"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const box = el.getBoundingClientRect();
    out.push({
      sel,
      box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      // Wider content than box means an ellipsis is eating something.
      clipped: el.scrollWidth > el.clientWidth + 1
        ? `${el.scrollWidth - el.clientWidth}px cut`
        : "",
      text: (el.textContent || "").trim().slice(0, 54)
    });
  }
  return out;
});
for (const r of report) {
  const [x, y, bw, bh] = r.box;
  console.log(`  ${r.sel.padEnd(22)} ${String(x).padStart(5)},${String(y).padStart(5)}` +
    ` ${String(bw).padStart(5)}x${String(bh).padStart(4)}  ${r.clipped.padEnd(9)} ${r.text}`);
}

if (strap.length === 2) {
  const [at, tall] = strap;
  await page.evaluate(([top, height]) => {
    const band = document.createElement("div");
    band.style.cssText = `position:fixed;left:0;right:0;top:${top}px;height:${height}px;` +
      "z-index:9999;background:repeating-linear-gradient(45deg," +
      "rgba(255,80,80,.5) 0 18px,rgba(0,0,0,.5) 18px 36px);" +
      "border-top:2px solid #ff5050;border-bottom:2px solid #ff5050";
    document.body.appendChild(band);
  }, [at, tall]);
  console.log(`\n  strap band drawn at y=${at}..${at + tall}`);
  const hit = report.filter((r) => r.box[1] < at + tall && r.box[1] + r.box[3] > at);
  for (const r of hit) console.log(`  UNDER THE STRAP: ${r.sel} — ${r.text}`);
  if (!hit.length) console.log("  nothing under the strap");
}

const name = process.env.NAME || "overlay";
writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ type: "png" }));
await browser.close();
console.log(`\nshot -> ${OUT}/${name}.png  (${w}x${h})`);
