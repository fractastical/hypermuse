// A message carried in how much colour a thing has from moment to moment.
//
// Every colour effect in the Metavillan act carries one. While the colour is
// up, its saturation is pulled down by a small fixed depth for half of every
// bit period: the first half for a 1, the second half for a 0 (Manchester).
// Every bit has exactly one half dipped, so the average colour never moves and
// what the eye gets is a fine shimmer rather than a pulse; a camera averaging
// the colour of the whole frame gets the bits back.
//
//   frame   13-bit Barker sync, the text as UTF-8 bytes, CRC-16/CCITT of them
//   between frames the dip sits at half depth, which is the same average again
//
// The reader needs no picture of the original, only the bit period. It
// resamples the frame-by-frame colour onto an even clock, takes off the slow
// part (the bloom arriving, the camera's exposure), tries every phase for the
// bit boundary, finds the sync word, and accepts the first length whose CRC
// passes and whose letters are printable.
//
// Browser: <script src="js/secret-shimmer.js"> gives window.SecretShimmer.
// Node: import it and read globalThis.SecretShimmer.
(function (root) {
  const SYNC = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1];
  const GAP = 3;          // bit periods at half depth between repeats
  const MAX_BYTES = 48;

  function crc16(bytes) {
    let c = 0xffff;
    for (const b of bytes) {
      c ^= b << 8;
      for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c;
  }

  const utf8 = (text) => Array.from(new TextEncoder().encode(String(text)));

  function frameBits(text) {
    const bytes = utf8(text).slice(0, MAX_BYTES);
    const bits = SYNC.slice();
    const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    for (const b of bytes) push(b, 8);
    push(crc16(bytes), 16);
    return bits;
  }

  // An encoder for one message: dip(t) is 1 where the colour should be pulled
  // down, 0 where it is left alone, and 0.5 between frames. t in seconds from
  // wherever the caller's message clock starts; it repeats on its own.
  function encoder(text, bitSec = 0.2) {
    const bits = frameBits(text);
    const span = (bits.length + GAP) * bitSec;
    return {
      bits, bitSec, span,
      dip(t) {
        if (!(t >= 0)) return 0.5;
        const u = t % span;
        const k = Math.floor(u / bitSec);
        if (k >= bits.length) return 0.5;
        const first = u - k * bitSec < bitSec / 2;
        return bits[k] ? (first ? 1 : 0) : (first ? 0 : 1);
      }
    };
  }

  // Colour strength of an RGBA buffer: mean distance from the grey axis, which
  // a turn of hue about that axis leaves alone — so the act's running hues do
  // not read as signal.
  function chroma(data) {
    let sum = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const m = (r + g + b) / 3;
      sum += Math.sqrt(((r - m) ** 2 + (g - m) ** 2 + (b - m) ** 2));
    }
    return sum / Math.max(1, n);
  }

  const printable = (s) => /^[\x20-\x7e\u00a0-\uffff]+$/.test(s) && !s.includes("\ufffd");

  // Up to two of the least certain bits flipped, for frames of four bytes or
  // more: below that the printable test is too weak to stop CRC-16 passing
  // something by chance among that many tries.
  const WEAKEST = 10;
  function readFrame(soft, start, len) {
    const n = len * 8 + 16;
    const hard = new Uint8Array(n);
    for (let i = 0; i < n; i++) hard[i] = soft[start + i] > 0 ? 1 : 0;
    const check = () => {
      const bytes = [];
      for (let b = 0; b < len; b++) {
        let v = 0;
        for (let i = 0; i < 8; i++) v = (v << 1) | hard[b * 8 + i];
        bytes.push(v);
      }
      let crc = 0;
      for (let i = 0; i < 16; i++) crc = (crc << 1) | hard[len * 8 + i];
      if (crc !== crc16(bytes)) return null;
      const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
      return printable(text) ? text : null;
    };
    let text = check();
    if (text) return { text, fixed: 0 };
    if (len < 4) return null;
    const weak = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => Math.abs(soft[start + a]) - Math.abs(soft[start + b]))
      .slice(0, WEAKEST);
    for (let x = 0; x < weak.length; x++) {
      hard[weak[x]] ^= 1;
      if ((text = check())) return { text, fixed: 1 };
      for (let y = x + 1; y < weak.length; y++) {
        hard[weak[y]] ^= 1;
        if ((text = check())) return { text, fixed: 2 };
        hard[weak[y]] ^= 1;
      }
      hard[weak[x]] ^= 1;
    }
    return null;
  }

  // samples: [{ t: seconds, v: colour strength }], in time order. Returns
  // { text, at, score } for the first frame found, or { best } — the strongest
  // sync seen, 0..1 — when there is none yet.
  function decode(samples, bitSec = 0.2) {
    if (samples.length < 8) return { best: 0 };
    const PER = 8;                       // resampled points per bit
    const dt = bitSec / PER;
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    const n = Math.floor((t1 - t0) / dt);
    if (n < PER * (SYNC.length + 24)) return { best: 0 };
    const even = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * dt;
      while (j < samples.length - 2 && samples[j + 1].t < t) j++;
      const a = samples[j], b = samples[j + 1];
      const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
      even[i] = a.v + (b.v - a.v) * f;
    }
    let best = 0;
    const hits = [];
    for (let phase = 0; phase < PER; phase++) {
      const nb = Math.floor((n - phase) / PER);
      // A Manchester bit averages the same whichever it is, so whole bits see
      // only the slow part — the bloom arriving, the camera's exposure — and
      // the bits either side give its slope, which would otherwise read as
      // second half brighter than first in every bit on the way up.
      const whole = new Float64Array(nb), half = new Float64Array(nb);
      for (let k = 0; k < nb; k++) {
        const o = phase + k * PER;
        let a = 0, z = 0, all = 0;
        for (let q = 0; q < PER; q++) all += even[o + q];
        // The point either side of each edge is left out: it is half one
        // level and half the other once the camera has blurred it in time.
        for (let q = 1; q < PER / 2; q++) { a += even[o + q]; z += even[o + PER / 2 + q]; }
        whole[k] = all / PER;
        half[k] = (z - a) / (PER / 2 - 1);
      }
      const soft = new Float64Array(nb);
      for (let k = 0; k < nb; k++) {
        const lo = Math.max(0, k - 2), hi = Math.min(nb - 1, k + 2);
        const slope = hi > lo ? (whole[hi] - whole[lo]) / (hi - lo) : 0;
        // Dipped is less colour, so a 1 is first half low.
        soft[k] = half[k] - slope / 2;
      }
      for (let k = 0; k + SYNC.length + 24 <= nb; k++) {
        let c = 0, mag = 0;
        for (let i = 0; i < SYNC.length; i++) {
          c += soft[k + i] * (SYNC[i] ? 1 : -1);
          mag += Math.abs(soft[k + i]);
        }
        const score = mag > 0 ? c / mag : 0;
        if (score > best) best = score;
        if (score < 0.6) continue;
        const at = t0 + (phase + k * PER) * dt;
        hits.push({ soft, start: k + SYNC.length, at, score });
        if (score < 0.85) continue;
        for (let len = 1; len <= MAX_BYTES && k + SYNC.length + len * 8 + 16 <= nb; len++) {
          const got = readFrame(soft, k + SYNC.length, len);
          if (got) return { text: got.text, at, score, copies: 1, bits: SYNC.length + len * 8 + 16, fixed: got.fixed };
        }
      }
    }
    // No single copy came through whole, so add up the copies there are. The
    // show sends one per flower at the same point in the hold, so a camera that
    // has watched several flowers has several, and noise that flips a bit in
    // one rarely flips it the same way in the others.
    hits.sort((a, b) => b.score - a.score);
    const copies = [];
    for (const h of hits) {
      if (copies.every((c) => Math.abs(c.at - h.at) > 20 * bitSec)) copies.push(h);
      if (copies.length >= 6) break;
    }
    const most = MAX_BYTES * 8 + 16;
    for (let m = 2; m <= copies.length; m++) {
      const sum = new Float64Array(most);
      for (const c of copies.slice(0, m)) {
        for (let i = 0; i < most && c.start + i < c.soft.length; i++) sum[i] += c.soft[c.start + i];
      }
      for (let len = 1; len <= MAX_BYTES; len++) {
        const got = readFrame(sum, 0, len);
        if (got) return { text: got.text, at: copies[0].at, score: copies[0].score, copies: m, bits: SYNC.length + len * 8 + 16, fixed: got.fixed };
      }
    }
    return { best };
  }

  root.SecretShimmer = { encoder, decode, chroma, frameBits, crc16, SYNC, GAP };
})(typeof window !== "undefined" ? window : globalThis);
