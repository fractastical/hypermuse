// Drives an Advatek PixLite (E16-S Mk3 and siblings) from the moon.
//
// A browser cannot open a UDP socket, so the page cannot talk to the
// controller itself. hypermoon.html?pixels=1 samples its own canvas at the
// points named in a pixel map and pushes the resulting RGB bytes over a
// WebSocket; this process packs them into sACN (E1.31) or Art-Net and sends
// them on. That is the whole trick — the page stays a page, and everything
// that knows about lighting protocol lives here.
//
//   npm run pixels                                  # sACN multicast
//   PIXLITE=192.168.0.50 npm run pixels             # sACN unicast (show nets)
//   PROTOCOL=artnet PIXLITE=192.168.0.50 npm run pixels
//   MAP=maps/moon-halo.json npm run pixels
//   IFACE=en7 npm run pixels                        # send out the cable, not Wi-Fi
//
// Without a browser attached it can still light the rig, which is how you
// prove wiring and patch before the show has anything to show:
//
//   TEST=chase npm run pixels        # one lit pixel walks each output
//   TEST=rgb npm run pixels          # whole rig cycles red/green/blue
//   TEST=white LEVEL=0.2 npm run pixels
import fs from "node:fs";
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PIXEL_PORT || 8082);
const MAP_PATH = process.env.MAP || "maps/moon-halo.json";
const PROTOCOL = (process.env.PROTOCOL || "sacn").toLowerCase();
const HOST = process.env.PIXLITE || "";      // empty = sACN multicast
// Which network port the light leaves by ("en7", or its address). A laptop at a
// show has Wi-Fi up as well as the cable to the rig, and multicast and broadcast
// do not consult the routing table the way a unicast packet does: they go out
// whichever interface the OS favours, which on macOS is usually Wi-Fi. That is
// the whole reason a rig can stay dark while this process cheerfully reports
// packets out. Unicast (PIXLITE=) has no such problem and is still the right
// answer for a show; this is for when you want multicast anyway.
const IFACE = process.env.IFACE || "";
const FPS = Number(process.env.FPS || 40);
const PRIORITY = Number(process.env.PRIORITY || 100);
const TEST = (process.env.TEST || "").toLowerCase();
const LEVEL = Number(process.env.LEVEL || 1);
const SOURCE = "hypermoon";

const PIX_PER_UNIVERSE = 170;
const SACN_PORT = 5568;
const ARTNET_PORT = 6454;

if (!fs.existsSync(MAP_PATH)) {
  console.error(`[pixels] no map at ${MAP_PATH} — make one:\n` +
    `  node scripts/make-pixel-map.mjs halo --leds 240 --name moon-halo`);
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));

// Flattened once: the wire order of every pixel, and where each output's slice
// of that order begins. The browser sends one buffer in exactly this order, so
// neither side has to send indices with the data.
const runs = map.outputs.map((o) => ({
  output: o.output, universe: o.universe, count: o.pixels.length
}));
let at = 0;
for (const r of runs) { r.offset = at; at += r.count; }
const TOTAL = at;

// Every universe this map touches, with the slice of the frame buffer that
// fills it. Built once so the per-frame path is only copies.
const universes = [];
for (const r of runs) {
  for (let u = 0; u * PIX_PER_UNIVERSE < r.count; u++) {
    const from = u * PIX_PER_UNIVERSE;
    const n = Math.min(PIX_PER_UNIVERSE, r.count - from);
    universes.push({
      universe: r.universe + u,
      byteFrom: (r.offset + from) * 3,
      channels: n * 3,
      seq: 0
    });
  }
}

const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
const CID = crypto.randomBytes(16);

// Every IPv4 port this machine could send out of, by name, so an interface can
// be named rather than looked up by hand at load-in.
const lans = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
  (addrs || []).filter((a) => a.family === "IPv4" && !a.internal)
    .map((a) => ({ name, address: a.address, netmask: a.netmask })));
const iface = IFACE ? lans.find((l) => l.name === IFACE || l.address === IFACE) : null;
if (IFACE && !iface) {
  console.error(`[pixels] no interface "${IFACE}" here. Available: ` +
    (lans.map((l) => `${l.name} (${l.address})`).join(", ") || "none"));
  process.exit(1);
}
// The subnet's broadcast address: host bits all ones. Art-Net is conventionally
// broadcast, and a subnet broadcast is both likelier to survive a switch and
// certain to leave by the interface that owns the subnet, where the all-ones
// 255.255.255.255 is neither.
const bcast = (l) => l.address.split(".")
  .map((o, i) => Number(o) | (~Number(l.netmask.split(".")[i]) & 0xff)).join(".");
