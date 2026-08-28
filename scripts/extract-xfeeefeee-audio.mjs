// Lifts the soundtrack out of the xfeeefeee masters as AIFF, so the tracks can
// be played from rekordbox while the muted clip runs behind the moon.
//
// The circle cuts are encoded -an: the backdrop is muted by the browser anyway
// (autoplay is only granted to muted video), so the audio only exists in the
// 1440p masters that scripts/fetch-xfeeefeee.mjs keeps. This reads those.
//
//   node scripts/extract-xfeeefeee-audio.mjs
//   node scripts/extract-xfeeefeee-audio.mjs rhythm      # just one
//   BITS=24 node scripts/extract-xfeeefeee-audio.mjs     # if you insist
//
// AIFF rather than WAV because rekordbox reads ID3 out of AIFF, so the tracks
// arrive with a title and artist instead of a filename. Output lands in
// audio/, which is gitignored like the rest of the media.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const MASTERS = path.resolve("assets/xfeeefeee/masters");
const OUT = path.resolve("audio/xfeeefeee");
const ARTIST = "xfeeefeee";
// 16-bit is the DJ standard and the source is lossy AAC — 24 would only make
// the files bigger without recovering anything that was thrown away.
const BITS = process.env.BITS === "24" ? "pcm_s24be" : "pcm_s16be";

// Release names carry the encode in them; the part before it is the track, and
// a trailing _loop / _v2 is a variant worth keeping visible in the title.
// Articles, conjunctions and short prepositions stay down mid-title; pronouns
// like "my" and "you" do not, and the last word is always up.
const SMALL = new Set(["a", "an", "and", "but", "or", "of", "the", "in", "on", "at", "to", "for", "with", "by"]);
function title(key) {
  const bare = key.replace(/_?1440p.*$/, "").replace(/_+$/, "");
  const variant = /_loop$/.test(bare) ? " (Loop)" : /_v(\d+)$/.test(bare) ? ` (v${bare.match(/_v(\d+)$/)[1]})` : "";
  const words = bare.replace(/_(loop|v\d+)$/, "").split(/[-_]+/).filter(Boolean);
  return words
    .map((w, i) => (i > 0 && i < words.length - 1 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ") + variant;
}

function probe(file) {
  const r = spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const a = out.match(/Audio: (\w+).*?, (\d+) Hz, (\w+)/);
  return a ? { codec: a[1], rate: a[2], layout: a[3] } : null;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!fs.existsSync(MASTERS)) {
  console.error(`no masters in ${path.relative(process.cwd(), MASTERS)} — run npm run clips first`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const masters = fs.readdirSync(MASTERS).filter((n) => n.endsWith(".mp4"));
const wanted = args.length
  ? masters.filter((n) => args.some((a) => n.includes(a)))
  : masters;
if (!wanted.length) {
  console.error(`nothing matched ${args.join(", ")} in ${masters.length} master(s)`);
  process.exit(1);
}

const size = (n) => Math.round(n / (1 << 20)) + "MB";
const made = [];
for (const file of wanted.sort()) {
  const src = path.join(MASTERS, file);
  const key = file.replace(/\.mp4$/, "");
  const name = title(key);
  const dest = path.join(OUT, `${ARTIST} - ${name}.aiff`);
  const info = probe(src);
  if (!info) { console.log(`  skip   ${name} — no audio stream`); continue; }
  if (fs.existsSync(dest)) { console.log(`  have   ${path.basename(dest)} (${size(fs.statSync(dest).size)})`); made.push(dest); continue; }
  process.stdout.write(`  write  ${path.basename(dest)} (${info.rate} Hz) … `);
  // No resampling and no normalisation: the sample rate stays whatever the
  // release was mastered at, and the level stays put so rekordbox analyses the
  // track's own gain rather than something this script decided.
  const r = spawnSync(ffmpegPath, [
    "-y", "-loglevel", "error", "-i", src,
    "-vn",
    "-c:a", BITS,
    // Drop the mp4 container's own tags (major_brand and friends) rather than
    // carrying them into the AIFF, then write only the three that mean
    // something in a rekordbox browser.
    "-map_metadata", "-1",
    "-write_id3v2", "1",
    "-metadata", `title=${name}`,
    "-metadata", `artist=${ARTIST}`,
    "-metadata", "album=xfeeefeee releases",
    dest
  ], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) { console.log("failed"); continue; }
  console.log(size(fs.statSync(dest).size));
  made.push(dest);
}

const total = made.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`\n${made.length} track(s), ${size(total)} -> ${path.relative(process.cwd(), OUT)}`);
console.log("add that folder to rekordbox (File > Import > Import Folder) and analyse.");
