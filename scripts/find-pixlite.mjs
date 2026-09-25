// Finds the controller on the cable, and says what to do about it.
//
// The situation this is for: a laptop plugged straight into the rig, nothing
// lighting, and no way to tell which of the three usual causes it is —
//
//   1. the cable or the controller is dead
//   2. both ends are alive but on unrelated subnets, so no packet can be routed
//   3. everything is fine and the light is leaving by Wi-Fi instead
//
// Pinging cannot separate them, because in case 2 there is nothing to ping: a
// direct cable has no DHCP server, so macOS gives up and self-assigns a
// 169.254 address while the PixLite sits on its own static one, and the two
// cannot see each other at the IP layer at all. What still crosses is
// broadcast, because that is a layer beneath — which is why this asks with
// ArtPoll, the Art-Net discovery packet every node must answer, and listens for
// the reply the node sends back as a broadcast. A controller on the wrong
// subnet still answers, and its reply carries the address it is actually on.
// That turns an invisible mismatch into a number we can configure against.
//
//   npm run pixels:find
import dgram from "node:dgram";
import os from "node:os";
import { execFile } from "node:child_process";

const ARTNET_PORT = 6454;
const LISTEN_MS = Number(process.env.SECONDS || 5) * 1000;

// Nothing here waits on anything unbounded, but this process holds open sockets
// on a port something else may want, so it gets a hard stop regardless.
const bomb = setTimeout(() => {
  console.log("\nwatchdog fired — exiting.");
  process.exit(2);
}, LISTEN_MS + 8000);

const artPoll = () => {
  const b = Buffer.alloc(14);
  b.write("Art-Net\0", 0, 8, "latin1");
  b.writeUInt16LE(0x2000, 8);   // OpPoll
  b.writeUInt16BE(14, 10);      // protocol version
  b.writeUInt8(0x00, 12);       // TalkToMe: reply once, unprompted updates off
  b.writeUInt8(0x00, 13);       // priority
  return b;
};

const str = (buf, from, len) => {
  const end = buf.indexOf(0, from);
  return buf.toString("latin1", from, end >= 0 && end < from + len ? end : from + len).trim();
};

// Advatek's own OUI, so a reply can be named as the rig rather than as "a node".
const ADVATEK = ["00:1e:c0", "98:d3:31", "24:0a:c4", "b8:27:eb"];

const found = new Map();
function reply(buf, from) {
  if (buf.length < 200) return;
  const ip = `${buf[10]}.${buf[11]}.${buf[12]}.${buf[13]}`;
  const mac = [...buf.subarray(201, 207)].map((n) => n.toString(16).padStart(2, "0")).join(":");
  const node = {
    ip,
    heardFrom: from.address,
    short: str(buf, 26, 18),
    long: str(buf, 44, 64),
    report: str(buf, 108, 64),
    ports: buf.readUInt16BE(172),
    net: buf[18],
    sub: buf[19],
    swOut: [...buf.subarray(190, 194)],
    mac,
    advatek: ADVATEK.some((p) => mac.startsWith(p))
  };
  found.set(ip, node);
}

const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
  (addrs || []).filter((a) => a.family === "IPv4" && !a.internal)
    .map((a) => ({ name, address: a.address, netmask: a.netmask })));

const bcastOf = (l) => l.address.split(".")
  .map((o, i) => Number(o) | (~Number(l.netmask.split(".")[i]) & 0xff)).join(".");

if (!interfaces.length) {
  console.log("no external IPv4 interface at all — is the cable in, and the port awake?");
  process.exit(1);
}

console.log("ports on this machine:");
for (const l of interfaces) {
  const link = l.address.startsWith("169.254");
  console.log(`  ${l.name.padEnd(6)} ${l.address}/${l.netmask}` +
    (link ? "   <- self-assigned: nothing handed it an address" : ""));
}
console.log("");

