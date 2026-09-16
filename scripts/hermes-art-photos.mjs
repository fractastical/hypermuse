#!/usr/bin/env node
/**
 * Fetch the official photograph of every art piece the annals names.
 *
 * The annals say "within sixty metres of The Lightning Tower" and then show the reader
 * nothing, which asks them to take a name on trust and picture a thing they have never
 * seen. Burning Man's own archive carries a photograph for most pieces, so this pulls
 * those down once and caches them next to the poster.
 *
 * The uncomfortable part, printed on the page rather than buried here: the only art
 * archive that exists in this repo is 2025, and the annals are 2026. Burning Man
 * publishes each year's archive after the event, so the distances the days quote — and
 * now these photographs — are matched against where things stood the previous year.
 * Most of the large pieces return, many in the same spot; some do not. That is a real
 * caveat and the page says so, because a reader who sees a photograph will otherwise
 * assume it was taken on the night described.
 *
 * Cached by uid, so a rerun costs nothing and an archive that goes away later does not
 * take the published page with it.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const ART_YEAR = 2025;
const artPath = join(repo, "data", "hermes", "art", ART_YEAR + "-art.json");
const indexPath = join(repo, "data", "hermes", "annals-index.json");
const outDir = join(repo, "assets", "hermes-annals", "art");

if (!existsSync(artPath)) {
  console.error("no art archive at " + artPath);
  process.exit(1);
}
if (!existsSync(indexPath)) {
  console.error("no annals index; run npm run hermes:annals:index first");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(artPath, "utf8")).rows || [];
const byName = new Map(rows.map((r) => [String(r.name || "").trim().toLowerCase(), r]));

// Only what the annals actually name. The archive has 341 pieces and the week went near
// two dozen; fetching the rest would be downloading a museum to illustrate a walk.
const index = JSON.parse(readFileSync(indexPath, "utf8"));
const wanted = new Map();
for (const day of index.days || []) {
  for (const art of (day.facts && day.facts.art) || []) {
    if (!wanted.has(art.name)) wanted.set(art.name, art);
  }
}

mkdirSync(outDir, { recursive: true });

const manifest = { note: "", year: ART_YEAR, source: "", pieces: {} };
manifest.note = "Photographs and placements from Burning Man's " + ART_YEAR +
  " art archive, which is the most recent one published. The annals describe 2026.";
manifest.source = "https://bm-innovate.s3.amazonaws.com/archive/" + ART_YEAR + "/art.json";

let fetched = 0;
let cached = 0;
let missing = 0;
const absent = [];

for (const [name] of wanted) {
  const row = byName.get(name.trim().toLowerCase());
  const url = row && row.images && row.images[0] && row.images[0].thumbnail_url;
  if (!row || !url) {
    missing++;
    absent.push(name + (row ? " (in the archive, no photograph)" : " (not in the archive)"));
    continue;
  }
  // uid, not the name: names carry commas, question marks and combining marks that do
  // not survive a round trip through a filesystem and a url intact.
  const file = row.uid + ".jpg";
  const dest = join(outDir, file);
  if (!existsSync(dest)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error("suspiciously small: " + buf.length + " bytes");
      writeFileSync(dest, buf);
      fetched++;
    } catch (err) {
      missing++;
      absent.push(name + " (" + err.message + ")");
      continue;
    }
  } else {
    cached++;
  }
  manifest.pieces[name] = {
    file,
    artist: row.artist || "",
    hometown: row.hometown || "",
    where: row.location_string || "",
    bytes: statSync(dest).size,
  };
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const total = Object.values(manifest.pieces).reduce((n, p) => n + p.bytes, 0);
console.log("[art] " + wanted.size + " pieces named across the annals");
console.log("[art] " + fetched + " fetched, " + cached + " already cached, " + missing + " without a photograph");
console.log("[art] " + (total / 1024).toFixed(0) + " KB in " + outDir.replace(repo + "/", ""));
for (const line of absent) console.log("       no photo: " + line);
