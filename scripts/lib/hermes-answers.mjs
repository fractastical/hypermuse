// Answering "where's Hermes?" in words, for anyone who asks from a phone.
//
// Deliberately not a WhatsApp thing. The question is the same whoever is asking
// and whatever is carrying it, so the answers live here as plain functions over
// plain data, and the transport — a bot, an http endpoint, a person reading it
// out — is somebody else's problem. It also means this can be tested without a
// QR code and a linked phone, which a bot cannot.
//
// The one editorial rule: never state a position as though it were current when
// it is not. The tracker on this car spends hours asleep, and "Hermes is at
// Center Camp" when the fix is four hours old is not a small inaccuracy — it
// sends people to the wrong side of the city. Every answer that names a place
// also says how old it is.
import { distanceMeters, nearestPlace } from "./playa-places.mjs";
import { journeys } from "./journeys.mjs";

export const ZONE = "America/Los_Angeles";

// Displacement over this window decides moving versus parked. Long enough that a
// single wandering fix does not read as driving, short enough to notice a car
// that has just pulled out.
const MOVING_WINDOW_MS = 10 * 60000;
const MOVING_METRES = 60;
// Past this, a fix is history rather than a position, and the wording changes.
const STALE_MS = 12 * 60000;

const COMPASS = ["north", "north-east", "east", "south-east",
  "south", "south-west", "west", "north-west"];

export function clock(ms, zone = ZONE) {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: zone
  });
}

// A bare clock time is a trap here. The log genuinely spans days — the last two
// recorded stops are a Friday afternoon and a Saturday pre-dawn — and printed as
// "3:59 PM" and "3:38 AM" they look like one evening in the wrong order. So
// anything not from today carries its day.
const dayKey = (ms, zone) => new Date(ms).toLocaleDateString("en-CA", { timeZone: zone });

export function when(ms, now = Date.now(), zone = ZONE) {
  const time = clock(ms, zone);
  const day = dayKey(ms, zone);
  if (day === dayKey(now, zone)) return time;
  if (day === dayKey(now - 86400000, zone)) return `yesterday ${time}`;
  const name = new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: zone });
  return `${name} ${time}`;
}

