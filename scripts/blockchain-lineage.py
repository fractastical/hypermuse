#!/usr/bin/env python3
"""Chains on a year line. Bar height is GitHub stars on that chain's client."""

import datetime as dt

from PIL import Image, ImageDraw, ImageFont

OUT = "book/blockchain-lineage.png"
W, H = 2500, 720
BG = (244, 239, 228)
INK = (28, 24, 20)
RULE = (90, 72, 52)
MUTED = (92, 78, 62)
ROOT_BG = (28, 48, 38)
ROOT_FG = (244, 239, 228)
JOIN_BG = (46, 62, 88)
BOX = (255, 251, 244)
EDGE = (42, 34, 26)

GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_B = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

F_TITLE = ImageFont.truetype(GEORGIA_B, 36)
F_SUB = ImageFont.truetype(GEORGIA, 18)
F_LABEL = ImageFont.truetype(GEORGIA_B, 16)
F_TICK = ImageFont.truetype(GEORGIA, 14)
F_FOOT = ImageFont.truetype(GEORGIA, 15)

# name, launch date, stars on the client repo, rollup or not.
# Stars fetched from GitHub on 22 September 2026.
CHAINS = [
    ("Bitcoin", "2009-01-03", 90232, False),
    ("Litecoin", "2011-10-07", 4604, False),
    ("XRP", "2012-07-01", 5196, False),
    ("Dogecoin", "2013-12-06", 15231, False),
    ("Dash", "2014-01-18", 1538, False),
    ("Monero", "2014-04-18", 10866, False),
    ("Stellar", "2014-07-31", 3302, False),
    ("Ethereum", "2015-07-30", 51365, False),
    ("Decred", "2016-02-08", 775, False),
    ("Zcash", "2016-10-28", 5490, False),
    ("Bitcoin Cash", "2017-08-01", 99, False),
    ("Cardano", "2017-09-29", 3179, False),
    ("Tezos", "2018-09-17", 1499, False),
    ("Tron", "2018-06-25", 4161, False),
    ("Bitcoin SV", "2018-11-15", 700, False),
    ("Cosmos", "2019-03-13", 573, False),
    ("Algorand", "2019-06-19", 1437, False),
    ("Solana", "2020-03-16", 14942, False),
    ("Polkadot", "2020-05-26", 7082, False),
    ("Polygon", "2020-06-01", 1102, True),
    ("BNB Chain", "2020-09-01", 3287, False),
    ("Avalanche", "2020-09-21", 2359, False),
    ("NEAR", "2020-10-13", 2620, False),
    ("Filecoin", "2020-10-15", 2986, False),
    ("Stacks", "2021-01-14", 3061, False),
    ("Optimism", "2021-01-16", 6471, True),
    ("Chia", "2021-03-19", 10795, False),
    ("Mina", "2021-03-23", 2122, False),
    ("ICP", "2021-05-10", 1792, False),
    ("Arbitrum", "2021-08-31", 952, True),
    ("Kaspa", "2021-11-07", 866, False),
    ("Aptos", "2022-10-17", 6433, False),
    ("zkSync", "2023-03-24", 3234, True),
    ("Sui", "2023-05-03", 7754, False),
    ("Base", "2023-08-09", 68368, True),
    ("Sei", "2023-08-15", 2841, False),
    ("Scroll", "2023-10-08", 740, True),
    ("Celestia", "2023-10-31", 417, False),
    ("Taiko", "2024-05-27", 4555, True),
    ("Hyperliquid", "2024-05-24", 504, False),
    ("World Chain", "2024-10-17", 115, True),
    ("Berachain", "2025-02-06", 326, False),
    ("Monad", "2025-11-24", 1224, False),
]


def year_frac(iso):
    y, m, d = (int(p) for p in iso.split("-"))
    day = dt.date(y, m, d)
    start = dt.date(y, 1, 1)
    end = dt.date(y + 1, 1, 1)
    return y + (day - start).days / (end - start).days


YEAR0, YEAR1 = 2008.2, 2026.6
LEFT, RIGHT = 64, W - 64
AXIS = 640
MAX_H = 340
LABEL_H = 30
BAR_W = 11


def x_of(year):
    return LEFT + (year - YEAR0) / (YEAR1 - YEAR0) * (RIGHT - LEFT)


def hits(rect, boxes, pad):
    l, t, r, b = rect
    for ol, ot, orr, ob in boxes:
        if l < orr + pad and r > ol - pad and t < ob + pad and b > ot - pad:
            return True
    return False


