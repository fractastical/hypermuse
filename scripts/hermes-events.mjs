#!/usr/bin/env node
// The official What Where When, turned into something the moon can advertise.
//
//   npm run hermes:events                    # this year, live API, needs a key
//   npm run hermes:events -- --year=2025     # a past year, no key needed
//   npm run hermes:events -- --dry           # report, write nothing
//   npm run hermes:events -- --merge         # keep the invented side quests too
//
// Burning Man publishes camps, art and events two ways. The live API at
// api.burningman.org has the current year and wants HTTP Basic auth with a key
// you request at https://api.burningman.org/ — put it in BM_API_KEY. The archive
// on S3 has 2015 through last year and wants nothing at all, which is what makes
// this script testable in the off season and on a year the key has not arrived
// for yet: same field names, same shapes, so a run against 2025 proves the
// mapping before the key ever turns up.
//
// The join is the actual work. An event does not carry an address — it carries
// the uid of the camp hosting it, or of the art it is installed at, and the
// address lives over there. So all three files have to come down together, and
// an event whose camp is missing from the camp file is an event nobody can be
// sent to.
//
// The other half of the work is that the official address vocabulary and the
// GIS vocabulary are not the same vocabulary. Placement writes "9:00 B Plaza @
// 3:00" and "Esplanade & 7:30"; the shapefiles say "9 & B Plaza" and "ESP".
// Left alone, roughly a tenth of the listing lands nowhere. See placeFor.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { placeCoords } from "./lib/playa-places.mjs";

const root = process.cwd();
const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const year = Number(arg("year", new Date().getFullYear()));
const dry = flag("dry");
const merge = flag("merge");
const outPath = arg("out", join(root, "data", "hermes", "activities.json"));
// An event that ran on Tuesday is not news on Saturday, but the server already
// drops anything finished and this file is read once at boot, so the default is
// the whole week and the window is for when you want the moon to be tonight.
const windowHours = Number(arg("window", 0));

const ARCHIVE = "https://bm-innovate.s3.amazonaws.com/archive";
const LIVE = "https://api.burningman.org/api/v1";
const key = process.env.BM_API_KEY || "";

// The API answers with `www-authenticate: Basic realm="Burning Man API"`, so the
// key goes in as credentials rather than a bearer token or an X- header. Keys
// issued as a bare string are the username with no password; if yours came as a
// pair, put the colon in BM_API_KEY and it is passed through as given.
const basic = () => "Basic " + Buffer.from(key.includes(":") ? key : `${key}:`).toString("base64");

// The live API takes the singular and a year; the archive is a folder per year
// of plural filenames, except art, which is already plural enough for anyone.
const ARCHIVE_FILE = { event: "events", camp: "camps", art: "art" };

async function grab(what) {
  const live = key && year >= new Date().getFullYear();
  const url = live ? `${LIVE}/${what}?year=${year}` : `${ARCHIVE}/${year}/${ARCHIVE_FILE[what]}.json`;
  const res = await fetch(url, live ? { headers: { authorization: basic() } } : undefined);
  if (live && (res.status === 401 || res.status === 403)) {
    throw new Error(`${url}\n  refused the key in BM_API_KEY. Request one at https://api.burningman.org/`);
  }
  if (!res.ok) throw new Error(`${url}\n  answered ${res.status} ${res.statusText}`);
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) throw new Error(`${url}\n  did not answer with a list`);
  return { rows: body, url };
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;
// The CPN file writes clock times without the colon, and then is not consistent
// about the rest: plazas drop a trailing :00 and portals keep it, so the same
// hour is "9 & B Plaza" and "900 Portal". Both spellings are needed because
// neither is what anybody writes on an address.
const plazaClock = (text) => {
  const m = CLOCK.exec(text.trim());
  if (!m) return null;
  return m[2] === "00" ? String(Number(m[1])) : `${Number(m[1])}${m[2]}`;
};
const portalClock = (text) => {
  const m = CLOCK.exec(text.trim());
  return m ? `${Number(m[1])}${m[2]}` : null;
};

