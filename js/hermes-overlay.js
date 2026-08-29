(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("hermes") !== "1") return;

  const css = `
    .hermes-panel {
      position: fixed;
      z-index: 50;
      width: min(25vw, 430px);
      max-height: 38vh;
      overflow: hidden;
      padding: clamp(16px, 1.4vw, 26px) clamp(18px, 1.6vw, 30px);
      color: rgba(244, 250, 255, 0.94);
      font: clamp(18px, 1.25vw, 28px)/1.3 "SF Mono", Menlo, Consolas, monospace;
      background: transparent;
      border: 0;
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    }
    .hermes-left { left: 18px; top: 18px; }
    .hermes-right { right: 18px; top: 18px; }
    .hermes-map-panel {
      left: 18px;
      bottom: 18px;
      top: auto;
      width: min(25vw, 430px);
      padding: 14px;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .hermes-map {
      display: block;
      width: 100%;
      aspect-ratio: 1.42 / 1;
      background: transparent;
    }
    .hermes-hidden { display: none; }
    .hermes-kicker {
      margin-bottom: 7px;
      color: rgba(122, 218, 255, 0.84);
      font-size: clamp(14px, 0.9vw, 20px);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .hermes-place {
      font-size: clamp(30px, 2.6vw, 56px);
      line-height: 1.05;
      font-weight: 700;
      letter-spacing: 0;
      color: #ffffff;
      text-shadow: 0 0 14px rgba(0, 214, 255, 0.62), 0 0 28px rgba(255, 0, 213, 0.28);
    }
    .hermes-meta {
      margin-top: 11px;
      color: rgba(244, 250, 255, 0.68);
      font-size: clamp(17px, 1.1vw, 25px);
    }
    .hermes-event {
      padding: 13px 0;
      border-top: 1px solid rgba(122, 218, 255, 0.18);
    }
    .hermes-event:first-of-type { border-top: 0; padding-top: 2px; }
    .hermes-event-title {
      display: flex;
      gap: 8px;
      align-items: baseline;
      font-weight: 700;
      font-size: clamp(19px, 1.35vw, 30px);
    }
    .hermes-event-marker {
      display: inline-flex;
      flex: 0 0 auto;
      width: 0.9em;
      justify-content: center;
      align-items: center;
      font-size: 0.8em;
      line-height: 1;
      -webkit-text-stroke: 1px rgba(8, 14, 22, 0.9);
      filter: drop-shadow(0 0 5px currentColor);
    }
    .hermes-adult {
      flex: 0 0 auto;
      padding: 1px 5px;
      color: #ffe7ef;
      border: 1px solid rgba(255, 92, 146, 0.68);
      background: rgba(132, 14, 58, 0.58);
      font-size: clamp(12px, 0.8vw, 17px);
      font-weight: 800;
    }
    .hermes-event-meta {
      margin-top: 2px;
      color: rgba(244, 250, 255, 0.72);
      font-size: clamp(16px, 1vw, 22px);
    }
    .hermes-event-desc {
      margin-top: 4px;
      color: rgba(244, 250, 255, 0.82);
      font-size: clamp(15px, 0.95vw, 21px);
    }
    .hermes-stale {
      color: #ffcf73;
    }
    @media (max-width: 900px) {
      .hermes-panel {
        width: calc(50vw - 22px);
        padding: 12px 13px;
        font-size: 16px;
      }
      .hermes-left { left: 10px; top: 10px; }
      .hermes-right { right: 10px; top: 10px; }
      .hermes-map-panel {
        left: 10px;
        bottom: 10px;
        width: calc(50vw - 22px);
      }
      .hermes-place { font-size: 25px; }
      .hermes-event-desc { font-size: 14px; }
    }
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const left = document.createElement("section");
  left.className = "hermes-panel hermes-left";
  left.setAttribute("aria-live", "polite");
  const right = document.createElement("section");
  right.className = "hermes-panel hermes-right";
  right.setAttribute("aria-live", "polite");
  const mapPanel = document.createElement("section");
  mapPanel.className = "hermes-panel hermes-map-panel";
  const mapCanvas = document.createElement("canvas");
  mapCanvas.className = "hermes-map";
  mapCanvas.width = 320;
  mapCanvas.height = 320;
  mapPanel.appendChild(mapCanvas);
  document.body.append(left, right, mapPanel);

  let visible = true;
  let lastState = null;
  const track = [];
  const maxTrackAgeMs = 12 * 60 * 1000;
  const mapImage = new Image();
  const mapState = {
    loaded: false,
    imageReady: false,
    meta: null
  };
  mapImage.onload = () => {
    mapState.imageReady = true;
    if (lastState) drawMap(lastState);
  };
  mapImage.src = "/data/hermes/2026/map/playa-streets.png";
  const hermesLogo = new Image();
  hermesLogo.onload = () => { if (lastState) drawMap(lastState); };
  hermesLogo.src = "/hermes/logo.png";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function meters(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n < 1000 ? `${Math.round(n)}m` : `${(n / 1000).toFixed(1)}km`;
  }

  const eventColors = ["#ff5c92", "#ffd45c", "#65e6ff", "#a9ff6b", "#c28cff"];
  function eventMarker(event, position = null) {
    if (Number.isInteger(position)) {
      return { color: eventColors[position % eventColors.length], shape: position % 3 };
    }
    const text = String(event.title || event.location || "event");
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const index = Math.abs(hash) % eventColors.length;
    return { color: eventColors[index], shape: index % 3 };
  }

  function drawEventMarker(ctx, point, marker, size) {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = marker.color;
    ctx.strokeStyle = "rgba(8, 14, 22, 0.95)";
    ctx.lineWidth = Math.max(1.5, size * 0.12);
    ctx.beginPath();
    if (marker.shape === 0) {
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
    } else if (marker.shape === 1) {
      ctx.moveTo(0, -size * 0.55);
      ctx.lineTo(size * 0.55, 0);
      ctx.lineTo(0, size * 0.55);
      ctx.lineTo(-size * 0.55, 0);
      ctx.closePath();
    } else {
      ctx.moveTo(0, -size * 0.58);
      ctx.lineTo(size * 0.52, size * 0.42);
      ctx.lineTo(-size * 0.52, size * 0.42);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function addTrackPoint(fix) {
    const lat = Number(fix.lat);
    const lon = Number(fix.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const now = Date.now();
    const prev = track[track.length - 1];
    if (!prev || Math.hypot((prev.lat - lat) * 111000, (prev.lon - lon) * 85000) > 2) {
      track.push({ lat, lon, t: now });
    } else {
      prev.lat = lat;
      prev.lon = lon;
      prev.t = now;
    }
    while (track.length && now - track[0].t > maxTrackAgeMs) track.shift();
    while (track.length > 180) track.shift();
  }

  function rotated(lon, lat) {
    const meta = mapState.meta || {};
    const o = meta.origin || { lon: -119.20788409599999, lat: 40.783247448000054 };
    const latScale = 111320;
    const lonScale = Math.cos(o.lat * Math.PI / 180) * 111320;
    const x = (lon - o.lon) * lonScale;
    const y = (lat - o.lat) * latScale;
    const c = Math.cos(meta.rotation || 0);
    const s = Math.sin(meta.rotation || 0);
    return {
      x: x * c - y * s,
      y: x * s + y * c
    };
  }

  async function loadMapMeta() {
    try {
      const resp = await fetch("/data/hermes/2026/map/playa-streets-metadata.json", { cache: "force-cache" });
      if (!resp.ok) throw new Error(`metadata HTTP ${resp.status}`);
      mapState.meta = await resp.json();
      mapState.loaded = true;
      if (lastState) drawMap(lastState);
    } catch (err) {
      console.warn("Hermes map metadata unavailable:", err);
    }
  }

  function project(lat, lon, width, height) {
    const meta = mapState.meta || {};
    const b = meta.bounds || {
      minX: -2600,
      minY: -2600,
      maxX: 2600,
      maxY: 2600
    };
    const pad = Math.max(8, Math.min(width, height) * 0.045);
    const p = rotated(lon, lat);
    const sx = (width - pad * 2) / (b.maxX - b.minX);
    const sy = (height - pad * 2) / (b.maxY - b.minY);
    const scale = Math.min(sx, sy);
    const mapW = (b.maxX - b.minX) * scale;
    const mapH = (b.maxY - b.minY) * scale;
    const ox = (width - mapW) / 2;
    const oy = (height - mapH) / 2;
    return {
      x: ox + (p.x - b.minX) * scale,
      y: oy + (b.maxY - p.y) * scale
    };
  }

  function drawBaseMap(ctx, width, height, dpr) {
    if (!mapState.imageReady || !mapState.loaded) {
      ctx.fillStyle = "rgba(244,250,255,0.72)";
      ctx.font = `${10 * dpr}px SF Mono, Menlo, monospace`;
      ctx.fillText("LOADING PLAYA MAP", 10 * dpr, 18 * dpr);
      return;
    }
    const imgRatio = mapState.meta.width / mapState.meta.height;
    const canvasRatio = width / height;
    let drawW = width;
    let drawH = height;
    let dx = 0;
    let dy = 0;
    if (canvasRatio > imgRatio) {
      drawH = height;
      drawW = height * imgRatio;
      dx = (width - drawW) / 2;
    } else {
      drawW = width;
      drawH = width / imgRatio;
      dy = (height - drawH) / 2;
    }
    ctx.drawImage(mapImage, dx, dy, drawW, drawH);
  }

  function drawMap(state) {
    const ctx = mapCanvas.getContext("2d");
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = mapCanvas.getBoundingClientRect();
    const width = Math.max(220, Math.round(rect.width * dpr));
    const height = Math.max(155, Math.round(rect.height * dpr));
    if (mapCanvas.width !== width || mapCanvas.height !== height) {
      mapCanvas.width = width;
      mapCanvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    drawBaseMap(ctx, width, height, dpr);

    const now = Date.now();
    if (track.length > 1) {
      for (let i = 1; i < track.length; i++) {
        const a = Math.max(0, 1 - (now - track[i].t) / maxTrackAgeMs);
        const p0 = project(track[i - 1].lat, track[i - 1].lon, width, height);
        const p1 = project(track[i].lat, track[i].lon, width, height);
        ctx.strokeStyle = `rgba(122, 218, 255, ${0.12 + a * 0.42})`;
        ctx.lineWidth = (1 + a * 2.2) * dpr;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    const activities = Array.isArray(state.activities) ? state.activities : [];
    activities.forEach((event, index) => {
      const eventLat = Number(event.lat);
      const eventLon = Number(event.lon);
      if (Number.isFinite(eventLat) && Number.isFinite(eventLon)) {
        drawEventMarker(ctx, project(eventLat, eventLon, width, height), eventMarker(event, index), Math.max(18, Math.min(30, width * 0.07)) * dpr);
      }
    });

    const fix = state.fix || {};
    const lat = Number(fix.lat);
    const lon = Number(fix.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const here = project(lat, lon, width, height);
      let heading = null;
      for (let i = track.length - 2; i >= 0; i--) {
        const prev = project(track[i].lat, track[i].lon, width, height);
        const dx = here.x - prev.x;
        const dy = here.y - prev.y;
        if (Math.hypot(dx, dy) > 3 * dpr) {
          heading = Math.atan2(dy, dx);
          break;
        }
      }
      if (hermesLogo.complete && hermesLogo.naturalWidth) {
        const logoSize = Math.max(38, Math.min(66, width * 0.16));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(hermesLogo, here.x - logoSize / 2, here.y - logoSize / 2, logoSize, logoSize);
        ctx.restore();
      }
      if (heading != null) {
        const len = 26 * dpr;
        const tipX = here.x + Math.cos(heading) * len;
        const tipY = here.y + Math.sin(heading) * len;
        const wing = 7 * dpr;
        ctx.strokeStyle = "rgba(255, 232, 128, 0.92)";
        ctx.lineWidth = 2.4 * dpr;
        ctx.beginPath();
        ctx.moveTo(here.x, here.y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 232, 128, 0.92)";
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + Math.cos(heading + Math.PI * 0.78) * wing, tipY + Math.sin(heading + Math.PI * 0.78) * wing);
        ctx.lineTo(tipX + Math.cos(heading - Math.PI * 0.78) * wing, tipY + Math.sin(heading - Math.PI * 0.78) * wing);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.fillStyle = "rgba(244, 250, 255, 0.72)";
    ctx.font = `${10 * dpr}px SF Mono, Menlo, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("PLAYA TRACK", 10 * dpr, 18 * dpr);
  }

  function render(state) {
    lastState = state;
    const fix = state.fix || {};
    addTrackPoint(fix);
    const place = state.place || {};
    const updatedAt = Date.parse(state.updatedAt || "");
    const age = Number.isFinite(updatedAt)
      ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
      : Number(fix.ageSec);
    const stale = Number.isFinite(age) && age > 15;
    const accuracy = Number(fix.accuracyM);
    const accuracyText = Number.isFinite(accuracy) && accuracy > 0 ? `${Math.round(accuracy)}m accuracy` : "accuracy unknown";
    const ageText = Number.isFinite(age) ? `${age}s old` : "age unknown";
    const coords = Number.isFinite(fix.lat) && Number.isFinite(fix.lon)
      ? `${Number(fix.lat).toFixed(5)}, ${Number(fix.lon).toFixed(5)}`
      : "waiting for GPS";

    left.innerHTML = `
      <div class="hermes-kicker">Hermes position</div>
      <div class="hermes-place">${esc(place.label || "Waiting for location")}</div>
      <div class="hermes-meta">${esc(place.kind || "unknown")} ${place.detail ? `• ${esc(place.detail)}` : ""}</div>
      <div class="hermes-meta ${stale ? "hermes-stale" : ""}">${esc(ageText)} • ${esc(accuracyText)}</div>
      <div class="hermes-meta">${esc(coords)}</div>
    `;

    const activities = Array.isArray(state.activities) ? state.activities.slice(0, 3) : [];
    right.innerHTML = `
      <div class="hermes-kicker">Nearby now / next hour</div>
      ${activities.map((ev, index) => {
        const marker = eventMarker(ev, index);
        return `
        <article class="hermes-event">
          <div class="hermes-event-title">
            <span class="hermes-event-marker" style="background:${marker.color};color:${marker.color}" aria-hidden="true">${marker.shape === 0 ? "●" : marker.shape === 1 ? "◆" : "▲"}</span>
            ${ev.adult ? '<span class="hermes-adult">18+</span>' : ""}
            <span>${esc(ev.title || "Untitled activity")}</span>
          </div>
          <div class="hermes-event-meta">${esc(ev.timeLabel || "time unknown")} • ${esc(meters(ev.distanceM))} • ${esc(ev.location || "location unknown")}</div>
          <div class="hermes-event-desc">${esc(ev.description || "")}</div>
        </article>
      `;
      }).join("") || '<div class="hermes-meta">No nearby activities loaded.</div>'}
    `;
    drawMap(state);
  }

  function setVisible(next) {
    visible = next;
    left.classList.toggle("hermes-hidden", !visible);
    right.classList.toggle("hermes-hidden", !visible);
    mapPanel.classList.toggle("hermes-hidden", !visible);
  }

  window.addEventListener("keydown", (event) => {
    if (event.key && event.key.toLowerCase() === "h") setVisible(!visible);
  });

  // Where the state lives. Two arrangements are both normal: hermes-server can
  // serve this page as well as the API, or it can sit on its own port beside the
  // plain static server the show is usually started with. Its own port is tried
  // first and this origin second — that way both of those answer on the first
  // request, and the console stays clean. Asking this origin first meant a 404
  // on every load of the commoner arrangement, which is noise in the one place
  // you look when something is actually wrong. Whichever answers is kept for the
  // event stream too, and the server already sends the CORS headers the
  // cross-origin case needs. ?hermesapi= pins it, for an API on another machine.
  const API_PORT = 8124;
  const API_FALLBACK = `${location.protocol}//${location.hostname}:${API_PORT}`;
  const API_PINNED = params.get("hermesapi");
  let apiBase = API_PINNED || "";
  let resolved = API_PINNED != null;
  let events = null;

  function connectEvents() {
    if (!("EventSource" in window)) return;
    if (events) events.close();
    events = new EventSource(apiBase + "/api/hermes/events");
    events.addEventListener("state", (event) => {
      try { render(JSON.parse(event.data)); } catch { /* ignore malformed event */ }
    });
    events.onerror = () => poll();
  }

  async function poll() {
    const bases = resolved ? [apiBase] : [API_FALLBACK, ""];
    let err = null;
    for (const base of bases) {
      try {
        const resp = await fetch(base + "/api/hermes/state", { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const next = await resp.json();
        const moved = !resolved || base !== apiBase || !events;
        apiBase = base;
        resolved = true;
        if (moved) connectEvents();
        render(next);
        return;
      } catch (e) { err = e; }
    }
    if (!lastState) {
      render({
        fix: {},
        place: {
          label: "Hermes backend offline", kind: "status",
          detail: (err ? err.message + " — " : "") + "npm run hermes:server"
        },
        activities: []
      });
    }
  }

  if (!("EventSource" in window)) setInterval(poll, 5000);
  // Keep the displayed age honest between Alpha watcher updates.
  setInterval(() => { if (lastState) render(lastState); }, 1000);
  loadMapMeta();
  poll();   // finds the API, then opens the event stream on whatever answered
})();
