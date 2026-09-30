#!/usr/bin/env python3
"""Write a short phrase into the Rd1A cover so a phone camera can read it back.

The chart version (cover-hidden-chart.py) needs the exact file: a one-pixel
pattern does not survive a lens, a printer, or JPEG. This one carries far less,
sixteen letters, and spends the room on surviving a photograph instead.

Each bit lives in a cell of CELL x CELL cover pixels. The phrase is written
twice, into the same cells, in two ways a printer is unlikely to spoil at once:

  A  green-magenta shift, as a two-by-two checkerboard
  B  blue-yellow shift, as top-half-against-bottom-half stripes

Every pattern averages to no shift across its cell, so the cover's colour does
not drift, and neither copy touches brightness. Because the two patterns are
orthogonal, the reader can pull the copies apart even when printing has turned
the colours partway round from one axis to the other, and it works out for
itself which way each copy ended up pointing. Copy B's bits are dealt out half a
cycle after A's, so a damaged patch of the cover costs the two copies different
bits. The phrase and a checksum are 144 bits; the cover holds 2,688 cells, so
each copy writes every bit about nineteen times, and the reader votes.

    python3 scripts/cover-phrase.py encode
    python3 scripts/cover-phrase.py decode <photo>
    python3 scripts/cover-phrase.py simulate
"""

import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
COVER = ROOT / "book" / "blockchain-chronicles-cover-rd1a.png"
KEYED = ROOT / "book" / "blockchain-chronicles-cover-rd1a-phrase.png"
LAYOUT = ROOT / "book" / "cover-phrase-layout.json"
SIMULATED = ROOT / "artifacts" / "cover-phrase-sim"

PHRASE = "vires in numeris"
CELL = 16                # cover pixels per bit cell
STRIDE = 61              # how bits are dealt across cells
QUIET = 0.4              # how much of a mark survives on flat, neutral paper
WEAKEST = 6              # least certain bits that get tried both ways

# Luminance-neutral directions: 0.299 r + 0.587 g + 0.114 b = 0 for each.
GREEN_MAGENTA = np.array([1.0, -0.299 / 0.587, 0.0])
BLUE_YELLOW = np.array([-0.114 / 0.886, -0.114 / 0.886, 1.0])

COPIES = [
    # amplitude is in counts of the axis's leading channel; at 9, copy A alone
    # lost soft photos in book/scan.html
    {"name": "A", "axis": GREEN_MAGENTA, "pattern": "checker", "offset": 0, "amplitude": 11.0},
    # stripes rather than the quarter-cell checker: the finer squares blur away
    # when the cover is small in the frame
    {"name": "B", "axis": BLUE_YELLOW, "pattern": "stripes", "offset": 72, "amplitude": 13.0},
]


