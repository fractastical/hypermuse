// How the triangle's turn actually moves, in degrees a second rather than in
// adjectives. Samples the live line's angle every frame and reports, for each
// turn, how long it took and how fast it got in the middle - the peak is what
// the eye reads as "too fast", not the duration.
//
//   node scripts/probe-poem-turn.mjs
//   EASE=1.6 node scripts/probe-poem-turn.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8253;
const BASE = `http://127.0.0.1:${PORT}`;
const SECONDS = Number(process.env.SECONDS || 26);
const EASES = (process.env.EASE || "0.9,1.3,1.7,2.2").split(",").map(Number);

const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

async function probe(ease) {
  const page = await context.newPage();
  const q = "poem=trinitypoem.txt&group=3&align=center&vcenter=1&color=white&fx=0" +
    `&cps=13&hold=1.6&safe=0.06&fit=0.97&layout=triangle&triease=${ease}`;
  await page.goto(`${BASE}/crt-terminal.html?${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hyperstitionStats?.frames > 40, { timeout: 15000 });

  // Sampled inside the page, on its own animation frames: sampling from here
  // over the wire lands nowhere near every frame and would flatten the peak.
  await page.evaluate((secs) => {
    window.__trace = [];
    const t0 = performance.now();
    const tick = () => {
      const st = window.__hyperstitionStats;
      window.__trace.push([performance.now() - t0, st.triLive, st.written]);
      if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
      else window.__traceDone = true;
    };
    requestAnimationFrame(tick);
  }, SECONDS);
  await page.waitForFunction(() => window.__traceDone === true, { timeout: (SECONDS + 12) * 1000 });
  const trace = await page.evaluate(() => window.__trace);
  await page.close();

  // A turn is a run of samples where the angle is off the base at all. The
  // angle is bumped a third at the instant a turn begins and the lines are
  // re-based by the same third, so that step is bookkeeping and cancels on
  // screen; only samples with a moving sample behind them are real motion.
  const turns = [];
  let run = null;
  for (let i = 1; i < trace.length; i++) {
    const [ms, a] = trace[i];
    const [pms, pa] = trace[i - 1];
    const moving = Math.abs(a) > 0.05;
    const wasMoving = Math.abs(pa) > 0.05;
    const rate = Math.abs(a - pa) / Math.max(1e-4, (ms - pms) / 1000);
    if (moving && !run) run = { start: pms, peak: 0 };
    if (run) {
      if (moving && wasMoving) run.peak = Math.max(run.peak, rate);
      if (!moving) { run.end = ms; turns.push(run); run = null; }
    }
  }
  const written = trace.map((s) => s[2]);
  // Characters that went down while the shape was moving: the thing the stall
  // exists to prevent.
  let duringTurn = 0;
  for (let i = 1; i < trace.length; i++) {
    if (Math.abs(trace[i][1]) > 0.05 && written[i] > written[i - 1]) duringTurn++;
  }
  const durs = turns.filter((t) => t.end).map((t) => (t.end - t.start) / 1000);
  const peaks = turns.filter((t) => t.end).map((t) => t.peak);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  console.log(
    `triease ${String(ease).padEnd(5)}`,
    "turns", String(durs.length).padStart(3),
    " each", avg(durs).toFixed(2).padStart(5) + "s",
    " peak", avg(peaks).toFixed(0).padStart(4) + " deg/s",
    " wrote mid-turn", String(duringTurn).padStart(3)
  );
  return { ease, dur: avg(durs), peak: avg(peaks) };
}

console.log("a 120 deg swing, eased; peak is the speed at the middle of it\n");
for (const e of EASES) await probe(e);

await browser.close();
server.kill();
process.exit(0);
