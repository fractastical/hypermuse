// The annals visitor count, on its own. The page is a static file, so something
// has to remember the number. This is that something: one integer, one file,
// and it does not depend on Railway being able to see GitHub.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 8080);
const START = 111;
const WINDOW_MS = Math.max(1000, Number(process.env.VISIT_WINDOW_MS || 12 * 60 * 60 * 1000));
const file = process.env.COUNT_FILE || "/data/visits.json";
const seen = new Map();

function read() {
  try {
    const n = Number(JSON.parse(readFileSync(file, "utf8")).n);
    if (Number.isFinite(n) && n >= START) return Math.floor(n);
  } catch {
    /* first boot: the count opens on the visitors who came before it existed */
  }
  return START;
}

function write(n) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ n }) + "\n");
}

function send(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store"
  });
  res.end(code === 204 ? "" : JSON.stringify(body));
}

function clientIp(req) {
  const fly = String(req.headers["fly-client-ip"] || "").trim();
  if (fly) return fly;
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
}

createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    send(res, 204);
    return;
  }
  if (url.pathname === "/health" || url.pathname === "/") {
    send(res, 200, { ok: true, n: read() });
    return;
  }
  if (url.pathname === "/api/hermes/annals/visits" && (req.method === "GET" || req.method === "POST")) {
    let counted = false;
    if (req.method === "POST") {
      const ip = clientIp(req);
      const now = Date.now();
      const last = seen.get(ip) || 0;
      if (ip && now - last >= WINDOW_MS) {
        seen.set(ip, now);
        counted = true;
      }
    }
    const n = read() + (counted ? 1 : 0);
    if (counted) write(n);
    send(res, 200, { ok: true, n, counted });
    return;
  }
  send(res, 404, { ok: false, error: "not found" });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`annals counter on :${PORT}, opening at ${read()}`);
});
