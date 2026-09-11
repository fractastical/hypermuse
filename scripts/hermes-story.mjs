#!/usr/bin/env node
// "Hermes was here" — the night, read back off the track log.
//
//   npm run hermes:story
//   npm run hermes:story -- --day=2026-08-29
//   npm run hermes:story -- --json
//
// Every sentence is read off the data. Nothing is invented, and where the log is
// silent it says so rather than joining the dots: the recorder spends most of its
// life unplugged and the phones only feed within range of one router, so a night
// arrives as islands with holes between them, and the holes are part of the story.
//
// The wording is worked out once and then rendered as text and as a page, so the
// two cannot come to disagree about what happened.
//
// Distances are metric because that is what the geometry is in, and rounded to
// something a person would say — ten metres of precision on a fix that is good to
// ten metres is false confidence twice over.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distanceMeters, placeCoords } from "./lib/playa-places.mjs";
import { journeys, readTrack } from "./lib/journeys.mjs";
import { renderPage } from "./lib/story-page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const trackPath = process.env.HERMES_TRACK || join(repo, "data", "hermes", "track.jsonl");
const outDir = process.env.HERMES_STORY_DIR || join(repo, "artifacts", "hermes-story");
const mapDir = join(repo, "data", "hermes", "2026", "map");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const asJson = process.argv.includes("--json");
const quiet = process.argv.includes("--quiet");
const day = arg("day");
// Journeys shorter than this are the log noticing the car exists rather than the
// car going anywhere, and a page of them buries the night's actual movement.
const minMetres = Number(arg("min") || 60);
// For when something has been feeding the log positions that were never true. The
// server refuses to record a fix marked test=1, so this should stay unused — it is
// here because it was needed once, retrospectively, and the reason it was needed
// is worth keeping in view.
const exclude = arg("exclude") ? new RegExp(arg("exclude"), "i") : null;

const listingPath = join(repo, "data", "hermes", "activities.json");
const listing = existsSync(listingPath) ? JSON.parse(readFileSync(listingPath, "utf8")) : null;
const activities = listing ? (Array.isArray(listing) ? listing : listing.activities || []) : [];
const TZ = process.env.HERMES_TZ || (listing && listing.timezone) || "America/Los_Angeles";

if (!existsSync(trackPath)) {
  console.error(`no track log at ${trackPath} — nothing to tell`);
  process.exit(1);
}

const all = readTrack(readFileSync(trackPath, "utf8"))
  .filter((p) => !exclude || !exclude.test(p.src));
if (!all.length) {
  console.error("the track log has no usable points");
  process.exit(1);
}

const dayKey = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
const points = day ? all.filter((p) => dayKey(p.ms) === day) : all;
if (!points.length) {
  const days = [...new Set(all.map((p) => dayKey(p.ms)))].sort();
  console.error(`nothing logged on ${day}. Days in the log: ${days.join(", ")}`);
  process.exit(1);
}

