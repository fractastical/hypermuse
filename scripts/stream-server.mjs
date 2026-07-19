// WebRTC signaling relay for LAN live streaming.
//
// One broadcaster (hypermoon.html?stream=1 or stream-broadcast.html) pushes
// its video to any number of viewers (stream-view.html on other devices).
// This server only relays the WebRTC handshake (offers/answers/ICE); the
// video itself flows peer-to-peer over the local network.
//
//   npm run stream:server          # listens on ws://0.0.0.0:8081
//   STREAM_PORT=9000 npm run stream:server
import { WebSocketServer } from "ws";
import os from "node:os";

const PORT = Number(process.env.STREAM_PORT || 8081);
const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

let broadcaster = null;
const viewers = new Map(); // id -> ws
let nextId = 1;

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws, req) => {
  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === "hello") {
      if (msg.role === "broadcaster") {
        if (broadcaster && broadcaster !== ws) {
          send(broadcaster, { type: "replaced" });
          broadcaster.close();
        }
        broadcaster = ws;
        ws._role = "broadcaster";
        console.log(`[stream] broadcaster connected (${req.socket.remoteAddress}), ${viewers.size} viewer(s) waiting`);
        send(ws, { type: "ready", viewers: viewers.size });
        // Introduce viewers that arrived before the broadcast started.
        for (const id of viewers.keys()) send(ws, { type: "viewer-join", id });
      } else {
        const id = String(nextId++);
        ws._role = "viewer";
        ws._id = id;
        viewers.set(id, ws);
        console.log(`[stream] viewer ${id} connected (${req.socket.remoteAddress}), live=${!!broadcaster}`);
        send(ws, { type: "ready", id, live: !!broadcaster });
        if (broadcaster) send(broadcaster, { type: "viewer-join", id });
      }
      return;
    }

    // Relay handshake messages between the broadcaster and a specific viewer.
    if (ws._role === "broadcaster") {
      const viewer = viewers.get(String(msg.to));
      if (viewer) send(viewer, { ...msg, to: undefined });
    } else if (ws._role === "viewer") {
      if (broadcaster) send(broadcaster, { ...msg, from: ws._id });
    }
  });

  ws.on("close", () => {
    if (ws === broadcaster) {
      broadcaster = null;
      console.log("[stream] broadcaster disconnected");
      viewers.forEach((v) => send(v, { type: "ended" }));
    }
    if (ws._id && viewers.delete(ws._id)) {
      console.log(`[stream] viewer ${ws._id} disconnected`);
      if (broadcaster) send(broadcaster, { type: "viewer-leave", id: ws._id });
    }
  });
});

const lanIps = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);
console.log(`[stream] signaling on ws://0.0.0.0:${PORT}`);
console.log(`[stream] broadcast: http://localhost:8080/hypermoon.html?stream=1  (or stream-broadcast.html)`);
for (const ip of lanIps) {
  console.log(`[stream] viewers:   http://${ip}:8080/stream-view.html`);
}
