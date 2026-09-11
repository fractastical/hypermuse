// How a listing gets a picture and a mark, in one place, because two maps now
// need the same answer: the overlay's corner map and the moon's aerial view.
// A listing that is a pink pentagon on one and a green star on the other is two
// listings as far as anyone watching is concerned.
//
// Sizes decide treatment. The corner map gets coloured polygons — the overlay
// learned the hard way that fourteen pixels of hollow nineties line art on a
// street grid reads as a smudge. The aerial map fills the moon, so a mark there
// has room for the actual icon, and that is what drawPin is for.
(function () {
  const params = new URLSearchParams(location.search);
  const ICON_BASE = "/hermes/icons/";
  // Geometry-first by default for readability at distance; gifs can be brought
  // back with ?hermesgifs=1 when wanted.
  const USE_GIFS = params.get("hermesgifs") === "1";

  // A slot is a meaning rather than a picture, so the listing's own words choose
  // it: first rule that matches wins, which is why the specific ones are above
  // the general. Matched against the title and the address only — descriptions
  // mention half the playa and would match anything.
  const RULES = [
    [/messages?|dispatch|mail|letter|postal|deliver|courier/i, "message"],
    [/morphogen|cellular|\bcells?\b|mitochond|dna|genome|microb|biolog/i, "cells"],
    [/stargate|portal|deep playa|\bdmz\b|alien|\bufo\b|space|cosmic|ontolog|galact/i, "portal"],
    [/casino|\bbets?\b|wager|poker|gambl|hypothes|\bodds\b|probabil/i, "chance"],
    [/villain|debutante|\bball\b|mask|monologue|final boss/i, "mask"],
    [/question|salon|epistem|\btruth\b|doubt|certaint|oracle/i, "question"],
    [/poem|poetry|manuscript|\bskin\b|\bink\b|librar|\bread(ing)?\b|\bwrit/i, "poem"],
    [/\bmoon\b|lunar|sunrise|sunset|\bdawn\b|\bdusk\b|solstice|eclipse/i, "moon"],
    [/temple/i, "temple"],
    [/church|confess|absolution|shrine|prayer|ritual|sanctuar|seance|summon|spirit/i, "shrine"],
    [/choir|opera|\bsing|vocal|\bsong|hymn|chant|orchestr|violin/i, "music"],
    [/dance|\bbass\b|\bbeat|\bdj\b|sound|disco|rave|trance|techno|movement/i, "dance"],
    [/\bthe man\b|burn|\bfire\b|flame|effigy/i, "man"],
    [/dating|romance|\bkiss|\blove\b|consent|cuddl|tender|intimac/i, "heart"],
    [/coffee|diner|\btea\b|\bfood\b|kitchen|breakfast|pancake|serve/i, "food"],
    [/reef|\bocean|aquatic|\bwater|mermaid|\bfish\b|coral/i, "water"],
    [/\bart\b|installation|sculpture|art car|mutant vehicle|gallery/i, "art"]
  ];

  // Ten marks that differ in both colour and shape. Colour alone is a guess on a
  // small map — two pinks in different corners of the city read as the same
  // listing — and shape alone is hard on a dusty screen at arm's length, so each
  // listing gets its own of both. Ten because that is how many the map carries;
  // the index does the work, so a mark never collides with itself.
  const COLORS = [
    "#ff5c92", "#ffd45c", "#65e6ff", "#a9ff6b", "#c28cff",
    "#ff8f4a", "#3fe0b0", "#ff70e0", "#8fb6ff", "#e2555a"
  ];
  const SHAPES = 10;

  const slots = new Set();
  const images = new Map();
  let haveIcons = false;

  // Resolves either way. No icon set is not a failure — the card and the pins
  // simply fall back to the polygon, and npm run hermes:icons builds one.
  const ready = USE_GIFS
    ? fetch(ICON_BASE + "manifest.json", { cache: "no-store" })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((body) => {
        if (body && body.icons) {
          for (const slot of Object.keys(body.icons)) slots.add(slot);
          haveIcons = slots.size > 0;
        }
        return haveIcons;
      })
      .catch(() => false)
    : Promise.resolve(false);

  // Title first, address second. A listing's own name is what it is about, while
  // its address is where it happens to be — and on this playa the addresses are
  // jokes that mention everything: "Hermes, boarding at Bisous" put the courier's
  // ankh on a dance party, because the word Hermes is in half the city.
  function slotFor(event) {
    const title = String((event && event.title) || "");
    const everything = `${title} ${(event && event.location) || ""} ${(event && event.place) || ""}`;
    for (const text of [title, everything]) {
      for (const [pattern, slot] of RULES) {
        if (pattern.test(text) && slots.has(slot)) return slot;
      }
    }
    return slots.has("default") ? "default" : "";
  }

  function iconSrc(event) {
    if (!USE_GIFS) return "";
    const slot = haveIcons ? slotFor(event) : "";
    return slot ? `${ICON_BASE}${slot}.gif` : "";
  }

  // Decoded once per slot and kept. Left detached from the document on purpose:
  // these are animated gifs and the browser still runs them, so drawing one to a
  // canvas picks up whichever frame is showing and the pins animate for free.
  function icon(event) {
    if (!USE_GIFS) return null;
    const slot = haveIcons ? slotFor(event) : "";
    if (!slot) return null;
    if (!images.has(slot)) {
      const img = new Image();
      img.src = `${ICON_BASE}${slot}.gif`;
      images.set(slot, img);
    }
    const img = images.get(slot);
    return img.complete && img.naturalWidth ? img : null;
  }

  function marker(event, position = null) {
    if (Number.isInteger(position)) {
      return { color: COLORS[position % COLORS.length], shape: position % SHAPES };
    }
    // Unplaced in the ranking: fall back to the title, so at least the same
    // listing keeps the same mark from one refresh to the next.
    const text = String((event && (event.title || event.location)) || "event");
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const index = Math.abs(hash) % COLORS.length;
    return { color: COLORS[index], shape: index % SHAPES };
  }

  // Vertices of a regular polygon, first one at the top so a triangle points up
  // rather than landing wherever the maths left it.
  function polygon(ctx, sides, r, turn = 0) {
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + turn + (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function star(ctx, points, r, inner = 0.46) {
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
      const radius = i % 2 ? r * inner : r;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function cross(ctx, r) {
    const a = r * 0.36;
    const b = r * 0.95;
    const pts = [
      [-a, -b], [a, -b], [a, -a], [b, -a], [b, a],
      [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]
    ];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function drawMarker(ctx, point, mark, size) {
    const r = size * 0.5;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = mark.color;
    // A dark outline is what makes these readable at all: the streets are drawn
    // in near-white and open playa is black, so a mark crossing between them
    // needs its own edge or half of it disappears into whichever it is over.
    ctx.strokeStyle = "rgba(8, 14, 22, 0.95)";
    ctx.lineWidth = Math.max(1.4, size * 0.13);
    ctx.beginPath();
    switch (mark.shape) {
      case 0: ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); break;
      case 1: polygon(ctx, 4, r); break;                       // diamond
      case 2: polygon(ctx, 3, r * 1.06); break;                // triangle up
      case 3: polygon(ctx, 4, r, Math.PI / 4); break;          // square
      case 4: polygon(ctx, 5, r); break;                       // pentagon
      case 5: polygon(ctx, 6, r, Math.PI / 6); break;          // hexagon
      case 6: star(ctx, 5, r * 1.08); break;
      case 7: polygon(ctx, 3, r * 1.06, Math.PI); break;       // triangle down
      case 8: cross(ctx, r); break;
      default: star(ctx, 6, r * 1.04, 0.55); break;
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // The big-map treatment: the icon on a dark plate with the listing's own colour
  // round it. The plate is not decoration — the icons are hollow line art, and
  // over near-white street strokes a hollow icon has nothing to be hollow
  // against. The ring is what ties this pin to the same listing's polygon on the
  // corner map and its badge on the event bar, so the colour is the join.
  //
  // Falls back to the polygon when the gif has not decoded yet, so a pin is never
  // simply missing while a map is up.
  function drawPin(ctx, point, mark, event, size, alpha = 1) {
    const img = icon(event);
    if (!img) {
      ctx.save();
      ctx.globalAlpha = alpha;
      drawMarker(ctx, point, mark, size * 0.9);
      ctx.restore();
      return;
    }
    const r = size * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(point.x, point.y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 10, 17, 0.9)";
    ctx.fill();
    ctx.lineWidth = Math.max(1.6, size * 0.09);
    ctx.strokeStyle = mark.color;
    ctx.stroke();
    // Clipped to the plate so a wide icon cannot bleed over its own ring.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
    ctx.clip();
    const box = size * 0.78;
    const aspect = img.naturalWidth / img.naturalHeight || 1;
    const w = aspect >= 1 ? box : box * aspect;
    const h = aspect >= 1 ? box / aspect : box;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.restore();
  }

  // Nudge marks that landed on top of each other out into a ring, so a corner of
  // the city with four things on at once shows four things rather than one.
  // Returns a new array; the inputs are left alone.
  function fan(placed, size) {
    const crowd = new Map();
    for (const item of placed) {
      const key = `${Math.round(item.at.x / size)},${Math.round(item.at.y / size)}`;
      if (!crowd.has(key)) crowd.set(key, []);
      crowd.get(key).push(item);
    }
    const out = [];
    for (const group of crowd.values()) {
      group.forEach((item, i) => {
        if (group.length < 2) { out.push(item); return; }
        const turn = (i / group.length) * Math.PI * 2 - Math.PI / 2;
        const spread = size * 0.9;
        out.push(Object.assign({}, item, {
          at: { x: item.at.x + Math.cos(turn) * spread, y: item.at.y + Math.sin(turn) * spread }
        }));
      });
    }
    return out;
  }

  window.HermesMarks = {
    ready,
    colors: COLORS,
    shapes: SHAPES,
    slotFor,
    iconSrc,
    icon,
    marker,
    drawMarker,
    drawPin,
    fan,
    get haveIcons() { return haveIcons; }
  };
})();
