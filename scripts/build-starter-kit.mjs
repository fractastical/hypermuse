// Build the small media set that ships in git so a fresh clone runs the show
// without scraping or downloading anything first.
//
// The repo already tracks a web-ready set for this reason — the moon discs, the
// vajra proxies, the eye backdrop — but the two things the show now leans on
// hardest were missing from it. The GifCities library and the xfeeefeee clips
// are both fetched by script, so a clone had an empty orbit and an iris opening
// onto black.
//
// What goes in is read off the kiosk:show launch URL rather than listed here,
// so the kit is by construction whatever the show actually asks for: change the
// rotation or the orbit themes and the next build follows.
//
//   npm run starter            # build what is missing
//   FORCE=1 npm run starter    # rebuild everything
//   SECONDS=90 npm run starter # longer clip excerpts
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, rmSync, readdirSync
} from "node:fs";
import { basename, join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const OUT = "assets/starter";
const CLIP_DIR = `${OUT}/clips`;
const GIF_DIR = `${OUT}/gifs`;
const GIF_SRC = "assets/gifcities";
const FORCE = process.env.FORCE === "1";
// One backdrop slot long, so an excerpt is swapped out at about the moment it
// would have looped and nobody sees it repeat.
const SECS = Math.max(5, Number(process.env.SECONDS) || 60);
// Through the aperture at 1080p this is indistinguishable from the 720p master:
// the clips are soft glows and gradients, which is what compresses to nothing.
const SIZE = Math.max(64, Number(process.env.SIZE) || 360);
// 33 rather than a safer 30 because the aperture veils the clip behind a 40%
// opaque moon, which hides encoder noise the same way it hides everything else.
const CRF = Math.max(1, Number(process.env.CRF) || 33);

const ffprobe = execFileSync("bash", ["-lc", "command -v ffprobe"]).toString().trim();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const show = pkg.scripts["kiosk:show"] || "";
const url = (show.match(/"(http:\/\/[^"]+)"/) || [])[1] || "";
if (!url) {
  console.error("could not find the show URL in package.json scripts.kiosk:show");
  process.exit(1);
}
const q = new URLSearchParams(url.split("?")[1] || "");

// --- what the show asks for ------------------------------------------------
const clips = [...new Set((q.get("backdrop") || "").split(",")
  .map((s) => s.trim()).filter((s) => /\.(mp4|webm|mov|m4v)$/i.test(s)))];
// orbitseq is acts separated by |, each act one or more comma-separated themes.
// "vajra" and "metavillan" are reserved act names rather than themes — they fly
// the dorje loops and the collected marks, both already tracked in the repo — so
// there is nothing to subset for either.
const RESERVED = /^(vajras?|metavillan|mv)$/;
const themes = [...new Set((q.get("orbitseq") || "").split("|")
  .flatMap((act) => act.split(",")).map((s) => s.trim().toLowerCase())
  .filter((s) => s && !RESERVED.test(s)))];

console.log(`show wants ${clips.length} clip(s) and ${themes.length} gif theme(s)`);
if (!clips.length && !themes.length) {
  console.error("nothing to do — the show URL has no backdrop or orbitseq");
  process.exit(1);
}

mkdirSync(CLIP_DIR, { recursive: true });
mkdirSync(GIF_DIR, { recursive: true });

// --- clips -----------------------------------------------------------------
const clipsOut = [];
for (const src of clips) {
  const out = join(CLIP_DIR, basename(src));
  if (!existsSync(src)) {
    console.log(`  ${basename(src)}: source missing, skipped (run npm run clips / clips:cut)`);
    continue;
  }
  if (existsSync(out) && !FORCE) {
    console.log(`  ${basename(src)}: already built`);
    clipsOut.push({ src, out });
    continue;
  }
  const dur = parseFloat(execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src
  ]).toString().trim()) || 0;
  // A fifth of the way in clears the title cards these releases open on, and
  // the credit crawl they close on, without having to hand-pick a window.
  const start = dur > SECS ? +(dur * 0.2).toFixed(2) : 0;
  const take = dur > SECS ? SECS : Math.max(1, dur);
  execFileSync(ffmpegPath, [
    "-nostdin", "-v", "error", "-y",
    "-ss", String(start), "-i", src, "-t", String(take),
    "-an", "-vf", `scale=${SIZE}:${SIZE}`,
    "-c:v", "libx264", "-crf", String(CRF), "-preset", "slow",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", out
  ]);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`  ${basename(src)}: ${start}s +${take.toFixed(0)}s at ${SIZE}px -> ${kb} KB`);
  clipsOut.push({ src, out });
}

