#!/usr/bin/env node
// The Annals of Hermes — one account per day, read off the logs and written up.
//
//   npm run hermes:annals
//   npm run hermes:annals -- --day=2026-09-03
//   npm run hermes:annals -- --rewrite          # ignore the cache, ask again
//   npm run hermes:annals -- --json
//   npm run hermes:annals -- --copy-media       # self-contained output folder
//
// Two halves, kept apart on purpose.
//
// The first half is arithmetic: every day in the track log becomes a block of
// facts — how far the car went, which corners it sat on, which art it came
// within reach of, who fed it a position, what was asked of it. Nothing there is
// a judgement, and nothing is joined across a silence in the log.
//
// The second half is the writing, and it is the only part that has a voice.
// Claude is handed the facts and nothing else and asked for a paragraph. The
// answer is cached against a hash of those facts, so re-running is free and the
// wording of a day that is already written stays put; a day whose facts have
// changed is asked again. With no API key the same facts are rendered plainly
// and the entry says who wrote it, because "written by Claude" is a claim about
// provenance and it should not be made on a template's behalf.
//
// Photographs are the third thing a day has, and they do not come out of a log.
// Drop them in assets/hermes-annals/<day>/ or assets/hermes-annals/art/<slug>/
// and they are picked up by name; annals-media.json is there for captions and
// for crediting a shoot to a particular installation.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { distanceMeters } from "./lib/playa-places.mjs";
import { journeys, readTrack } from "./lib/journeys.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dataDir = join(repo, "data", "hermes");
const trackPath = process.env.HERMES_TRACK || join(dataDir, "track.jsonl");
const artPath = process.env.HERMES_ART_CLOSEST_LOG || join(dataDir, "art-closest.jsonl");
const feedPath = process.env.HERMES_LOCATION_FEED || join(dataDir, "location-feed.jsonl");
const pickupPath = join(dataDir, "pickup-requests.jsonl");
const mediaManifestPath = process.env.HERMES_ANNALS_MEDIA || join(dataDir, "annals-media.json");
const cachePath = process.env.HERMES_ANNALS_CACHE || join(dataDir, "annals-narratives.json");
const mediaRoot = join(repo, "assets", "hermes-annals");
const outDir = process.env.HERMES_ANNALS_DIR || join(repo, "artifacts", "hermes-annals");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const onlyDay = arg("day");
const asJson = process.argv.includes("--json");
const rewrite = process.argv.includes("--rewrite");
const copyMedia = process.argv.includes("--copy-media");
const quiet = process.argv.includes("--quiet");

const listingPath = join(dataDir, "activities.json");
const listing = existsSync(listingPath) ? readJson(listingPath) : null;
const TZ = process.env.HERMES_TZ || (listing && listing.timezone) || "America/Los_Angeles";

// The Man, so a day can be described as city or deep playa without a second
// lookup. Same coordinate the overlay and the server use.
const MAN_LAT = 40.783247448000054;
const MAN_LON = -119.20788409599999;
const DEEP_PLAYA_M = Number(process.env.HERMES_ANNALS_DEEP_M || 1100);

const CLAUDE_KEY = String(
  process.env.ANTHROPIC_API_KEY ||
  process.env.CLAUDE_API_KEY ||
  process.env.HERMES_ANTHROPIC_API_KEY ||
  ""
).trim();
const CLAUDE_MODEL = String(process.env.HERMES_ANNALS_MODEL || "claude-sonnet-4-5").trim();

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function readLines(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { continue; }
  }
  return rows;
}

