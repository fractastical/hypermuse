#!/usr/bin/env python3
# One gif of the week: only the stops a picture can be stood on, about twenty
# of them, in the order Hermes reached them. Two frames from the same minute
# at the same stop are one picture.
#
#   python3 scripts/hermes-route-gifs.py
#
# The ground is the 30 August satellite frame, turned the same way as the
# street map (temple up) and registered so the official street grid lands on
# the city. Stills are turned upright from the camera's own orientation tag.
# Clips contribute a frame from the original, so a phone that stored the
# picture sideways is rotated before it is drawn. A stop with no picture is
# left off.

import json
import math
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
# Clear PlanetScope day, city built, already rotated and cropped to the playa.
SAT_PNG = ROOT / "assets/hermes-annals/city-days/framed/2026-08-30.png"
META_PATH = ROOT / "data/hermes/2026/map/playa-streets-metadata.json"
# The Man on that frame, and metres per pixel. Fitted by laying the street
# grid on the picture: the outer arc meets the outer blocks on both sides.
MAN_PX, MAN_PY = 620, 610
MPP = 3.15
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
MAX_BEATS = 30
# The picture keeps its own shape. A portrait is a tall frame, so it is not
# letterboxed into a landscape box with black bars down both sides.
MAX_PW, MAX_PH, CAP = 250, 340, 28

meta = json.loads(META_PATH.read_text())
LAT_SCALE = 111320
LON_SCALE = math.cos(meta["origin"]["lat"] * math.pi / 180) * 111320
COS_R = math.cos(meta["rotation"])
SIN_R = math.sin(meta["rotation"])
with Image.open(SAT_PNG) as _sat:
    W, H = _sat.size
SCALE = OUT_W / W


def screen(lon, lat):
    rx = (lon - meta["origin"]["lon"]) * LON_SCALE
    ry = (lat - meta["origin"]["lat"]) * LAT_SCALE
    x = rx * COS_R - ry * SIN_R
    y = rx * SIN_R + ry * COS_R
    return MAN_PX + x / MPP, MAN_PY - y / MPP


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


def crop_bars(im):
    # A solid black band along an edge is the phone's leftover margin, not the
    # picture. Night sky stays: a band only counts when the whole strip is black.
    im = im.convert("RGB")
    arr = np.asarray(im)
    height, width = arr.shape[:2]
    dark = arr.max(axis=2) < 16
    col = dark.mean(axis=0)
    row = dark.mean(axis=1)
    limit = int(min(width, height) * 0.42)

    def run(mask):
        n = 0
        for value in mask[:limit]:
            if value < 0.98:
                break
            n += 1
        return n

    left, right = run(col), run(col[::-1])
    top, bottom = run(row), run(row[::-1])
    if left + right >= width - 8 or top + bottom >= height - 8:
        return im
    if left or right or top or bottom:
        return im.crop((left, top, width - right, height - bottom))
    return im


def framed(im):
    im = crop_bars(im)
    scale = min(MAX_PW / im.width, MAX_PH / im.height)
    w = max(1, int(round(im.width * scale)))
    h = max(1, int(round(im.height * scale)))
    return im.resize((w, h), Image.Resampling.LANCZOS)


def beside(dot, pw, ph):
    r = 8
    x = dot["x"] + r + 12
    y = dot["y"] - (ph + CAP) / 2
    if x + pw > W - 8:
        x = dot["x"] - r - 12 - pw
    y = min(max(8, y), H - ph - CAP - 8)
    x = min(max(8, x), W - pw - 8)
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


def grab_frame(src, dest, ss):
    result = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-ss", str(ss), "-i", str(src), "-frames:v", "1", str(dest)],
    )
    if result.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
        return dest
    return None


def load_picture(shot, cache):
    src = shot.get("src")
    if src and Path(src).suffix.lower() in {".mp4", ".mov", ".m4v"}:
        dest = cache / (Path(src).stem + ".png")
        if not grab_frame(src, dest, shot.get("ss") or "1"):
            return None
        return Image.open(dest).convert("RGB")
    if src:
        return open_still(src)
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
    shots.extend(burn_shots())
    shots.sort(key=lambda s: s["ms"])
    return shots


