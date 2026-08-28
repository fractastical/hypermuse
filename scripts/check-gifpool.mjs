// What each act of the orbit sequence actually flies, act by act.
//
// A scraped theme is never all usable, and the two ways it fails are different.
// Curation catches the wrong subject — a torch that happened to sit on a page
// about something else — and that needs an eye. The loader catches the wrong
// shape: a gif whose background cannot be keyed to transparency is a rectangle,
// and a rectangle in orbit reads as a floating postage stamp, so it is dropped
// at decode time. This reports both, so a thin act is visible before a show
// rather than during one, and writes a sheet of the survivors over a checker so
// anything still reading as a tile can be seen and rejected by name.
//
//   npm run gifs:pool                          # the acts the show is set to
//   THEMES="coral,starfish" npm run gifs:pool  # one act
//   RAW=1 THEMES=boobs npm run gifs:pool       # plus every scraped gif, uncurated
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const OUT = path.resolve("artifacts/gifpool");
const COLS = 8;

// The show's own sequence is the default, so this reports on what will run.
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const url = ((pkg.scripts["kiosk:show"] || "").match(/"(http:\/\/[^"]+)"/) || [])[1] || "";
const seq = new URLSearchParams(url.split("?")[1] || "").get("orbitseq") || "";
const ACTS = (process.env.THEMES || seq).split("|").map((s) => s.trim()).filter(Boolean);
if (!ACTS.length) { console.error("no acts: set THEMES or orbitseq in kiosk:show"); process.exit(1); }

const idx = JSON.parse(fs.readFileSync("assets/gifcities/index.json", "utf8"));
let marks = {};
try { marks = JSON.parse(fs.readFileSync("assets/gifcities/curation.json", "utf8")); } catch { /* none */ }
const base = idx.base || "assets/gifcities/";
const themeFiles = (slug) => (idx.themes[slug]?.gifs || []).map((g) => base + slug + "/" + g.file);
const curated = (spec) => spec.split(",")
  .flatMap((s) => themeFiles(s.trim())).filter((p) => marks[p] !== "reject");

const reuse = await fetch(`http://127.0.0.1:${PORT}/hypermoon.html`).then((r) => r.ok).catch(() => false);
const server = reuse ? null : spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "."],
  { stdio: "ignore", detached: true });
const stop = () => { try { if (server) process.kill(-server.pid); } catch { /* gone */ } };

try {
  for (let i = 0; !reuse; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/hypermoon.html`).then((r) => r.ok).catch(() => false)) break;
    if (i > 40) throw new Error("http-server never came up on " + PORT);
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const spec of ACTS) {
    // "vajra" is a reserved act name: it flies the dorje loops rather than the
    // library, so there is no pool to report on.
    if (/^vajras?$/.test(spec)) {
      console.log(`${spec.padEnd(30)} the vajras' own act — no gifs`);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.goto(`http://127.0.0.1:${PORT}/hypermoon.html?content=orbit` +
      `&orbitseq=${encodeURIComponent(spec)}&giforbit=8&nosound=1&stars=0&meteors=0&vajras=0`,
      { waitUntil: "domcontentloaded" });

    // Each gif is dozens of async round trips, so the count only means
    // something once it has stopped climbing.
    let last = -1, still = 0, kept = 0;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(500);
      kept = await page.evaluate(() => window.__gifswarm?.sourceCount?.() ?? -1);
      still = kept === last ? still + 1 : 0;
      last = kept;
      if (still >= 8 && kept > 0) break;
    }
    // The pool is shuffled and only its first 32 are decoded, so a large theme
    // is sampled rather than exhausted — the drop count is out of what it tried.
    const tried = Math.min(32, curated(spec).length);
    console.log(`${spec.padEnd(30)} curated ${String(curated(spec).length).padStart(3)}` +
      `  tried ${String(tried).padStart(3)}  flies ${String(kept).padStart(3)}` +
      `  dropped as tiles ${tried - kept}`);

    const shot = await page.evaluate((cols) => {
      const pool = window.__gifswarm.pool();
      const cell = 128, pad = 16, rows = Math.ceil(pool.length / cols) || 1;
      const cv = document.createElement("canvas");
      cv.width = cols * cell;
      cv.height = rows * (cell + pad);
      const g = cv.getContext("2d");
      g.fillStyle = "#111";
      g.fillRect(0, 0, cv.width, cv.height);
      pool.forEach((p, i) => {
        const ox = (i % cols) * cell, oy = Math.floor(i / cols) * (cell + pad);
        // Checker, so an opaque background is impossible to miss.
        for (let k = 0; k < 64; k++) {
          g.fillStyle = ((k % 8) + Math.floor(k / 8)) % 2 ? "#00c07a" : "#c000a0";
          g.fillRect(ox + (k % 8) * cell / 8, oy + Math.floor(k / 8) * cell / 8, cell / 8, cell / 8);
        }
        const b = p.bmp, s = Math.min(cell / b.width, cell / b.height, 1);
        g.drawImage(b, ox + (cell - b.width * s) / 2, oy + (cell - b.height * s) / 2,
          b.width * s, b.height * s);
        g.fillStyle = "#fff";
        g.font = "11px monospace";
        g.fillText(i + " " + p.src.split("/").pop().slice(0, 20), ox + 2, oy + cell + 12);
      });
      return { url: cv.toDataURL("image/png"), names: pool.map((p) => p.src) };
    }, COLS);

    const name = spec.replace(/[^a-z0-9]+/g, "-");
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(shot.url.split(",")[1], "base64"));
    fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(shot.names, null, 2) + "\n");
    await page.close();
  }

  // Everything a theme scraped, curation and keying both ignored: the sheet to
  // mark up when a fresh scrape needs triaging.
  if (process.env.RAW) {
    for (const slug of [...new Set(ACTS.flatMap((a) => a.split(",").map((s) => s.trim())))]) {
      const files = themeFiles(slug);
      if (!files.length) continue;
      const cells = files.map((f, i) => `<figure><div class=c><img src="/${f}"></div>` +
        `<figcaption>${i} ${marks[f] === "reject" ? "[rejected] " : ""}` +
        `${f.split("/").pop().slice(0, 28)}</figcaption></figure>`).join("");
      const page = await browser.newPage({ viewport: { width: 7 * 154 + 8, height: 1000 } });
      await page.route("**/__sheet", (r) => r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta charset=utf-8><style>
          body{margin:0;background:#111;color:#fff;font:11px monospace;display:grid;
            grid-template-columns:repeat(7,150px);gap:4px;padding:4px}
          .c{width:150px;height:150px;display:grid;place-items:center;
            background:repeating-conic-gradient(#c000a0 0 25%,#00c07a 0 50%) 0 0/24px 24px}
          img{max-width:150px;max-height:150px} figure{margin:0}
          figcaption{word-break:break-all;line-height:1.1;padding:1px}
        </style>${cells}`
      }));
      await page.goto(`http://127.0.0.1:${PORT}/__sheet`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      fs.writeFileSync(path.join(OUT, "raw-" + slug + ".png"),
        await page.screenshot({ fullPage: true }));
      console.log(`raw ${slug}: ${files.length} scraped`);
      await page.close();
    }
  }

  await browser.close();
  console.log("sheets -> " + path.relative(process.cwd(), OUT));
} finally {
  stop();
}
