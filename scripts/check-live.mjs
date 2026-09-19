// The public site, probed from outside, with a log so an outage leaves a trace.
//
//   npm run check:live            one pass, prints a verdict
//   WATCH=60 npm run check:live   a pass every 60s until killed
//
// "The site went down again" has arrived several times with nothing to look at
// by the time anyone looks, so this writes every pass to artifacts/live-log.jsonl
// and the next report can be answered from the log instead of from memory.
//
// The thing worth measuring is *which origin answers each name*, because the
// three names do not all come from the same place and a name served by the
// laptop goes down when the lid does. Every name answers /api/hermes/faults, and
// the reply says which port that process is listening on, which identifies it:
// 8124 is the laptop behind the cloudflared tunnel, 8080 is Railway. Two names
// answering with different start times are two different servers, and that is
// how the September 19 "it only works when the laptop is open" was pinned down
// after the status codes alone had said everything was fine.
//
// So a name being up is not the whole question. A 200 served from the laptop is
// a warning, not a pass: it is only up because someone happens to be awake.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import dns from "node:dns/promises";

const HOSTS = [
  ["apex", "https://returnofhermes.com"],
  ["www", "https://www.returnofhermes.com"],
  ["request", "https://request.returnofhermes.com"],
];
// From docs/hermes-railway.md: the launchd agent binds 8124 and Railway sets
// PORT=8080. Anything else is a server nobody documented, so say so rather than
// guessing which machine it is.
const ORIGINS = new Map([["8124", "laptop"], ["8080", "railway"]]);
const LOG = path.join(process.cwd(), "artifacts", "live-log.jsonl");
const WATCH = Number(process.env.WATCH || 0);

const reason = (err) => err?.cause?.code || err?.name || String(err);

async function probe(url) {
  const began = Date.now();
  try {
    // Redirects followed: the apex 302s to the annals and a reader who lands on
    // the redirect and no further has still had the site fail on them.
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    return { status: res.status, ms: Date.now() - began, ok: res.ok };
  } catch (err) {
    // A refused connection, a DNS miss and a timeout are all "down" to a reader
    // but have different fixes, so keep which one it was. Every fetch failure is
    // a TypeError and the distinguishing code is one level down in cause.
    return { status: 0, ms: Date.now() - began, ok: false, error: reason(err) };
  }
}

// Which server is behind this particular name, asked of that name rather than of
// the site in general - that distinction is the whole point.
async function origin(base) {
  try {
    const res = await fetch(`${base}/api/hermes/faults`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { reachable: false, status: res.status };
    const body = await res.json();
    const start = (body.faults || []).find((f) => f.kind === "start");
    const port = (String(start?.message || "").match(/:(\d+)\s*$/) || [])[1] || null;
    return {
      reachable: true,
      since: start ? start.at : null,
      port,
      who: port ? ORIGINS.get(port) || `unknown port ${port}` : "unknown",
      degraded: (body.degraded || []).length,
    };
  } catch (err) {
    return { reachable: false, error: reason(err) };
  }
}

// Whether Railway itself has a route for a hostname, asked of the Railway edge
// directly so the answer does not depend on where DNS currently points. This is
// what says a custom domain was really added: its router replies "Application not
// found" for a name no service claims. The certificate cannot answer it, because
// an added domain has no certificate until DNS points at Railway.
//
// The edge address comes from resolving the apex rather than being written down,
// since the apex is already on Railway and those IPs are not promised to stay put.
async function railwayEdge() {
  try {
    const [ip] = await dns.resolve4("returnofhermes.com");
    return ip || null;
  } catch {
    return null;
  }
}

// The per-domain Railway target a name is actually pointed at, reported so it can
// be compared with the target Railway shows for that domain.
//
// Railway activates a custom domain by resolving its CNAME and checking it against
// the target it issued, so a target that is stale or mistyped by one character
// leaves the domain saying "waiting for DNS update" forever while every resolver
// answers normally. Nothing observable from outside separates a wrong target from
// a right one - every name under up.railway.app resolves either way - so the value
// is printed rather than judged, and a human compares it with the dashboard.
async function cnameTarget(host) {
  try {
    const [target] = await dns.resolveCname(host);
    return target || null;
  } catch {
    // The apex cannot be a CNAME, so having none is normal rather than a fault.
    return null;
  }
}

function railwayKnows(host, ip) {
  return new Promise((resolve) => {
    const req = https.request({
      host: ip,
      servername: host,
      // The certificate will be wrong for any name Railway has not issued one for
      // yet, and that is the case this check exists to look at.
      rejectUnauthorized: false,
      headers: { Host: host },
      path: "/api/hermes/faults",
      timeout: 20000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? "yes" : res.statusCode === 404 ? "no" : `http ${res.statusCode}`);
    });
    req.on("timeout", () => { req.destroy(); resolve("timeout"); });
    req.on("error", (err) => resolve(reason(err)));
    req.end();
  });
}

