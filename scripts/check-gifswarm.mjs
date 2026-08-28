// Shoots the swarm on each approach of the anchored window — the moment it is
// built around — rather than at instants off a clock of its own. Two views per
// pass: the moon as an audience sees it, and the swarm's bare canvas next to
// it, so a word that is not reading can be blamed on the layout or on the
// window rather than guessed at.
//
//   PASSES=4 WORDS="hermes,-" npm exec -- node scripts/check-gifswarm.mjs
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";

const PORT = Number.parseInt(process.env.PORT || "8099", 10);
const PASSES = Number.parseInt(process.env.PASSES || "4", 10);
const WORDS = process.env.WORDS || "hermes";
const OUT = path.resolve("artifacts/gifswarm");

// A server already serving the repo is reused, which is the common case while
// working on this and saves half a minute of npx per run.
const reuse = await fetch(`http://127.0.0.1:${PORT}/hypermoon.html`)
  .then((r) => r.ok).catch(() => false);
const server = reuse ? null : spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "."], {
  stdio: "ignore", detached: true
});
const stop = () => { try { if (server) process.kill(-server.pid); } catch { /* gone */ } };

try {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; !reuse; i++) {
    const up = await fetch(`http://127.0.0.1:${PORT}/hypermoon.html`)
      .then((r) => r.ok).catch(() => false);
    if (up) break;
    if (i > 40) throw new Error("http-server never came up on " + PORT);
    await new Promise((r) => setTimeout(r, 500));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") console.log("  page:", m.text());
  });
  await page.goto(`http://127.0.0.1:${PORT}/hypermoon.html?content=gifswarm` +
    `&gifwords=${encodeURIComponent(WORDS)}&nosound=1&stars=0&meteors=0&vajras=0&speed=0.5` +
    (process.env.EXTRA || ""), { waitUntil: "domcontentloaded" });

  // Three dozen gifs take a moment to decode; nothing is worth shooting until
  // the swarm has something in it.
  await page.waitForFunction(
    () => window.__gifswarm && window.__gifswarm.sourceCount() > 8, null, { timeout: 90000 });
  console.log("gifs decoded");

  // page.screenshot blocks on webfonts that never settle here; CDP just grabs
  // the framebuffer.
  const cdp = await page.context().newCDPSession(page);
  const angle = () => page.evaluate(() => window.__hyperstitionStats.facingAngle);
  for (let pass = 0; pass < PASSES; pass++) {
    // Round the back first, so each pass is a fresh approach and not the same
    // one photographed twice.
    for (let i = 0; i < 600 && Math.abs(await angle()) < 1.6; i++) {
      await new Promise((r) => setTimeout(r, 80));
    }
    for (let i = 0; i < 600 && Math.abs(await angle()) > 0.12; i++) {
      await new Promise((r) => setTimeout(r, 60));
    }
    const n = String(pass).padStart(2, "0");
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `m${n}.png`), Buffer.from(data, "base64"));
    const raw = await page.evaluate(() => window.__gifswarm.texture.image.toDataURL("image/png"));
    fs.writeFileSync(path.join(OUT, `c${n}.png`), Buffer.from(raw.split(",")[1], "base64"));
    const s = await page.evaluate(() => window.__gifswarm.state());
    console.log(`  pass ${pass}  angle ${(await angle()).toFixed(2)}  form ${s.form.toFixed(2)}` +
      `  R ${s.R.toFixed(2)}  opening ${s.VW.toFixed(0)}x${s.VH.toFixed(0)}  cells ${s.cells}`);
  }

  const cols = Math.min(2, PASSES);
  const rows = Math.ceil(PASSES / cols);
  spawnSync(ffmpegPath, [
    "-y", "-loglevel", "error", "-i", path.join(OUT, "m%02d.png"),
    "-vf", `crop=660:660:170:170,scale=420:420,tile=${cols}x${rows}`,
    "-frames:v", "1", path.join(OUT, "moon.png")
  ]);
  spawnSync(ffmpegPath, [
    "-y", "-loglevel", "error", "-i", path.join(OUT, "c%02d.png"),
    "-vf", `scale=420:420,tile=${cols}x${rows}`,
    "-frames:v", "1", path.join(OUT, "sheet.png")
  ]);
  console.log(`moon  -> ${path.relative(process.cwd(), path.join(OUT, "moon.png"))}`);
  console.log(`sheet -> ${path.relative(process.cwd(), path.join(OUT, "sheet.png"))}`);
  await browser.close();
} finally {
  stop();
}