def main():
    rows = []
    for name, iso, stars, rollup in CHAINS:
        year = year_frac(iso)
        label = f"{iso[:4]} {name}"
        rows.append({"name": name, "year": year, "stars": stars, "rollup": rollup, "label": label})
    max_stars = max(r["stars"] for r in rows)

    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((LEFT, 28), "Where the chains began", font=F_TITLE, fill=INK)
    d.text((LEFT, 74), "Each name sits on the year the chain launched. Taller means more GitHub stars.", font=F_SUB, fill=MUTED)

    # Keep a same-week pair from painting over each other. The nudge is a
    # few pixels; the label stays on the real year.
    rows.sort(key=lambda r: r["year"])
    last_cx = -1e9
    for r in rows:
        cx = x_of(r["year"])
        if cx < last_cx + BAR_W + 3:
            cx = last_cx + BAR_W + 3
        last_cx = cx
        bh = max(3, r["stars"] / max_stars * MAX_H)
        r["cx"] = cx
        r["year_x"] = x_of(r["year"])
        r["bh"] = bh
        r["bar"] = (cx - BAR_W / 2, AXIS - bh, cx + BAR_W / 2, AXIS)

    bars = [r["bar"] for r in rows]
    for r in sorted(rows, key=lambda r: r["bh"]):
        color = JOIN_BG if r["rollup"] else (ROOT_BG if r["name"] == "Bitcoin" else INK)
        d.rectangle(r["bar"], fill=color)

    placed = []
    for r in sorted(rows, key=lambda r: -r["bh"]):
        tw = d.textlength(r["label"], font=F_LABEL)
        bw = tw + 20
        cx = r["cx"]
        left = cx - bw / 2
        # Keep the word over the chart, not off the edge.
        if left < LEFT:
            left = LEFT
        if left + bw > RIGHT:
            left = RIGHT - bw
        prefer = r["bar"][1] - 8 - LABEL_H
        top = prefer
        rect = (left, top, left + bw, top + LABEL_H)
        guard = 0
        while top > 104 and (hits(rect, placed, 5) or hits(rect, bars, 3)):
            top -= 6
            rect = (left, top, left + bw, top + LABEL_H)
            guard += 1
            if guard > 80:
                break
        r["label_box"] = rect
        placed.append(rect)

    for r in rows:
        l, t, rr, b = r["label_box"]
        bar_top = r["bar"][1]
        # Hairline only. The wide bar is the star count; a dark stem would fake it.
        if b < bar_top - 2:
            d.line((r["cx"], b, r["cx"], bar_top), fill=MUTED, width=1)
        d.ellipse((r["cx"] - 3, AXIS - 3, r["cx"] + 3, AXIS + 3), fill=INK)

    d.line((LEFT, AXIS, RIGHT, AXIS), fill=INK, width=2)
    for year in (2010, 2015, 2020, 2025):
        x = x_of(year)
        d.line((x, AXIS, x, AXIS + 8), fill=MUTED, width=1)
        lab = str(year)
        tw = d.textlength(lab, font=F_TICK)
        d.text((x - tw / 2, AXIS + 14), lab, font=F_TICK, fill=MUTED)

    for r in rows:
        l, t, rr, b = r["label_box"]
        d.rounded_rectangle((l, t, rr, b), radius=7, fill=BOX, outline=EDGE, width=2)
        d.text((l + 10, t + 5), r["label"], font=F_LABEL, fill=INK)

    d.text(
        (LEFT, AXIS + 42),
        "Bar height is stars on the chain's client. Blue is a rollup. Green is Bitcoin. GitHub, 22 September 2026.",
        font=F_FOOT, fill=MUTED,
    )

    im.save(OUT, "PNG")
    print(OUT, im.size, "max", max_stars)


def abstract():
    """Same bars, no words. Decade ticks only. Same height as the other abstracts."""
    im = Image.new("RGB", (W, 640), BG)
    d = ImageDraw.Draw(im)
    axis = 560
    max_h = 460
    max_stars = max(stars for _n, _iso, stars, _roll in CHAINS)

    rows = []
    for name, iso, stars, rollup in CHAINS:
        rows.append({
            "name": name,
            "year": year_frac(iso),
            "stars": stars,
            "rollup": rollup,
        })
    rows.sort(key=lambda r: r["year"])
    last_cx = -1e9
    for r in rows:
        cx = x_of(r["year"])
        if cx < last_cx + BAR_W + 3:
            cx = last_cx + BAR_W + 3
        last_cx = cx
        bh = max(3, r["stars"] / max_stars * max_h)
        r["bar"] = (cx - BAR_W / 2, axis - bh, cx + BAR_W / 2, axis)
        r["bh"] = bh

    for r in sorted(rows, key=lambda r: r["bh"]):
        color = JOIN_BG if r["rollup"] else (ROOT_BG if r["name"] == "Bitcoin" else INK)
        d.rectangle(r["bar"], fill=color)

    d.line((LEFT, axis, RIGHT, axis), fill=INK, width=2)
    for year in (2010, 2015, 2020, 2025):
        x = x_of(year)
        d.line((x, axis, x, axis + 8), fill=MUTED, width=1)

    out = "book/blockchain-lineage-abstract.png"
    im.save(out, "PNG")
    print(out, im.size)


if __name__ == "__main__":
    main()
    abstract()