// Placement's spelling on the left, the shapefiles' on the right.
const STREET_ALIASES = new Map([
  ["esplanade", "ESP"],
  ["esp", "ESP"],
  ["rod's road", "Rods Road"],
  ["rods road", "Rods Road"],
  ["route 66", "Route 66"]
]);

// An official address in a form the geocoder has a chance with. Everything here
// is a shape seen in a real camp file, in descending order of how many camps use
// it; anything else is handed over untouched, because placeCoords already snaps
// odd radials to real ones and knows the CPN names by heart.
function normalise(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  // "9:00 B Plaza @ 3:00" and "Center Camp Plaza @ 6:00" — the tail is which
  // side of the plaza the camp is on, which is finer than a marker can show.
  text = text.replace(/\s*@\s*\d{1,2}:\d{2}\s*$/, "").trim();
  text = text.replace(/\s+and\s+/gi, " & ");

  // "9:00 B Plaza" -> "9 & B Plaza", an official point with its own coordinate.
  const plaza = /^(\d{1,2}:\d{2})\s+([A-La-l])\s+Plaza$/.exec(text);
  if (plaza) {
    const clock = plazaClock(plaza[1]);
    if (clock) return `${clock} & ${plaza[2].toUpperCase()} Plaza`;
  }
  // "3:00 Portal" on its own -> the CPN "300 Portal".
  const portal = /^(\d{1,2}:\d{2})\s+Portal$/i.exec(text);
  if (portal) {
    const clock = portalClock(portal[1]);
    if (clock) return `${clock} Portal`;
  }
  // The cafe, the canopy, the creation station and everything else anybody calls
  // Center Camp are one CPN as far as the map is concerned, and it is a big
  // enough structure that landing on its centre is landing on it.
  if (/^center\s+camp\b/i.test(text)) return "Center Camp";

  const parts = text.split("&").map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return text;
  // Inside a pair, "3:00 Portal & B" is just the corner: the portal is the gap in
  // the block at that radial, so the radial is the half of the address that
  // carries meaning.
  const side = (part) => {
    const bare = part.replace(/\s+Portal$/i, "").trim();
    return STREET_ALIASES.get(bare.toLowerCase()) || bare;
  };
  return `${side(parts[0])} & ${side(parts[1])}`;
}

// Where a listing goes on the map, and what the panel prints underneath it. Art
// is the good case and the rare one: the art file carries a surveyed lat/lon, so
// a piece a mile out in open playa — which has no corner and never will — still
// gets a marker on the exact spot rather than being quietly dropped.
function placeFor(event, camps, art, byName) {
  let home = camps.get(event.hosted_by_camp) || art.get(event.located_at_art) || null;
  // An event hosted nowhere official often writes its camp's name in the free
  // text instead of taking a uid — "COOLSVILLE", "Tengri Camp" — and that camp
  // is sitting in the camp file with an address on it.
  if (!home && event.other_location) home = byName.get(event.other_location.trim().toLowerCase()) || null;
  const raw = home ? home.location_string : event.other_location;
  const place = normalise(raw);
  const at = place ? placeCoords(place) : null;
  const gps = home && home.location && Number.isFinite(home.location.gps_latitude)
    ? { lat: home.location.gps_latitude, lon: home.location.gps_longitude }
    : null;
  return {
    name: home ? home.name : "",
    address: String(raw || "").trim(),
    place: at ? place : "",
    gps,
    placed: Boolean(at || gps)
  };
}

const clean = (text, limit) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
};