const dayKey = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
const dayName = (ms) => new Date(ms).toLocaleDateString("en-US",
  { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
const clock = (ms) => new Date(ms).toLocaleTimeString("en-US",
  { hour: "numeric", minute: "2-digit", timeZone: TZ });

function spell(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  if (m === 1) return "a minute";
  if (m < 90) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h} hours`;
}
function far(metres) {
  if (!Number.isFinite(metres)) return "an unknown distance";
  if (metres < 100) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
const named = (place) => (place && place.label) || "somewhere unnamed";
const slug = (text) => String(text || "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// --- the facts ------------------------------------------------------------

if (!existsSync(trackPath)) {
  console.error(`no track log at ${trackPath} — there are no days to account for`);
  process.exit(1);
}

const points = readTrack(readFileSync(trackPath, "utf8"));
if (!points.length) {
  console.error("the track log has no usable points");
  process.exit(1);
}

const artRows = readLines(artPath).filter((r) => r && r.art && Number.isFinite(Number(r.distanceM)));
const feedRows = readLines(feedPath).filter((r) => r && r.at);
const pickupRows = readLines(pickupPath).filter((r) => r && r.at);

const groupBy = (rows, stamp) => {
  const out = new Map();
  for (const row of rows) {
    const ms = Date.parse(row[stamp] || "");
    if (!Number.isFinite(ms)) continue;
    const key = dayKey(ms);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ ...row, ms });
  }
  return out;
};

const pointsByDay = new Map();
for (const point of points) {
  const key = dayKey(point.ms);
  if (!pointsByDay.has(key)) pointsByDay.set(key, []);
  pointsByDay.get(key).push(point);
}
const artByDay = groupBy(artRows, "at");
const feedByDay = groupBy(feedRows, "at");
const pickupByDay = groupBy(pickupRows, "at");

// Every art piece the car came within reach of that day, collapsed to one row
// each. The log writes a line per fix, so a piece parked beside for an hour
// arrives as hundreds of lines saying the same thing; what a reader wants is the
// closest it got and how long it was there.
function artForDay(rows) {
  const byPiece = new Map();
  for (const row of rows) {
    const key = row.artUid || row.art;
    if (!byPiece.has(key)) {
      byPiece.set(key, {
        name: row.art,
        uid: row.artUid || "",
        artist: row.artArtist || "",
        bigArtCar: Boolean(row.bigArtCar),
        closestM: Number(row.distanceM),
        firstMs: row.ms,
        lastMs: row.ms,
        fixes: 0
      });
    }
    const piece = byPiece.get(key);
    piece.fixes++;
    piece.closestM = Math.min(piece.closestM, Number(row.distanceM));
    piece.firstMs = Math.min(piece.firstMs, row.ms);
    piece.lastMs = Math.max(piece.lastMs, row.ms);
    if (row.bigArtCar) piece.bigArtCar = true;
  }
  return [...byPiece.values()]
    .sort((a, b) => a.closestM - b.closestM)
    .map((piece) => ({
      name: piece.name,
      artist: piece.artist,
      bigArtCar: piece.bigArtCar,
      closestM: piece.closestM,
      from: clock(piece.firstMs),
      fixes: piece.fixes,
      // The log records whichever piece was nearest, so the window between a
      // piece's first and last mention is only a dwell if it is short. A distant
      // landmark that was nearest at dawn and again at dusk would otherwise
      // claim the car spent nineteen hours at it.
      alongside: piece.fixes < 2
        ? "one fix in passing"
        : piece.lastMs - piece.firstMs <= 45 * 60000
          ? spell(piece.lastMs - piece.firstMs)
          : `${piece.fixes} fixes between ${clock(piece.firstMs)} and ${clock(piece.lastMs)}`
    }));
}

// Who put a position in, which is the only record of who was aboard with the
// app open. Rejected fixes are counted separately: a phone that spent the night
// failing the accuracy gate was still there.
function crewForDay(rows) {
  const byName = new Map();
  for (const row of rows) {
    const who = String(row.name || row.source || "").replace(/^phone-/, "").trim() || "unnamed";
    if (!byName.has(who)) byName.set(who, { who, accepted: 0, rejected: 0, firstMs: row.ms, lastMs: row.ms });
    const entry = byName.get(who);
    if (row.accepted === true) entry.accepted++; else entry.rejected++;
    entry.firstMs = Math.min(entry.firstMs, row.ms);
    entry.lastMs = Math.max(entry.lastMs, row.ms);
  }
  return [...byName.values()].sort((a, b) => b.accepted - a.accepted);
}

function requestsForDay(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = String(row.id || `${row.at}|${row.who}`);
    if (seen.has(id)) continue;   // the sync mirrors rows back, so ids repeat
    seen.add(id);
    out.push({
      who: String(row.who || "anonymous"),
      kind: String(row.requestType || "pickup"),
      place: String(row.place || ""),
      when: String(row.pickupWhen || ""),
      intention: String(row.intention || ""),
      note: String(row.note || ""),
      equipment: String(row.equipmentNeeded || ""),
      at: clock(row.ms)
    });
  }
  return out;
}

function factsForDay(day) {
  const dayPoints = (pointsByDay.get(day) || []).slice().sort((a, b) => a.ms - b.ms);
  const legs = journeys(dayPoints);
  // A car that leaves camp and comes back three times has one camp, not three
  // stops with the same name, and a day summarised the other way reads as a
  // stutter. Visits are counted instead.
  const byPlace = new Map();
  for (const journey of legs) {
    for (const event of journey.events) {
      if (event.kind !== "stop") continue;
      const place = named(event.place);
      if (!byPlace.has(place)) {
        byPlace.set(place, {
          place,
          detail: (event.place && event.place.detail) || "",
          firstMs: event.startMs,
          visits: 0,
          dwellMs: 0,
          deepPlaya: false
        });
      }
      const entry = byPlace.get(place);
      entry.visits++;
      entry.dwellMs += event.dwellMs;
      entry.firstMs = Math.min(entry.firstMs, event.startMs);
      if (distanceMeters(event.lat, event.lon, MAN_LAT, MAN_LON) >= DEEP_PLAYA_M) entry.deepPlaya = true;
    }
  }
  const stops = [...byPlace.values()].map((entry) => ({
    place: entry.place,
    detail: entry.detail,
    from: clock(entry.firstMs),
    visits: entry.visits,
    dwell: spell(entry.dwellMs),
    dwellMs: entry.dwellMs,
    deepPlaya: entry.deepPlaya
  }));
  const metres = legs.reduce((sum, j) => sum + j.metres, 0);
  const first = dayPoints[0];
  const last = dayPoints[dayPoints.length - 1];
  const fromMan = dayPoints.map((p) => distanceMeters(p.lat, p.lon, MAN_LAT, MAN_LON));
  const deepFixes = fromMan.filter((d) => d >= DEEP_PLAYA_M).length;

  return {
    day,
    dayName: dayName(first.ms),
    fixes: dayPoints.length,
    sources: [...new Set(dayPoints.map((p) => p.src).filter(Boolean))],
    firstFix: clock(first.ms),
    lastFix: clock(last.ms),
    metres: Math.round(metres),
    distance: far(metres),
    journeys: legs.length,
    farthestFromManM: fromMan.length ? Math.round(Math.max(...fromMan)) : 0,
    deepPlayaShare: dayPoints.length ? Math.round((deepFixes / dayPoints.length) * 100) : 0,
    stops: stops.sort((a, b) => b.dwellMs - a.dwellMs).slice(0, 8),
    art: artForDay(artByDay.get(day) || []),
    crew: crewForDay(feedByDay.get(day) || []),
    requests: requestsForDay(pickupByDay.get(day) || [])
  };
}

const days = [...pointsByDay.keys()].sort();
const wanted = onlyDay ? days.filter((d) => d === onlyDay) : days;
if (!wanted.length) {
  console.error(`nothing logged on ${onlyDay}. Days in the log: ${days.join(", ")}`);
  process.exit(1);
}

// --- the photographs ------------------------------------------------------

const MEDIA_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".m4v", ".webm"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) continue;
    if (!MEDIA_EXT.has(extname(name).toLowerCase())) continue;
    // A clip's poster frame belongs to the clip, not beside it as another photograph.
    if (/\.poster\.jpg$/i.test(name)) continue;
    out.push(full);
  }
  return out;
}

const mediaManifest = readJson(mediaManifestPath, null) || { days: {}, art: {} };
// A manifest is only worth having once there is something to say about a file,
// so the skeleton is written on the first run and left alone afterwards.
if (!existsSync(mediaManifestPath)) {
  const skeleton = { days: {}, art: {} };
  for (const day of days) skeleton.days[day] = [];
  for (const piece of new Set(artRows.map((r) => r.art))) skeleton.art[slug(piece)] = [];
  mkdirSync(dirname(mediaManifestPath), { recursive: true });
  writeFileSync(mediaManifestPath, JSON.stringify({
    note: "Captions and credits for the annals. Files are found by folder as well: " +
      "assets/hermes-annals/<day>/ and assets/hermes-annals/art/<slug>/. " +
      "Entries here may set src, caption, art, shoot (still|video) and credit.",
    ...skeleton
  }, null, 2) + "\n");
}

function mediaEntriesFor(day, artNames) {
  const found = new Map();
  const add = (full, extra = {}) => {
    const key = full;
    if (!found.has(key)) {
      found.set(key, {
        src: full,
        name: basename(full),
        shoot: VIDEO_EXT.has(extname(full).toLowerCase()) ? "video" : "still",
        caption: "",
        art: "",
        credit: "",
        ...extra
      });
    } else {
      Object.assign(found.get(key), Object.fromEntries(
        Object.entries(extra).filter(([, v]) => v !== "" && v != null)
      ));
    }
  };

  for (const full of filesUnder(join(mediaRoot, day))) add(full);
  // Art folders are matched against what the log says the car was beside that
  // day, so a shoot filed under the installation shows up on the right entry
  // without being dated by hand.
  for (const piece of artNames) {
    for (const full of filesUnder(join(mediaRoot, "art", slug(piece)))) add(full, { art: piece });
  }

  const fromManifest = [
    ...((mediaManifest.days && mediaManifest.days[day]) || []),
    ...artNames.flatMap((piece) => ((mediaManifest.art && mediaManifest.art[slug(piece)]) || [])
      .map((entry) => ({ art: piece, ...entry })))
  ];
  for (const entry of fromManifest) {
    if (!entry || !entry.src) continue;
    const full = entry.src.startsWith("/") ? entry.src : join(repo, entry.src);
    if (!existsSync(full)) {
      console.error(`annals: media listed but missing — ${entry.src}`);
      continue;
    }
    add(full, {
      caption: entry.caption || "",
      art: entry.art || "",
      credit: entry.credit || "",
      ...(entry.shoot ? { shoot: entry.shoot } : {})
    });
  }
  return [...found.values()];
}

// --- the writing ----------------------------------------------------------

const cache = readJson(cachePath, null) || { entries: {} };

function factsDigest(facts) {
  return createHash("sha1").update(JSON.stringify(facts)).digest("hex").slice(0, 16);
}

function promptFor(facts, media) {
  return [
    "You are writing one dated entry in the Annals of Hermes, the chronicle of an art car",
    "that roamed Black Rock City. Write it from the facts below and from nothing else.",
    "",
    "Who is reading. A stranger who was not there, who will never see this data, and who",
    "came for the story of a car crossing a desert at night. They do not know what a GPS",
    "fix is and should never have to find out.",
    "",
    "Rules:",
    "- Never invent a place, a person, a time or an event that is not in the facts.",
    "- Where the record is thin, say so plainly; a quiet day is a fact, not a failure.",
    "- Name places, installations and art cars exactly as given. They are the best",
    "  material you have — 'A Quiet Place to Scream' earns its place, a coordinate does not.",
    "- The subject of your sentences is Hermes, the night, and the people who asked it for",
    "  things. Never the instruments. Do not make 'the log' or 'the record' the actor.",
    "- Banned vocabulary, because it belongs to the plumbing and not to the week: fix,",
    "  fixes, log, record (as a noun for the data), accepted, rejected, source, sample,",
    "  accuracy, gate, geocoder, tracker, handheld, phone, handset, export, seed row,",
    "  deep playa share, per cent.",
    "- The people aboard may be named and credited — that is a courtesy, not a detail. But",
    "  name them as themselves: 'DJ Metavillan was aboard', never 'from Joel's phone'. Who",
    "  was carrying which device is plumbing; who was in the car is the story.",
    "- Translate every number to human scale or leave it out. 'Two kilometres out, farther",
    "  than any other night' is the story; '1,996 metres from the Man' is a coordinate.",
    "  Never quote a count of readings — a reader cannot tell whether 677 is a lot.",
    "- Distances are what was witnessed, not necessarily what was driven. Where the gaps",
    "  are wide, say so in plain words rather than hedging with statistics.",
    "- 90 to 160 words, past tense, one paragraph. Concrete and unhurried. It may carry",
    "  some weather and some grandeur, since the week had both, but do not reach for it.",
    "- No headings, no bullet points, no emoji.",
    "",
    media.length
      ? `There are ${media.length} photographs or clips filed with this day; you may refer to a shoot happening, but do not describe what is in them.`
      : "There are no photographs filed with this day.",
    "",
    "Reply with JSON only, of the shape {\"headline\": string, \"account\": string}.",
    "The headline is at most 60 characters and names the day's one real event. It must not",
    "name an instrument: 'The first real night out', never 'First night on phone positions'.",
    "",
    "Facts:",
    JSON.stringify(facts, null, 2)
  ].join("\n");
}

async function askClaude(facts, media) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: promptFor(facts, media) }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(json);
  const account = String(parsed.account || "").trim();
  if (!account) throw new Error("anthropic returned no account");
  return { headline: String(parsed.headline || "").trim(), account };
}

// The same facts, said in order, for when there is no key. Kept deliberately
// flat: it is a record, and it should not read as though it were narrated.
function plainAccount(facts) {
  const bits = [];
  bits.push(`The log holds ${facts.fixes} ${facts.fixes === 1 ? "fix" : "fixes"} for the day, ` +
    `the first at ${facts.firstFix} and the last at ${facts.lastFix}.`);
  if (facts.journeys) {
    bits.push(`Hermes covered ${facts.distance} across ${facts.journeys} ` +
      `${facts.journeys === 1 ? "journey" : "journeys"}.`);
  } else {
    bits.push("Nothing in the day amounts to a journey.");
  }
  if (facts.stops.length) {
    const longest = facts.stops[0];
    bits.push(`The longest stop was ${longest.place}, ${longest.dwell} from ${longest.from}` +
      `${longest.visits > 1 ? ` across ${longest.visits} visits` : ""}.`);
    if (facts.stops.length > 1) {
      bits.push(`It also stood at ${facts.stops.slice(1, 4).map((s) => s.place).join(", ")}.`);
    }
  }
  if (facts.art.length) {
    const closest = facts.art[0];
    bits.push(`Of ${facts.art.length} ${facts.art.length === 1 ? "installation" : "installations"} ` +
      `it came near, the closest was ${closest.name} at ${closest.closestM} m (${closest.alongside}).`);
  }
  if (facts.deepPlayaShare >= 20) {
    bits.push(`${facts.deepPlayaShare}% of the day's fixes were deep playa, ` +
      `out to ${far(facts.farthestFromManM)} from the Man.`);
  }
  if (facts.requests.length) {
    bits.push(`${facts.requests.length} ${facts.requests.length === 1 ? "request" : "requests"} came in, ` +
      `from ${[...new Set(facts.requests.map((r) => r.who))].join(", ")}.`);
  }
  if (facts.crew.length) {
    bits.push(`Positions were fed by ${facts.crew.map((c) => c.who).join(", ")}.`);
  }
  return bits.join(" ");
}