// One socket per interface, each bound to that interface's own address, so a
// broadcast provably leaves the port we think it does rather than whichever one
// the routing table prefers. Bound to 6454 because that is where a node sends
// its reply; if something already holds it, an ephemeral port still catches the
// nodes that answer to the sender's port, which is most of them.
const openOn = (l, port) => new Promise((resolve) => {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  // A failed bind leaves the socket in no state worth reusing, so the fallback
  // gets a clean one rather than a second bind on a socket that just errored.
  sock.once("error", () => { try { sock.close(); } catch { /* already gone */ } resolve(null); });
  sock.bind({ address: l.address, port, exclusive: false }, () => resolve(sock));
});

const sockets = [];
for (const l of interfaces) {
  const sock = await openOn(l, ARTNET_PORT) || await openOn(l, 0);
  if (!sock) { console.log(`  ${l.name}: could not open a socket`); continue; }
  sock.removeAllListeners("error");
  sock.on("error", (err) => console.log(`  ${l.name}: ${err.code || err.message}`));
  sock.on("message", reply);
  try { sock.setBroadcast(true); } catch { /* reported below if it matters */ }
  sockets.push({ sock, l });
}
if (!sockets.length) { console.log("no usable socket on any port"); process.exit(1); }

const poll = artPoll();
for (const { sock, l } of sockets) {
  // The subnet's own broadcast, and the all-ones. On a link-local address the
  // first is 169.254.255.255, which is the one a mismatched controller hears.
  for (const dest of new Set([bcastOf(l), "255.255.255.255"])) {
    sock.send(poll, ARTNET_PORT, dest, (err) => {
      if (err) console.log(`  ${l.name} -> ${dest}: ${err.code || err.message}`);
    });
  }
}
console.log(`polled ${sockets.length} port(s), listening ${LISTEN_MS / 1000}s …`);

// Asked more than once: a single UDP packet at load-in is not a reliable
// question, and a controller still booting misses the first one.
const again = setInterval(() => {
  for (const { sock, l } of sockets) {
    for (const dest of new Set([bcastOf(l), "255.255.255.255"])) sock.send(poll, ARTNET_PORT, dest);
  }
}, 1200);

await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
clearInterval(again);
for (const { sock } of sockets) sock.close();
clearTimeout(bomb);

// A controller set to sACN only, or with Art-Net switched off, answers no poll
// and is still perfectly alive. It cannot hide from ARP though: anything that
// speaks IP at all must answer "who has this address" to be reachable by
// anybody. So when discovery draws a blank, go a layer down — send a stray byte
// at every address on our own subnet, which makes the kernel ARP for each in
// turn, then read the table to see which ones answered. No root needed, because
// we are not reading raw frames, just the cache the kernel keeps anyway.
const shell = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 4000, killSignal: "SIGKILL" }, (err, stdout) => {
    resolve(String(stdout || ""));
  });
});

async function sweep(skipName) {
  const probe = Buffer.from("hypermoon");
  const targets = interfaces.filter((l) => l.name !== skipName && !l.address.startsWith("169.254"));
  if (!targets.length) return { live: [], swept: [] };
  for (const l of targets) {
    const [a, b, c] = l.address.split(".");
    const sock = dgram.createSocket("udp4");
    await new Promise((r) => sock.bind({ address: l.address, port: 0 }, r));
    console.log(`  sweeping ${a}.${b}.${c}.0/24 from ${l.name} …`);
    for (let host = 1; host <= 254; host++) {
      const ip = `${a}.${b}.${c}.${host}`;
      if (ip === l.address) continue;
      // Discard port: we want the ARP that precedes the packet, not a reply.
      sock.send(probe, 9, ip, () => { /* unreachable is the normal case */ });
    }
    await new Promise((r) => setTimeout(r, 2500));
    sock.close();
  }
  const table = await shell("arp", ["-a", "-n"]);
  const live = [];
  for (const line of table.split("\n")) {
    const m = /\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]{11,17})/i.exec(line);
    if (!m || /ff:ff:ff:ff:ff:ff/i.test(m[2])) continue;
    const on = /on (\w+)/.exec(line);
    if (on && on[1] === skipName) continue;
    if (targets.some((l) => l.address.split(".").slice(0, 3).join(".") ===
      m[1].split(".").slice(0, 3).join("."))) {
      live.push({ ip: m[1], mac: m[2], iface: on ? on[1] : "?" });
    }
  }
  // Which subnets were actually covered, so a blank result can tell the
  // difference between "looked and found nothing" and "had nowhere to look" —
  // advice for those two is not remotely the same, and conflating them had this
  // script recommending aliases that were already in place.
  return {
    live,
    swept: targets.map((l) => `${l.address.split(".").slice(0, 3).join(".")}.0/24 on ${l.name}`)
  };
}

