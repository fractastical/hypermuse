// Is the Starlink dish reachable from here, and would it tell us where it is?
//
// Written as a script with a watchdog rather than as a handful of shell commands
// because the shell version hung the machine twice. `ping` and `nc -z -w 3`
// both document a timeout and both ignore it when there is no route to the
// address at all, which is exactly the case this probe exists to detect: if we
// are behind a third-party router rather than on the dish's own LAN, 192.168.100.1
// is not merely closed, it is nowhere, and the tools sit there forever. So every
// wait here is a timer we own, and the last line of defence is a watchdog that
// calls process.exit whether or not anything has come back.
//
// What we are hoping for: the dish holds a real GPS fix and would be the one
// feed on this car that never sleeps, needs no cable, and no one has to
// remember to charge. What stands in the way: coordinates come from a separate
// call that is refused unless someone opts in from the Starlink app, so a clean
// "denied" here is a useful answer and not a failure.
import { execFile } from "node:child_process";
import { get } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

const DISH = process.env.STARLINK_HOST || "192.168.100.1";
const CONNECT_MS = 2500;
// Everything above is capped well under this; it fires only if a socket lies.
const TOTAL_MS = 15000;

const bomb = setTimeout(() => {
  console.log("\nwatchdog fired — something refused to time out. exiting anyway.");
  process.exit(2);
}, TOTAL_MS);

const tcp = (host, port) => new Promise((resolve) => {
  const started = Date.now();
  const socket = connect({ host, port });
  const done = (open, note) => {
    socket.destroy();
    resolve({ open, ms: Date.now() - started, note });
  };
  socket.setTimeout(CONNECT_MS);
  socket.on("connect", () => done(true, "answered"));
  socket.on("timeout", () => done(false, "no answer (timed out)"));
  socket.on("error", (err) => done(false, err.code || err.message));
});

const http = (url) => new Promise((resolve) => {
  const req = get(url, { timeout: CONNECT_MS }, (res) => {
    res.resume();
    resolve(`${res.statusCode} ${res.headers.server || ""}`.trim());
  });
  req.on("timeout", () => { req.destroy(); resolve("timed out"); });
  req.on("error", (err) => resolve(err.code || err.message));
});

// execFile has a real timeout and kills the child, unlike a piped shell line.
const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 3000, killSignal: "SIGKILL" }, (err, stdout) => {
    resolve(err && !stdout ? `(${err.code || err.message})` : String(stdout).trim());
  });
});

const own = [];
for (const [name, addrs] of Object.entries(networkInterfaces())) {
  for (const a of addrs || []) {
    if (a.family === "IPv4" && !a.internal) own.push(`${name} ${a.address}/${a.netmask}`);
  }
}
console.log("this mac:", own.join(", ") || "(no external IPv4)");

const route = await run("route", ["-n", "get", "default"]);
const gateway = /gateway:\s*(\S+)/.exec(route);
console.log("default gateway:", gateway ? gateway[1] : "(none found)");

// 9200 is the dish's gRPC port; 80 is its status page. Either answering means we
// are on a network with a route to the dish itself.
const grpc = await tcp(DISH, 9200);
const web = await tcp(DISH, 80);
console.log(`${DISH}:9200  ${grpc.open ? "OPEN" : "closed"} — ${grpc.note} (${grpc.ms}ms)`);
console.log(`${DISH}:80    ${web.open ? "OPEN" : "closed"} — ${web.note} (${web.ms}ms)`);
if (web.open) console.log(`http://${DISH}/ ->`, await http(`http://${DISH}/`));

clearTimeout(bomb);

if (!grpc.open) {
  console.log([
    "",
    "No route to the dish's own address, so there is nothing to ask.",
    "That is the normal result when the car is on a separate router that",
    "uplinks to Starlink: only the router can see 192.168.100.1, and we",
    "are a hop behind it. Worth retrying while joined directly to the",
    "Starlink SSID, if that is ever an option.",
    gateway ? `Try also: STARLINK_HOST=${gateway[1]} npm run hermes:starlink` : ""
  ].filter(Boolean).join("\n"));
  process.exit(1);
}

console.log([
  "",
  "The dish is reachable. Coordinates need one more call than this script can",
  "make on its own — it speaks gRPC with reflection, so it wants grpcurl:",
  "",
  "  cd /tmp && curl -sSL -o g.tar.gz \\",
  "    https://github.com/fullstorydev/grpcurl/releases/download/v1.9.1/grpcurl_1.9.1_osx_arm64.tar.gz \\",
  "    && tar xzf g.tar.gz",
  `  /tmp/grpcurl -plaintext -max-time 10 -d '{"get_location":{}}' ${DISH}:9200 SpaceX.API.Device.Device/Handle`,
  "",
  "If that comes back denied, it is a toggle and not a dead end: Starlink app",
  "-> Settings -> Debug data -> allow access on local network. get_status also",
  "carries GPS satellite counts but never latitude and longitude, so it cannot",
  "stand in for get_location."
].join("\n"));
