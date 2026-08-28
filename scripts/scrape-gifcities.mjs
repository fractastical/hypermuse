#!/usr/bin/env node
/**
 * Pulls themed animated GIFs out of the Internet Archive's GifCities, the
 * search index over the GIFs rescued from GeoCities.
 *
 *   npm run gifs
 *   THEMES="ufo,spaceship" npm run gifs   # just these, added to what's there
 *   PER=60 npm run gifs                   # how many to keep per theme
 *
 * Runs are cumulative: the existing index is read back in first, so adding a
 * theme does not throw away the last pull, and a theme that is already full is
 * skipped rather than re-fetched. Delete a file and the next run tops it up.
 *
 * Search gives a ranked list; the ranking is by how often a GIF appeared
 * across GeoCities, so the top of it is the genuinely ubiquitous web-1.0
 * furniture rather than one person's oddity. What comes back still needs
 * sifting: a query for "lava lamp" happily returns banner ads, and a swarm
 * wants small squarish sprites rather than 494x10 rules.
 *
 * Everything lands in assets/gifcities/<theme>/ with an index.json beside it
 * carrying the source page for each file, so provenance survives. That folder
 * is gitignored, like the rest of the media.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, process.env.OUT || "assets/gifcities");
const PER = Number.parseInt(process.env.PER || "40", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "4", 10);

// Queries are single words wherever possible, because the filter below insists
// the *last* word of the query is in the filename: "space ship" would go
// looking for ships and find a lot of pirates, where "spaceship" finds ships
// in space. Same reason there is no "disco ball" or "crystal ball" here.
const THEMES = (process.env.THEMES || [
  // out there
  "moon", "spaceship", "ufo", "alien", "rocket", "planet", "saturn", "galaxy",
  "astronaut", "comet", "satellite", "telescope", "earth", "sun", "star",
  // the psychedelic end of 1999
  "lava lamp", "rainbow", "peace", "smiley", "mushroom", "spiral", "yin yang",
  // occult
  "skull", "pentagram", "candle", "pyramid", "ankh", "dragon", "wizard", "crystal",
  // soft things
  "heart", "butterfly", "flower", "angel", "fairy", "cat", "flame", "eye"
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

// A swarm sprite wants to read at thumbnail size. Rules, banners and single
// pixels all come back from the same search and none of them are any use.
const MIN_PX = 24;
const MAX_PX = 500;
const MAX_ASPECT = 2.6;

// The index matches on the GIF's path, not on the picture, so a search for
// "heart" turns up a BACK button that happened to live in a folder called
// heart_to_arashi2. Two things fix most of it: insist the theme word lands in
// the filename rather than some ancestor directory, and throw out the standard
// furniture of a 1999 homepage, which is what most false hits actually are.
const FURNITURE = new Set([
  "back", "next", "home", "prev", "previous", "button", "buttons", "bar", "bars",
  "line", "lines", "rule", "banner", "ad", "ads", "mail", "email", "mailbox",
  "arrow", "arrows", "flag", "logo", "counter", "under", "construction",
  "new", "click", "here", "sign", "guestbook", "award", "link", "links", "menu"
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(url, asBuffer, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "hypermuse-art-project/1.0" },
        signal: AbortSignal.timeout(45000)
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(900 * (i + 1));
    }
  }
}

/**
 * Walks a GIF's block structure to count frames. Scanning for 0x2C bytes is
 * the obvious shortcut and it is wrong: that value turns up constantly inside
 * colour tables and pixel data, so a still would report as animated.
 */