if (!found.size) {
  // Which port faces the outside world, so the sweep does not spray the camp
  // network with 254 packets to no purpose.
  const dflt = /interface:\s*(\w+)/.exec(await shell("route", ["-n", "get", "default"]));
  console.log("\nNo Art-Net reply. Going a layer down and sweeping for anything that speaks IP.");
  const { live, swept } = await sweep(dflt ? dflt[1] : "en0");
  if (live.length) {
    console.log(`\nFound ${live.length} device(s) that answered ARP but not Art-Net:\n`);
    for (const d of live) {
      const advatek = ADVATEK.some((p) => d.mac.startsWith(p));
      console.log(`  ${d.ip}  ${d.mac}${advatek ? "  (Advatek)" : ""}  on ${d.iface}`);
    }
    const best = live.find((d) => ADVATEK.some((p) => d.mac.startsWith(p))) || live[0];
    console.log([
      "",
      "That is almost certainly the controller, with Art-Net discovery off.",
      "It will still take pixels. Try sACN first, which is what Advatek ships",
      "enabled, then Art-Net:",
      "",
      `  PIXLITE=${best.ip} TEST=chase npm run pixels`,
      `  PROTOCOL=artnet PIXLITE=${best.ip} TEST=chase npm run pixels`
    ].join("\n"));
    process.exit(0);
  }
  const cable = interfaces.find((l) => l.address.startsWith("169.254"));
  if (!swept.length) {
    // Nowhere to look, rather than nothing found. Fix the addressing first.
    console.log([
      "",
      `Nothing to sweep: ${cable ? `${cable.name} only has a self-assigned ${cable.address}` : "no port has a routable address"},`,
      "which can reach nothing but itself. Give it an address on each of the two",
      "subnets a controller is likely to be on — they cost nothing and one of them",
      "is probably right:",
      "",
      `  sudo ifconfig ${cable ? cable.name : "en13"} alias 192.168.0.10 255.255.255.0   # Advatek factory default`,
      `  sudo ifconfig ${cable ? cable.name : "en13"} alias 2.0.0.10 255.0.0.0           # Art-Net classic scheme`,
      "  npm run pixels:find",
      "",
      "Those aliases are not permanent — they vanish on reboot or unplug, and",
      `'sudo ifconfig ${cable ? cable.name : "en13"} -alias 192.168.0.10' takes one back by hand.`
    ].join("\n"));
    process.exit(1);
  }

  // Looked properly and found nothing. The remaining explanations are all about
  // where else the controller could be, so say what was actually covered.
  const dfltIface = dflt ? interfaces.find((l) => l.name === dflt[1]) : null;
  console.log([
    "",
    `Swept and found nothing: ${swept.join(", ")}.`,
    "",
    "The link is up, so something is on the end of that cable and it is not",
    "answering on either likely subnet. In rough order of likelihood —",
    "",
    dfltIface
      ? `  1. It is on ${dfltIface.address.split(".").slice(0, 3).join(".")}.x, the same subnet as ${dfltIface.name}.\n` +
        `     This one is invisible to every test above: that subnet already belongs\n` +
        `     to ${dfltIface.name}, so every packet for it leaves by ${dfltIface.name} and never touches the\n` +
        "     cable. To rule it in or out, turn that interface off for a minute, give\n" +
        `     the cable the subnet instead, and look again:\n` +
        `       sudo ifconfig ${dfltIface.name} down\n` +
        `       sudo ifconfig ${cable ? cable.name : "en13"} alias ${dfltIface.address.split(".").slice(0, 3).join(".")}.210 255.255.255.0\n` +
        "       npm run pixels:find\n" +
        `       sudo ifconfig ${dfltIface.name} up        # put it back either way`
      : "",
    "  2. Watch the wire. A controller set to DHCP with no server to answer will",
    "     be shouting for one, and a static one usually ARPs for its gateway; both",
    "     name it outright. Needs root because it is reading raw frames:",
    `       sudo tcpdump -i ${cable ? cable.name : "en13"} -n -e -s 300 'arp or udp'`,
    "     Leave it half a minute. Any packet at all tells you the address it thinks",
    "     it has; DHCP traffic means it wants a server and never got one.",
    "  3. Advatek Assistant, if it is on this machine — its own discovery protocol",
    "     finds and reconfigures controllers on any address whatsoever.",
    "  4. Hold the controller's reset to put it back to 192.168.0.50.",
    "  5. Send blind anyway — discovery is a convenience, the rig does not need it:",
    "       PIXLITE=192.168.0.50 TEST=chase npm run pixels",
    "       PROTOCOL=artnet PIXLITE=192.168.0.50 TEST=chase npm run pixels"
  ].filter((s) => s !== "").join("\n"));
  process.exit(1);
}