// --- gifs ------------------------------------------------------------------
// These need no transcoding: they are 90s web gifs, tens of KB each. All the
// kit does is drop the ones already marked reject, so a clone inherits the
// triage instead of orbiting the duds. Because the marks are keyed by their
// path under assets/gifcities, they will not match the copies here — which is
// correct, since the rejects are gone rather than needing to be filtered.
let marks = {};
try { marks = JSON.parse(readFileSync(`${GIF_SRC}/curation.json`, "utf8")); } catch { /* none */ }
let index = null;
try { index = JSON.parse(readFileSync(`${GIF_SRC}/index.json`, "utf8")); } catch { /* none */ }

const starterThemes = {};
let gifCount = 0, gifBytes = 0;
if (!index) {
  console.log("  no gifcities index — skipping gifs (run npm run gifs)");
} else {
  for (const slug of themes) {
    const theme = (index.themes || {})[slug];
    if (!theme) { console.log(`  ${slug}: not scraped, skipped`); continue; }
    const dir = join(GIF_DIR, slug);
    if (existsSync(dir) && FORCE) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const kept = [];
    for (const g of theme.gifs) {
      const from = join(GIF_SRC, slug, g.file);
      if (!existsSync(from)) continue;
      if (marks[`${GIF_SRC}/${slug}/${g.file}`] === "reject") continue;
      const to = join(dir, g.file);
      if (!existsSync(to)) copyFileSync(from, to);
      gifBytes += statSync(to).size;
      kept.push(g);
    }
    // Anything left from an earlier build whose mark has since changed.
    const want = new Set(kept.map((g) => g.file));
    for (const f of readdirSync(dir)) if (!want.has(f)) rmSync(join(dir, f));
    if (!kept.length) { rmSync(dir, { recursive: true, force: true }); continue; }
    starterThemes[slug] = { query: theme.query, gifs: kept };
    gifCount += kept.length;
    console.log(`  ${slug}: ${kept.length} of ${theme.gifs.length} kept`);
  }
  // base tells the page where these live, so the same loader serves the real
  // library and this one without knowing which it got.
  writeFileSync(`${GIF_DIR}/index.json`, JSON.stringify({
    built: new Date().toISOString(),
    base: `${GIF_DIR}/`,
    note: "Starter subset, pre-curated. npm run gifs fetches the full library.",
    themes: starterThemes
  }, null, 2) + "\n");
}

// --- manifest --------------------------------------------------------------
const clipBytes = clipsOut.reduce((a, c) => a + statSync(c.out).size, 0);
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  built: new Date().toISOString(),
  note: "Low-bandwidth media tracked in git so a fresh clone runs the show. " +
    "The page prefers the full media and falls back to these, so having the " +
    "masters locally costs nothing. npm run gifs / clips / clips:cut fetch the real thing.",
  excerptSeconds: SECS,
  clipSize: SIZE,
  clips: clipsOut.map((c) => ({ src: c.out, from: c.src })),
  gifThemes: Object.keys(starterThemes),
  gifs: gifCount
}, null, 2) + "\n");

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log(`\nclips: ${clipsOut.length} (${mb(clipBytes)})`);
console.log(`gifs:  ${gifCount} across ${Object.keys(starterThemes).length} theme(s) (${mb(gifBytes)})`);
console.log(`total: ${mb(clipBytes + gifBytes)}`);