function frameCount(buf) {
  if (buf.length < 13 || buf.toString("latin1", 0, 3) !== "GIF") return 0;
  let p = 10;
  const flags = buf[p++];
  p++; p++;                                        // background, aspect
  if (flags & 0x80) p += 3 * (2 << (flags & 0x07)); // global colour table
  let frames = 0;
  const skipBlocks = () => {
    while (p < buf.length) {
      const n = buf[p++];
      if (!n) return;
      p += n;
    }
  };
  while (p < buf.length) {
    const marker = buf[p++];
    if (marker === 0x3b) break;                    // trailer
    if (marker === 0x21) { p++; skipBlocks(); continue; }  // extension
    if (marker !== 0x2c) break;                    // anything else: malformed
    frames++;
    p += 8;
    const lf = buf[p++];
    if (lf & 0x80) p += 3 * (2 << (lf & 0x07));    // local colour table
    p++;                                           // LZW minimum code size
    skipBlocks();
  }
  return frames;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function theme(name, seen, have) {
  const dir = path.join(OUT, slug(name));
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\n[${name}] ${have.length ? have.length + " already" : ""}`);
  if (have.length >= PER) { console.log("  full"); return have; }

  let hits;
  try {
    hits = await grab(
      `https://gifcities.archive.org/api/v1/gifsearch?q=${encodeURIComponent(name)}`, false);
  } catch (err) {
    console.log(`  search failed: ${err.message}`);
    return [];
  }

  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  const head = words[words.length - 1];            // "lamp" out of "lava lamp"

  const shortlist = hits.filter((h) => {
    const w = h.width || 0, hh = h.height || 0;
    if (w < MIN_PX || hh < MIN_PX || w > MAX_PX || hh > MAX_PX) return false;
    if (Math.max(w / hh, hh / w) > MAX_ASPECT) return false;
    if (seen.has(h.checksum)) return false;

    const tokens = String(h.url_text || "").toLowerCase().split(/\s+/).filter(Boolean);
    const tail = tokens.slice(-3);                 // roughly the filename
    if (!tail.includes(head)) return false;
    if (tail.some((t) => FURNITURE.has(t))) return false;

    // Hits carrying every word of the query are the real thing; hits carrying
    // only the last are a kerosene lamp answering to "lava lamp".
    h._score = words.filter((wd) => tokens.includes(wd)).length;
    seen.add(h.checksum);
    return true;
  }).sort((a, b) => (b._score - a._score) || (b.weight - a.weight));
  console.log(`  ${hits.length} hits, ${shortlist.length} plausible`);

  const kept = have.slice();
  let idx = 0;
  async function worker() {
    while (idx < shortlist.length && kept.length < PER) {
      const h = shortlist[idx++];
      // The name is derived from the hit, so an earlier run's file can be
      // recognised before spending a request on it. Indexes written before
      // checksums were recorded have no other way of saying "already got it".
      const file = `${slug(h.url_text || "gif")}-${h.checksum.slice(0, 6)}.gif`.slice(-70);
      if (fs.existsSync(path.join(dir, file))) continue;
      const url = `https://web.archive.org/web/${h.gif.replace(/^(\d+)\//, "$1im_/")}`;
      let buf;
      try { buf = await grab(url, true); } catch { continue; }
      const frames = frameCount(buf);
      // A still GIF is no use to a swarm that is meant to shimmer.
      if (frames < 2) continue;
      fs.writeFileSync(path.join(dir, file), buf);
      kept.push({
        file, w: h.width, h: h.height, frames,
        weight: h.weight, source: h.page, checksum: h.checksum
      });
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const byFile = new Map(kept.map((g) => [g.file, g]));
  kept.length = 0;
  kept.push(...byFile.values());
  kept.sort((a, b) => b.weight - a.weight);
  console.log(`  ${kept.length} total (+${kept.length - have.length})`);
  return kept;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const idxPath = path.join(OUT, "index.json");
  let index = { themes: {} };
  if (fs.existsSync(idxPath)) {
    try { index = JSON.parse(fs.readFileSync(idxPath, "utf8")); } catch { /* start over */ }
  }
  index.themes = index.themes || {};

  // Entries whose file has gone are dropped, so deleting a GIF off disk is a
  // way of saying "get me another one of these" on the next run.
  for (const [slugName, t] of Object.entries(index.themes)) {
    t.gifs = (t.gifs || []).filter((g) => fs.existsSync(path.join(OUT, slugName, g.file)));
  }

  // Seeding the dedupe set with what is already held means the shortlist skips
  // those hits outright, so nothing gets downloaded twice across runs.
  const seen = new Set();
  for (const t of Object.values(index.themes)) {
    for (const g of t.gifs) if (g.checksum) seen.add(g.checksum);
  }

  for (const name of THEMES) {
    const s = slug(name);
    const kept = await theme(name, seen, (index.themes[s] || {}).gifs || []);
    if (kept.length) index.themes[s] = { query: name, gifs: kept };
  }

  index.built = new Date().toISOString();
  fs.writeFileSync(idxPath, JSON.stringify(index, null, 2));
  const total = Object.values(index.themes).reduce((n, t) => n + t.gifs.length, 0);
  console.log(`\n${total} gifs across ${Object.keys(index.themes).length} themes`);
  console.log(`index -> ${path.relative(ROOT, idxPath)}`);
})();
