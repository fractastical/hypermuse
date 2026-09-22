#!/usr/bin/env python3
# One gif of the week: only the stops a picture can be stood on, about twenty
# of them, in the order Hermes reached them. Two frames from the same minute
# at the same stop are one picture.
#
#   python3 scripts/hermes-route-gifs.py
#
# Stills are turned upright from the camera's own orientation tag. Clips
# contribute a frame from the original, so a phone that stored the picture
# sideways is rotated before it is drawn. A stop with no picture is left off.

import json
import math
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MAP_PNG = ROOT / "data/hermes/2026/map/playa-streets.png"
META_PATH = ROOT / "data/hermes/2026/map/playa-streets-metadata.json"
TRACK_PATH = ROOT / "data/hermes/track.jsonl"
CURATION_PATH = ROOT / "data/hermes/annals-curation.json"
MEDIA = ROOT / "docs/annals/media"
PHOTOS = ROOT / "assets/hermes-annals/photos"
OUT_DIR = ROOT / "assets/hermes-annals/route-gifs"
TZ = ZoneInfo("America/Los_Angeles")

PLACE_M = 120
# A second frame from the same stop only counts when it is a different moment.
GAP_MS = 8 * 60 * 1000
# Farther than this from the nearest fix, the picture is not put on a dot.
NEAR_MIN = 180
OUT_W = 840
FPS = 2
MAX_BEATS = 20
PW, PH, CAP = 240, 200, 28

meta = json.loads(META_PATH.read_text())
LAT_SCALE = 111320
LON_SCALE = math.cos(meta["origin"]["lat"] * math.pi / 180) * 111320
COS_R = math.cos(meta["rotation"])
SIN_R = math.sin(meta["rotation"])
W, H = meta["width"], meta["height"]
SCALE = OUT_W / W


def screen(lon, lat):
    rx = (lon - meta["origin"]["lon"]) * LON_SCALE
    ry = (lat - meta["origin"]["lat"]) * LAT_SCALE
    x = rx * COS_R - ry * SIN_R
    y = rx * SIN_R + ry * COS_R
    return (
        meta["offset"]["x"] + (x - meta["bounds"]["minX"]) * meta["scale"],
        meta["offset"]["y"] + (meta["bounds"]["maxY"] - y) * meta["scale"],
    )


def metres(a, b):
    dx = (b["lon"] - a["lon"]) * LON_SCALE
    dy = (b["lat"] - a["lat"]) * LAT_SCALE
    return math.hypot(dx, dy)


def quad(a, b, n=18):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if math.hypot(dx, dy) < 12:
        return []
    cx = (a[0] + b[0]) / 2 - dy * 0.14
    cy = (a[1] + b[1]) / 2 + dx * 0.14
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((
            u * u * a[0] + 2 * u * t * cx + t * t * b[0],
            u * u * a[1] + 2 * u * t * cy + t * t * b[1],
        ))
    return pts


def draw_dashed(draw, pts, fill, width=3, dash=8, gap=6):
    if len(pts) < 2:
        return
    on = True
    left = dash
    for p, q in zip(pts, pts[1:]):
        dist = math.hypot(q[0] - p[0], q[1] - p[1])
        if dist == 0:
            continue
        ux, uy = (q[0] - p[0]) / dist, (q[1] - p[1]) / dist
        walked = 0
        while walked < dist:
            step = min(left, dist - walked)
            a = (p[0] + ux * walked, p[1] + uy * walked)
            b = (p[0] + ux * (walked + step), p[1] + uy * (walked + step))
            if on:
                draw.line([a, b], fill=fill, width=width)
            walked += step
            left -= step
            if left <= 0:
                on = not on
                left = dash if on else gap


def text(draw, xy, s, font, fill):
    x, y = xy
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        draw.text((x + dx, y + dy), s, font=font, fill=(0, 0, 0))
    draw.text((x, y), s, font=font, fill=fill)


def fit(im, w, h):
    im = im.convert("RGB")
    scale = min(w / im.width, h / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (w, h), (6, 9, 15))
    canvas.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return canvas


def beside(dot):
    r = 8
    x = dot["x"] + r + 12
    y = dot["y"] - (PH + CAP) / 2
    if x + PW > W - 8:
        x = dot["x"] - r - 12 - PW
    y = min(max(8, y), H - PH - CAP - 8)
    x = min(max(8, x), W - PW - 8)
    return x, y


def stem_of(name):
    # 2026-08-31-IMG_4340.mp4 -> IMG_4340
    return Path(name[11:]).stem


