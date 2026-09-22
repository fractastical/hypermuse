#!/usr/bin/env node
// Builds the public annals: the days, the photographs somebody chose in
// annals-curator.html, re-encoded small enough to open on a phone, and a comment box.
//
//   npm run hermes:annals:publish            # say what it would do
//   npm run hermes:annals:publish -- --apply
//
// Nothing is published that was not chosen. The curation file is a list of what may
// go out, so an absent or empty file means an empty page rather than the whole dump —
// the failure mode has to be "too little" and never "everyone's camera roll".
//
// Output is self-contained under docs/annals/, which GitHub Pages already serves from
// main, so publishing is a commit and a push rather than a deploy.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const apply = process.argv.includes("--apply");
// The people who asked Hermes for a ride gave their names to a pickup box, not to a
// public page, so their requests stay out unless someone decides otherwise.
const withRequests = process.argv.includes("--with-requests");
// Some of what was photographed is topless, which is unremarkable on the playa and a
// different thing entirely on a page a stranger might open at work or hand to a relative.
// So the default build leaves those out and --explicit puts them back: the censored
// version is the one you get by forgetting to think about it, which is the right way
// round for a mistake that cannot be taken back once it is indexed.
const withExplicit = process.argv.includes("--explicit");
// resolve rather than join, so --out and --curation accept an absolute path.
const outDir = resolve(repo, arg("out", join("docs", "annals")));
const curationPath = resolve(repo, arg("curation", join("data", "hermes", "annals-curation.json")));
const STILL_MAX = Number(arg("still-max", 1600));
const VIDEO_MAX_H = Number(arg("video-max", 720));
const COMMENT_API = arg("api", "https://returnofhermes.com/api/hermes/annals/comments");
// Same host as the comments: the page is a static file and the only thing that can
// remember a visitor is the server that already keeps what people write.
const VISITS_API = COMMENT_API.replace(/\/comments$/, "/visits");
// Absolute, because this page is also served from GitHub Pages under /hypermuse/, where a
// root-relative /book would land on github.io itself rather than on Hermes.
const BOOK_URL = arg("book", "https://returnofhermes.com/book");
const INSTAGRAM = arg("instagram", "https://www.instagram.com/hermesartcar/");