// The geocoder already hedges when it is not confident — it hands back "near
// Department of Mutant Vehicles" — and gluing the obvious preposition in front
// of that produces "at near the DMV". The hedge is worth more than the
// preposition, so the preposition gives way.
const placed = (label) => /^near\b/i.test(label) ? label : `at ${label}`;

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m ago` : `${h}h ago`;
}

export function spell(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

const far = (metres) => metres < 950
  ? `${Math.round(metres / 10) * 10}m`
  : `${(metres / 1000).toFixed(1)}km`;

function bearing(from, to) {
  const dLon = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  const dLat = to.lat - from.lat;
  if (!dLon && !dLat) return null;
  const deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 45) % 8];
}

// Moving or parked, read off the tail of the log rather than off any one fix.
export function motion(points, now = Date.now()) {
  if (!points.length) return { known: false };
  const last = points[points.length - 1];
  const age = now - last.ms;
  const window = points.filter((p) => last.ms - p.ms <= MOVING_WINDOW_MS);
  const first = window[0] || last;
  const moved = distanceMeters(first.lat, first.lon, last.lat, last.lon);
  const seconds = (last.ms - first.ms) / 1000;
  // Only claim motion from a log that is still being written. A ten-minute
  // window whose newest point is an hour old describes an hour ago.
  const live = age <= STALE_MS;
  const going = live && moved >= MOVING_METRES && seconds > 30;
  return {
    known: true,
    live,
    going,
    age,
    at: last,
    metres: moved,
    kmh: seconds > 30 ? (moved / seconds) * 3.6 : null,
    heading: going && window.length > 1 ? bearing(first, last) : null,
    place: nearestPlace(last.lat, last.lon)
  };
}

// Where it is, hedged exactly as much as the freshness deserves.
export function whereNow({ points, now = Date.now(), zone = ZONE }) {
  const m = motion(points, now);
  if (!m.known) return "No fixes logged at all yet — nothing has ever reported in.";
  const where = m.place ? m.place.label : `${m.at.lat.toFixed(5)}, ${m.at.lon.toFixed(5)}`;

  if (m.going) {
    const speed = m.kmh ? `, about ${m.kmh.toFixed(0)} km/h` : "";
    const head = m.heading ? ` heading ${m.heading}` : "";
    return `Hermes is on the move${head}${speed}.\n` +
      `Just passed ${where} (${ago(m.age)}).`;
  }
  if (m.live) {
    return `Hermes is ${placed(where)}, parked.\n` +
      `Last fix ${ago(m.age)}.`;
  }
  // The honest version. The tracker is asleep more than it is awake, and this is
  // the sentence that stops someone walking across the playa to an empty patch.
  return `Hermes was last seen ${placed(where)} at ${when(m.at.ms, now, zone)} — ` +
    `${ago(m.age)}.\n` +
    `Nothing is reporting right now, so it may well have moved since.`;
}

// The night so far, most recent first, as places rather than coordinates.
export function whereRecently({ points, now = Date.now(), zone = ZONE, limit = 5 }) {
  if (!points.length) return "Nothing logged yet.";
  const runs = journeys(points);
  const stops = [];
  for (const run of runs) {
    for (const event of run.events) {
      if (event.kind === "stop") stops.push(event);
    }
  }
  if (!stops.length) {
    const m = motion(points, now);
    return `No proper stops logged yet — nowhere it stayed long enough to count.\n` +
      `Last position: ${m.place ? m.place.label : "unknown"}, ${ago(m.age)}.`;
  }
  const recent = stops.slice(-limit).reverse();
  const lines = recent.map((stop) => {
    const name = stop.place ? stop.place.label : `${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}`;
    return `• ${when(stop.startMs, now, zone)} — ${name}, stayed ${spell(stop.dwellMs)}`;
  });
  const total = runs.reduce((sum, run) => sum + run.metres, 0);
  // Whoever asks where it has been wants to know where it is as well, and one
  // message that answers both beats two over a network this slow.
  const m = motion(points, now);
  const now_ = m.place ? `\nRight now: ${placed(m.place.label)}, ${ago(m.age)}.` : "";
  return [`Where Hermes has been (most recent first):`, ...lines,
    `\n${far(total)} covered in ${runs.length} trip${runs.length === 1 ? "" : "s"}.${now_}`].join("\n");
}

// What is on near the car, off the same ranked list the moon is showing.
export function whatsOn({ activities, zone = ZONE, limit = 4 }) {
  const list = (Array.isArray(activities) ? activities : []).slice(0, limit);
  if (!list.length) return "Nothing listed near Hermes right now.";
  const lines = list.map((a) => {
    const when = a.timeLabel || (a.start ? clock(Date.parse(a.start), zone) : "");
    const away = Number.isFinite(Number(a.distanceM)) ? `, ${far(Number(a.distanceM))} away` : "";
    return `• ${a.title}${when ? ` — ${when}` : ""}${away}\n  ${a.location || ""}`.trimEnd();
  });
  return ["On near Hermes:", ...lines].join("\n");
}

export function help() {
  return [
    "Ask me:",
    "• where — where Hermes is now",
    "• moving — whether it's going anywhere",
    "• been — where it's been tonight",
    "• on — what's happening near it",
    "",
    "Any of those words on their own is enough."
  ].join("\n");
}

// Loose on purpose. People type "yo where's the moon car at" and mean `where`,
// and a bot that answers only exact commands gets asked once and then ignored.
const INTENTS = [
  ["help", /^\s*(help|commands?|what can you|\?)\s*$/i],
  ["been", /been|recent|earlier|history|where was|all night|so far|track/i],
  ["on", /what'?s on|happening|events?|nearby|near ?by|listings?|programme|program/i],
  ["moving", /moving|driving|stopped|parked|going anywhere|on the move/i],
  ["where", /where|position|located|location|at now|find|hermes\?|moon car/i]
];

export function intentOf(text) {
  const q = String(text || "");
  for (const [name, pattern] of INTENTS) if (pattern.test(q)) return name;
  return null;
}

// One question in, one message out. `null` means it was not addressed to us —
// the caller decides whether silence or help is the right answer, because a bot
// in a busy group chat must not reply to every message in it.
export function answer(text, data) {
  const intent = intentOf(text);
  if (!intent) return null;
  if (intent === "help") return { intent, text: help() };
  if (intent === "been") return { intent, text: whereRecently(data) };
  if (intent === "on") return { intent, text: whatsOn(data) };
  // Motion and position are nearly the same question, and answering "yes" to
  // "is it moving" without saying where is useless, so both get the full line.
  return { intent, text: whereNow(data) };
}