function plainHeadline(facts) {
  if (facts.art.length) return `Near ${facts.art[0].name}`;
  if (facts.stops.length) return `Held at ${facts.stops[0].place}`;
  if (facts.journeys) return `${facts.distance} across the city`;
  return "A quiet day in the log";
}

async function narrate(facts, media) {
  const digest = factsDigest(facts);
  const cached = cache.entries[facts.day];
  if (!rewrite && cached && cached.digest === digest && cached.account) return cached;
  if (!CLAUDE_KEY) {
    // A written account is worth more than a fresh template, so a cached entry
    // is kept even once the facts beneath it have moved, and says that it has.
    // Only --rewrite discards prose, and only when there is a key to replace it.
    if (cached && cached.account) {
      return { ...cached, digest, by: `${cached.by} — facts have changed since, rerun with a key to refresh` };
    }
    return { digest, by: "hermes-annals (no ANTHROPIC_API_KEY set)", headline: plainHeadline(facts), account: plainAccount(facts) };
  }
  try {
    const written = await askClaude(facts, media);
    const entry = { digest, by: `claude (${CLAUDE_MODEL})`, writtenAt: new Date().toISOString(), ...written };
    cache.entries[facts.day] = entry;
    return entry;
  } catch (err) {
    console.error(`annals: ${facts.day} fell back to the plain account — ${String(err.message || err).split("\n")[0]}`);
    return { digest, by: "hermes-annals (Claude unavailable)", headline: plainHeadline(facts), account: plainAccount(facts) };
  }
}

