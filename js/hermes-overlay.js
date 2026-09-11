(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("hermes") !== "1") return;

  // The screen is not all ours. A ratchet strap across the glass takes a band of
  // it, and no amount of clamping font sizes wins against something physically in
  // the way — the panel has to move instead. So the listings can run as a thin
  // bar along the top above the moon, which needs only a strip and leaves the
  // whole right-hand side clear, and the strip can be pushed down past whatever
  // crosses the screen.
  //   ?hermesevents=bar   one line along the top (default)
  //   ?hermesevents=card  the old block in the top right corner
  //   ?hermesbartop=90    px from the top, to sit clear of a strap
  //   ?hermesbarh=104     px tall
  //   ?hermesinset=40     px all panels keep away from every edge
  const asBar = (params.get("hermesevents") || "bar") !== "card";
  const px = (name, fallback) => {
    // Presence checked before conversion, because Number(null) is 0 rather than
    // NaN — so a missing parameter would otherwise read as a deliberate zero and
    // silently give a bar with no height pinned to the very corner of the glass.
    const raw = params.get(name);
    if (raw == null || raw === "") return fallback;
    const asked = Number(raw);
    return Number.isFinite(asked) && asked >= 0 ? asked : fallback;
  };
  const inset = px("hermesinset", 18);
  const barTop = px("hermesbartop", inset);
  const barH = px("hermesbarh", 104);
  const barSpan = (() => {
    const raw = params.get("hermesbarspan");
    if (raw == null || raw === "") return 0.6; // middle 3/5 by default
    const asked = Number(raw);
    return Number.isFinite(asked) ? Math.max(0.25, Math.min(1, asked)) : 0.6;
  })();
  const sidePct = (1 - barSpan) / 2;
  // Keep nearby events as the default panel content; now-playing can still be
  // forced into the card with ?hermesnow=1 when explicitly wanted.
  const SHOW_NOW_PLAYING_IN_EVENT_CARD = String(params.get("hermesnow") || "0") === "1";
  const QR_TARGET_URL = (() => {
    const asked = String(params.get("hermesqr") || "https://returnofhermes.com/").trim();
    return asked || "https://returnofhermes.com/";
  })();

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
    /* One card at a time, so it can be wide enough to finish its sentences. The
       old panel was a quarter of the screen holding three listings, which meant
       the third was always cut off mid-word by the overflow rule. */
    .hermes-right {
      right: ${inset}px;
      top: ${inset}px;
      width: min(34vw, 620px);
      max-height: 52vh;
    }
    /* One line across the top, above the moon. Everything that stacked in the
       corner card lays out along it instead: the title takes what it needs and
       the description takes the rest, both ending in an ellipsis rather than
       wrapping, because a bar that grows a second line is no longer a bar. */
    .hermes-bar {
      left: max(${inset}px, ${(sidePct * 100).toFixed(3)}vw);
      right: max(${inset}px, ${(sidePct * 100).toFixed(3)}vw);
      top: ${barTop}px;
      width: auto;
      height: ${barH}px;
      max-height: none;
      display: flex;
      align-items: center;
      gap: clamp(14px, 1.2vw, 26px);
      padding: 0 clamp(14px, 1.2vw, 24px);
      /* A shallow scrim, because the top of the frame is sometimes sky and
         sometimes the lit edge of the moon, and white text has to hold on both. */
      background: linear-gradient(to bottom,
        rgba(3, 6, 12, 0.62) 0%, rgba(3, 6, 12, 0.44) 62%, rgba(3, 6, 12, 0) 100%);
    }
    .hermes-bar .hermes-card {
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
      gap: clamp(10px, 0.9vw, 18px);
    }
    .hermes-bar .hermes-mark { flex-direction: row; align-items: center; gap: 9px; }
    .hermes-bar .hermes-icon {
      width: clamp(38px, 3vw, 62px);
      height: clamp(38px, 3vw, 62px);
    }
    .hermes-bar .hermes-card-body {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: clamp(10px, 0.9vw, 20px);
      flex: 1 1 auto;
      min-width: 0;
    }
    /* Who yields to whom when the bar is too narrow, which it always eventually
       is. The blurb goes first and can go to nothing — hence a zero basis, so it
       only ever takes space left over and can never be the thing that overflows.
       The title yields only after that and never below a few characters, because
       a listing with no title is not a listing. */
    .hermes-bar .hermes-event-title {
      /* Title first: this is the thing people scan for. */
      flex: 1 1 auto;
      max-width: 62%;
      min-width: 7ch;
      margin: 0;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      /* Caps set for a 4K panel rather than a 1080p one. At 1080p the vw term
         governs and these never bind, so raising them costs the tuned size
         nothing and stops the bar reading as fine print on a bigger screen. */
      font-size: clamp(20px, 1.6vw, 48px);
    }
    /* Kept inline with the title rather than in the flow, or the flex row would
       put the badge on its own line the moment the title got long. */
    .hermes-bar .hermes-adult { position: relative; top: -2px; }
    .hermes-bar .hermes-event-meta {
      /* Shrinks several times faster than the title, so the deficit is taken out
         of the tail of the location — which the map is showing anyway — instead of
         being split evenly and clipping the name of the thing. */
      flex: 0 8 auto;
      /* And capped outright, because some listings carry a whole sentence of
         address — "behind the inspection queue, Department of Mutant Vehicles" —
         whose natural width would otherwise set the terms for the entire bar. */
      max-width: 30%;
      min-width: 0;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: clamp(15px, 1vw, 30px);
    }
    .hermes-bar .hermes-event-desc {
      /* A small second line to finish the thought. Full width keeps it from
         fighting the title/meta row for horizontal space. */
      flex: 1 0 100%;
      min-width: 0;
      margin: -2px 0 0 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: normal;
      line-height: 1.18;
      font-size: clamp(12px, 0.82vw, 21px);
      opacity: 0.86;
    }
    .hermes-bar .hermes-kicker {
      order: 9;
      flex: 0 0 auto;
      margin: 0;
      white-space: nowrap;
    }
    /* Along the whole underside of the bar rather than under the text, which
       gives the strip a bottom edge and doubles as the clock. */
    .hermes-bar .hermes-progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      margin: 0;
    }
    .hermes-bar .hermes-card.hermes-out { transform: translateY(-6px); }
    .hermes-map-panel {
      left: ${inset}px;
      bottom: ${inset}px;
      top: auto;
      width: min(27vw, 460px);
      max-height: none;
      padding: 14px;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .hermes-rides-panel {
      right: ${inset}px;
      bottom: ${inset}px;
      top: auto;
      width: min(32vw, 560px);
      max-height: 42vh;
      padding: clamp(12px, 1vw, 18px);
      background: linear-gradient(to bottom, rgba(3, 6, 12, 0.58), rgba(3, 6, 12, 0.16));
      overflow: hidden;
    }
    .hermes-rides {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hermes-rides-qr {
      display: flex;
      align-items: center;
      gap: clamp(10px, 0.9vw, 18px);
    }
    .hermes-rides-qr img {
      width: clamp(108px, 8.5vw, 180px);
      height: clamp(108px, 8.5vw, 180px);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 0 18px rgba(0, 0, 0, 0.45);
      object-fit: contain;
      flex: 0 0 auto;
    }
    .hermes-rides-qr-text {
      min-width: 0;
      color: rgba(236, 247, 255, 0.9);
      font-size: clamp(14px, 0.95vw, 22px);
      line-height: 1.26;
    }
    .hermes-rides-qr-url {
      margin-top: 6px;
      opacity: 0.78;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: clamp(11px, 0.78vw, 17px);
    }
    .hermes-leave-panel {
      right: ${inset}px;
      bottom: calc(${inset}px + 43vh);
      top: auto;
      width: min(20vw, 340px);
      max-height: none;
      padding: 10px 12px;
      background: linear-gradient(to bottom, rgba(3, 6, 12, 0.68), rgba(3, 6, 12, 0.32));
      overflow: hidden;
    }
    .hermes-leave-kicker {
      margin: 0;
      color: rgba(122, 218, 255, 0.84);
      font-size: clamp(12px, 0.8vw, 18px);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .hermes-leave-clock {
      margin-top: 3px;
      color: #ffffff;
      font-size: clamp(19px, 1.35vw, 34px);
      font-weight: 750;
      line-height: 1.08;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 0 12px rgba(0, 214, 255, 0.42), 0 0 20px rgba(255, 0, 213, 0.22);
    }
    .hermes-leave-meta {
      margin-top: 4px;
      color: rgba(236, 247, 255, 0.74);
      font-size: clamp(11px, 0.78vw, 17px);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hermes-ride {
      border-top: 1px solid rgba(118, 157, 199, 0.28);
      padding-top: 6px;
    }
    .hermes-ride:first-child { border-top: 0; padding-top: 0; }
    .hermes-ride-head {
      color: #ffffff;
      font-size: clamp(16px, 1.05vw, 26px);
      line-height: 1.18;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hermes-ride-meta {
      margin-top: 2px;
      color: rgba(236, 247, 255, 0.78);
      font-size: clamp(13px, 0.86vw, 21px);
      line-height: 1.22;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
    /* The card fades and lifts on its way out, so a change of listing reads as a
       change rather than a flicker. Content is swapped while it is invisible. */
    .hermes-card {
      display: flex;
      gap: clamp(12px, 1vw, 20px);
      align-items: flex-start;
      transition: opacity 0.34s ease, transform 0.34s ease;
    }
    .hermes-card.hermes-out {
      opacity: 0;
      transform: translateY(-10px);
    }
    /* The picture and the mark stacked in their own column, so neither of them
       lands in the middle of a wrapping title. */
    .hermes-mark {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
    }
    .hermes-icon {
      width: clamp(44px, 3.4vw, 76px);
      height: clamp(44px, 3.4vw, 76px);
      object-fit: contain;
      image-rendering: auto;
      filter: drop-shadow(0 0 10px rgba(0, 214, 255, 0.45));
    }
    .hermes-card-body { min-width: 0; }
    /* The same mark the map draws for this listing, so the card and the map can
       be matched up without reading either of them twice. */
    .hermes-badge {
      width: clamp(24px, 1.8vw, 42px);
      height: clamp(24px, 1.8vw, 42px);
      filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.85));
    }
    .hermes-event-title {
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
      font-weight: 700;
      font-size: clamp(24px, 1.85vw, 40px);
      line-height: 1.12;
      color: #ffffff;
      text-shadow: 0 0 14px rgba(0, 214, 255, 0.52), 0 0 28px rgba(255, 0, 213, 0.24);
    }
    /* A thin clock along the bottom: how long this listing has left before the
       next one takes the panel. Without it a card that sits for ten seconds
       looks like a panel that has stopped updating. */
    .hermes-progress {
      margin-top: clamp(10px, 0.9vw, 16px);
      height: 2px;
      background: rgba(122, 218, 255, 0.16);
      overflow: hidden;
    }
    .hermes-progress > i {
      display: block;
      width: 0;
      height: 100%;
      background: rgba(122, 218, 255, 0.75);
      box-shadow: 0 0 8px rgba(122, 218, 255, 0.7);
    }
    /* Smaller than the old headline: it now sits above a 400px map in a corner
       rather than owning the whole top left of the screen. */
    .hermes-map-caption { margin-bottom: 9px; }
    .hermes-map-caption .hermes-place { font-size: clamp(22px, 1.7vw, 38px); }
    .hermes-map-caption .hermes-meta { margin-top: 5px; font-size: clamp(15px, 0.95vw, 21px); }
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
      margin-top: 6px;
      color: rgba(244, 250, 255, 0.76);
      font-size: clamp(17px, 1.1vw, 26px);
    }
    /* Clamped by lines rather than by height, so a long description ends on a
       word with an ellipsis instead of being sliced through the middle of one. */
    .hermes-event-desc {
      margin-top: 8px;
      color: rgba(244, 250, 255, 0.84);
      font-size: clamp(16px, 1.05vw, 24px);
      line-height: 1.32;
      display: -webkit-box;
      -webkit-line-clamp: 8;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hermes-stale {
      color: #ffcf73;
    }
    @media (max-width: 900px) {
      .hermes-panel {
        padding: 12px 13px;
        font-size: 16px;
      }
      .hermes-right {
        right: 10px;
        top: 10px;
        width: calc(58vw - 20px);
      }
      .hermes-bar {
        left: 10px;
        right: 10px;
        height: 62px;
        gap: 10px;
        padding: 0 10px;
      }
      .hermes-bar .hermes-event-title { font-size: 17px; }
      .hermes-bar .hermes-event-meta { font-size: 13px; }
      /* First thing to go when there is no room: the title and the time are the
         listing, the blurb is a courtesy. */
      .hermes-bar .hermes-event-desc { display: none; }
      .hermes-bar .hermes-icon { width: 34px; height: 34px; }
      .hermes-map-panel {
        left: 10px;
        bottom: 10px;
        width: calc(46vw - 20px);
      }
      .hermes-rides-panel {
        right: 10px;
        bottom: 10px;
        width: calc(54vw - 20px);
        max-height: 34vh;
      }
      .hermes-leave-panel {
        right: 10px;
        bottom: calc(10px + 34vh + 8px);
        width: calc(38vw - 20px);
      }
      .hermes-place { font-size: 22px; }
      .hermes-event-title { font-size: 20px; }
      .hermes-event-desc { font-size: 14px; -webkit-line-clamp: 4; }
      .hermes-icon { width: 38px; height: 38px; }
    }
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // Two corners, not three. The position used to have the whole top left to
  // itself, which spent a quarter of the screen on one line of text that the map
  // was already showing — so it moved to sit above the map it describes, and the
  // corner went back to being sky.
  const right = document.createElement("section");
  right.className = `hermes-panel ${asBar ? "hermes-bar" : "hermes-right"}`;
  right.setAttribute("aria-live", "polite");
  right.innerHTML = `
    <div class="hermes-kicker" data-hermes="count"></div>
    <div class="hermes-card" data-hermes="card">
      <div class="hermes-mark">
        <img class="hermes-icon" data-hermes="icon" alt="" hidden>
        <canvas class="hermes-badge" data-hermes="badge" width="64" height="64" aria-hidden="true"></canvas>
      </div>
      <div class="hermes-card-body">
        <div class="hermes-event-title">
          <span class="hermes-adult" data-hermes="adult" hidden>18+</span>
          <span data-hermes="title"></span>
        </div>
        <div class="hermes-event-meta" data-hermes="meta"></div>
        <div class="hermes-event-desc" data-hermes="desc"></div>
      </div>
    </div>
    <div class="hermes-progress" data-hermes="progress"><i></i></div>
  `;
  const card = {};
  for (const node of right.querySelectorAll("[data-hermes]")) card[node.dataset.hermes] = node;
  card.bar = card.progress.firstElementChild;

  const mapPanel = document.createElement("section");
  mapPanel.className = "hermes-panel hermes-map-panel";
  const mapCaption = document.createElement("div");
  mapCaption.className = "hermes-map-caption";
  const mapCanvas = document.createElement("canvas");
  mapCanvas.className = "hermes-map";
  mapCanvas.width = 320;
  mapCanvas.height = 320;
  mapPanel.append(mapCaption, mapCanvas);
  const ridesPanel = document.createElement("section");
  ridesPanel.className = "hermes-panel hermes-rides-panel";
  ridesPanel.setAttribute("aria-live", "polite");
  ridesPanel.innerHTML = `
    <div class="hermes-kicker" data-hermes="ridescount">Requests</div>
    <div class="hermes-rides" data-hermes="rides">
      <div class="hermes-ride">
        <div class="hermes-ride-meta">Waiting for requests…</div>
      </div>
    </div>
    <div class="hermes-rides-qr" data-hermes="rideqr" hidden>
      <img data-hermes="rideqrimg" alt="Pickup request QR code">
      <div class="hermes-rides-qr-text">
        <div>Scan to request pickup or DJ set</div>
        <div class="hermes-rides-qr-url" data-hermes="rideqrurl"></div>
      </div>
    </div>
  `;
  const ridesList = ridesPanel.querySelector("[data-hermes=\"rides\"]");
  const ridesCount = ridesPanel.querySelector("[data-hermes=\"ridescount\"]");
  const ridesQr = ridesPanel.querySelector("[data-hermes=\"rideqr\"]");
  const ridesQrImg = ridesPanel.querySelector("[data-hermes=\"rideqrimg\"]");
  const ridesQrUrl = ridesPanel.querySelector("[data-hermes=\"rideqrurl\"]");
  const leavePanel = document.createElement("section");
  leavePanel.className = "hermes-panel hermes-leave-panel";
  leavePanel.innerHTML = `
    <div class="hermes-leave-kicker">Leave Timer</div>
    <div class="hermes-leave-clock" data-hermes="leaveclock">—</div>
    <div class="hermes-leave-meta" data-hermes="leavemeta">Press T to set</div>
  `;
  const leaveClock = leavePanel.querySelector("[data-hermes=\"leaveclock\"]");
  const leaveMeta = leavePanel.querySelector("[data-hermes=\"leavemeta\"]");
  document.body.append(right, mapPanel, ridesPanel, leavePanel);

  let visible = true;
  let lastState = null;
  let pickupRequests = [];
  let nowPlayingRequest = null;
  let ridesQrSource = "";
  let ridesQrTarget = "";
  let leaveAtMs = Number(localStorage.getItem("hermes-leave-at") || 0);
  if (!Number.isFinite(leaveAtMs) || leaveAtMs <= Date.now()) leaveAtMs = 0;
  const track = [];
  // Two horizons, because a snail trail and a log of the night are different
  // wants. The fade is the slime: brightest and fattest at the head, thinning
  // back over half an hour so you can read which way you came. Past that a point
  // does not vanish, it settles to a faint thread and stays for the session, so
  // the map also answers where you have been all night. ?hermestrail= sets the
  // fade in minutes, ?hermeslog= how many hours are kept drawn.
  const trailFadeMs = Math.max(1, Number(params.get("hermestrail")) || 30) * 60 * 1000;
  const trailKeepMs = Math.max(1, Number(params.get("hermeslog")) || 12) * 3600 * 1000;
  const trailFloor = 0.11;
  const trailMaxPoints = 4000;
  let trailSeeded = false;
  let trailSeeding = false;
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

  // Icons and marks now live in js/hermes-marks.js, because the moon's aerial map
  // needs the same answers as this one and a listing that is a pink pentagon here
  // and a green star there is two listings to anyone watching. Loaded before this
  // script, so it is simply present.
  const marks = window.HermesMarks;

  marks.ready.then((got) => {
    // The card is already up by now, so it is refilled to pick the picture up.
    if (got && lastState) showEvent(eventIndex, true);
  });

  // The gif goes on the card and nowhere else *on this map*. Stamped on a map
  // this small it was mush: fourteen pixels of hollow nineties line art on a
  // street grid reads as a smudge, so the corner map carries coloured polygons
  // and the card carries the picture at a size worth having. The aerial map fills
  // the moon and has the room, so it does show them.
  function iconSrc(event) {
    return marks.iconSrc(event);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function since(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 90) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function meters(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n < 1000 ? `${Math.round(n)}m` : `${(n / 1000).toFixed(1)}km`;
  }

  function hhmm(date) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function formatCountdown(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function parseLeaveInput(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return { clear: true };
    if (["off", "clear", "none", "0"].includes(value)) return { clear: true };

    // Duration forms: "45m", "1h20m", "90s", "2h".
    const token = /(\d+)\s*([smhd])/g;
    let total = 0;
    let seen = 0;
    let m;
    while ((m = token.exec(value))) {
      const n = Number(m[1]);
      const unit = m[2];
      total += unit === "d" ? n * 86400000
        : unit === "h" ? n * 3600000
          : unit === "m" ? n * 60000
            : n * 1000;
      seen += m[0].length;
    }
    if (total > 0 && seen >= value.replace(/\s+/g, "").length) {
      return { at: Date.now() + total };
    }
    if (/^\d+$/.test(value)) return { at: Date.now() + Number(value) * 60000 };

    // Clock forms: "23:10", "11:45pm", "7am", "7:30 pm".
    const clock = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(value.replace(/\s+/g, ""));
    if (clock) {
      let hour = Number(clock[1]);
      const minute = Number(clock[2] || 0);
      const ap = (clock[3] || "").toLowerCase();
      if (minute > 59) return { error: "minutes must be 00-59" };
      if (ap) {
        if (hour < 1 || hour > 12) return { error: "hour must be 1-12 for am/pm" };
        if (hour === 12) hour = 0;
        if (ap === "pm") hour += 12;
      } else if (hour > 23) return { error: "hour must be 0-23" };
      const now = new Date();
      const at = new Date(now);
      at.setHours(hour, minute, 0, 0);
      if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
      return { at: at.getTime() };
    }

    // Accept a full date/time parse as a final fallback.
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > Date.now()) return { at: parsed };
    return { error: "Use 45m, 1h20m, 23:10, or 11:45pm" };
  }

  function renderLeaveTimer() {
    if (!leaveClock || !leaveMeta) return;
    if (!leaveAtMs) {
      leavePanel.hidden = true;
      leaveClock.textContent = "—";
      leaveMeta.textContent = "Press T to set";
      return;
    }
    leavePanel.hidden = false;
    const left = leaveAtMs - Date.now();
    if (left <= 0) {
      leaveAtMs = 0;
      localStorage.removeItem("hermes-leave-at");
      leavePanel.hidden = true;
      leaveClock.textContent = "—";
      leaveMeta.textContent = "Press T to set";
      return;
    }
    leaveClock.textContent = formatCountdown(left);
    leaveMeta.textContent = `Until ${hhmm(new Date(leaveAtMs))} • press T to change`;
  }

  // How many listings the map will carry at once. The panel cycles through the
  // same set, so this is also how long the rotation is.
  const MAP_MARKS = 10;

  const eventMarker = (event, position = null) => marks.marker(event, position);
  const drawEventMarker = (ctx, point, marker, size) =>
    marks.drawMarker(ctx, point, marker, size);

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
    trimTrack(now);
  }

  function trimTrack(now) {
    while (track.length && now - track[0].t > trailKeepMs) track.shift();
    if (track.length > trailMaxPoints) track.splice(0, track.length - trailMaxPoints);
  }

  // The night so far, from the server's log, so a reopened kiosk draws the trail
  // it already earned rather than starting again from wherever it was relaunched.
  async function seedTrack() {
    if (trailSeeded || trailSeeding) return;
    trailSeeding = true;
    try {
      const minutes = Math.round(trailKeepMs / 60000);
      const resp = await fetch(`${apiBase}/api/hermes/track?minutes=${minutes}&limit=${trailMaxPoints}`, { cache: "no-store" });
      if (!resp.ok) return;
      const body = await resp.json();
      const logged = (Array.isArray(body.points) ? body.points : [])
        .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), t: Date.parse(p.t) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t));
      if (!logged.length) {
        trailSeeded = true;
        return;
      }
      // A live fix may well have pushed a point while this was in flight, so the
      // two are merged in time order rather than one of them winning.
      const merged = [...logged, ...track].sort((a, b) => a.t - b.t);
      track.length = 0;
      track.push(...merged);
      trimTrack(Date.now());
      trailSeeded = true;
      if (lastState) drawMap(lastState);
    } catch {
      // No history is not an error. The trail simply starts here.
    } finally {
      trailSeeding = false;
    }
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

  // Where the map image sits inside the canvas, letterboxed to its own ratio.
  // The base map and every marker go through this, so they cannot drift apart.
  function imageRect(width, height) {
    const meta = mapState.meta;
    const imgRatio = meta.width / meta.height;
    if (width / height > imgRatio) {
      const drawW = height * imgRatio;
      return { dx: (width - drawW) / 2, dy: 0, drawW, drawH: height };
    }
    const drawH = width / imgRatio;
    return { dx: 0, dy: (height - drawH) / 2, drawW: width, drawH };
  }

  // A fix's place on the map, using the transform the map was drawn with rather
  // than one derived here. build-hermes-map.mjs renders the streets at a known
  // scale and offset into a 1400x900 image and writes both into the metadata,
  // so a point's pixel is offset + (metres - bounds.min) * scale and nothing
  // else. This used to re-fit the bounds onto the canvas instead, which ignored
  // the wide empty margins the image carries around the city — every marker
  // came out pushed away from the centre, far enough at the edges to stand a
  // fix off the streets the panel said it was standing on.
  function project(lat, lon, width, height) {
    const meta = mapState.meta;
    if (!meta || !meta.scale || !meta.offset || !meta.bounds) return null;
    const p = rotated(lon, lat);
    const ix = meta.offset.x + (p.x - meta.bounds.minX) * meta.scale;
    const iy = meta.offset.y + (meta.bounds.maxY - p.y) * meta.scale;
    const r = imageRect(width, height);
    return {
      x: r.dx + (ix / meta.width) * r.drawW,
      y: r.dy + (iy / meta.height) * r.drawH
    };
  }

  function drawBaseMap(ctx, width, height, dpr) {
    if (!mapState.imageReady || !mapState.loaded) {
      ctx.fillStyle = "rgba(244,250,255,0.72)";
      ctx.font = `${10 * dpr}px SF Mono, Menlo, monospace`;
      ctx.fillText("LOADING PLAYA MAP", 10 * dpr, 18 * dpr);
      return;
    }
    const r = imageRect(width, height);
    ctx.drawImage(mapImage, r.dx, r.dy, r.drawW, r.drawH);
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
        const a = Math.max(0, 1 - (now - track[i].t) / trailFadeMs);
        const p0 = project(track[i - 1].lat, track[i - 1].lon, width, height);
        const p1 = project(track[i].lat, track[i].lon, width, height);
        if (!p0 || !p1) continue;
        ctx.strokeStyle = `rgba(255, 92, 214, ${trailFloor + a * 0.43})`;
        ctx.lineWidth = (0.9 + a * 2.3) * dpr;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    const fix = state.fix || {};
    const lat = Number(fix.lat);
    const lon = Number(fix.lon);
    const here = Number.isFinite(lat) && Number.isFinite(lon) ? project(lat, lon, width, height) : null;
    if (here) {
      let heading = null;
      for (let i = track.length - 2; i >= 0; i--) {
        // Which way you are pointing, not which way you once went. Now that the
        // trail keeps hours of history, walking back far enough would find a
        // bearing from earlier in the night and draw the arrow along it.
        if (now - track[i].t > 120000) break;
        const prev = project(track[i].lat, track[i].lon, width, height);
        if (!prev) continue;
        const dx = here.x - prev.x;
        const dy = here.y - prev.y;
        if (Math.hypot(dx, dy) > 3 * dpr) {
          heading = Math.atan2(dy, dx);
          break;
        }
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

    // Events last, so they sit over the position mark rather than under it. The
    // logo is drawn additively and is wider than a marker, so anything happening
    // near you — which is everything the panel bothers to list — was being wiped
    // out by the very marker meant to say you were close to it.
    //
    // Several listings share one corner, and three markers on one pixel read as
    // one smudge, so a shared point is fanned into a ring the size of a marker.
    // Every listing gets its icon on the map, so the map is the legend and the
    // panel is the explanation walking through it. Capped at ten: past that the
    // city disappears under them, and the rotation takes longer to come round
    // than the events last.
    const activities = (Array.isArray(state.activities) ? state.activities : []).slice(0, MAP_MARKS);
    const size = Math.max(11, Math.min(26, width * 0.038));
    const placed = activities
      .map((event, index) => {
        const at = Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lon))
          ? project(Number(event.lat), Number(event.lon), width, height)
          : null;
        return at ? { at, event, marker: eventMarker(event, index), current: eventKeyOf(event) === eventKey } : null;
      })
      .filter(Boolean);
    const crowd = new Map();
    for (const item of placed) {
      const key = `${Math.round(item.at.x / size)},${Math.round(item.at.y / size)}`;
      if (!crowd.has(key)) crowd.set(key, []);
      crowd.get(key).push(item);
    }
    let current = null;
    for (const group of crowd.values()) {
      group.forEach((item, i) => {
        if (group.length > 1) {
          const turn = (i / group.length) * Math.PI * 2 - Math.PI / 2;
          const spread = size * 0.9;
          item.at = { x: item.at.x + Math.cos(turn) * spread, y: item.at.y + Math.sin(turn) * spread };
        }
        // The current one is held back and drawn last, over the top of the rest.
        if (item.current) current = item;
        else drawEventMarker(ctx, item.at, item.marker, size);
      });
    }

    // The one the panel is showing: same colour and shape, half again as big,
    // inside a white ring. Otherwise the map is a scatter of equal marks while
    // the panel talks about one of them, with no way to tell which.
    if (current) {
      ctx.beginPath();
      ctx.arc(current.at.x, current.at.y, size * 1.1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = Math.max(1.2, size * 0.1);
      ctx.stroke();
      drawEventMarker(ctx, current.at, current.marker, size * 1.5);
    }

    // Keep Hermes unmistakable: draw the logo last, after event markers.
    if (here) {
      if (hermesLogo.complete && hermesLogo.naturalWidth) {
        const logoSize = Math.max(34, Math.min(64, width * 0.085));
        ctx.save();
        ctx.beginPath();
        ctx.arc(here.x, here.y, logoSize * 0.54, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(hermesLogo, here.x - logoSize / 2, here.y - logoSize / 2, logoSize, logoSize);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(here.x, here.y, logoSize * 0.54, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(8, 14, 22, 0.95)";
        ctx.lineWidth = Math.max(1.4, size * 0.1);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(here.x, here.y, Math.max(3.5, size * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
        ctx.strokeStyle = "rgba(8, 14, 22, 0.95)";
        ctx.lineWidth = Math.max(1, size * 0.09);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(244, 250, 255, 0.72)";
    ctx.font = `${10 * dpr}px SF Mono, Menlo, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // Along the bottom, because the top of the map is deep playa: the DMZ sits
    // right on the upper edge and its markers were landing on top of the label.
    // Says what the trail amounts to as well as naming it — without a distance
    // and a span, a faint thread on a small map could as easily be GPS noise as
    // a night's driving.
    ctx.fillText(`PLAYA TRACK${trackSummary()}`, 10 * dpr, height - 8 * dpr);
  }

  function trackSummary() {
    if (track.length < 2) return "";
    let metres = 0;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1];
      const b = track[i];
      metres += Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 84500);
    }
    const span = (track[track.length - 1].t - track[0].t) / 1000;
    return ` · ${meters(metres)} · ${since(span)}`;
  }

  function render(state) {
    lastState = state;
    // Single shared truth for any other in-page view (moon aerial, debug tools):
    // publish the exact state object this overlay is rendering right now.
    try {
      window.__hermesState = state;
      window.dispatchEvent(new CustomEvent("hermes-state", { detail: state }));
    } catch {
      // Cross-context oddities should not block rendering.
    }
    addTrackPoint(state.fix || {});
    renderPosition(state);
    renderEvents(state);
    drawMap(state);
    renderRides();
  }

  function clock(iso) {
    const t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return "?";
    return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function ageFrom(iso) {
    const t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return "?";
    return since(Math.max(0, Math.round((Date.now() - t) / 1000))) + " ago";
  }

  function renderRides() {
    if (!ridesList || !ridesQr) return;
    const list = Array.isArray(pickupRequests) ? pickupRequests : [];
    if (ridesCount) {
      if (nowPlayingRequest) {
        const who = String(nowPlayingRequest.who || "someone");
        const intention = String(nowPlayingRequest.intention || "").trim();
        ridesCount.textContent = intention
          ? `Requests · ${list.length} active · now: ${who} (${intention})`
          : `Requests · ${list.length} active · now: ${who}`;
      } else {
        ridesCount.textContent = `Requests · ${list.length} active`;
      }
    }
    // Per show request, keep this panel simple: always-on QR + active count.
    ridesList.hidden = true;
    ridesQr.hidden = false;
    if (ridesQrUrl) ridesQrUrl.textContent = ridesQrTarget || "loading link…";
  }

  function syncRideQr() {
    if (!ridesQrImg) return;
    const base = resolved ? apiBase : "";
    ridesQrTarget = QR_TARGET_URL;
    const source = `${base}/api/hermes/pickup-qr.svg?mode=public&url=${encodeURIComponent(ridesQrTarget)}`;
    if (source !== ridesQrSource) {
      ridesQrSource = source;
      ridesQrImg.src = source;
    }
    if (ridesQrUrl) ridesQrUrl.textContent = ridesQrTarget.replace(/^https?:\/\//, "");
  }

  function renderPosition(state) {
    const fix = state.fix || {};
    // Age of the position, not age of the conversation. The server keeps the
    // satellites' own timestamp when the device reports one, and a handheld on
    // USB will happily answer every few seconds with a fix from hours ago — so
    // counting from updatedAt showed "4s old" over a dot that had not moved
    // since the afternoon. Counted here rather than taken as a number so it
    // still ticks up between fixes.
    const fixedAt = Date.parse(fix.gpsTimestamp || "");
    const updatedAt = Date.parse(state.updatedAt || "");
    const from = Number.isFinite(fixedAt) ? fixedAt : updatedAt;
    const age = Number.isFinite(from)
      ? Math.max(0, Math.floor((Date.now() - from) / 1000))
      : Number(fix.ageSec);
    // A Garmin's track log only gains a point when the unit moves, so its last
    // point is not a stale fix — it is the last time the car went anywhere. A
    // parked car reports the same four-hour-old position all night and is telling
    // the truth: "last moved 4h ago" is that same number said honestly, where
    // "fix 4h old" reads as a broken feed and sends you looking for the fault.
    // Only a live position file can be stale in the sense of untrustworthy.
    // Match on the log, not on the cable: the Alpha serves its live position over
    // MTP too, and that one really is stale when it is old.
    const fromLog = /track/.test(String(fix.source || ""));
    const heard = Number(fix.heardSec);
    const contact = Number.isFinite(heard) ? heard : age;
    // Losing the device is the failure worth colouring: the watcher has stopped,
    // or the cable is out, and the dot is now fiction of unknown age.
    const lostContact = Number.isFinite(contact) && contact > 30;
    const stale = lostContact || (!fromLog && Number.isFinite(age) && age > 30);
    const ageText = lostContact
      ? `no contact for ${since(contact)}`
      : !Number.isFinite(age) ? "age unknown"
        : fromLog ? `last moved ${since(age)} ago`
          : Number.isFinite(fixedAt) ? `fix ${since(age)} old`
            : `updated ${since(age)} ago`;
    mapCaption.innerHTML = `
      <div class="hermes-kicker">Hermes update</div>
      <div class="hermes-place ${stale ? "hermes-stale" : ""}">${esc(ageText)}</div>
    `;
  }

  // One listing at a time, cycled. Three at once meant the third was always
  // clipped mid-sentence and none of them had room for an icon, so the panel now
  // deals through the whole hand instead of showing the top of it.
  const holdMs = Math.max(2, Number(params.get("hermeshold")) || 10) * 1000;
  const ART_LOG_COUNT = Math.max(0, Number(params.get("hermesartlog")) || 3);
  const ART_DEEP_MIN_M = Math.max(200, Number(params.get("hermesdeepmin")) || 1100);
  const MAN_LAT = 40.783247448000054;
  const MAN_LON = -119.20788409599999;
  let shown = [];
  let eventIndex = 0;
  let eventKey = "";
  let holdTimer = null;

  const eventKeyOf = (event) =>
    `${event.kind || ""}|${event.uid || ""}|${event.title || ""}|${event.start || event.timeLabel || ""}`;

  function metersBetween(aLat, aLon, bLat, bLon) {
    const latM = (bLat - aLat) * 111320;
    const lonM = (bLon - aLon) * 111320 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
    return Math.hypot(latM, lonM);
  }

  function logArtEntries(state) {
    if (!state || !Array.isArray(state.art) || ART_LOG_COUNT <= 0) return [];
    return state.art
      .filter((art) => Number.isFinite(Number(art.lat)) && Number.isFinite(Number(art.lon)))
      .map((art) => {
        const lat = Number(art.lat);
        const lon = Number(art.lon);
        const fromManM = metersBetween(MAN_LAT, MAN_LON, lat, lon);
        return {
          kind: "art",
          uid: art.uid || "",
          title: art.title || "Deep playa art",
          location: art.location || "deep playa",
          distanceM: Number.isFinite(Number(art.distanceM)) ? Number(art.distanceM) : NaN,
          timeLabel: "deep playa art",
          description: [art.location ? `Artist/base: ${art.location}` : "", `~${meters(fromManM)} from the Man`]
            .filter(Boolean).join(" • "),
          adult: false,
          _fromManM: fromManM
        };
      })
      .filter((art) => art._fromManM >= ART_DEEP_MIN_M)
      .sort((a, b) => Number(a.distanceM) - Number(b.distanceM))
      .slice(0, ART_LOG_COUNT);
  }

  function renderNowPlayingCard(request, nearbyCount = 0) {
    const who = String(request && request.who || "someone").trim() || "someone";
    const intention = String(request && request.intention || "").trim();
    const place = String(request && request.place || "").trim();
    const when = String(request && request.pickupWhen || "").trim();
    const note = String(request && request.note || "").trim();
    const parts = [];
    if (intention) parts.push(intention);
    if (place) parts.push(place);
    if (when) parts.push(`at ${when}`);
    if (note) parts.push(note);

    shown = [];
    eventKey = "now-playing";
    card.card.hidden = false;
    card.progress.hidden = true;
    card.icon.hidden = true;
    card.adult.hidden = true;
    card.title.textContent = who;
    card.meta.textContent = "Now playing";
    card.desc.textContent = parts.length ? parts.join(" • ") : "Live set";
    card.count.textContent = nearbyCount > 0
      ? `Now playing • ${nearbyCount} nearby activities/art`
      : "Now playing";
    drawBadge(eventMarker({ kind: "music", title: "Now Playing" }, 0));
    if (lastState) drawMap(lastState);
  }

  function renderEvents(state) {
    const nearby = Array.isArray(state.activities) ? state.activities : [];
    const art = logArtEntries(state);
    shown = [...nearby, ...art];
    if (SHOW_NOW_PLAYING_IN_EVENT_CARD && nowPlayingRequest) {
      renderNowPlayingCard(nowPlayingRequest, shown.length);
      pace();
      return;
    }
    if (!shown.length) {
      card.card.hidden = true;
      card.progress.hidden = true;
      card.count.textContent = "No nearby activities or art loaded";
      eventKey = "";
      pace();
      return;
    }
    card.card.hidden = false;
    // Whatever is on screen stays on screen if it is still listed. The state
    // refreshes every second or two, and re-deriving the index from scratch each
    // time would drag the panel back to the first card and never show the rest.
    const at = shown.findIndex((event) => eventKeyOf(event) === eventKey);
    if (at >= 0) {
      eventIndex = at;
      updateCount();
      updateMeta(shown[at]);
    } else {
      showEvent(eventKey ? eventIndex : 0, true);
    }
    pace();
  }

  function updateCount() {
    const artCount = shown.filter((e) => e && e.kind === "art").length;
    const label = artCount ? `Nearby + art · ${artCount} art` : "Nearby now";
    card.count.textContent = shown.length > 1
      ? `${label} · ${eventIndex + 1} of ${shown.length}`
      : label;
  }

  function eventWhere(event) {
    const place = String((event && event.place) || "").trim();
    if (place) return place;
    const location = String((event && event.location) || "").trim();
    if (!location) return "location unknown";
    // A camp name is useful in the card title and description; in the status
    // line we need the actionable bit — the address — and that is usually the
    // tail after the last comma.
    const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : location;
  }

  function updateMeta(event) {
    card.meta.textContent = [
      eventWhere(event),
      meters(event.distanceM),
      event.timeLabel || "time unknown"
    ].filter(Boolean).join(" • ");
  }

  function fillCard(event) {
    const src = iconSrc(event);
    // Only touched when it actually changes: reassigning the same src restarts
    // the animation, and the panel would twitch once a second.
    if (src) {
      if (card.icon.getAttribute("src") !== src) card.icon.src = src;
      card.icon.hidden = false;
    } else {
      card.icon.hidden = true;
    }
    card.title.textContent = event.title || "Untitled activity";
    card.adult.hidden = !event.adult;
    card.desc.textContent = event.description || "";
    drawBadge(eventMarker(event, eventIndex));
    updateCount();
    updateMeta(event);
    // The map has to be told: it draws this listing bigger and ringed, and until
    // it redraws the emphasis is still sitting on the previous card's marker.
    if (lastState) drawMap(lastState);
  }

  // Drawn with the very function the map uses, so the two cannot drift apart.
  function drawBadge(marker) {
    const ctx = card.badge.getContext("2d");
    const side = card.badge.width;
    ctx.clearRect(0, 0, side, side);
    drawEventMarker(ctx, { x: side / 2, y: side / 2 }, marker, side * 0.84);
  }

  function showEvent(index, immediate) {
    if (!shown.length) return;
    eventIndex = ((index % shown.length) + shown.length) % shown.length;
    eventKey = eventKeyOf(shown[eventIndex]);
    if (immediate) {
      fillCard(shown[eventIndex]);
      restartProgress();
      return;
    }
    // Swapped while invisible, so the card changes rather than flickers. The wait
    // is the CSS transition; shortening one without the other shows the seam.
    card.card.classList.add("hermes-out");
    setTimeout(() => {
      fillCard(shown[eventIndex] || shown[0]);
      card.card.classList.remove("hermes-out");
      restartProgress();
    }, 340);
  }

  function restartProgress() {
    if (shown.length < 2) {
      card.progress.hidden = true;
      return;
    }
    card.progress.hidden = false;
    card.bar.style.transition = "none";
    card.bar.style.width = "0%";
    void card.bar.offsetWidth; // commit the reset before animating away from it
    card.bar.style.transition = `width ${holdMs}ms linear`;
    card.bar.style.width = "100%";
  }

  function pace() {
    if (shown.length < 2) {
      if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
      card.progress.hidden = true;
      return;
    }
    if (holdTimer) return;
    holdTimer = setInterval(() => {
      // Nothing to advance past if nobody is looking, and cycling while hidden
      // would land on an arbitrary card the moment the panels come back.
      if (!visible || document.hidden) return;
      showEvent(eventIndex + 1);
    }, holdMs);
  }

  function setVisible(next) {
    visible = next;
    right.classList.toggle("hermes-hidden", !visible);
    mapPanel.classList.toggle("hermes-hidden", !visible);
    ridesPanel.classList.toggle("hermes-hidden", !visible);
    leavePanel.classList.toggle("hermes-hidden", !visible);
    if (visible) restartProgress();
  }

  window.addEventListener("keydown", (event) => {
    const key = event.key ? event.key.toLowerCase() : "";
    if (key === "h") {
      setVisible(!visible);
      return;
    }
    if (key !== "t") return;
    const seed = leaveAtMs > Date.now()
      ? `${Math.max(1, Math.round((leaveAtMs - Date.now()) / 60000))}m`
      : "";
    const asked = window.prompt(
      "Leave timer: enter duration or time (e.g. 45m, 1h20m, 23:10, 11:45pm). Enter 'off' to clear.",
      seed
    );
    if (asked == null) return;
    const parsed = parseLeaveInput(asked);
    if (parsed.error) {
      window.alert(`Could not read timer: ${parsed.error}`);
      return;
    }
    if (parsed.clear) {
      leaveAtMs = 0;
      localStorage.removeItem("hermes-leave-at");
      renderLeaveTimer();
      return;
    }
    leaveAtMs = parsed.at;
    localStorage.setItem("hermes-leave-at", String(leaveAtMs));
    renderLeaveTimer();
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
        syncRideQr();
        render(next);
        refreshPickupRequests();
        seedTrack();
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

  async function refreshPickupRequests() {
    if (!resolved) return;
    try {
      const resp = await fetch(apiBase + "/api/hermes/pickup", { cache: "no-store" });
      if (!resp.ok) return;
      const body = await resp.json();
      pickupRequests = Array.isArray(body.requests) ? body.requests : [];
      nowPlayingRequest = body && body.nowPlaying ? body.nowPlaying : null;
      renderRides();
    } catch {
      // Keep the last seen requests if this refresh fails.
    }
  }

  if (!("EventSource" in window)) setInterval(poll, 5000);
  setInterval(refreshPickupRequests, 7000);
  // Keep the displayed age honest between Alpha watcher updates.
  setInterval(() => {
    if (lastState) render(lastState);
    else renderRides();
    renderLeaveTimer();
  }, 1000);
  renderLeaveTimer();
  syncRideQr();
  loadMapMeta();
  poll();   // finds the API, then opens the event stream on whatever answered
})();