async function main() {
  // The archive is a March-the-following-year publication, so the current year
  // exists only behind the key. Saying so beats a 403 from S3 that reads like
  // the network is broken.
  if (!key && year >= new Date().getFullYear()) {
    console.error(`${year} is only available from the live API, and BM_API_KEY is not set.`);
    console.error("  Request a key at https://api.burningman.org/ (free, HTTP Basic auth).");
    console.error(`  Then: BM_API_KEY=... npm run hermes:events`);
    console.error(`  To see the importer work in the meantime: npm run hermes:events -- --year=2025 --dry`);
    process.exit(1);
  }

  const [events, camps, art] = await Promise.all([grab("event"), grab("camp"), grab("art")]);
  console.log(`from ${dirname(events.url)}`);
  console.log(`  ${events.rows.length} events, ${camps.rows.length} camps, ${art.rows.length} art\n`);

  const byUid = (rows) => new Map(rows.map((r) => [r.uid, r]));
  const campIndex = byUid(camps.rows);
  const artIndex = byUid(art.rows);
  const nameIndex = new Map(camps.rows
    .filter((c) => c.location_string)
    .map((c) => [String(c.name || "").trim().toLowerCase(), c]));

  const now = Date.now();
  const until = windowHours > 0 ? now + windowHours * 3600000 : Infinity;
  const activities = [];
  const unplaced = new Map();

  for (const event of events.rows) {
    const where = placeFor(event, campIndex, artIndex, nameIndex);
    if (!where.placed && where.address) {
      unplaced.set(where.address, (unplaced.get(where.address) || 0) + 1);
    }
    for (const slot of event.occurrence_set || []) {
      const start = Date.parse(slot.start_time);
      const end = Date.parse(slot.end_time);
      if (!Number.isFinite(start)) continue;
      if (windowHours > 0 && (start > until || (Number.isFinite(end) ? end : start) < now)) continue;
      activities.push({
        title: clean(event.title, 90),
        // The camp name is the half of this a person navigates by. "Ashram
        // Galactica, 7:30 & E" is findable; "7:30 & E" is a block.
        location: [where.name, where.address].filter(Boolean).join(", ") || "location unknown",
        place: where.place,
        ...(where.gps ? { lat: where.gps.lat, lon: where.gps.lon } : {}),
        start: slot.start_time,
        minutes: Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 60000)) : 60,
        adult: (event.event_type || {}).label === "Mature Audiences",
        kind: (event.event_type || {}).abbr || "",
        description: clean(event.print_description || event.description, 320)
      });
    }
  }

  activities.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const placed = activities.filter((a) => a.place || Number.isFinite(a.lat)).length;
  const pct = activities.length ? Math.round((placed / activities.length) * 100) : 0;
  console.log(`${activities.length} occurrences, ${placed} of them placeable on the map (${pct}%)`);
  if (unplaced.size) {
    const worst = [...unplaced.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`\n${unplaced.size} addresses the geocoder could not read, commonest first:`);
    for (const [address, count] of worst) console.log(`  ${String(count).padStart(4)}  ${address}`);
  }

  let kept = [];
  if (merge && existsSync(outPath)) {
    const held = JSON.parse(readFileSync(outPath, "utf8"));
    kept = Array.isArray(held) ? held : held.activities || [];
    console.log(`\nkeeping ${kept.length} existing listings alongside the official ones`);
  }

  const out = {
    note: `Official Burning Man ${year} listings${kept.length ? ", plus unofficial Hermes side quests" : ""}. `
      + "Times are playa local. 'place' is what gets geocoded onto the map — a street corner or an "
      + "official CPN name — while 'location' is what the panel prints. Art carries its own surveyed "
      + "lat/lon because open playa has no corners.",
    timezone: "America/Los_Angeles",
    source: events.url,
    generated: new Date().toISOString(),
    activities: [...kept, ...activities]
  };

  if (dry) {
    console.log(`\n--dry, so ${outPath} is untouched. Three it would have written:`);
    for (const a of activities.slice(0, 3)) console.log(`  ${a.start}  ${a.title} — ${a.location}`);
    return;
  }

  // The file being replaced was written by hand and has never been committed, so
  // it only exists here. Moving it aside is not politeness, it is the only copy.
  if (existsSync(outPath)) {
    const aside = outPath.replace(/\.json$/, `.${Date.now()}.json`);
    renameSync(outPath, aside);
    console.log(`\nprevious listing moved to ${aside}`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${out.activities.length} listings to ${outPath}`);
  console.log("restart the hermes server to pick them up");
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
