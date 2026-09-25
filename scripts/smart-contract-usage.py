#!/usr/bin/env python3
"""Smart contract, on a year axis. Open strokes. Counts run up the vertical axis."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "book" / "smart-contract-usage.png"

W = 2500
BG = (244, 239, 228)
INK = (28, 24, 20)
MUTED = (92, 78, 62)
JOIN = (46, 62, 88)

GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_B = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
F_TITLE = ImageFont.truetype(GEORGIA_B, 36)
F_SUB = ImageFont.truetype(GEORGIA, 18)
F_ROW = ImageFont.truetype(GEORGIA_B, 20)
F_TICK = ImageFont.truetype(GEORGIA, 15)
F_FOOT = ImageFont.truetype(GEORGIA, 16)

# Google Books Ngram, English 2019 corpus. Fraction of words, 1994 through 2019.
# Later years in that file are empty because the corpus stops, not because the phrase does.
SINGULAR = [
    8.754973135349786e-11, 1.271808769409688e-10, 3.004306525777878e-10,
    1.7337835334085838e-10, 4.258860278327781e-11, 2.1007881545465068e-10,
    1.4951685445296903e-09, 3.080331822946647e-10, 3.613870314111978e-11,
    4.845850942736263e-10, 4.733705094572827e-10, 1.0740994205171717e-10,
    4.1285916352329366e-10, 2.692651934754764e-10, 3.313366941926077e-11,
    2.0582344162356492e-10, 3.576269558269729e-10, 1.0566136854350816e-10,
    2.7628324975048635e-11, 8.184705690972294e-11, 1.0185878807078552e-09,
    3.3038671798379937e-09, 1.8565836867878716e-08, 6.116468398431607e-08,
    2.204753428713957e-07, 5.264653282210929e-07,
]
PLURAL = [
    0.0, 4.2393623334024966e-11, 4.291866514960496e-11,
    1.7337835334085838e-10, 2.5553162363856075e-10, 1.2604728372167529e-10,
    7.284154390774233e-10, 2.6952903797727856e-10, 1.8069351570559888e-10,
    7.26877669166015e-10, 7.776800869940814e-10, 7.160663034744275e-11,
    1.3761972117443122e-10, 1.009744510227506e-10, 4.970050482278054e-10,
    1.0291172081178246e-10, 4.29152324787907e-10, 3.169841056305245e-10,
    2.762832462810394e-10, 3.001058568319337e-10, 2.9014322056042374e-09,
    8.312956545353245e-09, 4.432994060721285e-08, 8.882536661758422e-08,
    2.7196901442039234e-07, 5.875573378943955e-07,
]

# Semantic Scholar, exact phrase in title or abstract, 23 September 2026.
# Records dated before 1994 are omitted: a handful of catalog dates, not the phrase.
WORKS = {
    1995: 1, 1996: 2, 1997: 1, 1999: 1, 2000: 1, 2002: 1, 2003: 4,
    2005: 5, 2006: 1, 2008: 3, 2010: 5, 2011: 5, 2013: 2, 2014: 10,
    2015: 26, 2016: 123, 2017: 446, 2018: 1324, 2019: 2111, 2020: 2392,
    2021: 2518, 2022: 2606, 2023: 3133, 2024: 3925, 2025: 5656, 2026: 3304,
}
CITES = {
    1996: 8, 1997: 1936, 1999: 80, 2000: 78, 2002: 2, 2003: 15,
    2010: 3, 2011: 116, 2013: 27, 2014: 504, 2015: 11395, 2016: 19377,
    2017: 29727, 2018: 60688, 2019: 62349, 2020: 61191, 2021: 50624,
    2022: 36626, 2023: 27920, 2024: 23630, 2025: 12035, 2026: 989,
}

YEAR0, YEAR1 = 1994, 2027
PLOT_L, PLOT_R = 168, W - 72


def x_of(year):
    return PLOT_L + (year - YEAR0) / (YEAR1 - YEAR0) * (PLOT_R - PLOT_L)


def y_of(value, axis, plot_h, scale):
    return axis - (value / scale) * plot_h


def axes(d, axis, plot_h, scale, ticks):
    top = axis - plot_h
    d.line((PLOT_L, top, PLOT_L, axis), fill=INK, width=2)
    d.line((PLOT_L, axis, PLOT_R, axis), fill=INK, width=2)
    for value, label in ticks:
        y = y_of(value, axis, plot_h, scale)
        d.line((PLOT_L - 7, y, PLOT_L, y), fill=MUTED, width=1)
        tw = d.textlength(label, font=F_TICK)
        d.text((PLOT_L - 14 - tw, y - 9), label, font=F_TICK, fill=MUTED)
    for year in range(1995, 2026, 5):
        x = x_of(year)
        d.line((x, axis, x, axis + 8), fill=MUTED, width=1)


def year_labels(d, axis):
    for year in range(1995, 2026, 5):
        x = x_of(year)
        lab = str(year)
        tw = d.textlength(lab, font=F_TICK)
        d.text((x - tw / 2, axis + 14), lab, font=F_TICK, fill=MUTED)


def bars(d, series, axis, plot_h, scale):
    for year, value in series.items():
        if value <= 0:
            continue
        x0 = x_of(year) + 2
        x1 = x_of(year + 1) - 2
        y = y_of(value, axis, plot_h, scale)
        color = MUTED if year == 2026 else INK
        d.rectangle((x0, y, x1, axis), outline=color, width=2)


def line(d, values, year0, axis, plot_h, scale, color):
    pts = []
    for i, value in enumerate(values):
        pts.append((x_of(year0 + i) + (x_of(year0 + i + 1) - x_of(year0 + i)) / 2, y_of(value, axis, plot_h, scale)))
    d.line(pts, fill=color, width=3, joint="curve")


def main():
    assert len(SINGULAR) == len(PLURAL) == 26
    book_h, work_h, cite_h = 220, 280, 340
    gap = 78
    head = 128
    book_axis = head + 36 + book_h
    work_axis = book_axis + gap + 36 + work_h
    cite_axis = work_axis + gap + 36 + cite_h
    height = cite_axis + 78

    im = Image.new("RGB", (W, height), BG)
    d = ImageDraw.Draw(im)
    d.text((64, 32), "Smart contract", font=F_TITLE, fill=INK)
    d.text(
        (64, 80),
        "Years run left to right. The count runs up. A year is as wide as that year.",
        font=F_SUB,
        fill=MUTED,
    )

    d.text((PLOT_L, book_axis - book_h - 34), "In books, per million words", font=F_ROW, fill=INK)
    legend_y = book_axis - book_h - 24
    lx = PLOT_L + 360
    d.line((lx, legend_y, lx + 36, legend_y), fill=INK, width=3)
    d.text((lx + 44, legend_y - 10), "smart contract", font=F_TICK, fill=INK)
    lx2 = lx + 220
    d.line((lx2, legend_y, lx2 + 36, legend_y), fill=JOIN, width=3)
    d.text((lx2 + 44, legend_y - 10), "smart contracts", font=F_TICK, fill=JOIN)

    # Per million words. 0.6 leaves the 2019 plural just under the top.
    book_scale = 0.6
    axes(d, book_axis, book_h, book_scale, [(0.2, "0.2"), (0.4, "0.4"), (0.6, "0.6")])
    line(d, [v * 1e6 for v in SINGULAR], 1994, book_axis, book_h, book_scale, INK)
    line(d, [v * 1e6 for v in PLURAL], 1994, book_axis, book_h, book_scale, JOIN)

    d.text((PLOT_L, work_axis - work_h - 34), "Works that use the phrase", font=F_ROW, fill=INK)
    axes(d, work_axis, work_h, 6000, [(2000, "2,000"), (4000, "4,000"), (6000, "6,000")])
    bars(d, WORKS, work_axis, work_h, 6000)

    d.text((PLOT_L, cite_axis - cite_h - 34), "Citations of those works", font=F_ROW, fill=INK)
    axes(d, cite_axis, cite_h, 70000, [(20000, "20,000"), (40000, "40,000"), (60000, "60,000")])
    bars(d, CITES, cite_axis, cite_h, 70000)
    year_labels(d, cite_axis)

    d.text(
        (64, cite_axis + 46),
        "Books: Google Books, English, through 2019. Works and citations: Semantic Scholar, 23 September 2026. The pale year is 2026, still open. Citations sit on the year the work was published.",
        font=F_FOOT,
        fill=MUTED,
    )

    im.save(OUT, "PNG")
    print(OUT, im.size)


def dashed(d, pts, color, dash=8, gap=6, width=2):
    pending = dash
    drawing = True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dist = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        if dist == 0:
            continue
        walked = 0
        while walked < dist:
            step = min(pending, dist - walked)
            t0, t1 = walked / dist, (walked + step) / dist
            if drawing:
                d.line(
                    (x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1),
                    fill=color, width=width,
                )
            walked += step
            pending -= step
            if pending <= 0:
                drawing = not drawing
                pending = gap if not drawing else dash


def abstract():
    """The four series on one year line, 1900 to now. No words."""
    span0, span1 = 1900, 2026
    plot_l, plot_r = 64, W - 64
    plot_h = 480
    axis = 520
    height = 580

    def x_year(year):
        return plot_l + (year - span0) / (span1 - span0) * (plot_r - plot_l)

    im = Image.new("RGB", (W, height), BG)
    d = ImageDraw.Draw(im)
    d.line((plot_l, axis, plot_r, axis), fill=INK, width=2)
    for year in range(1900, 2021, 20):
        x = x_year(year)
        d.line((x, axis, x, axis + 8), fill=MUTED, width=1)

    work_max = max(WORKS.values())
    cite_max = max(CITES.values())
    for year in range(1994, 2027):
        x0 = x_year(year) + 1
        x1 = x_year(year + 1) - 1
        if x1 - x0 < 4:
            continue
        color = MUTED if year == 2026 else INK
        slot = x1 - x0
        cites = CITES.get(year, 0)
        works = WORKS.get(year, 0)
        if cites > 0:
            y = axis - cites / cite_max * plot_h
            d.rectangle((x0, y, x0 + slot * 0.52, axis), outline=color, width=2)
        if works > 0:
            y = axis - works / work_max * plot_h
            d.rectangle((x1 - slot * 0.36, y, x1, axis), outline=color, width=2)

    def line_pts(values):
        pts = []
        for i, raw in enumerate(values):
            year = 1994 + i
            mid = (x_year(year) + x_year(year + 1)) / 2
            pts.append((mid, axis - (raw * 1e6) / 0.6 * plot_h))
        return pts

    d.line(line_pts(SINGULAR), fill=INK, width=2, joint="curve")
    dashed(d, line_pts(PLURAL), JOIN, dash=3, gap=7, width=2)

    out = ROOT / "book" / "smart-contract-usage-abstract.png"
    im.save(out, "PNG")
    im.save(ROOT / "book" / "social" / "post.png", "PNG")
    print(out, im.size)


if __name__ == "__main__":
    main()
    abstract()