const time = (ms) => new Date(ms).toLocaleTimeString("en-US",
  { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayName = (ms) => new Date(ms).toLocaleDateString("en-US",
  { weekday: "long", month: "long", day: "numeric", timeZone: TZ });

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
  if (metres < 100) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
const named = (place) => (place && place.label) || "somewhere unnamed";

// What was on near a stop while Hermes was standing there. The listing says where
// in the city's own language, which the shared geocoder turns into a coordinate,
// so this is the same lookup the live panel ranks by.
const ACTIVITY_NEAR_M = 300;
const ACTIVITY_SLACK_MS = 30 * 60000;
function onNearby(stop) {
  const found = [];
  for (const activity of activities) {
    const at = placeCoords(activity.place);
    if (!at) continue;
    const metres = distanceMeters(stop.lat, stop.lon, at.lat, at.lon);
    if (metres > ACTIVITY_NEAR_M) continue;
    const start = Date.parse(activity.start || "");
    if (!Number.isFinite(start)) continue;
    if (start < stop.startMs - ACTIVITY_SLACK_MS || start > stop.endMs + ACTIVITY_SLACK_MS) continue;
    found.push({ ...activity, metres, start });
  }
  return found.sort((a, b) => a.metres - b.metres).slice(0, 3);
}

const raw = journeys(points).filter((j) => j.metres >= minMetres || j.stops > 0);

// A hue each, spaced around the wheel, so the map's trails and the headings
// beside them are the same colours in the same order.
const told = raw.map((journey, index) => {
  const hue = Math.round((index * 360) / Math.max(1, raw.length) + 190) % 360;
  const roundTrip = named(journey.from) === named(journey.to);
  const held = journey.stoppedMs >= (journey.endMs - journey.startMs) * 0.75;
  // Three different nights, and one sentence for each. Coming back to where it
  // started is the common one at a festival — camp, out, camp — and reading it as
  // "went 70 m from 8:45 & F to 8:45 & F" is how a first draft describes standing
  // still. Whether the two ends have the same name is the thing to test, not the
  // distance: a loop of five kilometres is still a night spent at camp.
  const headline = roundTrip && held
    ? `Hermes stayed at ${named(journey.from)} for ${spell(journey.endMs - journey.startMs)}, ` +
      `drifting ${far(journey.metres)} inside it.`
    : roundTrip
      ? `Hermes went ${far(journey.metres)} out from ${named(journey.from)} and back, ` +
        `over ${spell(journey.endMs - journey.startMs)}.`
      : `Hermes went ${far(journey.metres)} from ${named(journey.from)} to ${named(journey.to)}, ` +
        `over ${spell(journey.endMs - journey.startMs)}.`;

  let n = 0;
  const beats = [];
  for (const event of journey.events) {
    if (event.kind === "stop") {
      n++;
      beats.push({
        kind: "stop",
        n,
        time: time(event.startMs),
        // Where in this journey's points the stop finishes, so the page can hold
        // the marker back until an animated trail has actually arrived there.
        to: event.to,
        lat: event.lat,
        lon: event.lon,
        place: named(event.place),
        text: `stopped at **${named(event.place)}** for ${spell(event.dwellMs)}` +
          `${event.place && event.place.detail ? ` (${event.place.detail})` : ""}.`,
        nearby: onNearby(event).map((a) =>
          `**${a.title || "something"}** was on at ${a.place}, ${far(a.metres)} away, ` +
          `starting ${time(a.start)}.`)
      });
    } else {
      // A leg of a few metres is the fix breathing, not a drive.
      if (event.metres < 30) continue;
      beats.push({
        kind: "leg",
        time: time(event.startMs),
        text: event.openEnded
          ? `moved ${far(event.metres)} over ${spell(event.endMs - event.startMs)}, ` +
            `last seen at **${named(event.place)}**.`
          : `moved ${far(event.metres)} to **${named(event.place)}**, ` +
            `taking ${spell(event.endMs - event.startMs)}.`
      });
    }
  }

  return {
    ...journey,
    hue,
    label: `${time(journey.startMs)} — ${time(journey.endMs)}`,
    day: dayName(journey.startMs),
    headline,
    beats
  };
});

// The hole between one journey and the next is a fact about the record, not about
// the night, and saying so is the difference between a log and a lie.
told.forEach((journey, index) => {
  const next = told[index + 1];
  journey.silenceAfter = next
    ? `Then ${spell(next.startMs - journey.endMs)} with nothing recorded — ` +
      `the handheld was unplugged, or no phone was in range.`
    : null;
});

const metres = told.reduce((sum, j) => sum + j.metres, 0);
const sources = [...new Set(told.flatMap((j) => j.sources))];
const first = points[0];
const last = points[points.length - 1];

const story = {
  title: "Hermes was here",
  subtitle: day || dayKey(first.ms) === dayKey(last.ms)
    ? dayName(first.ms)
    : `${dayName(first.ms)} to ${dayName(last.ms)}`,
  tally: told.length
    ? `${told.length} ${told.length === 1 ? "journey" : "journeys"} · ${far(metres)} · ` +
      `${points.length} fixes · ${sources.join(", ") || "an unnamed source"}`
    : `${points.length} fixes, no journey among them`,
  mapCaption: "Trail from the track log on the 2026 city geometry. Numbers are stops.",
  // Only offered if it has actually been rendered. The page draws its own trail
  // anyway, so the gif is the copy for places that cannot run a canvas — a
  // message thread, a mailing list — and a link to one that is not there yet is
  // worse than no link.
  gif: existsSync(join(outDir, "hermes-trail.gif")) ? "hermes-trail.gif" : null,
  footer: `Read off ${points.length} fixes, places named from the official 2026 GIS. ` +
    `Written ${new Date().toLocaleString("en-US", { timeZone: TZ })}.`,
  journeys: told,
  map: existsSync(join(mapDir, "playa-streets-metadata.json"))
    ? JSON.parse(readFileSync(join(mapDir, "playa-streets-metadata.json"), "utf8"))
    : null
};

if (asJson) {
  console.log(JSON.stringify({
    day: day || null,
    logged: points.length,
    journeys: told.map((j) => ({
      start: new Date(j.startMs).toISOString(),
      end: new Date(j.endMs).toISOString(),
      metres: Math.round(j.metres),
      stops: j.stops,
      from: named(j.from),
      to: named(j.to),
      sources: j.sources,
      headline: j.headline,
      beats: j.beats.map((b) => ({ kind: b.kind, time: b.time, text: b.text, place: b.place }))
    }))
  }, null, 2));
  process.exit(0);
}

const lines = [`# ${story.title}`, "", `## ${story.subtitle}`, "", story.tally, ""];
if (!told.length) {
  lines.push(`The log holds ${points.length} fixes but nothing that amounts to a journey — ` +
    `Hermes did not go anywhere far enough to be worth a sentence.`, "");
}
for (const journey of told) {
  lines.push(`### ${journey.label}`, "", journey.headline, "");
  for (const beat of journey.beats) {
    lines.push(`- **${beat.time}** ${beat.text}`);
    for (const near of beat.nearby || []) lines.push(`    - ${near}`);
  }
  lines.push("");
  if (journey.silenceAfter) lines.push(`*${journey.silenceAfter}*`, "");
}
lines.push("---", story.footer);
const text = lines.join("\n");
if (!quiet) console.log(text);

mkdirSync(outDir, { recursive: true });
const stamp = day || dayKey(last.ms);
writeFileSync(join(outDir, `hermes-was-here-${stamp}.md`), text + "\n");

if (story.map) {
  writeFileSync(join(outDir, "index.html"), renderPage(story));
  // Beside the page rather than referenced back into the repo, so the directory
  // is the whole dispatch and can be moved anywhere as it stands. Both forms of
  // the map: the page crops into it and wants the vector, and falls back to the
  // raster wherever the vector will not load.
  for (const name of ["playa-streets.svg", "playa-streets.png"]) {
    if (existsSync(join(mapDir, name))) copyFileSync(join(mapDir, name), join(outDir, name));
  }
}

const shown = (p) => p.replace(repo + "/", "");
console.error(`\nwritten:`);
console.error(`  ${shown(join(outDir, `hermes-was-here-${stamp}.md`))}`);
if (story.map) console.error(`  ${shown(join(outDir, "index.html"))}`);
else console.error(`  (no page: ${shown(mapDir)}/playa-streets-metadata.json is missing)`);
