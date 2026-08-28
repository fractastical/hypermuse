// Pulls xfeeefeee.net release videos and cuts them down to clips that can sit
// in the moon circle.
//
// The site streams through a Bunny player, but it also publishes the finished
// files itself under /releases/ and links them from its own pages — those are
// what this fetches. They are 1440p masters, 100MB to 2.2GB each, which is far
// more than a disc a few hundred pixels across can show: everything gets
// centre-cropped to a square (the circle throws the sides away regardless) and
// re-encoded small enough that several can crossfade without costing frames.
//
//   node scripts/fetch-xfeeefeee.mjs --list
//   node scripts/fetch-xfeeefeee.mjs                      # the default set
//   node scripts/fetch-xfeeefeee.mjs kaleidoscope psychedelic_v2
//   SIZE=1080 node scripts/fetch-xfeeefeee.mjs --all      # everything, bigger
//
// Masters are kept in assets/xfeeefeee/masters so a re-cut does not re-download
// gigabytes; both directories are outside git, like the rest of the media.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const SITE = "https://xfeeefeee.net";
const UA = "Mozilla/5.0";
const OUT = path.resolve("assets/xfeeefeee");
const MASTERS = path.join(OUT, "masters");
const CIRCLE = path.join(OUT, "circle");
const SIZE = Number.parseInt(process.env.SIZE || "720", 10);
const CRF = process.env.CRF || "26";

// Reads well small and in a circle: motion that stays near the middle of frame,
// no burned-in titles down at the edges where the crop and the limb eat them.
const DEFAULTS = [
  "body-and-mind_loop_1440p",
  "kaleidoscope_1440p",
  "in-my-dreamz_1440p",
  "psychedelic_v2_1440p",
  "the-shadow-of-you_1440p_medium",
  "rhythm_1440p"
];

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

async function releases() {
  // The nav on any page lists every piece; each piece's page carries the
  // download links. Follow the redirects — the bare paths are 302s.
  const home = await (await fetch(SITE, { headers: { "user-agent": UA } })).text();
  const pages = [...new Set([...home.matchAll(/href="\/([a-z0-9-]+)"/g)].map((m) => m[1]))]
    .filter((p) => !/^(favicon|apple-touch|releases|about)/.test(p));
  const found = new Map();
  const scan = (html) => {
    for (const m of html.matchAll(/\/releases\/([^"'\s]+?\.mp4)/g)) {
      const file = decodeURIComponent(m[1]);
      found.set(file.replace(/\.mp4$/, ""), SITE + "/releases/" + m[1]);
    }
  };
  scan(home);
  // Politely serial rather than hammering someone's site with 40 sockets.
  for (const p of pages) {
    try {
      const r = await fetch(`${SITE}/${p}`, { headers: { "user-agent": UA }, redirect: "follow" });
      if (r.ok) scan(await r.text());
    } catch { /* a dead nav entry is not worth stopping for */ }
  }
  return found;
}

const size = (n) => (n > 1 << 30 ? (n / (1 << 30)).toFixed(1) + "GB" : Math.round(n / (1 << 20)) + "MB");

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  have   ${path.basename(dest)} (${size(fs.statSync(dest).size)})`);
    return;
  }
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const total = Number(r.headers.get("content-length") || 0);
  process.stdout.write(`  fetch  ${path.basename(dest)} (${size(total)}) `);
  // Streamed to a partial file and renamed, so an interrupted run does not
  // leave a truncated master that the next run believes it already has.
  const tmp = dest + ".part";
  const out = fs.createWriteStream(tmp);
  let got = 0, dot = 0;
  for await (const chunk of r.body) {
    out.write(chunk);
    got += chunk.length;
    if (total && got / total > dot / 20) { process.stdout.write("."); dot++; }
  }
  out.end();
  await new Promise((res, rej) => out.on("finish", res).on("error", rej));
  fs.renameSync(tmp, dest);
  console.log(" done");
}

function cut(master, dest) {
  // Square centre crop to the short edge, then down to SIZE. The moon circle
  // is inscribed in this square, so nothing outside it was ever going to show.
  const r = spawnSync(ffmpegPath, [
    "-y", "-loglevel", "error", "-i", master,
    "-vf", `crop='min(iw,ih)':'min(iw,ih)',scale=${SIZE}:${SIZE}:flags=lanczos`,
    "-an",                              // the backdrop plays muted anyway
    "-c:v", "libx264", "-crf", CRF, "-preset", "slow",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    dest
  ], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error("ffmpeg failed on " + master);
}

const all = await releases();
if (flag("--list")) {
  console.log(`${all.size} release videos on ${SITE}:`);
  [...all.keys()].sort().forEach((k) => console.log("  " + k));
  process.exit(0);
}

const wanted = flag("--all") ? [...all.keys()]
  : (args.filter((a) => !a.startsWith("--")).length
    ? args.filter((a) => !a.startsWith("--")) : DEFAULTS);

fs.mkdirSync(MASTERS, { recursive: true });
fs.mkdirSync(CIRCLE, { recursive: true });

const made = [];
for (const name of wanted) {
  // Accept a loose name: "kaleidoscope" finds kaleidoscope_1440p.
  const key = all.has(name) ? name
    : [...all.keys()].find((k) => k === name || k.startsWith(name + "_") || k.includes(name));
  if (!key) { console.log(`  skip   ${name} — no such release`); continue; }
  const short = key.replace(/_?1440p.*$/, "").replace(/_+$/, "");
  const master = path.join(MASTERS, key + ".mp4");
  const dest = path.join(CIRCLE, short + ".mp4");
  try {
    await download(all.get(key), master);
    if (fs.existsSync(dest)) console.log(`  have   circle/${short}.mp4`);
    else {
      process.stdout.write(`  cut    circle/${short}.mp4 … `);
      cut(master, dest);
      console.log(size(fs.statSync(dest).size));
    }
    made.push({ name: short, src: `assets/xfeeefeee/circle/${short}.mp4` });
  } catch (e) {
    console.log(`  fail   ${key}: ${e.message}`);
  }
}

// The controller reads this to fill its clip list, so a new cut shows up in the
// UI without anyone editing markup.
const manifest = path.join(CIRCLE, "manifest.json");
const prev = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")).clips || [] : [];
const merged = [...prev.filter((p) => !made.some((m) => m.name === p.name)), ...made]
  .filter((c) => fs.existsSync(path.resolve(c.src)))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(manifest, JSON.stringify({
  source: SITE, note: "release files published by xfeeefeee.net, centre-cropped square for the moon circle",
  clips: merged
}, null, 2) + "\n");
console.log(`\n${merged.length} clip(s) -> ${path.relative(process.cwd(), CIRCLE)}`);
