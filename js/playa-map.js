// The city, drawn as if seen from above it, at any altitude you like.
//
// The projection here is the same one the overlay's corner map and the story page
// both carry their own copy of — origin at the Man, rotated so the Man-to-Temple
// axis stands upright, metres scaled to the pixels of the generated street image.
// This is the version meant to be shared, so a third copy does not get written the
// next time something needs to put a dot on the playa.
//
//   PlayaMap.load().then((map) => map.draw(ctx, { lat, lon, spanM: 900 }))
//
// Everything after loading is synchronous and allocation-light, because the moon
// show calls draw() once a frame while the camera is climbing.
(function () {
  const DIR = "data/hermes/2026/map";
  const LAT_M = 111320;

  function load(opts) {
    const dir = (opts && opts.dir) || DIR;
    return fetch(`${dir}/playa-streets-metadata.json`, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`map metadata ${r.status}`);
        return r.json();
      })
      .then((meta) => new Promise((resolve, reject) => {
        const base = new Image();
        // The vector city, because this gets blown up: the png is 1400px for the
        // whole playa, and a few blocks of that enlarged to fill the moon is a
        // blur of soft grey bands. The png stays as the fallback — a map with
        // fuzzy streets still says where you are.
        base.onload = () => resolve(make(meta, base, dir));
        base.onerror = () => {
          if (base.src.endsWith(".svg")) { base.src = `${dir}/playa-streets.png`; return; }
          reject(new Error("no playa street image"));
        };
        base.src = `${dir}/playa-streets.svg`;
      }));
  }

  function make(meta, base, dir) {
    const lonM = Math.cos((meta.origin.lat * Math.PI) / 180) * LAT_M;
    const rc = Math.cos(meta.rotation);
    const rs = Math.sin(meta.rotation);

    // Straight to image pixels rather than stopping in metres, because the metre
    // space and the image agree on x and disagree on y, and every consumer of a
    // half-converted coordinate has to remember that. Nothing outside here needs
    // to know the city is stored upside down.
    function at(lat, lon) {
      const mx = (lon - meta.origin.lon) * lonM;
      const my = (lat - meta.origin.lat) * LAT_M;
      const rx = mx * rc - my * rs;
      const ry = mx * rs + my * rc;
      return {
        x: meta.offset.x + (rx - meta.bounds.minX) * meta.scale,
        y: meta.offset.y + (meta.bounds.maxY - ry) * meta.scale
      };
    }

    // Where the whole city sits, so an ascent has somewhere to end up. Taken off
    // the street bounds rather than the image, which carries margin.
    const wholeCity = {
      x: meta.offset.x + ((meta.bounds.maxX - meta.bounds.minX) / 2) * meta.scale,
      y: meta.offset.y + ((meta.bounds.maxY - meta.bounds.minY) / 2) * meta.scale,
      spanM: Math.max(meta.bounds.maxX - meta.bounds.minX,
        meta.bounds.maxY - meta.bounds.minY)
    };

    // The Man: the projection's own origin, and the point every ring and radial
    // in the city is drawn concentric about. Near the centre of the street
    // bounds but not the same place — the city only wraps 2:00 to 10:00, so the
    // bounds lean a hundred-odd metres into the open side. On a rectangle that
    // difference is nothing. On a disc it is the map sitting crooked, because
    // the city's circles and the moon's circle no longer share a centre.
    const man = at(meta.origin.lat, meta.origin.lon);

    const map = {
      meta,
      base,
      dir,
      wholeCity,
      man,
      at,
      pxPerMetre: meta.scale,
      // Metres to a side of the visible square at a given altitude view.
      spanToPx: (spanM) => spanM * meta.scale,

      // One aerial frame. `centre` is in image pixels — normally map.at(lat, lon)
      // for straight overhead, or somewhere between that and map.wholeCity for a
      // camera that has drifted off the vertical to get the city in frame.
      draw(ctx, o) {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const centre = o.centre || at(o.lat, o.lon);
        const spanPx = spanToPxSafe(o.spanM);
        // The visible window in image pixels. Square in metres, so a non-square
        // canvas shows more of the long axis rather than stretching the city.
        const per = spanPx / Math.max(w, h);
        const vw = w * per;
        const vh = h * per;
        const vx = centre.x - vw / 2;
        const vy = centre.y - vh / 2;
        const toCanvas = (p) => ({ x: (p.x - vx) / per, y: (p.y - vy) / per });

        ctx.clearRect(0, 0, w, h);
        // Something for the streets to be light against. Not opaque: the moon it
        // sits on should still be faintly there, or the disc reads as having been
        // replaced by a screen rather than seen through.
        ctx.fillStyle = `rgba(4, 8, 15, ${o.dim == null ? 0.84 : o.dim})`;
        ctx.fillRect(0, 0, w, h);

        if (base.naturalWidth) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.globalAlpha = o.cityAlpha == null ? 0.92 : o.cityAlpha;
          ctx.drawImage(base, vx, vy, vw, vh, 0, 0, w, h);
          ctx.globalAlpha = 1;
        }

        if (o.trail && o.trail.length > 1) {
          drawTrail(ctx, o, o.trail.map((p) => toCanvas(at(p.lat, p.lon))));
        }
        if (o.ring && Number.isFinite(o.lat)) {
          drawRing(ctx, toCanvas(at(o.lat, o.lon)), o.ring, w);
        }
        if (o.mask !== false) maskToDisc(ctx, w, h, o.maskFeather);
        // Handed back so the caller can place its own marks in the same view
        // without repeating the arithmetic and drifting out of step with it.
        return { per, vx, vy, toCanvas, at };
      }
    };

    function spanToPxSafe(spanM) {
      return Math.max(1, (spanM || wholeCity.spanM) * meta.scale);
    }
    return map;
  }

  function drawTrail(ctx, o, pts) {
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = o.trailColour || "rgba(122, 218, 255, 0.95)";
    // Twice over, wide and soft then narrow and bright, or a one-pixel line at
    // altitude disappears into the streets it is crossing.
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = Math.max(6, o.trailWidth || 9);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2, (o.trailWidth || 9) * 0.3);
    ctx.stroke();
  }

  function drawRing(ctx, p, ring, w) {
    const r = Math.max(6, ring.r || w * 0.02);
    ctx.strokeStyle = ring.colour || "rgba(255, 214, 122, 0.9)";
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.globalAlpha = ring.alpha == null ? 1 : ring.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Cut to the disc, with the last stretch faded rather than cut, so the map
  // meets the limb of the moon instead of ending in a hard circle drawn on it.
  function maskToDisc(ctx, w, h, feather) {
    const r = Math.min(w, h) / 2;
    const soft = Math.max(0, Math.min(0.6, feather == null ? 0.14 : feather));
    const g = ctx.createRadialGradient(w / 2, h / 2, r * (1 - soft), w / 2, h / 2, r);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  window.PlayaMap = { load };
})();