const mb = (bytes) => (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB";
// Midday UTC and a UTC formatter, because a bare date parsed as local and printed as local
// is fine here and wrong on a machine east of the meridian, where it lands on the day before.
const shortDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB",
  { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function annalsJson() {
  const { stdout } = await execFileAsync("node", ["scripts/hermes-annals.mjs", "--json"],
    { cwd: repo, maxBuffer: 1 << 26 });
  const parsed = JSON.parse(stdout);
  const days = parsed.days || parsed.entries || parsed;
  return Array.isArray(days) ? days : Object.values(days);
}

if (!existsSync(curationPath)) {
  console.error("No curation file at " + curationPath);
  console.error("Open annals-curator.html, choose the photographs, and save the download there.");
  process.exit(1);
}
const curation = JSON.parse(readFileSync(curationPath, "utf8"));
const chosen = new Map(Object.entries(curation.publish || {})
  .filter(([, v]) => v && v.publish)
  .map(([src, v]) => [src, v]));
if (chosen.size === 0) {
  console.error("The curation file has nothing marked for publishing. Nothing to do.");
  process.exit(1);
}

const isVideo = (src) => /\.(mp4|mov|m4v|webm)$/i.test(src);
const posterSource = (src) => src.replace(/\.[^.]+$/, "") + ".poster.jpg";
// One flat media folder, prefixed by day, so the published names carry no camera
// serials into anything and two days cannot collide on IMG_0001.
const publishedName = (day, src, ext) =>
  day + "-" + basename(src, extname(src)).replace(/[^a-zA-Z0-9_-]+/g, "-") + ext;

const days = await annalsJson();
const plan = [];
let sourceBytes = 0;
const heldBack = [];
const explicitMarked = [];

function mediaFor(dayKey, items) {
  const media = [];
  for (const item of items || []) {
    const mark = chosen.get(item.src);
    if (!mark) continue;
    if (mark.explicit) {
      explicitMarked.push(item.src);
      if (!withExplicit) { heldBack.push(item.src); continue; }
    }
    const abs = join(repo, item.src);
    if (!existsSync(abs)) {
      console.warn("  chosen but missing, skipping: " + item.src);
      continue;
    }
    sourceBytes += statSync(abs).size;
    const video = isVideo(item.src);
    media.push({
      src: item.src,
      abs,
      video,
      // Captions from the curator win: it is the newer decision and the one made
      // while actually looking at the photograph.
      caption: mark.caption || item.caption || "",
      art: item.art || "",
      lead: !!mark.lead,
      name: publishedName(dayKey, item.src, video ? ".mp4" : ".jpg"),
      poster: video ? publishedName(dayKey, item.src, ".poster.jpg") : "",
      posterAbs: video ? join(repo, posterSource(item.src)) : ""
    });
  }
  return media;
}

for (const day of days) {
  const media = mediaFor(day.day, day.media);
  if (media.length === 0 && !(day.account || "").trim()) continue;
  plan.push({ day, media });
}

// What was photographed before the tracker was running: Hermes on the playa at Juplaya in
// July, and the build days before the first logged one. hermes-annals.mjs takes its days
// from the GPS log, so these dates are not days of the annals at all and choosing them in
// the curator was never going to put them on the page — the publisher never saw them.
//
// They go in a prologue rather than into the sequence. A day there carries a map, a list of
// stops and an account read off the track, and these have no track to read: dropped into
// the sequence they would be three days arguing that nothing happened, with July sitting
// seven weeks up the page from August and a gap in the contents where the summer was.
const trackedDays = new Set(days.map((d) => d.day));
const dayOfSource = (src) => (src.match(/hermes-annals\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || "";
const beforeDays = new Map();
for (const src of chosen.keys()) {
  const day = dayOfSource(src);
  if (!day || trackedDays.has(day)) continue;
  if (!beforeDays.has(day)) beforeDays.set(day, []);
  beforeDays.get(day).push({ src });
}
const prologue = [...beforeDays.keys()].sort()
  .map((day) => ({ day: { day }, media: mediaFor(day, beforeDays.get(day)) }))
  .filter((entry) => entry.media.length);

const totalMedia = plan.reduce((n, p) => n + p.media.length, 0) +
  prologue.reduce((n, p) => n + p.media.length, 0);
console.log("  " + chosen.size + " chosen · " + totalMedia + " publishable across " +
  plan.filter((p) => p.media.length).length + " days · " + mb(sourceBytes) + " of source");
if (prologue.length) {
  console.log("  " + prologue.reduce((n, p) => n + p.media.length, 0) +
    " of them before the log starts, going in the prologue: " +
    prologue.map((p) => p.day.day).join(", "));
}
// Counted separately from the line above, which would otherwise report them as chosen
// files missing from the annals and read like a curation mistake rather than a decision.
if (chosen.size - heldBack.length !== totalMedia) {
  console.log("  " + (chosen.size - heldBack.length - totalMedia) +
    " chosen file(s) are not in any day of the annals");
}
if (heldBack.length) {
  console.log("  " + heldBack.length + " held back as explicit (--explicit includes them):");
  for (const src of heldBack) console.log("      " + src);
} else if (withExplicit && explicitMarked.length) {
  // Worth saying out loud rather than building quietly, because this is the build that
  // puts them on a public page and the flag is easy to leave in a shell history.
  console.log("  --explicit: publishing " + explicitMarked.length + " explicit file(s):");
  for (const src of explicitMarked) console.log("      " + src);
} else if (withExplicit) {
  console.log("  --explicit given, but nothing is marked explicit in the curation file");
}

if (!apply) {
  for (const { day, media } of [...prologue, ...plan]) {
    console.log("  " + day.day + "  " + (media.length || "no") + " shot(s)" +
      (media.length ? "  " + media.map((m) => (m.video ? "clip" : "still")).join(", ") : ""));
  }
  console.log("\n  Dry run. Add --apply to write " + outDir.replace(repo + "/", "") + ".");
  process.exit(0);
}

// The day maps, built separately by hermes-day-maps.mjs because they come from the track
// log rather than from anything anyone chose. Missing is not an error: the annals read
// perfectly well without them, and saying so beats failing the whole build.
const mapSourceDir = join(repo, "artifacts", "hermes-annals", "maps");
const mapDays = new Set();
let mapDim = "";
if (existsSync(join(mapSourceDir, "playa-streets.svg"))) {
  for (const name of readdirSync(mapSourceDir)) {
    const match = /^(\d{4}-\d{2}-\d{2})\.track\.svg$/.exec(name);
    if (match) mapDays.add(match[1]);
  }
  // Read off the base map rather than written down here, so the tags follow the map
  // generator if its canvas ever changes size.
  const head = readFileSync(join(mapSourceDir, "playa-streets.svg"), "utf8").slice(0, 400);
  const w = (head.match(/width="(\d+)"/) || [])[1];
  const h = (head.match(/height="(\d+)"/) || [])[1];
  if (w && h) mapDim = ` width="${w}" height="${h}"`;
}

// Who gets a link when the copy names them. Kept out of the accounts themselves because
// the accounts are escaped on the way out — which is what stops a narrative from being a
// hole in the page — so a credit has to be reattached after escaping rather than typed in.
const creditsPath = join(repo, "data", "hermes", "annals-credits.json");
const credits = existsSync(creditsPath)
  ? (JSON.parse(readFileSync(creditsPath, "utf8")).people || {})
  : {};
// Longest first, so someone whose name contains another's is linked as themselves.
const creditNames = Object.keys(credits).sort((a, b) => b.length - a.length);

const mediaDir = join(outDir, "media");
// A rebuild after unchoosing something must not leave the old file behind, still
// reachable by anyone who kept the link.
if (existsSync(mediaDir)) rmSync(mediaDir, { recursive: true, force: true });
mkdirSync(mediaDir, { recursive: true });

const mapOutDir = join(outDir, "maps");
if (existsSync(mapOutDir)) rmSync(mapOutDir, { recursive: true, force: true });
if (mapDays.size) {
  mkdirSync(mapOutDir, { recursive: true });
  copyFileSync(join(mapSourceDir, "playa-streets.svg"), join(mapOutDir, "playa-streets.svg"));
  for (const day of mapDays) {
    copyFileSync(join(mapSourceDir, day + ".track.svg"), join(mapOutDir, day + ".track.svg"));
  }
}

// The public programme: what the week was meant to be, printed before it happened. It
// belongs at the top rather than on any one day, because half of what it lists never got
// recorded and a third of what the days describe is not on it. Its own hedge — a 30%
// chance of finding Hermes anywhere named — is the honest part, and the reason the
// accounts below are the record and this is only the intention.
const programSource = join(repo, "assets", "hermes-annals", "program", "public-program.png");
const hasProgram = existsSync(programSource);
if (hasProgram) copyFileSync(programSource, join(outDir, "public-program.png"));
const programSize = hasProgram ? await pixelSize(programSource) : null;

// The Source Library booklet on the god the car is named after: seven nested-circle
// diagrams from 1540 to 2012, and an essay on why a messenger and thief is the right
// patron for a vehicle that spent the week carrying people across the playa at night.
// Offered as a download rather than summarised, because it is somebody else's work.
const readingSource = join(repo, "assets", "hermes-annals", "reading", "seven-circles-of-hermes.pdf");
const reading = existsSync(readingSource)
  ? { file: "seven-circles-of-hermes.pdf", size: statSync(readingSource).size }
  : null;
if (reading) copyFileSync(readingSource, join(outDir, reading.file));

// Photographs of the art the days name, cached by hermes-art-photos.mjs. Named pieces
// without a picture ask the reader to trust a name for a thing they have never seen.
// These come from the 2025 archive because it is the last one published and the annals
// are 2026 — so the page says which year they are, rather than letting a photograph
// imply it was taken on the night described.
const artSourceDir = join(repo, "assets", "hermes-annals", "art");
const artManifestPath = join(artSourceDir, "manifest.json");
const artPhotos = existsSync(artManifestPath)
  ? JSON.parse(readFileSync(artManifestPath, "utf8"))
  : { pieces: {}, year: null };
const artOutDir = join(outDir, "art");
if (existsSync(artOutDir)) rmSync(artOutDir, { recursive: true, force: true });
if (Object.keys(artPhotos.pieces).length) {
  mkdirSync(artOutDir, { recursive: true });
  for (const piece of Object.values(artPhotos.pieces)) {
    copyFileSync(join(artSourceDir, piece.file), join(artOutDir, piece.file));
  }
}

// Every figure needs its finished pixel size on the tag. Without it the browser gives a
// lazy image no room until it arrives, so the page grows under the reader as photographs
// load — and an anchor from the contents lands wherever the page happened to be a moment
// ago. Sixty-one lazy images put the Saturday link 1,118 pixels wide of Saturday.
async function pixelSize(file) {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1]);
  const height = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1]);
  return width && height ? { width, height } : null;
}