def original_clip(name):
    stem = stem_of(name)
    if not PHOTOS.exists():
        return None
    for path in PHOTOS.iterdir():
        if path.stem == stem and path.suffix.lower() in {".mov", ".mp4", ".m4v"}:
            return path
    return None


def video_frame(name, dest):
    src = original_clip(name) or (MEDIA / name)
    if not src.exists():
        return None
    # A second in, so the frame is the scene and not the shutter opening.
    # ffmpeg applies the clip's rotation, which the re-encoded copy often lost.
    for ss in ("1", "0.25"):
        result = subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-ss", ss, "-i", str(src), "-frames:v", "1", str(dest)],
        )
        if result.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
            return dest
    return None


def open_still(path):
    with Image.open(path) as im:
        return ImageOps.exif_transpose(im).convert("RGB")


def load_picture(shot, cache):
    dest = cache / (shot["name"].replace("/", "_") + ".png")
    if shot["name"].endswith(".mp4"):
        if not video_frame(shot["name"], dest):
            return None
        return Image.open(dest).convert("RGB")
    still = MEDIA / shot["name"]
    if not still.exists():
        return None
    return open_still(still)


def still_taken(path):
    try:
        out = subprocess.run(["sips", "-g", "creation", str(path)], capture_output=True, text=True).stdout
    except OSError:
        return None
    found = re.search(r"creation:\s*(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})", out)
    if not found:
        return None
    # The camera clock was already playa time, and it has no zone of its own.
    return datetime(*(int(g) for g in found.groups())).replace(tzinfo=TZ)


def clip_taken(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format_tags", "-of", "json", str(path)],
            capture_output=True, text=True,
        ).stdout
        tags = json.loads(out).get("format", {}).get("tags") or {}
    except (OSError, json.JSONDecodeError):
        return None
    raw = tags.get("com.apple.quicktime.creationdate")
    if not raw:
        return None
    raw = str(raw).strip()
    if re.search(r"[+-]\d{4}$", raw):
        raw = raw[:-2] + ":" + raw[-2:]
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def load_track():
    fixes = []
    for line in TRACK_PATH.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("lat") is None or not row.get("t"):
            continue
        fixes.append({
            "t": datetime.fromisoformat(row["t"].replace("Z", "+00:00")),
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
        })
    fixes.sort(key=lambda f: f["t"])
    return fixes


def pictured_shots(fixes):
    # A picture is placed on the nearest fix when that fix is within three
    # hours, or when the car had not moved between the fixes on either side.
    # Anything further is a different part of the night and is left off.
    curation = json.loads(CURATION_PATH.read_text()).get("publish") or {}
    originals = {}
    if PHOTOS.exists():
        for path in PHOTOS.iterdir():
            if not path.name.startswith("."):
                originals.setdefault(path.stem, []).append(path)
    times = [f["t"] for f in fixes]
    shots = []
    for src, mark in curation.items():
        if not mark or not mark.get("publish") or mark.get("explicit"):
            continue
        stem = Path(src).stem
        video = src.lower().endswith((".mp4", ".mov", ".m4v"))
        day = src.split("/")[-2]
        name = f"{day}-{stem}{'.mp4' if video else '.jpg'}"
        published = MEDIA / name
        when = still_taken(published) if published.exists() and not video else None
        if when is None:
            for path in originals.get(stem, []):
                when = clip_taken(path) if path.suffix.lower() in {".mov", ".mp4", ".m4v"} else still_taken(path)
                if when:
                    break
        if when is None or when < fixes[0]["t"] or when > fixes[-1]["t"]:
            continue
        i = next((n for n, t in enumerate(times) if t >= when), len(times) - 1)
        prev, nxt = fixes[max(0, i - 1)], fixes[min(i, len(fixes) - 1)]
        after = (when - prev["t"]).total_seconds() / 60
        before = (nxt["t"] - when).total_seconds() / 60
        nearer = prev if after <= before else nxt
        if min(after, before) > NEAR_MIN and metres(prev, nxt) > 150:
            continue
        shots.append({
            "name": name,
            "ms": when.timestamp() * 1000,
            "when": when,
            "lat": nearer["lat"],
            "lon": nearer["lon"],
            "video": video,
            "clock": when.strftime("%-I:%M %p"),
            "day": when.astimezone(TZ).strftime("%Y-%m-%d"),
        })
    shots.sort(key=lambda s: s["ms"])
    return shots


