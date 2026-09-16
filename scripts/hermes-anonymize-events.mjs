#!/usr/bin/env node
// Turns the people-graph log into something that can live in a public repo: the events
// and their shape, with every name replaced by a stable pseudonym.
//
//   node scripts/hermes-anonymize-events.mjs             # what it would write
//   node scripts/hermes-anonymize-events.mjs --apply
//   node scripts/hermes-anonymize-events.mjs --show-map  # the mapping, on screen only
//
// Why keyed and not hashed. The names here are ordinary first names and a handful of
// public figures. A plain sha256 of "Sophia" is the same sha256 anybody else can compute,
// so an unsalted hash would publish a lookup table rather than a pseudonym: you would
// guess a few hundred names, hash each, and read straight off who was censored. The
// pseudonyms are therefore HMACs under a secret that stays out of the repo. Whoever holds
// the secret can re-derive the mapping; nobody else can invert it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = process.env.HERMES_PEOPLE_EVENTS ||
  join(repo, "data", "hermes", "people-graph-events.jsonl");
const outPath = join(repo, "data", "hermes", "people-graph-events.anon.jsonl");
const saltPath = join(repo, "data", "hermes", ".anon-salt");
const apply = process.argv.includes("--apply");
const showMap = process.argv.includes("--show-map");

// Fields that name a person. Anything here becomes a pseudonym, and anything matching
// one of these values inside free text is rewritten too.
const PERSON_FIELDS = ["person", "fromPerson", "toPerson", "withPerson", "subject", "reporter"];
// Roles rather than people. Pseudonymising "admin" would say a person was called admin.
const NOT_PEOPLE = new Set(["admin", "crew", "system", "hermes", "anonymous", "unknown", ""]);
// Structural, and none of it identifies anyone, so it survives intact.
const KEEP = new Set(["id", "at", "type", "kind", "severity", "severityRank", "verdict", "source"]);
// Deliberately dropped. An address is an identifier even when the name beside it is gone.
const DROP = new Set(["ip", "ua", "userAgent", "email", "phone", "handle", "instagram"]);

if (!existsSync(inPath)) {
  console.error("no log at " + inPath.replace(repo + "/", ""));
  process.exit(1);
}

function loadSalt() {
  if (process.env.HERMES_ANON_SALT) return process.env.HERMES_ANON_SALT;
  if (existsSync(saltPath)) return readFileSync(saltPath, "utf8").trim();
  const salt = randomBytes(32).toString("hex");
  if (!apply) {
    console.log("  no salt yet — --apply would create data/hermes/.anon-salt (gitignored)\n");
    return salt;
  }
  mkdirSync(dirname(saltPath), { recursive: true });
  writeFileSync(saltPath, salt + "\n", { mode: 0o600 });
  console.log("  wrote a new salt to data/hermes/.anon-salt — keep it, and keep it out of git.");
  console.log("  Lose it and the next run invents different pseudonyms for the same people,");
  console.log("  which makes the committed file's history stop lining up with itself.\n");
  return salt;
}

const salt = loadSalt();
const mapping = new Map();
/** Same person, same pseudonym, run after run — that is what makes the graph readable. */
function pseudonym(name) {
  const clean = String(name == null ? "" : name).trim();
  if (!clean || NOT_PEOPLE.has(clean.toLowerCase())) return clean;
  if (!mapping.has(clean)) {
    const digest = createHmac("sha256", salt).update(clean.toLowerCase()).digest("hex");
    mapping.set(clean, "person-" + digest.slice(0, 6));
  }
  return mapping.get(clean);
}

const rows = [];
for (const line of readFileSync(inPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line)); } catch { /* a torn last line is not worth failing over */ }
}

// Every name in the file, longest first, so "Jon Levy" is replaced before a bare "Jon"
// inside it could be. Notes are prose written by hand, and they name people.
for (const row of rows) {
  for (const field of PERSON_FIELDS) if (row[field]) pseudonym(row[field]);
}
const names = [...mapping.keys()].sort((a, b) => b.length - a.length);

function scrubText(text) {
  let out = String(text == null ? "" : text);
  for (const name of names) {
    out = out.split(name).join(mapping.get(name));
    // Bare first name of a two-part name, which is how notes usually refer back.
    const first = name.split(/\s+/)[0];
    if (first.length > 2 && first !== name) {
      out = out.replace(new RegExp("\\b" + first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"),
        mapping.get(name));
    }
  }
  return out;
}

// A note can name somebody who never appears in a person field, and no substitution will
// catch that. Rather than publish it and hope, flag it and let a person read it.
const LOOKS_LIKE_A_NAME = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/;
const suspect = [];
const dropped = new Set();
const out = rows.map((row, index) => {
  const clean = {};
  for (const [key, value] of Object.entries(row)) {
    if (DROP.has(key)) { dropped.add(key); continue; }
    if (PERSON_FIELDS.includes(key)) { clean[key] = pseudonym(value); continue; }
    if (key === "by") { clean[key] = pseudonym(value); continue; }
    if (KEEP.has(key)) { clean[key] = value; continue; }
    if (typeof value === "string") {
      clean[key] = scrubText(value);
      const left = LOOKS_LIKE_A_NAME.exec(clean[key]);
      if (left) suspect.push({ line: index + 1, field: key, found: left[0], text: clean[key] });
      continue;
    }
    clean[key] = value;
  }
  return clean;
});

console.log("  " + rows.length + " event(s), " + mapping.size + " distinct people\n");
for (const row of out) {
  console.log("  " + String(row.at || "").slice(0, 10) + "  " + String(row.kind).padEnd(15) +
    " " + String(row.severity || "").padEnd(7) + " " + String(row.person || "-").padEnd(15) +
    " | " + (row.note || ""));
}
if (dropped.size) console.log("\n  dropped field(s): " + [...dropped].join(", "));
if (showMap) {
  console.log("\n  mapping (screen only, never written to the output):");
  for (const [name, alias] of mapping) console.log("    " + alias + "  <-  " + name);
}
if (suspect.length) {
  console.log("\n  READ THESE BEFORE COMMITTING — text that still looks like it names somebody:");
  for (const s of suspect) console.log("    line " + s.line + " " + s.field + ": \"" + s.found + "\"");
}

if (!apply) {
  console.log("\n  dry run. --apply writes " + outPath.replace(repo + "/", ""));
  process.exit(0);
}
writeFileSync(outPath, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log("\n  wrote " + outPath.replace(repo + "/", "") + " — safe to commit.");
console.log("  The original stays gitignored, and the salt with it.");