function previous() {
  try {
    const lines = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean);
    return lines.length ? JSON.parse(lines.at(-1)) : null;
  } catch {
    return null;
  }
}

async function pass() {
  const before = previous();
  const edge = await railwayEdge();
  const seen = {};
  for (const [name, base] of HOSTS) {
    const host = new URL(base).hostname;
    const target = await cnameTarget(host);
    seen[name] = {
      ...(await probe(base)),
      origin: await origin(base),
      onRailway: edge ? await railwayKnows(host, edge) : "unchecked",
      target,
    };
  }

  const down = Object.entries(seen).filter(([, r]) => !r.ok).map(([n]) => n);
  const onLaptop = Object.entries(seen).filter(([, r]) => r.origin.who === "laptop").map(([n]) => n);
  const wedged = Object.entries(seen).filter(([, r]) => r.ok && !r.origin.reachable).map(([n]) => n);
  // Pointed at Railway in DNS, yet Railway has no route for the name. Kept apart
  // from "down" because the fix is a value to reconcile, not a service to restart.
  const unrouted = Object.entries(seen).filter(([, r]) => r.target && r.onRailway === "no").map(([n]) => n);
  // A restart is only news against a pass that recorded a start time for the
  // same name; the first ever pass has nothing to compare and should not cry
  // crash. Tracked per name because the names are different servers.
  const restarted = Object.entries(seen)
    .filter(([n, r]) => {
      const was = before?.hosts?.[n]?.origin?.since;
      return was && r.origin.since && was !== r.origin.since;
    })
    .map(([n]) => n);

  let verdict;
  if (down.length === HOSTS.length) verdict = "everything down";
  else if (unrouted.length) verdict = `${unrouted.join(" and ")} pointed at Railway, which has no route for them`;
  else if (down.length) verdict = `${down.join(" and ")} down, the rest serving`;
  else if (wedged.length) verdict = `${wedged.join(" and ")} serving pages but not the API - wedged`;
  else if (onLaptop.length) verdict = `up, but ${onLaptop.join(" and ")} served by the laptop`;
  else verdict = "up, all off the laptop";

  const row = { at: new Date().toISOString(), verdict, restarted, hosts: seen };
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(row) + "\n");

  console.log(`${row.at.slice(11, 19)}  ${verdict}`);
  for (const [name, r] of Object.entries(seen)) {
    const code = r.ok ? String(r.status) : `FAIL ${r.error || r.status}`;
    const from = r.origin.reachable ? r.origin.who : `API ${r.origin.error || r.origin.status || "unreachable"}`;
    const up = r.origin.since ? `, up ${Math.floor((Date.now() - Date.parse(r.origin.since)) / 3600000)}h` : "";
    const claimed = r.onRailway === "yes" ? "" : `, Railway route: ${r.onRailway}`;
    console.log(`  ${name.padEnd(8)} ${code.padEnd(6)} ${String(r.ms + "ms").padEnd(7)} from ${from}${up}${claimed}`);
  }
  if (unrouted.length) {
    console.log(`  WARNING  ${unrouted.join(" and ")} resolve to Railway, which has no route for them.`);
    console.log("           DNS is doing its job, so the remaining mismatch is the target itself:");
    for (const n of unrouted) console.log(`             ${n.padEnd(8)} -> ${seen[n].target}`);
    console.log("           Compare each against the target Railway shows in the domain's own row.");
    console.log("           While they differ the row stays on 'waiting for DNS update' and no");
    console.log("           certificate is issued, which is what makes the name look unresolvable.");
  }
  if (onLaptop.length) {
    const unclaimed = onLaptop.filter((n) => seen[n].onRailway === "no");
    console.log(`  WARNING  ${onLaptop.join(" and ")} will go down when the laptop sleeps.`);
    if (unclaimed.length) {
      console.log(`           Railway has no route for ${unclaimed.join(" or ")} yet, so there is nothing`);
      console.log("           for Cloudflare to point at - add the domain to the service serving the");
      console.log("           apex first. See docs/hermes-railway.md, 'Finishing it, in an order that");
      console.log("           does not break the site'.");
    } else {
      console.log("           Railway has a route for them - repoint Cloudflare next, same doc.");
    }
  }
  for (const name of restarted) {
    console.log(`  RESTARTED  ${name} (was ${before.hosts[name].origin.since}) - it went down in between`);
  }
  return down.length === 0 && wedged.length === 0 && onLaptop.length === 0 && restarted.length === 0;
}

if (!WATCH) {
  process.exit((await pass()) ? 0 : 1);
}
console.log(`watching every ${WATCH}s, logging to ${path.relative(process.cwd(), LOG)}, ctrl-c to stop`);
for (;;) {
  await pass();
  await new Promise((r) => setTimeout(r, WATCH * 1000));
}
