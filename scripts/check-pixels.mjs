// Proves the LED chain without a PixLite on the bench.
//
// Stands a fake controller on the loopback, starts the bridge pointed at it,
// runs a headless moon with ?pixels=1, and reports what actually landed on the
// wire: header validity, which universes arrived, the frame rate, and the
// brightest pixels seen. If this passes, everything up to the controller's
// ethernet port is known good and a dark rig is a patch or wiring problem.
//
//   node scripts/check-pixels.mjs
//   MAP=maps/moon-disc.json node scripts/check-pixels.mjs
import dgram from "node:dgram";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const MAP = process.env.MAP || "maps/moon-halo.json";
const PORT = Number(process.env.PORT || 8080);
const SECONDS = Number(process.env.SECONDS || 12);

const seen = new Map();      // universe -> { packets, maxRGB }
let bad = 0, first = 0, last = 0;

const listener = dgram.createSocket({ type: "udp4", reuseAddr: true });
listener.on("message", (buf) => {
  // Validate the E1.31 framing rather than just counting bytes: a packet the
  // PixLite would reject should fail here too.
  const ok = buf.length >= 126
    && buf.readUInt16BE(0) === 0x0010
    && buf.toString("latin1", 4, 16) === "ASC-E1.17\0\0\0"
    && buf.readUInt32BE(18) === 4
    && buf.readUInt32BE(40) === 2
    && buf.readUInt8(117) === 0x02
    && buf.readUInt8(125) === 0x00;
  if (!ok) { bad++; return; }
  const universe = buf.readUInt16BE(113);
  const channels = buf.readUInt16BE(123) - 1;
  const rec = seen.get(universe) || { packets: 0, max: 0, name: buf.toString("utf8", 44, 52) };
  rec.packets++;
  for (let i = 0; i < channels; i++) rec.max = Math.max(rec.max, buf[126 + i]);
  seen.set(universe, rec);
  const t = Date.now();
  if (!first) first = t;
  last = t;
});
await new Promise((r) => listener.bind(5568, "127.0.0.1", r));

const bridge = spawn("node", ["scripts/pixel-bridge.mjs"], {
  env: { ...process.env, MAP, PIXLITE: "127.0.0.1", PROTOCOL: "sacn" },
  stdio: ["ignore", "pipe", "inherit"]
});
bridge.stdout.on("data", (d) => process.stdout.write("  " + d));
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("console", (m) => {
  if (/pixel map/.test(m.text())) console.log("  page: " + m.text());
});
await page.goto(`http://127.0.0.1:${PORT}/hypermoon.html?pixels=1&nosound=1`,
  { waitUntil: "domcontentloaded" });
console.log(`  sampling for ${SECONDS}s …`);
await new Promise((r) => setTimeout(r, SECONDS * 1000));
await browser.close();
bridge.kill();
listener.close();

const total = [...seen.values()].reduce((n, r) => n + r.packets, 0);
const span = (last - first) / 1000 || 1;
console.log(`\n  universes seen : ${[...seen.keys()].sort((a, b) => a - b).join(", ") || "NONE"}`);
console.log(`  packets        : ${total} over ${span.toFixed(1)}s ` +
  `(${(total / span / Math.max(1, seen.size)).toFixed(0)} fps/universe)`);
console.log(`  malformed      : ${bad}`);
console.log(`  source name    : ${[...seen.values()][0]?.name || "-"}`);
for (const [u, r] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  universe ${String(u).padStart(3)} : ${r.packets} packets, peak level ${r.max}`);
}
const lit = [...seen.values()].some((r) => r.max > 0);
console.log(`\n  ${!total ? "FAIL — nothing reached the controller"
  : bad ? "FAIL — malformed packets"
  : !lit ? "WARN — packets arrived but every channel is 0 (is the moon dark where the map samples?)"
  : "PASS — valid sACN carrying live picture"}`);
process.exit(total && !bad && lit ? 0 : 1);
