// Shoots the candidate looks for a two-projector poem set, at the true 16:9 of
// a 402 x 226 cm surface, and lays them out as labelled screen pairs.
//
//   node scripts/preview-poem-screens.mjs
//
// Writes artifacts/poem-screens/*.png plus a contact sheet.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const ROOT = process.cwd();
const OUTDIR = path.join(ROOT, "artifacts", "poem-screens");
const PORT = 8251;
const BASE = `http://127.0.0.1:${PORT}`;
const W = 1280, H = 720;                       // 16:9, as the surface is

// The poem is 27 stanzas of nine three-word lines. The CRT script format is
// "|" for a line and "~" for the next screen, so a stanza is a screen exactly.
const raw = fs.readFileSync(path.join(ROOT, "trinitypoem.txt"), "utf8").replace(/\r/g, "");
const stanzas = [];
let cur = [];
for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t) { if (cur.length) { stanzas.push(cur); cur = []; } } else cur.push(t);
}
if (cur.length) stanzas.push(cur);
const crtScript = stanzas.map((s) => s.join("|")).join("~");
const moonLines = stanzas.flat().join("|");

fs.mkdirSync(OUTDIR, { recursive: true });
const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"]
});
const context = await browser.newContext({ viewport: { width: W, height: H } });

async function shoot(name, url, waitMs) {
  const page = await context.newPage();
  await page.goto(`${BASE}/${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const f = path.join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: f });
  await page.close();
  console.log("  shot", name);
  return f;
}

const q = encodeURIComponent;
const shots = {};
// The moon as it already runs.
shots.moon = await shoot("moon", "hypermoon.html?stars=700&meteors=8", 9000);
// These are about layout, not typing, so the stills are taken with the screen
// typed instantly and held: chasing a live 13-a-second type just catches a
// half-written screen. A show would run cps=13.
const held = "cps=400&hold=90";
// What the controller's "open poem output" opens: three lines at a time,
// centred, fitted just shy of the longest line in the poem.
const poem = `poem=trinitypoem.txt&group=3&align=center&vcenter=1&safe=0.06&fit=0.97&${held}`;
// Quiet: the register to open on.
shots.crtWhite = await shoot("poem-quiet", `crt-terminal.html?${poem}&color=white&fx=0`, 2500);
// Transmission: the same text in the oath's voice, one control away.
shots.crtGreen = await shoot("poem-transmission", `crt-terminal.html?${poem}&color=green&fx=1`, 2500);
// Three words to a side. Nine words is a screen, which is why it fits.
shots.tri = await shoot("poem-triangle",
  `crt-terminal.html?${poem}&color=white&fx=0&layout=triangle`, 2500);
// Kept for the record: the moon carrying the poem itself. The dark-side panel
// is sized for one word, so three-word lines run off the limb - the reason the
// poem has a surface of its own.
if (process.env.MOON_SPEAKS) {
  shots.moonSpeaks = await shoot("moon-speaks",
    `hypermoon.html?stars=700&meteors=8&peek=0.5&text=${q(moonLines)}`, 11000);
}

// Lay the candidates out as the pairs they would actually be projected as. The
// caption goes in a band under the frame rather than over it - the triangle
// runs to the bottom of its safe box and a bar across the picture would sit on
// the words.
const label = (src, text, out) => {
  execFileSync(ffmpeg, ["-y", "-i", src, "-vf",
    `pad=${W}:${H + 46}:0:0:black,` +
    `drawtext=text='${text}':x=18:y=${H + 12}:fontsize=24:fontcolor=white`,
    out], { stdio: "ignore" });
};
const pairs = [
  ["quiet", shots.moon, "PROJECTOR 1  the moon", shots.crtWhite, "PROJECTOR 2  the poem, quiet"],
  ["transmission", shots.moon, "PROJECTOR 1  the moon", shots.crtGreen, "PROJECTOR 2  the poem, as transmission"],
  ["triangle", shots.moon, "PROJECTOR 1  the moon", shots.tri, "PROJECTOR 2  three words a side"]
];
const sheets = [];
for (const [name, a, la, b, lb] of pairs) {
  label(a, la, "/tmp/pa.png");
  label(b, lb, "/tmp/pb.png");
  const out = path.join(OUTDIR, `${name}.png`);
  execFileSync(ffmpeg, ["-y", "-i", "/tmp/pa.png", "-i", "/tmp/pb.png",
    "-filter_complex", "[0][1]hstack=inputs=2,pad=iw+48:ih+48:24:24:black", out], { stdio: "ignore" });
  sheets.push(out);
  console.log("  pair ", name);
}
execFileSync(ffmpeg, ["-y", ...sheets.flatMap((s) => ["-i", s]),
  "-filter_complex", `[0][1][2]vstack=inputs=3,scale=1600:-1`,
  path.join(OUTDIR, "options.png")], { stdio: "ignore" });

// How long the poem runs, so it can be placed against the moon's hour. As a
// turning triangle it runs longer: nothing is written while it turns, so every
// line costs its swing on top of its characters.
const CPS = 13, HOLD = 3.2, EASE = 0.9;
const screens = stanzas.reduce((n, s) => n + Math.ceil(s.length / 3), 0);
const lines = stanzas.reduce((n, s) => n + s.length, 0);
const chars = stanzas.flat().reduce((n, l) => n + l.length + 1, 0);
const secs = chars / CPS + screens * HOLD;
const clock = (s) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
console.log(`\n${stanzas.length} stanzas -> ${screens} screens of three lines`);
console.log(`at ${CPS} characters a second with a ${HOLD}s hold, the poem runs ` +
  `${clock(secs)} flat, ${clock(secs + lines * EASE)} as a turning triangle`);
console.log(path.relative(ROOT, path.join(OUTDIR, "options.png")));
await browser.close();
server.kill();
process.exit(0);