const ARTNET_DEST = iface ? bcast(iface) : "255.255.255.255";

// --- sACN (E1.31) --------------------------------------------------------
// Layout per ANSI E1.31-2018: a 38-byte root layer, a 77-byte framing layer
// and a 10-byte DMP header before the start code and the slots themselves.
function sacnPacket(universe, channels) {
  const len = 126 + channels;
  const b = Buffer.alloc(len);
  b.writeUInt16BE(0x0010, 0);                     // preamble size
  b.writeUInt16BE(0x0000, 2);                     // post-amble size
  b.write("ASC-E1.17\0\0\0", 4, 12, "latin1");    // ACN packet identifier
  b.writeUInt16BE(0x7000 | (len - 16), 16);       // root flags & length
  b.writeUInt32BE(0x00000004, 18);                // VECTOR_ROOT_E131_DATA
  CID.copy(b, 22);
  b.writeUInt16BE(0x7000 | (len - 38), 38);       // framing flags & length
  b.writeUInt32BE(0x00000002, 40);                // VECTOR_E131_DATA_PACKET
  b.write(SOURCE, 44, 63, "utf8");                // source name, 64 incl. null
  b.writeUInt8(PRIORITY, 108);
  b.writeUInt16BE(0, 109);                        // synchronisation address
  // 111 sequence, written per frame
  b.writeUInt8(0, 112);                           // options
  b.writeUInt16BE(universe, 113);
  b.writeUInt16BE(0x7000 | (len - 115), 115);     // DMP flags & length
  b.writeUInt8(0x02, 117);                        // VECTOR_DMP_SET_PROPERTY
  b.writeUInt8(0xa1, 118);                        // address & data type
  b.writeUInt16BE(0x0000, 119);                   // first property address
  b.writeUInt16BE(0x0001, 121);                   // address increment
  b.writeUInt16BE(channels + 1, 123);             // count, incl. start code
  b.writeUInt8(0x00, 125);                        // DMX start code
  return b;
}
// Universe N is multicast to 239.255.<high>.<low>, per E1.31.
const sacnGroup = (u) => `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;

// --- Art-Net -------------------------------------------------------------
function artnetPacket(universe, channels) {
  const b = Buffer.alloc(18 + channels);
  b.write("Art-Net\0", 0, 8, "latin1");
  b.writeUInt16LE(0x5000, 8);                     // OpDmx
  b.writeUInt16BE(14, 10);                        // protocol version
  // 12 sequence, 13 physical
  b.writeUInt16LE(universe, 14);                  // sub-uni + net
  b.writeUInt16BE(channels, 16);
  return b;
}

for (const u of universes) {
  u.packet = PROTOCOL === "artnet"
    ? artnetPacket(u.universe, u.channels)
    : sacnPacket(u.universe, u.channels);
  u.dataAt = PROTOCOL === "artnet" ? 18 : 126;
  u.seqAt = PROTOCOL === "artnet" ? 12 : 111;
  u.dest = HOST || (PROTOCOL === "artnet" ? ARTNET_DEST : sacnGroup(u.universe));
  u.port = PROTOCOL === "artnet" ? ARTNET_PORT : SACN_PORT;
}

const frame = Buffer.alloc(TOTAL * 3);
let sent = 0, framesIn = 0, dirty = false;

function blast() {
  for (const u of universes) {
    frame.copy(u.packet, u.dataAt, u.byteFrom, u.byteFrom + u.channels);
    u.packet.writeUInt8(u.seq, u.seqAt);
    u.seq = (u.seq + 1) & 0xff;
    sock.send(u.packet, u.port, u.dest);
  }
  sent++;
}

// --- test patterns -------------------------------------------------------
// Deliberately independent of the browser: if the rig does not light under
// these, the problem is the patch, the wiring or the network, and no amount of
// looking at the moon will show it.
let tick = 0;
function testFrame() {
  frame.fill(0);
  const v = Math.max(0, Math.min(255, Math.round(255 * LEVEL)));
  if (TEST === "white") frame.fill(v);
  else if (TEST === "rgb") {
    const ch = Math.floor(tick / FPS) % 3;   // a second each
    for (let i = 0; i < TOTAL; i++) frame[i * 3 + ch] = v;
  } else if (TEST === "chase") {
    // One lit pixel per output, so a mis-patched or reversed run is obvious
    // and you can count the runs against the outputs that light.
    for (const r of runs) {
      const i = r.offset + (tick % Math.max(1, r.count));
      frame[i * 3] = v; frame[i * 3 + 1] = v; frame[i * 3 + 2] = v;
    }
  }
  tick++;
}

// --- browser feed --------------------------------------------------------
const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });
// pixel-preview.html says hello and is then sent the frames rather than asked
// for them. It watches the same bytes the rig is given, gamma and gain already
// applied, so what it shows is what the controller is being told - and because
// the test patterns run through the same buffer, a map can be checked on screen
// with no moon and no rig attached at all.
const monitors = new Set();
wss.on("connection", (ws, req) => {
  const who = req.socket.remoteAddress;
  // Whoever it is needs the map: the moon to know what to sample, the preview to
  // know what it is looking at.
  ws.send(JSON.stringify({ type: "map", map, total: TOTAL }));
  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { /* not for us */ }
      if (msg && msg.type === "monitor") {
        monitors.add(ws);
        console.log(`[pixels] preview attached (${who})`);
      }
      return;
    }
    if (!framesIn) console.log(`[pixels] moon connected (${who})`);
    // Short frames are padded rather than dropped: a map edited under a running
    // page should dim the tail, not stop the show.
    data.copy(frame, 0, 0, Math.min(data.length, frame.length));
    if (data.length < frame.length) frame.fill(0, data.length);
    framesIn++;
    dirty = true;
  });
  ws.on("close", () => {
    if (monitors.delete(ws)) console.log("[pixels] preview detached");
    else console.log("[pixels] moon disconnected");
  });
});

// The preview only has to look right to an eye, so it is fed at about 20fps
// however fast the rig is being driven.
let monTick = 0;
const MON_EVERY = Math.max(1, Math.round(FPS / 20));
function relayToPreviews() {
  if (!monitors.size || monTick++ % MON_EVERY) return;
  for (const m of monitors) if (m.readyState === 1) m.send(frame);
}

// Broadcast has to be asked for — a send to a broadcast address is refused
// outright without it — and neither it nor the multicast interface can be set on
// an unbound socket, so nothing goes out until the bind lands.
sock.bind(() => {
  if (!HOST) {
    try { sock.setBroadcast(true); } catch (e) {
      console.warn("[pixels] could not enable broadcast: " + e.message);
    }
    if (iface && PROTOCOL !== "artnet") {
      try { sock.setMulticastInterface(iface.address); } catch (e) {
        console.warn(`[pixels] could not pin multicast to ${iface.name}: ${e.message}`);
      }
    }
  }
  setInterval(() => {
    if (TEST) testFrame();
    else if (!dirty && !framesIn) return;   // nothing has ever arrived; stay dark
    blast();
    relayToPreviews();
    dirty = false;
  }, 1000 / FPS);
});

const STAT_SEC = 5;
let lastIn = 0, lastOut = 0;
setInterval(() => {
  const fin = framesIn - lastIn, fout = sent - lastOut;
  lastIn = framesIn; lastOut = sent;
  if (!fin && !fout) return;
  console.log(`[pixels] in ${(fin / STAT_SEC).toFixed(0)}fps  out ${(fout / STAT_SEC).toFixed(0)}fps` +
    ` (${(fout / STAT_SEC * universes.length).toFixed(0)} packets/s over ${universes.length} universes)`);
}, STAT_SEC * 1000);

console.log(`[pixels] map ${MAP_PATH}: ${TOTAL} pixels, ${runs.length} output(s), ` +
  `${universes.length} universes (${universes[0].universe}-${universes[universes.length - 1].universe})`);
console.log(`[pixels] ${PROTOCOL} -> ` +
  (HOST ? HOST : PROTOCOL === "artnet" ? `broadcast ${ARTNET_DEST}` : "multicast") +
  ` at ${FPS}fps${TEST ? `, test pattern "${TEST}"` : ""}`);
if (HOST) {
  // Unicast follows the routing table, so it leaves by whichever interface owns
  // the rig's subnet whether or not anything was named here.
  console.log("[pixels] unicast: the route decides the interface, which is what you want at a show");
} else if (iface) {
  console.log(`[pixels] leaving by ${iface.name} (${iface.address})`);
} else {
  // The failure this warns about is silent and looks exactly like broken
  // wiring: packets out, rig dark, because the light went out of the Wi-Fi.
  console.log(`[pixels] no interface pinned, so the OS picks${lans.length > 1
    ? " — with " + lans.map((l) => l.name).join(" and ") + " both up that is a coin toss" : ""}.` +
    ` Set IFACE=<name> or PIXLITE=<ip>`);
}
console.log(`[pixels] listening on ws://0.0.0.0:${PORT}`);
for (const l of lans) console.log(`[pixels] moon: http://${l.address}:8080/hypermoon.html?pixels=1`);