def bursts_of(shots):
    # One picture per burst. A burst is the same ground inside eight minutes,
    # which is what the near-duplicate pairs were.
    bursts = []
    for shot in shots:
        if bursts and metres(bursts[-1], shot) <= PLACE_M and shot["ms"] - bursts[-1]["end"] <= GAP_MS:
            burst = bursts[-1]
            burst["shots"].append(shot)
            burst["end"] = shot["ms"]
            continue
        bursts.append({
            "lon": shot["lon"], "lat": shot["lat"], "end": shot["ms"], "shots": [shot],
        })
    for burst in bursts:
        burst["x"], burst["y"] = screen(burst["lon"], burst["lat"])
        videos = [s for s in burst["shots"] if s["video"]]
        burst["shot"] = videos[len(videos) // 2] if videos else burst["shots"][len(burst["shots"]) // 2]
    if len(bursts) > MAX_BEATS:
        step = len(bursts) / MAX_BEATS
        bursts = [bursts[min(len(bursts) - 1, int(i * step))] for i in range(MAX_BEATS)]
    return bursts


def paint(base, stops, upto, picture, caption, font, small):
    frame = base.copy()
    draw = ImageDraw.Draw(frame)
    shown = stops[: upto + 1]
    for a, b in zip(shown, shown[1:]):
        draw_dashed(draw, quad((a["x"], a["y"]), (b["x"], b["y"])), (255, 157, 61), width=3)
    for i, stop in enumerate(shown):
        fill = (125, 255, 168) if i == 0 else (255, 209, 102)
        if i == len(shown) - 1:
            fill = (127, 212, 255)
        draw.ellipse((stop["x"] - 8, stop["y"] - 8, stop["x"] + 8, stop["y"] + 8), fill=fill)
    here = shown[-1]
    if picture is not None:
        x, y = beside(here)
        frame.paste(fit(picture, PW, PH), (int(x), int(y)))
        draw.rectangle((x - 2, y - 2, x + PW + 2, y + PH + CAP), outline=(127, 212, 255), width=2)
        text(draw, (x + 8, y + PH + 4), caption, small, (127, 212, 255))
        near_x = x if x > here["x"] else x + PW
        draw.line([(here["x"], here["y"]), (near_x, y + PH / 2)], fill=(127, 212, 255), width=2)
        draw.ellipse((here["x"] - 6, here["y"] - 6, here["x"] + 6, here["y"] + 6), fill=(127, 212, 255))
    return frame.resize((OUT_W, round(H * SCALE)), Image.Resampling.LANCZOS)


def main():
    fixes = load_track()
    if not fixes:
        sys.exit("no track")
    bursts = bursts_of(pictured_shots(fixes))
    beats = [(burst, burst["shot"]) for burst in bursts]
    if not beats:
        sys.exit("no pictured stops")

    streets = Image.open(MAP_PNG).convert("RGBA")
    black = Image.new("RGBA", streets.size, (0, 0, 0, 255))
    base = Image.alpha_composite(black, streets).convert("RGB")
    small = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 18)
    font = small

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.gif"):
        old.unlink()
    frame_dir = OUT_DIR / "frames"
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir()
    cache = frame_dir / "src"
    cache.mkdir()

    # The route is only the pictured stays, in the order they are reached.
    stops = []
    sequence = []
    for stay, shot in beats:
        if not stops or metres(stops[-1], stay) > PLACE_M:
            stops.append({"x": stay["x"], "y": stay["y"], "lon": stay["lon"], "lat": stay["lat"]})
        picture = load_picture(shot, cache)
        if picture is None:
            continue
        day = datetime.strptime(shot["day"], "%Y-%m-%d").strftime("%a %-d %b")
        sequence.append((len(stops) - 1, picture, f"{day}  {shot['clock']}", shot["name"]))

    frames = []
    for index, (upto, picture, caption, name) in enumerate(sequence):
        img = paint(base, stops, upto, picture, caption, font, small)
        # Held long enough to see the picture, then the route moves on.
        copies = 2 if index < len(sequence) - 1 else 4
        for _ in range(copies):
            frames.append(img)
        print(f"  {caption}  {name}")

    for i, img in enumerate(frames):
        img.save(frame_dir / f"{i:04d}.png")
    gif = OUT_DIR / "hermes-route.gif"
    subprocess.check_call([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", str(FPS), "-i", str(frame_dir / "%04d.png"),
        "-vf", "palettegen=stats_mode=diff:reserve_transparent=0",
        str(frame_dir / "palette.png"),
    ])
    subprocess.check_call([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", str(FPS), "-i", str(frame_dir / "%04d.png"),
        "-i", str(frame_dir / "palette.png"),
        "-lavfi", "paletteuse=dither=bayer:bayer_scale=3",
        "-loop", "0", str(gif),
    ])
    shutil.rmtree(frame_dir, ignore_errors=True)
    print(f"\n  {len(sequence)} pictured stops  {gif.relative_to(ROOT)}  {gif.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