def pattern_sign(name, y, x):
    """Sign of a cell's pattern at pixel (y, x) inside the cell.

    checker  two-by-two squares, half a cell each
    fine     four-by-four squares, a quarter cell each
    stripes  top half against bottom half
    All three sum to zero over a cell and each pair sums to zero when multiplied,
    which is what lets one reading pull them apart.
    """
    h = CELL // 2
    q = CELL // 4
    if name == "checker":
        return np.where((y // h + x // h) % 2 == 0, 1.0, -1.0)
    if name == "fine":
        return np.where((y // q + x // q) % 2 == 0, 1.0, -1.0)
    if name == "stripes":
        return np.where(y // h == 0, 1.0, -1.0)
    raise ValueError(name)


def crc16(data: bytes) -> int:
    """CRC-16/CCITT-FALSE. The camera page computes the same thing."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return crc


def frame_bits(text: str) -> np.ndarray:
    body = text.encode("ascii")
    crc = crc16(body)
    data = body + bytes([crc >> 8, crc & 0xFF])
    return np.unpackbits(np.frombuffer(data, dtype=np.uint8)).astype(np.int8)


def layout(width, height, nbits):
    cols, rows = width // CELL, height // CELL
    x0, y0 = (width - cols * CELL) // 2, (height - rows * CELL) // 2
    # Dealt with a stride rather than in reading order, so a dark patch or a
    # thumb over a corner costs every bit a few votes instead of costing a few
    # bits all of theirs.
    base = (np.arange(rows * cols) * STRIDE) % nbits
    return {"cols": cols, "rows": rows, "x0": x0, "y0": y0, "base": base}


def planes(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cr = 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b
    cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b
    return cr, cb


def shading(rgb):
    cr, cb = planes(rgb)
    energy = np.hypot(cb - 128.0, cr - 128.0)
    spread = Image.fromarray(np.clip(energy, 0, 255).astype(np.uint8))
    spread = np.asarray(spread.filter(ImageFilter.GaussianBlur(10))).astype(float)
    return QUIET + (1.0 - QUIET) * np.clip(spread / 18.0, 0.0, 1.0)


def mark(rgb, copies):
    height, width = rgb.shape[:2]
    bits = frame_bits(PHRASE)
    lay = layout(width, height, len(bits))
    cols, rows, x0, y0 = lay["cols"], lay["rows"], lay["x0"], lay["y0"]
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    shade = shading(rgb)
    out = rgb.copy()
    for copy in copies:
        index = (lay["base"] + copy["offset"]) % len(bits)
        signs = (bits[index] * 2 - 1).astype(float).reshape(rows, cols)
        within = pattern_sign(copy["pattern"], yy, xx)
        field = np.zeros((height, width))
        field[y0 : y0 + rows * CELL, x0 : x0 + cols * CELL] = (
            np.kron(signs, np.ones((CELL, CELL))) * np.tile(within, (rows, cols)))
        out = out + (copy["amplitude"] * shade * field)[..., None] * copy["axis"]
    return np.clip(out, 0, 255).round().astype(np.uint8)


def encode():
    rgb = np.asarray(Image.open(COVER).convert("RGB")).astype(float)
    height, width = rgb.shape[:2]
    out = mark(rgb, COPIES)
    Image.fromarray(out).save(KEYED)
    bits = frame_bits(PHRASE)
    lay = layout(width, height, len(bits))
    delta = np.abs(out.astype(float) - rgb)
    # The phrase itself is left out: book/scan.html loads this file, and it has
    # to find the phrase on the cover, not in here.
    LAYOUT.write_text(json.dumps({
        "bits": int(len(bits)),
        "cover": {"w": width, "h": height},
        "cell": CELL, "cols": lay["cols"], "rows": lay["rows"],
        "x0": lay["x0"], "y0": lay["y0"], "stride": STRIDE,
        "copies": [{"name": c["name"], "pattern": c["pattern"], "offset": c["offset"],
                    "axis": "green-magenta" if c["axis"] is GREEN_MAGENTA else "blue-yellow"}
                   for c in COPIES],
        "crc": "CRC-16/CCITT-FALSE over the ASCII phrase, appended big-endian",
        "maxChannelShift": float(delta.max()),
        "meanChannelShift": float(delta[delta > 0].mean()),
    }, indent=2) + "\n")
    n = lay["cols"] * lay["rows"]
    print(f"wrote {KEYED.relative_to(ROOT)}")
    print(f"  {n} cells, {len(COPIES)} copies, each bit written {n * len(COPIES) / len(bits):.0f} times")
    print(f"  largest change to any channel: {delta.max():.0f} of 255, mean {delta[delta > 0].mean():.1f}")


# --- reading ---------------------------------------------------------------

COVER_W, COVER_H = 682, 1024


def sample_points(nbits):
    """Sixteen points per cell, one in the middle of each quarter-cell square.

    Those sixteen serve every pattern: each pattern is constant on a
    quarter-cell square, so each point reads one square of whichever pattern.
    """
    lay = layout(COVER_W, COVER_H, nbits)
    cols, rows, x0, y0 = lay["cols"], lay["rows"], lay["x0"], lay["y0"]
    q = CELL // 4
    oy, ox = np.mgrid[0:4, 0:4]
    oy = (oy * q + q / 2).ravel()
    ox = (ox * q + q / 2).ravel()
    r, c = np.divmod(np.arange(rows * cols), cols)
    xs = x0 + c[:, None] * CELL + ox[None, :]
    ys = y0 + r[:, None] * CELL + oy[None, :]
    iy, ix = oy.astype(int), ox.astype(int)
    return xs, ys, iy, ix, lay


def bilinear(plane, x, y):
    h, w = plane.shape
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    a = plane[y0, x0] * (1 - fx) + plane[y0, x0 + 1] * fx
    b = plane[y0 + 1, x0] * (1 - fx) + plane[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def to_photo(xs, ys, guide, pose, shift=(0, 0)):
    gx, gy, gw, gh = guide
    scale, dx, dy, theta = pose
    s = scale * gw / COVER_W
    u = xs - COVER_W / 2 + dx + shift[0]
    v = ys - COVER_H / 2 + dy + shift[1]
    ct, st = np.cos(theta), np.sin(theta)
    return gx + gw / 2 + s * (ct * u - st * v), gy + gh / 2 + s * (st * u + ct * v)


class Reader:
    """Everything the camera page does, in the same order."""

    def __init__(self, copies, adaptive=True, use_cb=True):
        self.copies = copies
        self.adaptive = adaptive   # False: read copy A off the green-magenta channel only
        self.use_cb = use_cb
        self.nbits = len(frame_bits(PHRASE))
        self.xs, self.ys, iy, ix, lay = sample_points(self.nbits)
        self.lay = lay
        self.signs = np.stack([pattern_sign(c["pattern"], iy, ix) for c in copies])
        self.r, self.c = np.divmod(np.arange(lay["rows"] * lay["cols"]), lay["cols"])

    def measure(self, P, guide, pose, keep, shift=(0, 0)):
        """Per cell, per copy, per channel: how strongly that copy's pattern shows."""
        px, py = to_photo(self.xs[keep], self.ys[keep], guide, pose, shift)
        out = []
        for plane in P:
            v = bilinear(plane, px, py)
            out.append(v @ self.signs.T)          # cells x copies
        return np.stack(out, axis=-1)             # cells x copies x channels

    def score(self, P, guide, pose, keep, shift=(0, 0)):
        m = self.measure(P, guide, pose, keep, shift)
        return np.sqrt((m ** 2).sum(axis=-1)).sum()

    def patch(self, radius):
        lay = self.lay
        return np.flatnonzero((np.abs(self.r - lay["rows"] / 2) <= radius)
                              & (np.abs(self.c - lay["cols"] / 2) <= radius))

    def read(self, P, guide):
        everything = np.arange(len(self.r))

        # 1. Find the grid with a small patch in the middle, where a wrong size
        #    or tilt has not had room to add up. A whole cell out is fine: it
        #    only turns the phrase, and the checksum sorts that out at the end.
        centre = self.patch(5)
        best, pose = -1.0, None
        for s in np.arange(0.76, 1.241, 0.04):
            for t in np.radians(np.arange(-4, 4.1, 2)):
                for dx in range(0, CELL, CELL // 4):
                    for dy in range(0, CELL, CELL // 4):
                        sc = self.score(P, guide, (s, dx, dy, t), centre)
                        if sc > best:
                            best, pose = sc, (s, dx, dy, t)

        # 2. Grow the patch and tighten the fit as it grows.
        pose = np.array(pose, dtype=float)
        step = np.array([0.02, 2.0, 2.0, np.radians(1.0)])
        for radius in (5, 9, 14, 99):
            keep = self.patch(radius)
            best = self.score(P, guide, pose, keep)
            for _ in range(3):
                improved = True
                while improved:
                    improved = False
                    for i in range(4):
                        for d in (-1, 1):
                            q = pose.copy()
                            q[i] += d * step[i]
                            sc = self.score(P, guide, q, keep)
                            if sc > best:
                                best, pose, improved = sc, q, True
                step = step / 2
            step = np.array([0.01, 1.0, 1.0, np.radians(0.5)])

        # 3. A cover held at an angle is not a rectangle in the picture, so each
        #    block of cells gets its own nudge, always under half a cell.
        m = self.measure(P, guide, pose, everything)
        block = 8
        for br in range(0, self.lay["rows"], block):
            for bc in range(0, self.lay["cols"], block):
                keep = np.flatnonzero((self.r >= br) & (self.r < br + block)
                                      & (self.c >= bc) & (self.c < bc + block))
                best_sc = np.sqrt((m[keep] ** 2).sum(-1)).sum()
                for ox in range(-6, 7, 2):
                    for oy in range(-6, 7, 2):
                        mm = self.measure(P, guide, pose, keep, (ox, oy))
                        sc = np.sqrt((mm ** 2).sum(-1)).sum()
                        if sc > best_sc:
                            best_sc, m[keep] = sc, mm

        # 4. Each copy's colour may have been turned by printing. Find the
        #    direction it points now, read along that, and weight the copy by
        #    how cleanly it stands out from what it is not.
        per_copy = []
        base = self.lay["base"]
        for i, copy in enumerate(self.copies):
            v = m[:, i, :]
            if self.adaptive and v.shape[1] == 2:
                cov = v.T @ v / len(v)
                vals, vecs = np.linalg.eigh(cov)
                axis = vecs[:, 1]
                signal, noise = max(vals[1] - vals[0], 1e-9), max(vals[0], 1e-9)
                weight = np.sqrt(signal) / noise
                proj = v @ axis
            else:
                proj = v[:, 0]
                weight = 1.0
            index = (base + copy["offset"]) % self.nbits
            per_copy.append(weight * np.bincount(index, weights=proj, minlength=self.nbits))

        # 5. Which way round each copy points is not known, so both ways are
        #    tried, together and alone. The checksum decides.
        candidates = []
        if len(per_copy) == 2:
            candidates += [per_copy[0] + per_copy[1], per_copy[0] - per_copy[1]]
        candidates += per_copy
        candidates += [-c for c in candidates]
        found = resolve(candidates, self.nbits)
        return (found if found else None), pose


def bits_to_text(bits):
    data = np.packbits(bits.astype(np.uint8)).tobytes()
    body, crc = data[:-2], (data[-2] << 8) | data[-1]
    ok = crc16(body) == crc and all(32 <= b < 127 for b in body)
    return body.decode("ascii", errors="replace"), ok


def resolve(candidates, n):
    """Every candidate, every starting point, the least certain bits both ways.

    A checksum plus sixteen printable letters is the bar; clearing it by
    accident is far below one chance in a billion even across every try.
    """
    patterns = sorted(range(1 << WEAKEST), key=lambda p: bin(p).count("1"))
    prepared = [(votes, np.argsort(np.abs(votes))[:WEAKEST]) for votes in candidates]
    for pattern in patterns:
        for votes, weak in prepared:
            for turn in range(n):
                bits = (np.roll(votes, turn) > 0).astype(np.int8)
                for j in range(WEAKEST):
                    if pattern >> j & 1:
                        bits[(weak[j] + turn) % n] ^= 1
                text, ok = bits_to_text(bits)
                if ok:
                    return text
    return None


def photo_planes(photo: Image.Image, use_cb=True):
    rgb = np.asarray(photo.convert("RGB")).astype(float)
    out = []
    for plane in planes(rgb)[: 2 if use_cb else 1]:
        # Take away the slow colour of the room and the camera's white balance.
        smooth = np.asarray(Image.fromarray(np.clip(plane, 0, 255).astype(np.uint8))
                            .filter(ImageFilter.BoxBlur(CELL))).astype(float)
        out.append(plane - smooth)
    return out


def default_guide(w, h, share=0.8):
    gh = h * share
    gw = gh * COVER_W / COVER_H
    return ((w - gw) / 2, (h - gh) / 2, gw, gh)


def decode(path):
    photo = Image.open(path)
    reader = Reader(COPIES)
    for share in (0.8, 1.0):
        text, pose = reader.read(photo_planes(photo), default_guide(*photo.size, share))
        if text:
            print(f"read: {text!r}  (scale {pose[0]:.3f}, tilt {np.degrees(pose[3]):+.1f} deg)")
            return
    print("nothing read")


# --- pretending to be a printer, then a phone --------------------------------

def press(img: Image.Image, *, turn=0.0, sat=1.0, slip=(0, 0), gain=1.0, grain=0.0):
    """What a print run might do: turn the hues, dull them, misregister a plate,
    darken the midtones, and add the texture of halftone dots."""
    a = np.asarray(img.convert("RGB")).astype(float)
    cr, cb = planes(a)
    y = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    t = np.radians(turn)
    u, v = cb - 128, cr - 128
    u, v = sat * (np.cos(t) * u - np.sin(t) * v), sat * (np.sin(t) * u + np.cos(t) * v)
    out = np.stack([y + 1.402 * v, y - 0.344136 * u - 0.714136 * v, y + 1.772 * u], -1)
    if slip != (0, 0):
        out[..., 0] = np.roll(out[..., 0], shift=(slip[1], slip[0]), axis=(0, 1))
    out = 255.0 * (np.clip(out, 0, 255) / 255.0) ** gain
    out = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    if grain:
        n = np.random.default_rng(3).normal(0, grain, (img.height, img.width, 3))
        out = Image.fromarray(np.clip(np.asarray(out) + n, 0, 255).astype(np.uint8))
    return out


def fake_photo(keyed: Image.Image, rng, *, err, tilt, keystone, blur, quality, noise, cast):
    fw, fh = 720, 1280
    gx, gy, gw, gh = default_guide(fw, fh)
    s = (1 + err[0]) * gw / COVER_W
    cx = gx + gw / 2 + err[1] * gw
    cy = gy + gh / 2 + err[2] * gh
    t = np.radians(tilt)
    corners = []
    for u, v in ((0, 0), (COVER_W, 0), (COVER_W, COVER_H), (0, COVER_H)):
        uu, vv = u - COVER_W / 2, v - COVER_H / 2
        k = 1 + keystone * (vv / COVER_H)
        corners.append((cx + s * k * (np.cos(t) * uu - np.sin(t) * vv),
                        cy + s * (np.sin(t) * uu + np.cos(t) * vv)))
    coeffs = perspective_coeffs(corners, [(0, 0), (COVER_W, 0), (COVER_W, COVER_H), (0, COVER_H)])
    table = Image.new("RGB", (fw, fh), (92, 84, 76))
    warped = keyed.convert("RGBA").transform((fw, fh), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    table.paste(warped, (0, 0), warped)
    a = np.asarray(table.filter(ImageFilter.GaussianBlur(blur))).astype(float)
    a = a * np.array(cast)[None, None, :] + rng.normal(0, noise, a.shape)
    buf = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=quality)
    return Image.open(io.BytesIO(buf.getvalue()))


def webcam_photo(keyed: Image.Image, width, seed, fw=1920, fh=1080):
    """A laptop camera: landscape, the cover held up at some size, noisier than a phone."""
    s = width / COVER_W
    cx, cy = fw / 2 + 0.01 * fw, fh / 2
    t = np.radians(1.0)
    corners = [(cx + s * (np.cos(t) * (u - COVER_W / 2) - np.sin(t) * (v - COVER_H / 2)),
                cy + s * (np.sin(t) * (u - COVER_W / 2) + np.cos(t) * (v - COVER_H / 2)))
               for u, v in ((0, 0), (COVER_W, 0), (COVER_W, COVER_H), (0, COVER_H))]
    coeffs = perspective_coeffs(corners, [(0, 0), (COVER_W, 0), (COVER_W, COVER_H), (0, COVER_H)])
    table = Image.new("RGB", (fw, fh), (70, 66, 62))
    warped = keyed.convert("RGBA").transform((fw, fh), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    table.paste(warped, (0, 0), warped)
    a = np.asarray(table.filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    a = a + np.random.default_rng(seed).normal(0, 7, a.shape)
    buf = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=70)
    return Image.open(io.BytesIO(buf.getvalue()))


# cover widths in a 1920x1080 frame; 719 fills its height
WEBCAM = (480, 600, 719)
LIVE_SHARES = (0.92, 0.72, 0.56)   # the guide sizes book/scan.html cycles through


def perspective_coeffs(dst, src):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    rhs = np.array([c for pair in src for c in pair], dtype=float)
    return np.linalg.solve(np.array(m, dtype=float), rhs)


PHONE = {
    "steady": dict(err=(0.0, 0.0, 0.0), tilt=0, keystone=0.0, blur=0.8, quality=85, noise=2, cast=(1, 1, 1)),
    "off guide": dict(err=(0.07, 0.05, -0.04), tilt=2.5, keystone=0.0, blur=1.0, quality=80, noise=3, cast=(1, 1, 1)),
    "angled": dict(err=(-0.05, -0.03, 0.03), tilt=-3, keystone=0.05, blur=1.2, quality=75, noise=3, cast=(1, 1, 1)),
    "warm light": dict(err=(0.03, 0.02, 0.02), tilt=1, keystone=0.02, blur=1.2, quality=75, noise=4, cast=(1.08, 1.0, 0.86)),
    "soft, JPEG 55": dict(err=(0.02, -0.02, 0.01), tilt=-1, keystone=0.02, blur=2.0, quality=55, noise=5, cast=(1, 1, 1)),
    "very soft": dict(err=(0.0, 0.0, 0.0), tilt=0, keystone=0.0, blur=3.0, quality=60, noise=5, cast=(1, 1, 1)),
    "steep": dict(err=(-0.06, 0.04, 0.03), tilt=-4, keystone=0.09, blur=1.5, quality=70, noise=4, cast=(1, 1, 1)),
    "small in frame": dict(err=(-0.15, 0.02, 0.0), tilt=1, keystone=0.02, blur=1.5, quality=70, noise=4, cast=(1, 1, 1)),
    "limit: blur 3, JPEG 50": dict(err=(0.04, 0.03, -0.02), tilt=2, keystone=0.03, blur=3.0, quality=50, noise=6, cast=(1.05, 1, 0.9)),
    "limit: blur 4": dict(err=(0.0, 0.0, 0.0), tilt=0, keystone=0.0, blur=4.0, quality=60, noise=5, cast=(1, 1, 1)),
}
HANDHELD = dict(err=(0.03, -0.02, 0.02), tilt=1.5, keystone=0.03, blur=1.3, quality=75, noise=3, cast=(1.04, 1.0, 0.94))

PRINT = {
    "screen, no print": dict(),
    "press, mild": dict(turn=8, sat=0.85, gain=1.1, grain=2),
    "hues turned 30 deg": dict(turn=30, sat=0.8, gain=1.1, grain=2),
    "hues turned 60 deg": dict(turn=60, sat=0.8, gain=1.1, grain=2),
    "hues turned 90 deg": dict(turn=90, sat=0.8, gain=1.1, grain=2),
    "dull ink, half saturation": dict(turn=12, sat=0.5, gain=1.15, grain=3),
    "plate off by 2 px": dict(turn=10, sat=0.8, slip=(2, 1), gain=1.1, grain=2),
    "all of it at once": dict(turn=45, sat=0.6, slip=(1, 1), gain=1.2, grain=3),
    "harsh: 60 deg, third saturation": dict(turn=60, sat=0.35, gain=1.2, grain=3),
    "harsh: 75 deg, half, plate off": dict(turn=75, sat=0.5, slip=(2, 1), gain=1.2, grain=3),
    "harsh: quarter saturation": dict(turn=20, sat=0.25, gain=1.2, grain=3),
}


def simulate():
    SIMULATED.mkdir(parents=True, exist_ok=True)
    rgb = np.asarray(Image.open(COVER).convert("RGB")).astype(float)
    single = Image.fromarray(mark(rgb, COPIES[:1]))
    double = Image.fromarray(mark(rgb, COPIES))
    old = Reader(COPIES[:1], adaptive=False)
    new = Reader(COPIES)

    def run(reader, img, use_cb):
        g = default_guide(*img.size)
        text, _ = reader.read(photo_planes(img, use_cb), g)
        return text == PHRASE

    print(f"{'phone, straight from the file':32s} one copy   two copies")
    rng = np.random.default_rng(7)
    for i, (name, kw) in enumerate(PHONE.items()):
        a = fake_photo(single, rng, **kw)
        b = fake_photo(double, np.random.default_rng(7 + i), **kw)
        b.save(SIMULATED / f"case{i}.jpg")
        print(f"  {name:30s} {'read' if run(old, a, False) else '-':10s} {'read' if run(new, b, True) else '-'}")

    print(f"\n{'printed, then photographed':32s} one copy   two copies")
    for j, (name, kw) in enumerate(PRINT.items()):
        a = fake_photo(press(single, **kw) if kw else single, np.random.default_rng(100 + j), **HANDHELD)
        b = fake_photo(press(double, **kw) if kw else double, np.random.default_rng(100 + j), **HANDHELD)
        b.save(SIMULATED / f"print{j}.jpg")
        print(f"  {name:30s} {'read' if run(old, a, False) else '-':10s} {'read' if run(new, b, True) else '-'}")

    print(f"\n{'laptop camera, 1920x1080':32s} two copies, any of the live guide sizes")
    for k, width in enumerate(WEBCAM):
        img = webcam_photo(double, width, 200 + k)
        img.save(SIMULATED / f"webcam{k}.jpg")
        ok = any(new.read(photo_planes(img), default_guide(*img.size, s))[0] == PHRASE for s in LIVE_SHARES)
        print(f"  cover {width} px wide{'':15s} {'read' if ok else '-'}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "encode"
    if what == "encode":
        encode()
    elif what == "decode":
        decode(sys.argv[2])
    elif what == "simulate":
        simulate()
    else:
        sys.exit(__doc__)
