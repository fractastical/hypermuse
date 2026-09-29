#!/usr/bin/env node
// Drives book/scan.html in Chrome: reads photos through the file picker, then a
// fake camera stream through the live loop. The unkeyed cover must NOT read.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const ROOT = process.cwd();
const PORT = 8791;
const SIM = path.join(ROOT, "artifacts", "cover-phrase-sim");
const TYPES = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("no");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const url = `http://127.0.0.1:${PORT}/book/scan.html`;

const photos = [
  ["keyed cover, the file itself", "book/blockchain-chronicles-cover-rd1a-phrase.png", true],
  ["unkeyed cover (must fail)", "book/blockchain-chronicles-cover-rd1a.png", false],
  ...fs.readdirSync(SIM).filter((f) => f.endsWith(".jpg")).sort()
    .map((f) => [`simulated ${f}`, path.join("artifacts/cover-phrase-sim", f), null])
];

let failures = 0;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
page.on("pageerror", (e) => { console.log("page error:", e.message); failures++; });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true);
for (const [name, file, expect] of photos) {
  await page.locator("#found").evaluate((el) => el.classList.remove("on"));
  await page.setInputFiles("#file", path.join(ROOT, file));
  await page.waitForFunction(() => window.__lastRead && window.__lastReadSeen !== window.__lastRead, undefined, { timeout: 60000 });
  const r = await page.evaluate(() => { window.__lastReadSeen = window.__lastRead; return window.__lastRead; });
  const verdict = expect === null ? "" : (expect === (r.text === "vires in numeris") ? "  pass" : "  FAIL");
  if (verdict.includes("FAIL")) failures++;
  console.log(`${name.padEnd(36)} ${String(r.text).padEnd(18)} ${r.ms.toFixed(0).padStart(5)} ms${verdict}`);
}
await browser.close();

// The live loop, fed a still photo as if it were the camera.
const still = path.join(SIM, "case1.jpg");
const y4m = path.join(SIM, "camera.y4m");
spawnSync(ffmpegPath, ["-y", "-loop", "1", "-i", still, "-t", "4", "-r", "15", "-pix_fmt", "yuv420p", y4m], { stdio: "ignore" });
const cam = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`]
});
const cpage = await cam.newPage({ viewport: { width: 500, height: 900 } });
cpage.on("pageerror", (e) => { console.log("page error:", e.message); failures++; });
await cpage.goto(url);
await cpage.waitForFunction(() => window.__ready === true);
await cpage.click("#start");
try {
  await cpage.waitForFunction(() => window.__lastRead && window.__lastRead.text, undefined, { timeout: 30000 });
  const r = await cpage.evaluate(() => window.__lastRead);
  console.log(`${"live camera (fake stream)".padEnd(36)} ${r.text.padEnd(18)} ${r.ms.toFixed(0).padStart(5)} ms  frame ${r.frames}`);
  await cpage.screenshot({ path: path.join(SIM, "found.png") });
} catch {
  const r = await cpage.evaluate(() => window.__lastRead);
  console.log("live camera: nothing read", JSON.stringify(r));
  failures++;
}
await cam.close();
server.close();
console.log(failures ? `${failures} failure(s)` : "all checks passed");
process.exit(failures ? 1 : 0);