def landmark(name):
    data = json.loads((ROOT / "data/hermes/2026/gis/cpns.geojson").read_text())
    wanted = name.lower()
    for feature in data["features"]:
        if str((feature.get("properties") or {}).get("NAME", "")).lower() != wanted:
            continue
        lon, lat = feature["geometry"]["coordinates"]
        return float(lon), float(lat)
    raise SystemExit(f"missing {name}")


def burn_shots():
    # The logger was off for both burns, so each picture is stood on the
    # landmark. The wide still of Saturday night is the crowd, with the Man a
    # speck. The frame that shows him burning is late in IMG_2982. The clock
    # is the still beside it, 10:07 PM, the only time that camera kept.
    man = (meta["origin"]["lon"], meta["origin"]["lat"])
    temple = landmark("The Temple")
    # The burn-night clips have no camera clock, only an export date. They
    # were shot before the 10:07 still, so they sit ahead of it. The caption
    # stays the day, rather than a minute we do not have.
    specs = [
        (
            ROOT / "assets/burnnight/IMG_2964.mp4",
            "25",
            datetime(2026, 9, 5, 21, 20, tzinfo=TZ),
            man,
            "",
        ),
        (
            ROOT / "assets/burnnight/IMG_2973.mp4",
            "6",
            datetime(2026, 9, 5, 21, 40, tzinfo=TZ),
            man,
            "",
        ),
        (
            ROOT / "assets/burnnight/IMG_2982.mp4",
            "23",
            datetime(2026, 9, 5, 22, 7, 26, tzinfo=TZ),
            man,
            None,
        ),
        (
            ROOT / "assets/hermes-annals/2026-09-06/IMG_4542.jpg",
            None,
            datetime(2026, 9, 6, 20, 6, 23, tzinfo=TZ),
            temple,
            None,
        ),
    ]
    shots = []
    for path, ss, when, (lon, lat), clock in specs:
        if not path.exists():
            continue
        shots.append({
            "name": path.name,
            "src": path,
            "ss": ss,
            "ms": when.timestamp() * 1000,
            "when": when,
            "lat": lat,
            "lon": lon,
            "video": path.suffix.lower() in {".mp4", ".mov", ".m4v"},
            "clock": when.strftime("%-I:%M %p") if clock is None else clock,
            "day": when.strftime("%Y-%m-%d"),
        })
    return shots


# These clips are a different picture from the frame the burst kept, so each
# one stays its own stop instead of being folded into the neighbour.
SPLIT_CLIPS = ("IMG_4330", "IMG_4345", "IMG_4508")


def own_stop(shot):
    return any(token in shot["name"] for token in SPLIT_CLIPS)


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
        burst["t"] = burst["shot"]["ms"]
    # A second clip from the same stop, when it is a different picture.
    added = []
    for burst in bursts:
        for shot in burst["shots"]:
            if not own_stop(shot) or shot is burst["shot"]:
                continue
            added.append({
                "lon": shot["lon"], "lat": shot["lat"], "end": shot["ms"],
                "shots": [shot], "shot": shot, "t": shot["ms"],
                "x": burst["x"], "y": burst["y"],
            })
    bursts.extend(added)
    bursts.sort(key=lambda b: b["t"])
    if len(bursts) > MAX_BEATS:
        step = len(bursts) / MAX_BEATS
        bursts = [bursts[min(len(bursts) - 1, int(i * step))] for i in range(MAX_BEATS)]
    return bursts


