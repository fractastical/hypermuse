// LAN broadcast helper: pushes a MediaStream (e.g. a canvas captureStream)
// peer-to-peer to any number of stream-view.html viewers, using the WebRTC
// signaling relay in scripts/stream-server.mjs (npm run stream:server,
// ws on :8081). Loaded by hypermoon.html; used as:
//
//   const session = window.HypermuseStream.broadcast(stream, {
//     onStatus: (state, viewerCount) => { ... }
//   });
//   session.stop();
//
// The signaling server only relays the handshake - video flows directly
// between this machine and each viewer over the LAN.
(function () {
  "use strict";

  function broadcast(stream, opts) {
    opts = opts || {};
    const HOST = opts.host || location.hostname || "localhost";
    const PORT = opts.port || 8081;
    const onStatus = typeof opts.onStatus === "function" ? opts.onStatus : function () {};

    let ws = null;
    let stopped = false;
    let reconnectTimer = 0;
    const peers = new Map(); // viewer id -> RTCPeerConnection

    function status(state) {
      onStatus(state, peers.size);
    }

    function send(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    }

    function closePeer(id) {
      const pc = peers.get(id);
      if (pc) {
        pc.close();
        peers.delete(id);
      }
    }

    async function offerTo(id) {
      closePeer(id);
      const pc = new RTCPeerConnection();
      peers.set(id, pc);
      stream.getTracks().forEach(function (track) { pc.addTrack(track, stream); });
      pc.onicecandidate = function (ev) {
        if (ev.candidate) send({ type: "ice", candidate: ev.candidate, to: id });
      };
      pc.onconnectionstatechange = function () {
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          if (peers.get(id) === pc) peers.delete(id);
          status("live");
        }
      };
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: "offer", sdp: pc.localDescription, to: id });
      } catch (e) {
        closePeer(id);
      }
      status("live");
    }

    function connect() {
      status("connecting");
      ws = new WebSocket("ws://" + HOST + ":" + PORT);
      ws.onopen = function () {
        send({ type: "hello", role: "broadcaster" });
      };
      ws.onerror = function () { ws.close(); };
      ws.onclose = function () {
        peers.forEach(function (pc) { pc.close(); });
        peers.clear();
        if (!stopped) {
          status("reconnecting");
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
      ws.onmessage = async function (e) {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.type === "ready") {
          status("live");
        } else if (msg.type === "viewer-join") {
          offerTo(String(msg.id));
        } else if (msg.type === "viewer-leave") {
          closePeer(String(msg.id));
          status("live");
        } else if (msg.type === "answer") {
          const pc = peers.get(String(msg.from));
          if (pc) {
            try { await pc.setRemoteDescription(msg.sdp); } catch (err) {}
          }
        } else if (msg.type === "ice") {
          const pc = peers.get(String(msg.from));
          if (pc && msg.candidate) pc.addIceCandidate(msg.candidate).catch(function () {});
        } else if (msg.type === "replaced") {
          // Another broadcaster took over on the relay; stand down.
          stop();
          status("replaced");
        }
      };
    }

    function stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      peers.forEach(function (pc) { pc.close(); });
      peers.clear();
      if (ws) ws.close();
      status("off");
    }

    connect();
    return { stop: stop };
  }

  window.HypermuseStream = { broadcast: broadcast };
})();
