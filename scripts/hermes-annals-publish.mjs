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
// resolve rather than join, so --out and --curation accept an absolute path.
const outDir = resolve(repo, arg("out", join("docs", "annals")));
const curationPath = resolve(repo, arg("curation", join("data", "hermes", "annals-curation.json")));
const STILL_MAX = Number(arg("still-max", 1600));
const VIDEO_MAX_H = Number(arg("video-max", 720));
const COMMENT_API = arg("api", "https://returnofhermes.com/api/hermes/annals/comments");

const mb = (bytes) => (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB";
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
for (const day of days) {
  const media = [];
  for (const item of day.media || []) {
    const mark = chosen.get(item.src);
    if (!mark) continue;
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
      name: publishedName(day.day, item.src, video ? ".mp4" : ".jpg"),
      poster: video ? publishedName(day.day, item.src, ".poster.jpg") : "",
      posterAbs: video ? join(repo, posterSource(item.src)) : ""
    });
  }
  if (media.length === 0 && !(day.account || "").trim()) continue;
  plan.push({ day, media });
}

const totalMedia = plan.reduce((n, p) => n + p.media.length, 0);
console.log("  " + chosen.size + " chosen · " + totalMedia + " publishable across " +
  plan.filter((p) => p.media.length).length + " days · " + mb(sourceBytes) + " of source");
if (chosen.size !== totalMedia) {
  console.log("  " + (chosen.size - totalMedia) + " chosen file(s) are not in any day of the annals");
}

if (!apply) {
  for (const { day, media } of plan) {
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
if (existsSync(join(mapSourceDir, "playa-streets.svg"))) {
  for (const name of readdirSync(mapSourceDir)) {
    const match = /^(\d{4}-\d{2}-\d{2})\.track\.svg$/.exec(name);
    if (match) mapDays.add(match[1]);
  }
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

async function encodeStill(item) {
  const dest = join(mediaDir, item.name);
  await execFileAsync("sips", ["-Z", String(STILL_MAX), "-s", "format", "jpeg",
    "-s", "formatOptions", "80", item.abs, "--out", dest]);
  return statSync(dest).size;
}

async function encodeVideo(item) {
  const dest = join(mediaDir, item.name);
  // 720p and crf 28: these are handheld night clips on a phone screen, where the
  // grain costs more bits than the detail is worth. Audio kept, because people talk
  // in them, but mono at 96k since nothing here is music.
  await execFileAsync("ffmpeg", ["-y", "-nostdin", "-loglevel", "error", "-i", item.abs,
    "-vf", "scale=-2:'min(" + VIDEO_MAX_H + ",ih)'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ac", "1",
    "-movflags", "+faststart", dest]);
  let bytes = statSync(dest).size;
  if (item.posterAbs && existsSync(item.posterAbs)) {
    const posterDest = join(mediaDir, item.poster);
    await execFileAsync("sips", ["-Z", String(STILL_MAX), "-s", "format", "jpeg",
      "-s", "formatOptions", "72", item.posterAbs, "--out", posterDest]);
    bytes += statSync(posterDest).size;
  } else {
    item.poster = "";
  }
  return bytes;
}

let outBytes = 0;
for (const { day, media } of plan) {
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

function figureFor(item, lead = false) {
  const caption = esc([item.art, item.caption].filter(Boolean).join(" · "));
  const cap = caption ? `<figcaption>${caption}</figcaption>` : "";
  const cls = lead ? ' class="lead"' : "";
  if (!item.video) {
    // The lead is the one image worth fetching before the reader scrolls to it.
    const loading = lead ? "" : ' loading="lazy"';
    return `<figure${cls}><img src="media/${esc(item.name)}" alt="${caption || "A photograph from the annals"}"${loading}>${cap}</figure>`;
  }
  const poster = item.poster ? ` poster="media/${esc(item.poster)}"` : "";
  return `<figure${cls}><video src="media/${esc(item.name)}" controls playsinline preload="none"${poster}></video>${cap}</figure>`;
}

/** The day's map, if one was built for it: the track over the shared street plan. */
function mapFor(day) {
  if (!mapDays.has(day)) return "";
  return `<div class="daymap">
  <img src="maps/playa-streets.svg" alt="" aria-hidden="true">
  <img src="maps/${esc(day)}.track.svg" alt="Where Hermes went on ${esc(day)}">
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

function sectionFor({ day, media }) {
  const facts = day.facts || {};
  const shots = media.filter((m) => !m.failed);
  const stops = (facts.stops || []).map((s) =>
    `<li><strong>${esc(s.place)}</strong> — ${esc(s.dwell)} from ${esc(s.from)}${s.visits > 1 ? ` across ${s.visits} visits` : ""}</li>`).join("");
  const art = (facts.art || []).map((a) =>
    `<li><strong>${esc(a.name)}</strong> — within ${a.closestM} metres${a.artist ? `, by ${esc(a.artist)}` : ""}</li>`).join("");
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
${art ? `<h3>Art within reach</h3><ul>${art}</ul>` : ""}
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

const publishedDays = plan.filter((p) => p.media.length || (p.day.account || "").trim());
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
  figure img, figure video { width:100%; border-radius:10px; display:block; background:#0b111a; }
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
</style></head><body><main>
<h1>The Annals of Hermes</h1>
<p class="standfirst">Hermes was an art car that spent a week crossing Black Rock City,
mostly at night, mostly out past the edge of the streets where the city stops. People could
send for it — for a ride home, or for a set played off its deck at four in the morning. This
is what it did, day by day, as far as anyone was there to write it down.</p>
<p class="byline">Kept by <a href="https://www.instagram.com/metavillan/" rel="noopener">DJ
Metavillan</a>, who was aboard for every night in this book from the thirtieth of August on.</p>
<div class="sub">${publishedDays.length} ${publishedDays.length === 1 ? "day" : "days"} on the playa · ${totalMedia} photograph${totalMedia === 1 ? "" : "s"} and clip${totalMedia === 1 ? "" : "s"} · anyone may comment</div>
${publishedDays.map(sectionFor).join("\n")}
<script>
// Comments live on the hermes server rather than in this page, because the page is a
// static file on GitHub Pages and cannot keep anything. A day with no comments and a
// server that is down look the same from here on purpose: the annals still read.
const API = ${JSON.stringify(COMMENT_API)};

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
