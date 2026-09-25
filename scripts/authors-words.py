#!/usr/bin/env python3
"""Open rectangles, no words. Sides are the years. Area is the word count."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "book" / "authors-words-abstract.png"
W, H = 2500, 640
BG = (244, 239, 228)
INK = (28, 24, 20)
MUTED = (92, 78, 62)

# First year, last year, words. A single year fills that year.
# A stated range uses its middle:
# Mises 450–475k, Heinlein 640–675k, Hayek 700–860k,
# Sterling 705–755k, Stephenson 754–817k.
AUTHORS = [
    (1922, 1944, 462_500),
    (1936, 1982, 1_400_000),
    (1938, 1949, 212_000),
    (1940, 1982, 657_500),
    (1944, 1988, 780_000),
    (1962, 1985, 446_000),
    (1968, 1975, 402_000),
    (1981, 1999, 484_000),
    (1984, 2020, 1_230_000),
    (1985, 1985, 106_000),
    (1985, 1998, 730_000),
    (1992, 1999, 785_500),
]

YEAR0, YEAR1 = 1916, 2026
LEFT, RIGHT = 64, W - 64
AXIS = 560
MAX_H = 480


def x_of(year):
    return LEFT + (year - YEAR0) / (YEAR1 - YEAR0) * (RIGHT - LEFT)


def main():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    rows = []
    for start, end, words in AUTHORS:
        span = (end - start) + 1
        rows.append((span, words / span, start, end))
    tallest = max(per for _span, per, _s, _e in rows)

    d.line((LEFT, AXIS, RIGHT, AXIS), fill=INK, width=2)
    for year in range(1920, 2021, 10):
        x = x_of(year)
        d.line((x, AXIS, x, AXIS + 8), fill=MUTED, width=1)

    for _span, per, start, end in sorted(rows, key=lambda r: -r[0]):
        x0 = x_of(start)
        x1 = x_of(end + 1)
        bh = max(4, per / tallest * MAX_H)
        d.rectangle((x0, AXIS - bh, x1, AXIS), outline=INK, width=2)

    im.save(OUT, "PNG")
    print(OUT, im.size)


if __name__ == "__main__":
    main()