async function encodeStill(item) {
  const dest = join(mediaDir, item.name);
  await execFileAsync("sips", ["-Z", String(STILL_MAX), "-s", "format", "jpeg",
    "-s", "formatOptions", "80", item.abs, "--out", dest]);
  item.size = await pixelSize(dest);
  return statSync(dest).size;
}

/** Seconds, or 0 when ffprobe cannot say — treated as short, which is the common case. */
async function clipSeconds(file) {
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error",
      "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// Most clips here run ten or twenty seconds, and one runs five minutes. At the settings
// that suit the short ones that single clip encoded to 57 MB — as much as the rest of the
// annals put together, committed to the repository for good. A long handheld clip is
// watched for the moment in it rather than for its detail, so length buys a smaller frame
// and a looser quantiser instead of a bigger file.
const LONG_CLIP_S = 90;

async function encodeVideo(item) {
  const dest = join(mediaDir, item.name);
  const long = await clipSeconds(item.abs) > LONG_CLIP_S;
  const height = long ? 540 : VIDEO_MAX_H;
  // 720p and crf 28: these are handheld night clips on a phone screen, where the
  // grain costs more bits than the detail is worth. Audio kept, because people talk
  // in them, but mono at 96k since nothing here is music.
  await execFileAsync("ffmpeg", ["-y", "-nostdin", "-loglevel", "error", "-i", item.abs,
    "-vf", "scale=-2:'min(" + height + ",ih)'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", long ? "33" : "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", long ? "64k" : "96k", "-ac", "1",
    "-movflags", "+faststart", dest]);
  let bytes = statSync(dest).size;
  if (item.posterAbs && existsSync(item.posterAbs)) {
    const posterDest = join(mediaDir, item.poster);
    await execFileAsync("sips", ["-Z", String(STILL_MAX), "-s", "format", "jpeg",
      "-s", "formatOptions", "72", item.posterAbs, "--out", posterDest]);
    bytes += statSync(posterDest).size;
    // The poster's shape is the video's shape, and it is the one the browser has to
    // reserve room for while preload="none" keeps the clip itself off the wire.
    item.size = await pixelSize(posterDest);
  } else {
    item.poster = "";
  }
  return bytes;
}

let outBytes = 0;
for (const { day, media } of [...prologue, ...plan]) {
  for (const item of media) {
    process.stdout.write("  " + day.day + " " + item.name + " … ");
    try {
      const bytes = item.video ? await encodeVideo(item) : await encodeStill(item);
      outBytes += bytes;
      console.log(mb(bytes));
    } catch (error) {
      console.log("failed: " + String(error.message || error).split("\n")[0]);
      item.failed = true;
    }
  }
}

// Tiles for the contents: three per day, so a headline comes with a glimpse of what
// clicking it gets you. Encoded small on purpose rather than the day's photographs
// shrunk by the browser — thirty-odd full-size jpegs above the fold would cost more
// than the eleven days below them, which is the opposite of what a contents list is for.
const TILE_PX = 72;
const TILES_PER_DAY = 3;
const tileDir = join(outDir, "tiles");
if (existsSync(tileDir)) rmSync(tileDir, { recursive: true, force: true });
mkdirSync(tileDir, { recursive: true });
let tileBytes = 0;
for (const entry of [...prologue, ...plan]) {
  entry.tiles = [];
  // The lead first, since it is the shot already judged best; a clip contributes the
  // poster frame, and one without a poster has nothing to show and is passed over.
  const shots = entry.media.filter((m) => !m.failed);
  const ordered = [...shots.filter((m) => m.lead), ...shots.filter((m) => !m.lead)];
  for (const item of ordered) {
    if (entry.tiles.length >= TILES_PER_DAY) break;
    const from = item.video ? item.poster : item.name;
    if (!from) continue;
    const source = join(mediaDir, from);
    if (!existsSync(source)) continue;
    const file = `${entry.day.day}-${entry.tiles.length + 1}.jpg`;
    try {
      // ffmpeg rather than sips, which wrote 8 KB for a 72 by 54 tile — over two bytes
      // a pixel, nearly all of it metadata it will not leave out. Same picture comes
      // out of here at 2 KB. Scale to cover then crop, so a tile is a true square and
      // both the tag and the layout can say so without the css cropping anything.
      await execFileAsync("ffmpeg", ["-y", "-nostdin", "-loglevel", "error", "-i", source,
        "-vf", `scale=${TILE_PX}:${TILE_PX}:force_original_aspect_ratio=increase,crop=${TILE_PX}:${TILE_PX}`,
        "-q:v", "6", join(tileDir, file)]);
    } catch (_) {
      continue;
    }
    tileBytes += statSync(join(tileDir, file)).size;
    entry.tiles.push({ file });
  }
}

function figureFor(item, lead = false) {
  const caption = esc([item.art, item.caption].filter(Boolean).join(" · "));
  const cap = caption ? `<figcaption>${caption}</figcaption>` : "";
  const cls = lead ? ' class="lead"' : "";
  const dim = item.size ? ` width="${item.size.width}" height="${item.size.height}"` : "";
  if (!item.video) {
    // The lead is the one image worth fetching before the reader scrolls to it.
    const loading = lead ? "" : ' loading="lazy"';
    return `<figure${cls}><img src="media/${esc(item.name)}" alt="${caption || "A photograph from the annals"}"${dim}${loading}>${cap}</figure>`;
  }
  const poster = item.poster ? ` poster="media/${esc(item.poster)}"` : "";
  return `<figure${cls}><video src="media/${esc(item.name)}" controls playsinline preload="none"${poster}${dim}></video>${cap}</figure>`;
}

/** The day's map, if one was built for it: the track over the shared street plan. */
function mapFor(day) {
  if (!mapDays.has(day)) return "";
  // The base map sets the box the track is laid over, so it is the one image on a day
  // whose height everything below depends on. An svg has no size until it is fetched,
  // which is eleven map-shaped jumps down the page if the tag does not say.
  return `<div class="daymap">
    <img src="maps/playa-streets.svg" alt="" aria-hidden="true"${mapDim}>
    <img src="maps/${esc(day)}.track.svg" alt="Where Hermes went on ${esc(day)}"${mapDim}>
  </div>
<p class="mapnote">Where it went. Each circle is somewhere Hermes stopped, drawn larger the
longer it stayed; green is the first of the day, red the last. The dashed curves are the
moves between them — curved because what survives is where it stood, not the route it took
to get there. The shaded ground is roughly the territory the day covered.</p>`;
}

/**
 * Turns the first mention of a credited name into a link. Runs on already-escaped text,
 * so the only markup in the result is the anchor this function put there.
 */
function linkCredits(escaped) {
  let out = escaped;
  for (const name of creditNames) {
    const safeName = esc(name);
    if (!out.includes(safeName)) continue;
    // String replace, not a regex, so it takes the first mention and leaves the rest.
    out = out.replace(safeName,
      `<a href="${esc(credits[name])}" rel="noopener">${safeName}</a>`);
  }
  return out;
}

/**
 * The line under each day. It used to open with a count of GPS readings, which tells a
 * reader nothing they can feel — nobody knows whether 677 is a lot. Hours and distance
 * they can picture, and a day of one reading is better described than counted.
 */
function metaLine(facts) {
  const parts = [];
  if (facts.firstFix && facts.lastFix && facts.firstFix !== facts.lastFix) {
    parts.push(`Out from ${esc(facts.firstFix)} until ${esc(facts.lastFix)}`);
  } else if (facts.firstFix) {
    parts.push(`Seen once, at ${esc(facts.firstFix)}`);
  }
  // Both gated on having actually gone somewhere. On 28 August the day is split into two
  // "outings" across seventy metres of car park, and printing that beside an account of
  // standing still just makes the page argue with itself.
  const moved = facts.metres > 100;
  if (facts.distance && moved) parts.push(esc(facts.distance));
  if (facts.journeys > 1 && moved) parts.push(`${facts.journeys} outings`);
  return parts.join(" · ");
}

// Said once per day, under the list, because it qualifies every distance above it. Burning
// Man publishes each year's art archive after the event, so 2026 does not exist yet and
// these are matched to where things stood in 2025: most big pieces come back, some in the
// same place, and a photograph will otherwise be read as taken on the night described.
const artNote = artPhotos.year
  ? `<p class="artnote">Photographs and placements from Burning Man's ${artPhotos.year} art
archive, the most recent published. These are 2026 nights, so treat a distance as roughly
where a piece stood the year before, and a picture as of the piece rather than of that
night.</p>`
  : "";

function sectionFor({ day, media }) {
  const facts = day.facts || {};
  const shots = media.filter((m) => !m.failed);
  const stops = (facts.stops || []).map((s) =>
    `<li><strong>${esc(s.place)}</strong> — ${esc(s.dwell)} from ${esc(s.from)}${s.visits > 1 ? ` across ${s.visits} visits` : ""}</li>`).join("");
  // A picture where there is one, the name alone where there is not, rather than a broken
  // frame or a grey box standing in for a thing that exists and simply was not photographed.
  const art = (facts.art || []).map((a) => {
    const photo = artPhotos.pieces[a.name];
    const img = photo
      ? `<img src="art/${esc(photo.file)}" alt="${esc(a.name)}" loading="lazy">`
      : `<span class="nopic" aria-hidden="true"></span>`;
    // The index's "artist" is the hometown — it carries "Rome, Italy" where the archive
    // has "Pepemaniak" — so a credit taken from it names a city as the maker. The archive
    // has both fields properly, so prefer it and keep the index only as a fallback.
    const who = [photo && photo.artist, photo ? photo.hometown : a.artist]
      .filter(Boolean).join(", ");
    return `<li>${img}<span class="what"><strong>${esc(a.name)}</strong>` +
      `<span class="how">within ${a.closestM} metres${who ? ` · ${esc(who)}` : ""}</span></span></li>`;
  }).join("");
  const requests = withRequests ? (facts.requests || []).map((r) =>
    `<li><strong>${esc(r.who)}</strong> — ${esc(r.kind)}${r.place ? ` at ${esc(r.place)}` : ""}${r.intention ? ` — ${esc(r.intention)}` : ""}</li>`).join("") : "";
  // Prefixed, so #day-2026-09-02 both links to the day and can be selected in css;
  // a bare id starting with a digit is legal html but not a legal selector.
  // The best-of leads, above the account, so a day opens on a photograph rather than on
  // a paragraph. Nothing marked means no lead: a day is not obliged to have a best one.
  const lead = shots.find((s) => s.lead);
  const rest = shots.filter((s) => s !== lead);
  return `<section id="day-${esc(day.day)}">
<h2><a href="#day-${esc(day.day)}">${esc(facts.dayName || day.day)}</a></h2>
<p class="headline">${esc(day.headline || "")}</p>
${lead ? figureFor(lead, true) : ""}
<p>${linkCredits(esc(day.account || ""))}</p>
${mapFor(day.day)}
<p class="meta">${metaLine(facts)}</p>
${stops ? `<h3>Stops</h3><ul>${stops}</ul>` : ""}
${art ? `<h3>Art within reach</h3><ul class="artlist">${art}</ul>${artNote}` : ""}
${requests ? `<h3>Asked of Hermes</h3><ul>${requests}</ul>` : ""}
${rest.length ? `<h3>Shoots</h3><div class="shots">${rest.map((s) => figureFor(s)).join("")}</div>` : ""}
<div class="comments" data-day="${esc(day.day)}">
  <h3>Comments</h3>
  <div class="comment-list" hidden></div>
  <form class="comment-form">
    <input type="text" name="who" placeholder="your name" maxlength="60" required>
    <textarea name="body" placeholder="what you remember of this day…" maxlength="1200" rows="3" required></textarea>
    <button type="submit">leave it on the record</button>
    <span class="comment-status"></span>
  </form>
</div>
</section>`;
}

/**
 * The prologue: what there is from before the log begins. No map, no stops and no meta
 * line, because there is no track behind any of it — saying so once at the top is honester
 * than printing three empty day frames and leaving the reader to wonder what is missing.
 */
function prologueSection() {
  if (!prologue.length) return "";
  const blocks = prologue.map(({ day, media }) => {
    const shots = media.filter((m) => !m.failed);
    if (!shots.length) return "";
    return `<h3>${esc(shortDay(day.day))}</h3>\n<div class="shots">` +
      shots.map((s) => figureFor(s)).join("") + "</div>";
  }).filter(Boolean).join("\n");
  return `<section id="before">
<h2><a href="#before">Before</a></h2>
<p class="headline">Juplaya in July, and the build days before the log starts</p>
<p>The track begins on the twenty-eighth of August, so none of this is a day in the account
below: there is nothing to draw and no stops to list. It is here because it happened. Hermes
was out on the Black Rock playa in July, two months early — parked at Spanky's Wine Bar after
dark, and out on open ground at golden hour — and the same propeller and rope-wound lamps
turn up again in the build days at the end of August, when the car stood unlit in the daylight
and the first sets were played off its deck before there was a week to play them in.</p>
${blocks}
</section>`;
}

const publishedDays = plan.filter((p) => p.media.length || (p.day.account || "").trim());
// One GeoCities sprite per classic orbit theme, beside the counter. The visitor
// number picks which, so a reload of the same count shows the same picture.
const guestManifestPath = join(repo, "docs", "annals", "gifs", "manifest.json");
const guests = existsSync(guestManifestPath)
  ? (JSON.parse(readFileSync(guestManifestPath, "utf8")).gifs || [])
  : [];
// 111 opens the count, shown as seven digits. The leading place was added after
// the other six and opens on the fairy; the six behind it keep their sprites.
const GUEST_FROM = 111;
const PLACES = 7;
const fairyAt = Math.max(0, guests.findIndex((g) => g.theme === "fairy"));
function guestFor(n, digit, place) {
  if (!guests.length) return null;
  const span = guests.length;
  const shift = Math.floor(Number(n) || 0) - GUEST_FROM;
  const raw = place === 0
    ? fairyAt + Number(digit) + shift
    : Number(digit) + (place - 1) + shift;
  const i = ((raw % span) + span) % span;
  return guests[i];
}
function digitCells(n) {
  const digits = String(Math.max(0, Number(n) || 0)).padStart(PLACES, "0").slice(-PLACES);
  return digits.split("").map((d, i) => {
    const g = guestFor(n, d, i);
    const img = g
      ? `<img src="gifs/${esc(g.file)}" alt="${esc(g.theme)}" width="${Number(g.w) || 48}" height="${Number(g.h) || 48}">`
      : "";
    return `<span class="cell">${img}<span class="n" data-d="${d}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></span>`;
  }).join("");
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Annals of Hermes</title>
<meta name="description" content="A day by day account of Hermes on the playa, ${publishedDays.length} days of it.">
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#06090f; color:#f4faff; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 30px; margin: 0 0 6px; }
  .standfirst { font-size:18px; line-height:1.65; color:#dce9f5; margin:10px 0 14px; max-width:34em; }
  .byline { font-size:15px; color:#b8cadb; margin:0 0 14px; max-width:34em; }
  /* Tall and narrow — a poster, not a photograph. Set as a column beside its caption and
     kept small, because it sits under the contents now: a reader arriving at the page wants
     the list of days first, and a full-width poster pushed the first of them off the screen.
     Small enough to be legible as an object, not as a document — it is a plate here, and
     anyone who wants to read it can open the file. */
  .program { margin:18px 0 30px; display:grid; grid-template-columns:190px minmax(0,1fr);
    gap:18px; align-items:start; max-width:46em; }
  .program img { display:block; width:100%; height:auto; border-radius:10px; border:1px solid #1d2937; }
  .program figcaption { color:#8fa3b8; font-size:13px; line-height:1.55; }
  /* One column on a narrow screen: 190px of poster beside a caption leaves the caption in
     a gutter four words wide. */
  @media (max-width:560px) {
    .program { grid-template-columns:minmax(0,1fr); gap:10px; max-width:34em; }
    .program img { max-width:260px; }
  }
  /* Art with a picture beside it. A plain list of names asks the reader to imagine a
     thing they have never seen; a thumbnail costs 60 KB and does the work instead. */
  .artlist { list-style:none; padding:0; margin:8px 0 0;
    display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
  .artlist li { display:flex; gap:10px; align-items:center; margin:0; }
  .artlist img { width:72px; height:72px; object-fit:cover; border-radius:8px;
    border:1px solid #1d2937; flex:none; background:#0b111a; }
  /* Holds the row's shape for the three pieces the archive never photographed, so a
     missing picture reads as absence rather than as a broken image. */
  .artlist .nopic { width:72px; height:72px; border-radius:8px; flex:none;
    border:1px dashed #223041; }
  .artlist .what { display:flex; flex-direction:column; min-width:0; }
  .artlist .how { color:#8fa3b8; font-size:13px; }
  .artnote { color:#6f8296; font-size:12.5px; line-height:1.5; margin:12px 0 0; max-width:40em; }
  /* The headlines double as the contents, so a reader can see the shape of the week — the
     badges, the burns, the night nothing was recorded — without scrolling eleven days to
     find it. Built from the same strings the days print, so it cannot drift out of step. */
  .toc { border-top:1px solid #1d2937; padding:22px 0 4px; margin:0 0 4px; }
  .toc h2 { font-size:13px; text-transform:uppercase; letter-spacing:1.4px; color:#8fa3b8; margin:0 0 12px; }
  .toc ol { list-style:none; padding:0; margin:0; }
  .toc li { margin:0 0 8px; }
  .toc a { display:flex; gap:12px; align-items:baseline; text-decoration:none; }
  .toc a:hover .what { text-decoration:underline; }
  /* Fixed width and tabular figures so the headlines start on one line down the page
     rather than stepping in and out with the length of each date. */
  .toc .when { flex:none; width:6.2em; color:#8fa3b8; font-size:13px; font-variant-numeric:tabular-nums; }
  .toc .what { color:#a6e2ff; }
  /* margin-left:auto pushes the strip to the right edge, so the tiles line up in a
     column of their own however long the headline runs. */
  .toc .tiles { flex:none; display:flex; gap:4px; margin-left:auto; padding-left:14px; }
  /* The tiles are cropped square at build time, so this only sets how big they sit;
     cover is kept as a guard in case a tile is ever regenerated at another shape. */
  .toc .tiles img { width:34px; height:34px; object-fit:cover; border-radius:5px;
    border:1px solid #1d2937; background:#0b111a; display:block; }
  .toc a:hover .tiles img { border-color:#37506a; }
  @media (max-width:520px) {
    .toc a { display:block; }
    .toc .when { width:auto; display:block; margin-bottom:1px; }
    /* Back under the headline on a phone, where there is no room beside it. */
    .toc .tiles { margin:6px 0 0; padding-left:0; }
  }
  .reading p { max-width:34em; }
  /* Sized like a thing to click rather than a word in a sentence, since the paragraphs
     around it are also full of links and the download is the point of the section. */
  .reading .dl { font-weight:650; font-size:17px; }
  .reading .how { display:block; color:#8fa3b8; font-size:13px; line-height:1.55; margin-top:4px; }
  .next p { max-width:34em; }
  a { color:#7fd4ff; }
  .sub { color:#8fa3b8; font-size:14px; margin-bottom:28px; }
  section { border-top:1px solid #1d2937; padding:26px 0; }
  h2 { font-size:21px; margin:0 0 4px; }
  h2 a { color:inherit; text-decoration:none; }
  h2 a:hover { text-decoration:underline; }
  .headline { color:#a6e2ff; font-weight:650; margin:0 0 12px; }
  .meta { color:#8fa3b8; font-size:13px; margin:12px 0 0; }
  ul { margin:10px 0; padding-left:20px; color:#d7e8fa; font-size:14px; }
  h3 { font-size:13px; text-transform:uppercase; letter-spacing:1.4px; color:#8fa3b8; margin:20px 0 4px; }
  .shots { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-top:10px; }
  figure { margin:0; }
  /* height:auto is what turns the width and height attributes into an aspect ratio the
     browser can reserve, rather than a fixed size it stretches the picture into. */
  figure img, figure video { width:100%; height:auto; border-radius:10px; display:block; background:#0b111a; }
  figcaption { color:#8fa3b8; font-size:12px; margin-top:6px; }
  figure.lead { margin:14px 0 18px; }
  /* Capped, because a portrait phone photograph at full column width is taller than the
     screen and pushes the day's account off the bottom of it. */
  figure.lead img, figure.lead video { max-height:70vh; width:100%; object-fit:contain; }
  .daymap { position:relative; margin:18px 0 6px; background:#0b111a; border-radius:10px; overflow:hidden; }
  .daymap img { display:block; width:100%; }
  /* The streets sit under the track, dimmed, and both share one viewBox so they line up
     at whatever width the column happens to be. */
  .daymap img:first-child { opacity:0.45; }
  .daymap img:last-child { position:absolute; inset:0; }
  .mapnote { color:#8fa3b8; font-size:12px; margin:6px 0 0; }
  .comments { margin-top:22px; }
  .comment-list { margin:8px 0 12px; }
  .comment { border-left:2px solid #1d2937; padding:2px 0 2px 12px; margin:10px 0; }
  .comment .who { color:#a6e2ff; font-size:13px; font-weight:650; }
  .comment .when { color:#8fa3b8; font-size:12px; margin-left:6px; }
  /* pre-wrap because the server keeps the line breaks people type, and two thoughts
     run together read as one. */
  .comment p { margin:2px 0 0; font-size:15px; white-space:pre-wrap; }
  .comment-form { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start; }
  .comment-form input, .comment-form textarea {
    font:inherit; color:#f4faff; background:#0b111a; border:1px solid #1d2937;
    border-radius:8px; padding:8px 10px;
  }
  .comment-form input { flex:0 0 180px; }
  .comment-form textarea { flex:1 1 100%; resize:vertical; }
  .comment-form button {
    font:inherit; color:#06090f; background:#a6e2ff; border:0; border-radius:8px;
    padding:9px 14px; cursor:pointer;
  }
  .comment-form button:disabled { opacity:0.5; cursor:default; }
  .comment-status { color:#8fa3b8; font-size:13px; align-self:center; }
  /* The 1990s hit counter: a black bezel, a caption in the plastic, and digits that
     glow because the page is dark and a flat number would disappear into it. */
  .guestbook { display:flex; justify-content:center; margin:36px 0 8px; }
  .odometer { display:flex; flex-direction:column; align-items:center; gap:8px; width:fit-content;
    margin:0; padding:10px 12px 12px;
    background:linear-gradient(#3a3a3a,#1a1a1a); border:1px solid #555;
    border-radius:8px; box-shadow:inset 0 0 0 2px #0a0a0a, inset 0 8px 12px rgba(0,0,0,.45); }
  .odometer .label { font:10px/1 ui-monospace,Menlo,Consolas,monospace; letter-spacing:.22em;
    text-transform:uppercase; color:#8a8a8a; }
  .odometer .digits { display:flex; gap:8px; align-items:flex-end; background:transparent;
    padding:0; letter-spacing:0; text-shadow:none; }
  .odometer .cell { display:flex; flex-direction:column; align-items:center; gap:4px; width:44px; }
  .odometer .cell img { height:38px; width:auto; max-width:44px; object-fit:contain; image-rendering:pixelated; }
  @media (max-width:420px) {
    .odometer { padding:8px 8px 10px; }
    .odometer .digits { gap:3px; }
    .odometer .cell { width:34px; }
    .odometer .cell img { height:30px; max-width:34px; }
  }
  /* Seven bars, the way a 1990s hit counter drew a numeral: the dark ones are the
     segments that are off, still visible so it reads as a display and not as type. */
  .odometer .cell .n { position:relative; display:block; width:22px; height:36px;
    background:#050805; border-radius:2px; box-shadow:inset 0 0 3px #000; }
  .odometer .cell .n i { position:absolute; background:#12321c; border-radius:2px; }
  .odometer .cell .n i:nth-child(1) { left:4px; top:2px; width:14px; height:3px; }
  .odometer .cell .n i:nth-child(2) { right:2px; top:5px; width:3px; height:12px; }
  .odometer .cell .n i:nth-child(3) { right:2px; bottom:5px; width:3px; height:12px; }
  .odometer .cell .n i:nth-child(4) { left:4px; bottom:2px; width:14px; height:3px; }
  .odometer .cell .n i:nth-child(5) { left:2px; bottom:5px; width:3px; height:12px; }
  .odometer .cell .n i:nth-child(6) { left:2px; top:5px; width:3px; height:12px; }
  .odometer .cell .n i:nth-child(7) { left:4px; top:16px; width:14px; height:3px; }
  .odometer .n[data-d="0"] i:nth-child(1), .odometer .n[data-d="0"] i:nth-child(2),
  .odometer .n[data-d="0"] i:nth-child(3), .odometer .n[data-d="0"] i:nth-child(4),
  .odometer .n[data-d="0"] i:nth-child(5), .odometer .n[data-d="0"] i:nth-child(6),
  .odometer .n[data-d="1"] i:nth-child(2), .odometer .n[data-d="1"] i:nth-child(3),
  .odometer .n[data-d="2"] i:nth-child(1), .odometer .n[data-d="2"] i:nth-child(2),
  .odometer .n[data-d="2"] i:nth-child(4), .odometer .n[data-d="2"] i:nth-child(5),
  .odometer .n[data-d="2"] i:nth-child(7),
  .odometer .n[data-d="3"] i:nth-child(1), .odometer .n[data-d="3"] i:nth-child(2),
  .odometer .n[data-d="3"] i:nth-child(3), .odometer .n[data-d="3"] i:nth-child(4),
  .odometer .n[data-d="3"] i:nth-child(7),
  .odometer .n[data-d="4"] i:nth-child(2), .odometer .n[data-d="4"] i:nth-child(3),
  .odometer .n[data-d="4"] i:nth-child(6), .odometer .n[data-d="4"] i:nth-child(7),
  .odometer .n[data-d="5"] i:nth-child(1), .odometer .n[data-d="5"] i:nth-child(3),
  .odometer .n[data-d="5"] i:nth-child(4), .odometer .n[data-d="5"] i:nth-child(6),
  .odometer .n[data-d="5"] i:nth-child(7),
  .odometer .n[data-d="6"] i:nth-child(1), .odometer .n[data-d="6"] i:nth-child(3),
  .odometer .n[data-d="6"] i:nth-child(4), .odometer .n[data-d="6"] i:nth-child(5),
  .odometer .n[data-d="6"] i:nth-child(6), .odometer .n[data-d="6"] i:nth-child(7),
  .odometer .n[data-d="7"] i:nth-child(1), .odometer .n[data-d="7"] i:nth-child(2),
  .odometer .n[data-d="7"] i:nth-child(3),
  .odometer .n[data-d="8"] i:nth-child(1), .odometer .n[data-d="8"] i:nth-child(2),
  .odometer .n[data-d="8"] i:nth-child(3), .odometer .n[data-d="8"] i:nth-child(4),
  .odometer .n[data-d="8"] i:nth-child(5), .odometer .n[data-d="8"] i:nth-child(6),
  .odometer .n[data-d="8"] i:nth-child(7),
  .odometer .n[data-d="9"] i:nth-child(1), .odometer .n[data-d="9"] i:nth-child(2),
  .odometer .n[data-d="9"] i:nth-child(3), .odometer .n[data-d="9"] i:nth-child(4),
  .odometer .n[data-d="9"] i:nth-child(6), .odometer .n[data-d="9"] i:nth-child(7) {
    background:#5dff6a; box-shadow:0 0 5px #3dff6a;
  }
</style></head><body><main>
<h1>The Annals of Hermes</h1>
<p class="standfirst">For three thousand years Hermes has been
${reading ? `<a href="${esc(reading.file)}">the god of roads, messengers
and divine mischief</a>` : "the god of roads, messengers and divine mischief"}. For one week
in 2026 he was an art car, and it crossed Black Rock City
mostly at night, mostly out past the edge of the streets where the city stops pretending to be
a grid. People could send for it — for a ride home, or for a set played off its deck at four in
the morning. This is what it did, day by day, as far as anyone was there to write it down.</p>
<p class="byline">Kept by
<a href="https://www.instagram.com/metavillan/" rel="noopener">DJ Metavillan</a>, who was
aboard for every night in this book from the thirtieth of August on, with
<a href="https://www.instagram.com/stephen.rodan/" rel="noopener">Coral Daddy</a> out with
him for three of them. Hermes is on Instagram as
<a href="${esc(INSTAGRAM)}" rel="noopener">@hermesartcar</a>.</p>
<div class="sub">${publishedDays.length} ${publishedDays.length === 1 ? "day" : "days"} on the playa · ${totalMedia} photograph${totalMedia === 1 ? "" : "s"} and clip${totalMedia === 1 ? "" : "s"} · anyone may comment</div>
<nav class="toc" aria-label="Contents">
  <h2>Contents</h2>
  <ol>
${prologue.length ? `    <li><a href="#before"><span class="when">Before</span><span class="what">Juplaya in July, and the build days</span>${
  // The strip is taken across the whole prologue rather than per date, since it is one
  // entry in the contents however many dates it gathers.
  (() => {
    const tiles = prologue.flatMap((p) => p.tiles || []).slice(0, TILES_PER_DAY);
    return tiles.length
      ? `<span class="tiles" aria-hidden="true">${tiles.map((t) =>
          `<img src="tiles/${esc(t.file)}" alt="" width="${TILE_PX}" height="${TILE_PX}">`).join("")}</span>`
      : "";
  })()}</a></li>\n` : ""}${publishedDays.map(({ day, tiles }) => {
  // Decorative: the link already says the date and the headline, so announcing three
  // unnamed photographs after it would only make the contents longer to listen to.
  const strip = (tiles || []).length
    ? `<span class="tiles" aria-hidden="true">${tiles.map((t) =>
        `<img src="tiles/${esc(t.file)}" alt="" width="${TILE_PX}" height="${TILE_PX}">`).join("")}</span>`
    : "";
  return `    <li><a href="#day-${esc(day.day)}"><span class="when">${esc(shortDay(day.day))}</span><span class="what">${esc(day.headline || (day.facts || {}).dayName || day.day)}</span>${strip}</a></li>`;
}).join("\n")}
${reading ? `    <li><a href="#reading"><span class="when">Read</span><span class="what">The seven circles of Hermes</span></a></li>\n` : ""}    <li><a href="#next"><span class="when">Next</span><span class="what">Be part of it next year</span></a></li>
  </ol>
</nav>
${hasProgram ? `<figure class="program">
  <img src="public-program.png" alt="The Hermes public programme for Burning Man 2026, listing the week's planned events day by day"${programSize ? ` width="${programSize.width}" height="${programSize.height}"` : ""} loading="lazy">
  <figcaption>The programme, as printed before the week began — Hermes at Axis Mundi, 31 August to
  6 September, draft 27. It promised at least a 30% chance of finding the car at any of these
  places, which turned out to be about right. Some of it happened, some of it did not, and a
  good deal of what follows is not on it at all.</figcaption>
</figure>` : ""}
${prologueSection()}
${publishedDays.map(sectionFor).join("\n")}
${reading ? `<section class="reading" id="reading">
  <h2>The seven circles</h2>
  <p>Before he was a car, Hermes was the fastest of the Greek gods — the messenger, the
  psychopomp, the only Olympian free to travel everywhere, and a thief by the evening of the
  day he was born. Fused with Thoth in Egypt he became Hermes Trismegistus, whose
  <em>Corpus Hermeticum</em> has the soul rising after death through seven planetary circles,
  letting go of one earthly thing at each ring.</p>
  <p>Source Library has collected seven versions of that gesture — the whole cosmos drawn as
  nested rings — from a 1540 volvelle printed for Charles V through Fludd, Boehme, the
  Rosicrucians, the <em>Bardo Thodol</em> and the crown chakra to a 2012 map of the observable
  universe. Five centuries, and none of the makers ever saw each other's work.</p>
  <p><a class="dl" href="${esc(reading.file)}">The Seven Circles of Hermes</a>
  <span class="how">PDF, 11 pages, ${mb(reading.size)} · assembled from the collection of
  <a href="https://sourcelibrary.org" rel="noopener">Source Library</a> · plates public domain
  except the observable-universe map, &copy; Pablo Carlos Budassi, CC BY-SA</span></p>
</section>
` : ""}<section class="next" id="next">
  <h2>Next year</h2>
  <p>Hermes goes out again. If you want to play a set off the deck, host something on it, be
  collected by it, or help build the thing, you can
  <a href="${esc(BOOK_URL)}">ask to be part of it</a>. Wherever it goes between now and then
  gets posted to <a href="${esc(INSTAGRAM)}" rel="noopener">@hermesartcar</a>.</p>
  <p class="mapnote">That form needs the Hermes server, so it works on returnofhermes.com
  rather than on this copy of the page.</p>
</section>
<div class="guestbook">
<div class="odometer" id="odometer">
  <span class="label">you are visitor</span>
  <div class="digits" aria-live="polite" aria-label="0000111">${digitCells(GUEST_FROM)}</div>
</div>
</div>
<script>
// Comments live on the hermes server rather than in this page, because the page is a
// static file on GitHub Pages and cannot keep anything. A day with no comments and a
// server that is down look the same from here on purpose: the annals still read.
const API = ${JSON.stringify(COMMENT_API)};
const VISITS = ${JSON.stringify(VISITS_API)};

// One count per browser, kept in localStorage, because a reload is not a new visitor
// and the server cannot tell a person from a refresh. A server that is down leaves the
// zeroes where they are: the page still reads, and a missing number is not a zero.
const counter = document.querySelector("#odometer .digits");
const GUESTS = ${JSON.stringify(guests.map((g) => ({ file: g.file, theme: g.theme, w: g.w, h: g.h })))};
const GUEST_FROM = 111;
function showCount(n) {
  const digits = String(Math.max(0, Number(n) || 0)).padStart(7, "0").slice(-7);
  const span = GUESTS.length;
  const shift = Math.floor(Number(n) || 0) - GUEST_FROM;
  const fairyAt = Math.max(0, GUESTS.findIndex((g) => g.theme === "fairy"));
  counter.setAttribute("aria-label", digits);
  counter.replaceChildren();
  digits.split("").forEach((d, place) => {
    const cell = document.createElement("span");
    cell.className = "cell";
    if (span) {
      const raw = place === 0 ? fairyAt + Number(d) + shift : Number(d) + (place - 1) + shift;
      const i = ((raw % span) + span) % span;
      const g = GUESTS[i];
      const img = document.createElement("img");
      img.src = "gifs/" + g.file;
      img.alt = g.theme;
      img.width = g.w;
      img.height = g.h;
      cell.append(img);
    }
    const num = document.createElement("span");
    num.className = "n";
    num.dataset.d = d;
    num.setAttribute("aria-hidden", "true");
    for (let s = 0; s < 7; s++) num.append(document.createElement("i"));
    cell.append(num);
    counter.append(cell);
  });
}
showCount(GUEST_FROM);
(async function countVisit() {
  const key = "hermes-annals-visitor";
  let seen = false;
  try { seen = localStorage.getItem(key) === "1"; } catch (_) {}
  try {
    const res = await fetch(VISITS, seen ? { cache: "no-store" } : { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.n === "number") showCount(data.n);
    if (!seen && data.counted) {
      try { localStorage.setItem(key, "1"); } catch (_) {}
    }
  } catch (_) {}
})();

function when(iso) {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch (_) { return ""; }
}

function draw(host, rows) {
  if (!rows.length) { host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = rows.map((row) => {
    const div = document.createElement("div");
    div.className = "comment";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = row.who || "someone";
    const at = document.createElement("span");
    at.className = "when";
    at.textContent = when(row.at);
    const body = document.createElement("p");
    body.textContent = row.body || "";
    div.append(who, at, body);
    return div.outerHTML;
  }).join("");
}

async function load(section) {
  const day = section.dataset.day;
  const host = section.querySelector(".comment-list");
  try {
    const res = await fetch(API + "?day=" + encodeURIComponent(day), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    draw(host, Array.isArray(data.comments) ? data.comments : []);
  } catch (_) { /* offline, or the server is down; the day still reads */ }
}

for (const section of document.querySelectorAll(".comments")) {
  load(section);
  const form = section.querySelector(".comment-form");
  const status = section.querySelector(".comment-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const who = form.who.value.trim();
    const body = form.body.value.trim();
    if (!who || !body) return;
    button.disabled = true;
    status.textContent = "sending…";
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day: section.dataset.day, who, body })
      });
      if (!res.ok) throw new Error(await res.text());
      form.body.value = "";
      status.textContent = "on the record.";
      await load(section);
    } catch (error) {
      // Say so rather than swallowing it: someone who typed a paragraph deserves to
      // know it did not land, and to still have it in the box.
      status.textContent = "did not send — " + String(error.message || error).slice(0, 90);
    } finally {
      button.disabled = false;
    }
  });
}
</script>
</main></body></html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html);
const pageBytes = statSync(join(outDir, "index.html")).size;

console.log("\n  " + outDir.replace(repo + "/", "") + "/index.html  " + mb(pageBytes));
console.log("  media: " + mb(outBytes) + " (from " + mb(sourceBytes) + ", " +
  (sourceBytes ? Math.round((1 - outBytes / sourceBytes) * 100) : 0) + "% smaller)");
console.log("  comments post to " + COMMENT_API);
if (!withRequests) {
  console.log("  ride requests left out; --with-requests publishes the names of people who asked");
}