// --- assemble -------------------------------------------------------------

const entries = [];
for (const day of wanted) {
  const facts = factsForDay(day);
  const media = mediaEntriesFor(day, facts.art.map((a) => a.name));
  const written = await narrate(facts, media);
  entries.push({ facts, media, written });
}

mkdirSync(cachePath ? dirname(cachePath) : dataDir, { recursive: true });
writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");

if (asJson) {
  console.log(JSON.stringify({ timezone: TZ, days: entries.map((e) => ({
    day: e.facts.day,
    headline: e.written.headline,
    writtenBy: e.written.by,
    account: e.written.account,
    facts: e.facts,
    media: e.media.map((m) => ({ src: relative(repo, m.src), shoot: m.shoot, art: m.art, caption: m.caption }))
  })) }, null, 2));
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

// Media is referenced where it lies unless asked for a folder that can be sent
// somewhere, because a day of stills is worth more than the page that shows it.
function mediaHref(entry) {
  if (!copyMedia) return relative(outDir, entry.src);
  const dest = join(outDir, "media", `${entry.name}`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(entry.src, dest);
  return join("media", entry.name);
}

/** A clip's poster frame, if one was written beside it. Copied too when self-contained. */
function posterAttr(entry) {
  const poster = entry.src.replace(/\.[^.]+$/, "") + ".poster.jpg";
  if (!existsSync(poster)) return "";
  if (!copyMedia) return ` poster="${esc(relative(outDir, poster))}"`;
  const name = basename(poster);
  const dest = join(outDir, "media", name);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(poster, dest);
  return ` poster="${esc(join("media", name))}"`;
}

const md = ["# The Annals of Hermes", "",
  `${entries.length} ${entries.length === 1 ? "day" : "days"} · times in ${TZ}`, ""];
for (const { facts, media, written } of entries) {
  md.push(`## ${facts.dayName}`, "", `**${written.headline}**`, "", written.account, "");
  md.push(`*${facts.fixes} ${facts.fixes === 1 ? "fix" : "fixes"} · ${facts.distance} · ` +
    `${facts.journeys} ${facts.journeys === 1 ? "journey" : "journeys"} · ` +
    `${facts.firstFix}–${facts.lastFix} · written by ${written.by}*`, "");
  if (facts.stops.length) {
    md.push("Stops:");
    for (const stop of facts.stops) {
      md.push(`- **${stop.place}** — ${stop.dwell} from ${stop.from}` +
        `${stop.visits > 1 ? ` across ${stop.visits} visits` : ""}` +
        `${stop.deepPlaya ? " (deep playa)" : ""}${stop.detail ? ` — ${stop.detail}` : ""}`);
    }
    md.push("");
  }
  if (facts.art.length) {
    md.push("Art within reach:");
    for (const piece of facts.art) {
      md.push(`- **${piece.name}** — closest ${piece.closestM} m, ${piece.alongside}` +
        `${piece.artist ? `, ${piece.artist}` : ""}${piece.bigArtCar ? " (big art car)" : ""}`);
    }
    md.push("");
  }
  if (facts.requests.length) {
    md.push("Asked of Hermes:");
    for (const req of facts.requests) {
      md.push(`- **${req.who}** — ${req.kind}${req.place ? ` at ${req.place}` : ""}` +
        `${req.when ? `, ${req.when}` : ""}${req.intention ? ` — ${req.intention}` : ""}`);
    }
    md.push("");
  }
  if (media.length) {
    md.push("Shoots:");
    for (const entry of media) {
      md.push(`- ${entry.shoot === "video" ? "clip" : "still"} \`${relative(repo, entry.src)}\`` +
        `${entry.art ? ` — ${entry.art}` : ""}${entry.caption ? ` — ${entry.caption}` : ""}`);
    }
    md.push("");
  }
  md.push("---", "");
}
const text = md.join("\n");
writeFileSync(join(outDir, "annals.md"), text + "\n");
for (const { facts } of entries) {
  const one = entries.filter((e) => e.facts.day === facts.day);
  writeFileSync(join(outDir, `annals-${facts.day}.md`),
    one.map(({ facts: f, written }) => `# ${f.dayName}\n\n**${written.headline}**\n\n${written.account}\n`).join("\n") + "\n");
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Annals of Hermes</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#06090f; color:#f4faff; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 30px; margin: 0 0 6px; }
  .sub { color:#8fa3b8; font-size:14px; margin-bottom:28px; }
  section { border-top:1px solid #1d2937; padding:26px 0; }
  h2 { font-size:21px; margin:0 0 4px; }
  .headline { color:#a6e2ff; font-weight:650; margin:0 0 12px; }
  .meta { color:#8fa3b8; font-size:13px; margin:12px 0 0; }
  ul { margin:10px 0; padding-left:20px; color:#d7e8fa; font-size:14px; }
  h3 { font-size:13px; text-transform:uppercase; letter-spacing:1.4px; color:#8fa3b8; margin:20px 0 4px; }
  .shots { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-top:10px; }
  figure { margin:0; }
  figure img, figure video { width:100%; border-radius:10px; display:block; background:#0b111a; }
  figcaption { color:#8fa3b8; font-size:12px; margin-top:6px; }
</style></head><body><main>
<h1>The Annals of Hermes</h1>
<div class="sub">${entries.length} ${entries.length === 1 ? "day" : "days"} · times in ${esc(TZ)}</div>
${entries.map(({ facts, media, written }) => `<section>
<h2>${esc(facts.dayName)}</h2>
<p class="headline">${esc(written.headline)}</p>
<p>${esc(written.account)}</p>
<p class="meta">${facts.fixes} ${facts.fixes === 1 ? "fix" : "fixes"} · ${esc(facts.distance)} · ${facts.journeys} ${facts.journeys === 1 ? "journey" : "journeys"} · ${esc(facts.firstFix)}–${esc(facts.lastFix)} · written by ${esc(written.by)}</p>
${facts.stops.length ? `<h3>Stops</h3><ul>${facts.stops.map((s) =>
  `<li><strong>${esc(s.place)}</strong> — ${esc(s.dwell)} from ${esc(s.from)}${s.visits > 1 ? ` across ${s.visits} visits` : ""}${s.deepPlaya ? " (deep playa)" : ""}</li>`).join("")}</ul>` : ""}
${facts.art.length ? `<h3>Art within reach</h3><ul>${facts.art.map((a) =>
  `<li><strong>${esc(a.name)}</strong> — closest ${a.closestM} m, ${esc(a.alongside)}${a.artist ? `, ${esc(a.artist)}` : ""}${a.bigArtCar ? " (big art car)" : ""}</li>`).join("")}</ul>` : ""}
${facts.requests.length ? `<h3>Asked of Hermes</h3><ul>${facts.requests.map((r) =>
  `<li><strong>${esc(r.who)}</strong> — ${esc(r.kind)}${r.place ? ` at ${esc(r.place)}` : ""}${r.intention ? ` — ${esc(r.intention)}` : ""}</li>`).join("")}</ul>` : ""}
${media.length ? `<h3>Shoots</h3><div class="shots">${media.map((m) => {
  const href = esc(mediaHref(m));
  const cap = esc([m.art, m.caption, m.credit].filter(Boolean).join(" · ") || m.name);
  return m.shoot === "video"
    // preload="none" because a day can hold a dozen clips and preloading even their
    // metadata means a dozen requests before anything is on screen. The poster frame,
    // written next to the clip by hermes-annals-photos.mjs, is what makes that free:
    // the shoot is visible as a still and only fetches video when it is played.
    ? `<figure><video src="${href}" muted loop playsinline controls preload="none"${posterAttr(m)}></video><figcaption>${cap}</figcaption></figure>`
    : `<figure><img src="${href}" alt="${cap}" loading="lazy" decoding="async"><figcaption>${cap}</figcaption></figure>`;
}).join("")}</div>` : ""}
</section>`).join("\n")}
</main></body></html>
`;
writeFileSync(join(outDir, "index.html"), html);

if (!quiet) console.log(text);

const shown = (p) => relative(repo, p);
// Per entry rather than per run: a cached day was written by whoever wrote it,
// and the run that rendered it does not get to take the credit.
const byline = entries.reduce((tally, { written }) => {
  const who = written.by.startsWith("claude") ? "claude" : "the plain renderer";
  tally[who] = (tally[who] || 0) + 1;
  return tally;
}, {});
console.error(`\n${Object.entries(byline).map(([who, n]) => `${n} ${n === 1 ? "day" : "days"} by ${who}`).join(", ")}:`);
console.error(`  ${shown(join(outDir, "annals.md"))}`);
console.error(`  ${shown(join(outDir, "index.html"))}`);
console.error(`  ${shown(cachePath)}`);
console.error(`\ndrop stills and clips in ${shown(mediaRoot)}/<day>/ or ${shown(mediaRoot)}/art/<slug>/`);