def square_box(stops):
    # The horseshoe, the dots, and the pictures. The spare desert falls away,
    # and what remains is square.
    bounds = meta["bounds"]
    x0 = MAN_PX + bounds["minX"] / MPP
    x1 = MAN_PX + bounds["maxX"] / MPP
    y0 = MAN_PY - bounds["maxY"] / MPP
    y1 = MAN_PY - bounds["minY"] / MPP
    for stop in stops:
        bx, by = beside(stop, MAX_PW, MAX_PH)
        x0 = min(x0, stop["x"] - 18, bx - 6)
        y0 = min(y0, stop["y"] - 18, by - 6)
        x1 = max(x1, stop["x"] + 18, bx + MAX_PW + 6)
        y1 = max(y1, stop["y"] + 18, by + MAX_PH + CAP + 6)
    # A margin, so the horseshoe is not sliced flush with the frame.
    pad = 56
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    side = min(max(x1 - x0, y1 - y0), W, H)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left = min(max(0, cx - side / 2), W - side)
    top = min(max(0, cy - side / 2), H - side)
    if left > x0:
        left = max(0, x0)
    if top > y0:
        top = max(0, y0)
    if left + side < x1:
        left = min(W - side, x1 - side)
    if top + side < y1:
        top = min(H - side, y1 - side)
    left, top = int(round(left)), int(round(top))
    side = int(round(side))
    bottom = top + side
    # The built city runs past the last street line. Slide the square down
    # so that edge stays inside, without pushing the northern dots off.
    city_bottom = MAN_PY - bounds["minY"] / MPP
    highest = min(stop["y"] for stop in stops) - 36
    shift = min(max(0, city_bottom + 130 - bottom), H - bottom, max(0, highest - top))
    top += int(shift)
    return (left, top, left + side, top + side)


def paint(base, stops, upto, picture, caption, font, small, crop):
    frame = base.copy()
    draw = ImageDraw.Draw(frame)
    shown = stops[: upto + 1]
    for a, b in zip(shown, shown[1:]):
        curve = quad((a["x"], a["y"]), (b["x"], b["y"]))
        # A dark stroke under the orange, so the route reads on pale playa.
        draw_dashed(draw, curve, (42, 24, 8), width=7)
        draw_dashed(draw, curve, (255, 157, 61), width=3)
    for i, stop in enumerate(shown):
        fill = (125, 255, 168) if i == 0 else (255, 209, 102)
        if i == len(shown) - 1:
            fill = (127, 212, 255)
        draw.ellipse((stop["x"] - 11, stop["y"] - 11, stop["x"] + 11, stop["y"] + 11), fill=(24, 16, 8))
        draw.ellipse((stop["x"] - 8, stop["y"] - 8, stop["x"] + 8, stop["y"] + 8), fill=fill)
    here = shown[-1]
    if picture is not None:
        picture = framed(picture)
        pw, ph = picture.size
        x, y = beside(here, pw, ph)
        frame.paste(picture, (int(x), int(y)))
        draw.rectangle((x - 2, y - 2, x + pw + 2, y + ph + CAP), outline=(127, 212, 255), width=2)
        text(draw, (x + 8, y + ph + 4), caption, small, (127, 212, 255))
        near_x = x if x > here["x"] else x + pw
        draw.line([(here["x"], here["y"]), (near_x, y + ph / 2)], fill=(127, 212, 255), width=2)
        draw.ellipse((here["x"] - 6, here["y"] - 6, here["x"] + 6, here["y"] + 6), fill=(127, 212, 255))
    frame = frame.crop(crop)
    return frame.resize((OUT_W, OUT_W), Image.Resampling.LANCZOS)


def main():
    fixes = load_track()
    if not fixes:
        sys.exit("no track")
    bursts = bursts_of(pictured_shots(fixes))
    beats = [(burst, burst["shot"]) for burst in bursts]
    if not beats:
        sys.exit("no pictured stops")

    base = Image.open(SAT_PNG).convert("RGB")
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
        clock = shot["clock"]
        caption = f"{day}  {clock}" if clock else day
        sequence.append((len(stops) - 1, picture, caption, shot["name"]))

    crop = square_box(stops)
    frames = []
    for index, (upto, picture, caption, name) in enumerate(sequence):
        img = paint(base, stops, upto, picture, caption, font, small, crop)
        # Held long enough to see the picture, then the route moves on.
        # The burns are held, so a one-second flash is not the only look at them.
        copies = 4 if "2982" in name or index == len(sequence) - 1 else 2
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
    mp4 = OUT_DIR / "hermes-route.mp4"
    subprocess.check_call([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", str(FPS), "-i", str(frame_dir / "%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-movflags", "+faststart", str(mp4),
    ])
    shutil.rmtree(frame_dir, ignore_errors=True)
    print(f"\n  {len(sequence)} pictured stops  {gif.relative_to(ROOT)}  {gif.stat().st_size/1024:.0f} KB")
    print(f"  {mp4.relative_to(ROOT)}  {mp4.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
