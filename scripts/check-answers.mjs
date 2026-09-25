// What the bot would say, right now, off the real log.
//
// Wording is the whole product here — the difference between "Hermes is at
// Center Camp" and "Hermes was last seen at Center Camp four hours ago" is
// somebody's walk across the city — so it wants reading over before it is
// handed to a group chat, and reading it over should not require a linked
// phone. Prints every answer against the log on disk.
import { readFileSync } from "node:fs";
import { answer, help } from "./lib/hermes-answers.mjs";
import { readTrack } from "./lib/journeys.mjs";

const trackPath = process.env.HERMES_TRACK || "data/hermes/track.jsonl";
const statePath = process.env.HERMES_ACTIVITIES || "data/hermes/activities.json";

let points = [];
try {
  points = readTrack(readFileSync(trackPath, "utf8"));
} catch (err) {
  console.log(`no track at ${trackPath} (${err.code || err.message})`);
}

let activities = [];
try {
  const file = JSON.parse(readFileSync(statePath, "utf8"));
  activities = file.activities || file || [];
} catch { /* the listing is optional for this */ }

const data = { points, activities, now: Date.now() };
console.log(`${points.length} points, ${activities.length} listings\n`);

for (const q of ["where is hermes", "is it moving", "where has it been", "what's on", "help"]) {
  const said = answer(q, data);
  console.log(`--- "${q}" -> ${said ? said.intent : "(no match)"}`);
  console.log(said ? said.text : help());
  console.log("");
}
