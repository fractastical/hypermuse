#!/usr/bin/env python3
"""Feed and story crops for the book and the smart-contract chart.

Instagram feed is 4:5. Stories are 9:16, with the picture kept out of the
top and bottom bands the app covers. The wide chart is redrawn so the years
stay large enough to read on a phone.
"""

import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "book" / "social"

GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_B = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

BG = (244, 239, 228)
INK = (28, 24, 20)
MUTED = (92, 78, 62)
JOIN = (46, 62, 88)
COVER_BG = (219, 221, 218)

FEED = (1080, 1350)
STORY = (1080, 1920)
YEAR0, YEAR1 = 1994, 2027


def load_usage():
    path = ROOT / "scripts" / "smart-contract-usage.py"
    spec = importlib.util.spec_from_file_location("smart_contract_usage", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def font(path, size):
    return ImageFont.truetype(path, size)


def place_cover(size, max_box):
    cover = Image.open(ROOT / "book" / "blockchain-chronicles-cover.png").convert("RGB")
    cw, ch = cover.size
    max_w, max_h = max_box
    scale = min(max_w / cw, max_h / ch)
    cover = cover.resize((round(cw * scale), round(ch * scale)), Image.Resampling.LANCZOS)
    im = Image.new("RGB", size, COVER_BG)
    im.paste(cover, ((size[0] - cover.width) // 2, (size[1] - cover.height) // 2))
    return im


def chart_card(usage, kind):
    w, h = FEED
    im = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(im)
    title = font(GEORGIA_B, 44)
    sub = font(GEORGIA, 24)
    tick = font(GEORGIA, 20)
    foot = font(GEORGIA, 18)

    d.text((56, 52), "Smart contract", font=title, fill=INK)
    subtitles = {
        "books": "In books, per million words",
        "works": "Works that use the phrase",
        "cites": "Citations of those works",
    }
    d.text((56, 114), subtitles[kind], font=sub, fill=MUTED)

    plot_l, plot_r = 148, w - 56
    axis = 1168
    plot_h = 860
    top = axis - plot_h

    if kind == "books":
        lx = 560
        ly = 128
        d.line((lx, ly, lx + 42, ly), fill=INK, width=4)
        d.text((lx + 52, ly - 14), "smart contract", font=tick, fill=INK)
        d.line((lx, ly + 36, lx + 42, ly + 36), fill=JOIN, width=4)
        d.text((lx + 52, ly + 22), "smart contracts", font=tick, fill=JOIN)

    def x_of(year):
        return plot_l + (year - YEAR0) / (YEAR1 - YEAR0) * (plot_r - plot_l)

    def y_of(value, scale):
        return axis - (value / scale) * plot_h

    scales = {"books": 0.6, "works": 6000, "cites": 70000}
    scale = scales[kind]
    ticks = {
        "books": [(0.2, "0.2"), (0.4, "0.4"), (0.6, "0.6")],
        "works": [(2000, "2,000"), (4000, "4,000"), (6000, "6,000")],
        "cites": [(20000, "20,000"), (40000, "40,000"), (60000, "60,000")],
    }[kind]

    d.line((plot_l, top, plot_l, axis), fill=INK, width=2)
    d.line((plot_l, axis, plot_r, axis), fill=INK, width=2)
    for value, label in ticks:
        y = y_of(value, scale)
        d.line((plot_l - 8, y, plot_l, y), fill=MUTED, width=1)
        tw = d.textlength(label, font=tick)
        d.text((plot_l - 16 - tw, y - 12), label, font=tick, fill=MUTED)

    for year in range(1995, 2026, 5):
        x = x_of(year)
        d.line((x, axis, x, axis + 10), fill=MUTED, width=1)
        lab = str(year)
        tw = d.textlength(lab, font=tick)
        d.text((x - tw / 2, axis + 18), lab, font=tick, fill=MUTED)

    if kind == "books":
        for values, color in (
            (usage.SINGULAR, INK),
            (usage.PLURAL, JOIN),
        ):
            pts = []
            for i, raw in enumerate(values):
                year = 1994 + i
                mid = x_of(year) + (x_of(year + 1) - x_of(year)) / 2
                pts.append((mid, y_of(raw * 1e6, scale)))
            d.line(pts, fill=color, width=4, joint="curve")
            ex, ey = pts[-1]
            d.ellipse((ex - 5, ey - 5, ex + 5, ey + 5), outline=color, width=3)
    else:
        series = usage.WORKS if kind == "works" else usage.CITES
        for year, value in series.items():
            if value <= 0:
                continue
            x0 = x_of(year) + 2
            x1 = x_of(year + 1) - 2
            y = y_of(value, scale)
            color = MUTED if year == 2026 else INK
            d.rectangle((x0, y, x1, axis), outline=color, width=2)

    footers = {
        "books": "Google Books, English. The line stops in 2019, where the corpus ends.",
        "works": "Semantic Scholar, title or abstract. Counted 23 September 2026.",
        "cites": "Same works, placed on the year they were published. Pale is 2026.",
    }
    d.text((56, 1288), footers[kind], font=foot, fill=MUTED)
    return im


def combined(usage):
    """Cover on the left, the three counts on the right, one year axis."""
    book_h, work_h, cite_h = 220, 270, 320
    gap = 52
    top = 44
    book_axis = top + 28 + book_h
    work_axis = book_axis + gap + 28 + work_h
    cite_axis = work_axis + gap + 28 + cite_h
    height = cite_axis + 78

    cover = Image.open(ROOT / "book" / "blockchain-chronicles-cover.png").convert("RGB")
    cover_w = round(height * cover.width / cover.height)
    cover = cover.resize((cover_w, height), Image.Resampling.LANCZOS)

    plot_l = cover_w + 168
    plot_r = plot_l + 1560
    width = plot_r + 56

    im = Image.new("RGB", (width, height), BG)
    im.paste(cover, (0, 0))
    d = ImageDraw.Draw(im)
    row = font(GEORGIA_B, 22)
    tick = font(GEORGIA, 16)
    foot = font(GEORGIA, 16)

    def x_of(year):
        return plot_l + (year - YEAR0) / (YEAR1 - YEAR0) * (plot_r - plot_l)

    def y_of(value, axis, plot_h, scale):
        return axis - (value / scale) * plot_h

    def frame(axis, plot_h, scale, ticks, label, years=False):
        d.text((plot_l, axis - plot_h - 30), label, font=row, fill=INK)
        top_y = axis - plot_h
        d.line((plot_l, top_y, plot_l, axis), fill=INK, width=2)
        d.line((plot_l, axis, plot_r, axis), fill=INK, width=2)
        for value, text in ticks:
            y = y_of(value, axis, plot_h, scale)
            d.line((plot_l - 8, y, plot_l, y), fill=MUTED, width=1)
            tw = d.textlength(text, font=tick)
            d.text((plot_l - 14 - tw, y - 10), text, font=tick, fill=MUTED)
        for year in range(1995, 2026, 5):
            x = x_of(year)
            d.line((x, axis, x, axis + 8), fill=MUTED, width=1)
            if years:
                lab = str(year)
                tw = d.textlength(lab, font=tick)
                d.text((x - tw / 2, axis + 16), lab, font=tick, fill=MUTED)

    frame(book_axis, book_h, 0.6, [(0.2, "0.2"), (0.4, "0.4"), (0.6, "0.6")], "In books, per million words")
    lx = plot_l + 430
    ly = book_axis - book_h - 16
    d.line((lx, ly, lx + 36, ly), fill=INK, width=3)
    d.text((lx + 44, ly - 10), "smart contract", font=tick, fill=INK)
    d.line((lx + 230, ly, lx + 266, ly), fill=JOIN, width=3)
    d.text((lx + 274, ly - 10), "smart contracts", font=tick, fill=JOIN)
    for values, color in ((usage.SINGULAR, INK), (usage.PLURAL, JOIN)):
        pts = []
        for i, raw in enumerate(values):
            year = 1994 + i
            mid = x_of(year) + (x_of(year + 1) - x_of(year)) / 2
            pts.append((mid, y_of(raw * 1e6, book_axis, book_h, 0.6)))
        d.line(pts, fill=color, width=3, joint="curve")
        ex, ey = pts[-1]
        d.ellipse((ex - 4, ey - 4, ex + 4, ey + 4), outline=color, width=2)

    frame(work_axis, work_h, 6000, [(2000, "2,000"), (4000, "4,000"), (6000, "6,000")], "Works that use the phrase")
    frame(
        cite_axis, cite_h, 70000,
        [(20000, "20,000"), (40000, "40,000"), (60000, "60,000")],
        "Citations of those works",
        years=True,
    )
    for series, axis, plot_h, scale in (
        (usage.WORKS, work_axis, work_h, 6000),
        (usage.CITES, cite_axis, cite_h, 70000),
    ):
        for year, value in series.items():
            if value <= 0:
                continue
            x0 = x_of(year) + 2
            x1 = x_of(year + 1) - 2
            y = y_of(value, axis, plot_h, scale)
            color = MUTED if year == 2026 else INK
            d.rectangle((x0, y, x1, axis), outline=color, width=2)

    d.text(
        (plot_l, cite_axis + 48),
        "Books through 2019. Works and citations: Semantic Scholar, 23 September 2026. Pale is 2026, still open.",
        font=foot,
        fill=MUTED,
    )
    return im


def main():
    usage = load_usage()
    OUT.mkdir(exist_ok=True)

    # Story UI covers roughly the top 250px and the bottom 280px.
    place_cover(FEED, (1080, 1350)).save(OUT / "cover-feed.png", "PNG")
    place_cover(STORY, (920, 1280)).save(OUT / "cover-story.png", "PNG")

    names = {"books": "smart-contract-1-books.png", "works": "smart-contract-2-works.png", "cites": "smart-contract-3-citations.png"}
    for kind, name in names.items():
        chart_card(usage, kind).save(OUT / name, "PNG")
        print(name)

    combined(usage).save(OUT / "post.png", "PNG")
    print(OUT / "post.png")


if __name__ == "__main__":
    main()
