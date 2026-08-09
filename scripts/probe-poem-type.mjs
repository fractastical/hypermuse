// What the poem screen's type actually measures on a 402 x 226 cm surface.
// Reports capital height in centimetres and the distance it reads from, for a
// few groupings, so the pacing is chosen on a number rather than a guess.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8252;
const BASE = `http://127.0.0.1:${PORT}`;
const H_CM = Number(process.env.H_CM || 226);   // surface height
const W = 1280, H = 720;                        // 16:9, as the surface is

const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle"] });
const context = await browser.newContext({ viewport: { width: W, height: H } });

async function measure(label, query) {
  const page = await context.newPage();
  await page.goto(`${BASE}/crt-terminal.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hyperstitionStats
    && window.__hyperstitionStats.fontPx > 0
    && window.__hyperstitionStats.frames > 1, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const s = await page.evaluate(() => {
    const st = window.__hyperstitionStats;
    return { fontPx: st.fontPx, frames: st.frames, align: st.align, group: st.group };
  });
  await page.close();
  // Cap height is about 0.7 em in this face; the usual sign rule is that text
  // reads comfortably at 150x its capital height, and at a push 200x.
  const capCm = (0.7 * s.fontPx / H) * H_CM;
  console.log(
    label.padEnd(26),
    "screens", String(s.frames).padStart(4),
    " font", (s.fontPx).toFixed(1).padStart(6) + "px",
    " caps", capCm.toFixed(1).padStart(5) + "cm",
    " reads to", (capCm * 150 / 100).toFixed(0).padStart(3) + "m",
    " (max " + (capCm * 200 / 100).toFixed(0) + "m)"
  );
  return capCm;
}

const poem = "poem=trinitypoem.txt&align=center&vcenter=1&color=white&fx=0&cps=400&hold=90";
console.log(`surface ${H_CM} cm high, 16:9\n`);
await measure("whole stanza", `${poem}&safe=0.1`);
await measure("3 lines", `${poem}&group=3&safe=0.1`);
await measure("3 lines, tight", `${poem}&group=3&safe=0.06`);
await measure("3 lines, fit p99", `${poem}&group=3&safe=0.06&fit=0.99`);
await measure("3 lines, fit p97", `${poem}&group=3&safe=0.06&fit=0.97`);
await measure("3 lines, fit p90", `${poem}&group=3&safe=0.06&fit=0.90`);
console.log();
// The turning triangle rests square on one of three identical orientations, so
// it measures the same as one that never moves; only a free spin pays.
await measure("triangle, turning", `${poem}&group=3&safe=0.06&fit=0.97&layout=triangle`);
await measure("triangle, held still", `${poem}&group=3&safe=0.06&fit=0.97&layout=triangle&trifollow=0`);
await measure("triangle, free spin", `${poem}&group=3&safe=0.06&fit=0.97&layout=triangle&trispin=6`);

await browser.close();
server.kill();
process.exit(0);