console.log(`\n${found.size} node(s) answered:\n`);
for (const n of found.values()) {
  console.log(`  ${n.ip}${n.advatek ? "  (Advatek)" : ""}`);
  console.log(`    name     ${n.short}${n.long && n.long !== n.short ? ` / ${n.long}` : ""}`);
  console.log(`    mac      ${n.mac}`);
  console.log(`    outputs  ${n.ports} port(s), net ${n.net} sub ${n.sub}, universes ${n.swOut.join(",")}`);
  if (n.report) console.log(`    status   ${n.report}`);
  if (n.heardFrom !== n.ip) console.log(`    note     replied from ${n.heardFrom}`);
}

// The part that matters: can we actually route to it, or does an address have
// to be set first? Same-subnet is decided by the mask on our side.
const sameSubnet = (l, ip) => {
  const mask = l.netmask.split(".").map(Number);
  const a = l.address.split(".").map(Number);
  const b = ip.split(".").map(Number);
  return a.every((o, i) => (o & mask[i]) === (b[i] & mask[i]));
};

const target = [...found.values()].find((n) => n.advatek) || [...found.values()][0];
const route = interfaces.find((l) => sameSubnet(l, target.ip));

console.log("");
if (route) {
  console.log(`${route.name} (${route.address}) is on the same subnet as ${target.ip}, so it is reachable.`);
  console.log("Light it:");
  console.log(`  PROTOCOL=artnet PIXLITE=${target.ip} TEST=chase npm run pixels`);
} else {
  // The whole reason this script exists. Both ends are alive and cannot speak.
  const [a, b, c] = target.ip.split(".");
  const mine = `${a}.${b}.${c}.10`;
  // Which port to reconfigure. A self-assigned address is the strongest signal
  // that this is the cable to the rig — it means nothing on that wire answered
  // for DHCP — and en0 is Wi-Fi on every Mac, so it is the last thing we would
  // want to hand a static address belonging to the lighting network.
  const cable = interfaces.find((l) => l.address.startsWith("169.254"))
    || interfaces.find((l) => l.name !== "en0")
    || interfaces[0];
  console.log(`${target.ip} answered, but no port here shares its subnet — that is why nothing works.`);
  console.log(`Give ${cable.name} an address next to it:`);
  console.log("");
  console.log(`  sudo ipconfig set ${cable.name} MANUAL ${mine} 255.255.255.0`);
  console.log("");
  console.log("(or System Settings -> Network -> Ethernet -> Details -> TCP/IP,");
  console.log(` configure IPv4 manually, ${mine}, mask 255.255.255.0, no router)`);
  console.log("Then:");
  console.log(`  PROTOCOL=artnet PIXLITE=${target.ip} TEST=chase npm run pixels`);
}
