#!/usr/bin/env node
// Best-effort Instagram ingestion for public posts/reels.
//
// Usage:
//   npm run hermes:instagram
//   npm run hermes:instagram -- --source=data/hermes/instagram-sources.json --dry
//   npm run hermes:instagram -- --apply
//
// Output:
//   data/hermes/instagram-scrape.json
// Optional --apply:
//   appends parsed DJ/live-act requests to data/hermes/pickup-requests.jsonl
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const root = process.cwd();
const arg = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const sourcePath = join(root, arg("source", "data/hermes/instagram-sources.json"));
const outPath = join(root, arg("out", "data/hermes/instagram-scrape.json"));
const pickupPath = join(root, "data/hermes/pickup-requests.jsonl");
const dry = flag("dry");
const apply = flag("apply");

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function tidy(text) {
  return decodeHtml(String(text || "").replace(/\s+/g, " ").trim());
}

function parseMeta(html, key, isProperty = true) {
  const attr = isProperty ? "property" : "name";
  const re = new RegExp(`<meta\\s+[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = re.exec(html);
  return m ? tidy(m[1]) : "";
}

function parseCaption(html) {
  const candidates = [];
  const og = parseMeta(html, "og:description", true);
  const desc = parseMeta(html, "description", false);
  if (og) candidates.push(og);
  if (desc) candidates.push(desc);

  const jsonCap = /"caption":"([^"]{20,4000})"/g;
  for (const m of html.matchAll(jsonCap)) candidates.push(tidy(m[1]));

  const bodyCap = /"articleBody":"([^"]{20,4000})"/g;
  for (const m of html.matchAll(bodyCap)) candidates.push(tidy(m[1]));

  if (!candidates.length) return "";
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function parseHandle(url, caption) {
  const byCaption = /@([a-zA-Z0-9._]{2,30})/.exec(caption || "");
  if (byCaption) return byCaption[1];
  const byUrl = /instagram\.com\/([a-zA-Z0-9._]{2,30})\//.exec(url || "");
  if (byUrl && !["p", "reel", "tv"].includes(byUrl[1])) return byUrl[1];
  return "";
}

const TIME_RE = /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b/i;
const PLACE_RE = /\b(?:\d{1,2}(?::\d{2})?\s*&\s*[A-Za-z][A-Za-z0-9 .'-]{0,20}|[2-9]:[0-5][0-9]\s*&\s*[A-L](?:\s+Plaza)?|[2-9]:[0-5][0-9]\s*&\s*ESP)\b/i;

function parseSetLines(caption) {
  const lines = String(caption || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith("#"));

  const parsed = [];
  for (const line of lines) {
    const lineClean = line.replace(/^[\-\u2022*]+\s*/, "").trim();
    if (!lineClean) continue;
    if (!TIME_RE.test(lineClean)) continue;
    const t1 = /^((?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?)\s*[-–—:|]\s*(.+)$/i.exec(lineClean);
    const t2 = /^(.+?)\s*[-–—:|]\s*((?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?)$/i.exec(lineClean);
    const t3 = /^(.+?)\s+(?:at|@)\s+((?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?)/i.exec(lineClean);
    let when = "";
    let act = "";
    if (t1) { when = tidy(t1[1]); act = tidy(t1[2]); }
    else if (t2) { when = tidy(t2[2]); act = tidy(t2[1]); }
    else if (t3) { when = tidy(t3[2]); act = tidy(t3[1]); }
    else {
      const tm = TIME_RE.exec(lineClean);
      if (!tm) continue;
      when = tidy(tm[0]);
      act = tidy(lineClean.replace(tm[0], "").replace(/^[-–—:|]\s*/, ""));
    }
    if (!act) act = "Set";
    const placeMatch = PLACE_RE.exec(lineClean);
    parsed.push({
      when,
      act,
      place: placeMatch ? tidy(placeMatch[0]) : "",
      line: lineClean
    });
  }
  return parsed.slice(0, 20);
}

async function scrapeOne(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "accept-language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  const caption = parseCaption(html);
  const handle = parseHandle(url, caption);
  const sets = parseSetLines(caption);
  return {
    url,
    fetchedAt: new Date().toISOString(),
    handle,
    caption,
    setLines: sets
  };
}

function loadSources(path) {
  if (!existsSync(path)) {
    throw new Error(`source file not found: ${path}`);
  }
  const body = JSON.parse(readFileSync(path, "utf8"));
  const urls = Array.isArray(body) ? body : body.urls || [];
  return urls.map((u) => String(u || "").trim()).filter(Boolean);
}

function makeRequest(row, setLine) {
  const base = `${row.url}|${setLine.line}|${setLine.when}|${setLine.act}`;
  const id = `ig-${createHash("sha1").update(base).digest("hex").slice(0, 12)}`;
  return {
    id,
    at: new Date().toISOString(),
    who: row.handle || "instagram",
    intention: "from instagram setlist",
    requestType: "dj-set",
    place: setLine.place || "wherever Hermes is now",
    pickupWhen: setLine.when || "asap",
    pickupAt: null,
    equipmentNeeded: "",
    lat: NaN,
    lon: NaN,
    note: `${setLine.act} · ${setLine.line}`.slice(0, 220),
    source: "instagram-scrape",
    ip: ""
  };
}

function appendRequests(rows) {
  const existing = new Set();
  if (existsSync(pickupPath)) {
    for (const line of readFileSync(pickupPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item && item.id) existing.add(String(item.id));
      } catch { /* skip malformed */ }
    }
  }
  const toWrite = [];
  for (const row of rows) {
    for (const setLine of row.setLines || []) {
      const request = makeRequest(row, setLine);
      if (existing.has(request.id)) continue;
      existing.add(request.id);
      toWrite.push(request);
    }
  }
  if (!toWrite.length) return 0;
  mkdirSync(dirname(pickupPath), { recursive: true });
  appendFileSync(pickupPath, toWrite.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return toWrite.length;
}

async function main() {
  const urls = loadSources(sourcePath);
  if (!urls.length) {
    throw new Error(`no URLs in ${sourcePath}`);
  }
  const rows = [];
  for (const url of urls) {
    try {
      const row = await scrapeOne(url);
      rows.push({ ...row, ok: true });
      console.log(`ok   ${url}  (${row.setLines.length} set line(s))`);
    } catch (err) {
      rows.push({ url, fetchedAt: new Date().toISOString(), ok: false, error: String(err.message || err) });
      console.log(`fail ${url}  (${String(err.message || err)})`);
    }
  }

  const okRows = rows.filter((r) => r.ok);
  const out = {
    generated: new Date().toISOString(),
    source: sourcePath,
    count: rows.length,
    ok: okRows.length,
    failed: rows.length - okRows.length,
    posts: rows
  };

  if (!dry) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  }

  let added = 0;
  if (apply && !dry) added = appendRequests(okRows);

  console.log(`\n${okRows.length}/${rows.length} posts scraped`);
  console.log(dry ? `--dry: would write ${outPath}` : `wrote ${outPath}`);
  if (apply) console.log(`added ${added} instagram-derived request(s)`);
}

main().catch((err) => {
  console.error(`\n${String(err.message || err)}`);
  process.exit(1);
});
