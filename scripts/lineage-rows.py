#!/usr/bin/env python3
"""Four abstracts, one row each, with no words. Authors sit on top."""

import importlib.util
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "book" / "lineage-abstract-rows.png"
W = 2500
LEFT, RIGHT = 64, W - 64
# One span for every row, so a year lands in the same place on each line.
SPAN = (1900, 2026)
TICKS = range(1900, 2021, 20)
# Space above the first row, below the last, and between the ink of one row and the next.
MARGIN = 28
GAP = 48
BG = (244, 239, 228)
INK = (28, 24, 20)
RULE = (90, 72, 52)
MUTED = (92, 78, 62)


def load(name):
    path = ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.replace(".py", ""), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def x_of(year, y0, y1):
    return LEFT + (year - y0) / (y1 - y0) * (RIGHT - LEFT)


def quad(p0, p1, p2, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return pts


def ticks(d, axis, years, y0, y1):
    for year in years:
        x = x_of(year, y0, y1)
        d.line((x, axis, x, axis + 8), fill=MUTED, width=1)


def draw_authors(d, axis, m):
    max_h = 480
    rows = []
    for start, end, words in m.AUTHORS:
        span = (end - start) + 1
        rows.append((span, words / span, start, end))
    tallest = max(per for _span, per, _s, _e in rows)
    for _span, per, start, end in sorted(rows, key=lambda r: -r[0]):
        x0 = x_of(start, *SPAN)
        x1 = x_of(end + 1, *SPAN)
        bh = max(4, per / tallest * max_h)
        d.rectangle((x0, axis - bh, x1, axis), outline=INK, width=2)


def draw_merkle(d, axis, m):
    by = {key: x_of(year, *SPAN) for key, year, _label, _kind in m.EVENTS}
    kind = {key: k for key, _year, _label, k in m.EVENTS}
    depth = {"merkle": 0}
    for parent, kids, _color in m.GROUPS:
        if parent == "patricia":
            continue
        for kid in kids:
            depth[kid] = depth[parent] + 1

    def hy(level):
        return axis - 28 - level * 42

    for parent, kids, color in m.GROUPS:
        if parent == "patricia":
            continue
        xs = [by[parent]] + [by[k] for k in kids]
        y = hy(depth[kids[0]])
        d.line((min(xs), y, max(xs), y), fill=color, width=2)
        d.line((by[parent], hy(depth[parent]), by[parent], y), fill=color, width=2)

    for key, level in depth.items():
        d.line((by[key], axis, by[key], hy(level)), fill=RULE, width=2)

    eth_x, pat_x = by["eth"], by["patricia"]
    d.line(quad((pat_x, axis), ((pat_x + eth_x) / 2, axis + 78), (eth_x, axis)), fill=m.PAT_BG, width=3)
    radius = {"root": 9, "pat": 8, "join": 7}
    fill = {"root": m.ROOT_BG, "pat": m.PAT_BG, "join": m.JOIN_BG, "paper": INK, "time": INK, "sys": INK}
    for key, x in by.items():
        r = radius.get(kind[key], 5)
        d.ellipse((x - r, axis - r, x + r, axis + r), fill=fill[kind[key]], outline=BG)


def draw_dh(d, axis, m):
    by = {key: x_of(year, *SPAN) for key, year, _label, _kind in m.EVENTS}
    kind = {key: k for key, _year, _label, k in m.EVENTS}
    depth = {"dh": 0}
    for parent, kids, _color in m.GROUPS:
        if parent in ("ellis", "will"):
            continue
        for kid in kids:
            depth[kid] = depth[parent] + 1

    def hy(level):
        return axis - 28 - level * 42

    for parent, kids, color in m.GROUPS:
        if parent in ("ellis", "will"):
            continue
        xs = [by[parent]] + [by[k] for k in kids]
        y = hy(depth[kids[0]])
        d.line((min(xs), y, max(xs), y), fill=color, width=2)
        d.line((by[parent], hy(depth[parent]), by[parent], y), fill=color, width=2)

    for key, level in depth.items():
        d.line((by[key], axis, by[key], hy(level)), fill=RULE, width=2)

    y_prior = axis + 72
    d.line((by["ellis"], y_prior, by["dh"], y_prior), fill=m.PRIOR_BG, width=3)
    for key in ("ellis", "will", "dh"):
        d.line((by[key], axis, by[key], y_prior), fill=m.PRIOR_BG, width=3)

    radius = {"root": 9, "prior": 8, "join": 7}
    fill = {"root": m.ROOT_BG, "prior": m.PRIOR_BG, "join": m.JOIN_BG, "paper": INK, "sys": INK}
    for key, x in by.items():
        r = radius.get(kind[key], 5)
        d.ellipse((x - r, axis - r, x + r, axis + r), fill=fill[kind[key]], outline=BG)


# USD market cap from CoinGecko, 22 September 2026. Base has no traded coin here.
# Depth uses the square root, so a coin worth four times as much is twice as deep.
CAP = {
    "Bitcoin": 1751158405010,
    "Litecoin": 4965434645,
    "XRP": 103158167962,
    "Dogecoin": 16171621078,
    "Dash": 809358139,
    "Monero": 10781334769,
    "Stellar": 7818001782,
    "Ethereum": 339414005714,
    "Decred": 329330103,
    "Zcash": 27157467693,
    "Bitcoin Cash": 6797131922,
    "Cardano": 9757555207,
    "Tezos": 374837486,
    "Tron": 32695382497,
    "Bitcoin SV": 462608276,
    "Cosmos": 975789525,
    "Algorand": 1028041529,
    "Solana": 70224989989,
    "Polkadot": 2042086865,
    "Polygon": 1181567583,
    "BNB Chain": 105821274613,
    "Avalanche": 4932387315,
    "NEAR": 5714549171,
    "Filecoin": 869189785,
    "Stacks": 626372944,
    "Optimism": 312426336,
    "Chia": 31022576,
    "Mina": 203146455,
    "ICP": 1685144658,
    "Arbitrum": 1650844653,
    "Kaspa": 1177843988,
    "Aptos": 729718881,
    "zkSync": 127946125,
    "Sui": 4215682395,
    "Base": 0,
    "Sei": 414422884,
    "Scroll": 4721679,
    "Celestia": 492345503,
    "Taiko": 19404060,
    "Hyperliquid": 21694495743,
    "World Chain": 1696401912,
    "Berachain": 79678815,
    "Monad": 319310674,
}


def stroke_rect(d, x0, y0, x1, y1, color):
    d.rectangle((x0, y0, x1, y1), outline=color, width=2)


def draw_chains(d, axis, m):
    max_h = 430
    # Forward reach is market cap. Four times the earlier scale, so the spread is readable.
    max_d = 78 * 4
    max_stars = max(stars for _n, _iso, stars, _roll in m.CHAINS)
    max_cap = max(CAP.values())
    rows = []
    for name, iso, stars, rollup in m.CHAINS:
        cap = CAP.get(name, 0)
        rows.append({
            "name": name,
            "year": m.year_frac(iso),
            "stars": stars,
            "rollup": rollup,
            "depth": 0 if cap <= 0 else math.sqrt(cap / max_cap) * max_d,
        })
    rows.sort(key=lambda r: r["year"])
    for r in rows:
        # The left edge is the year. Market cap runs forward, to the right, in the plane.
        x0 = x_of(r["year"], *SPAN)
        bh = max(3, r["stars"] / max_stars * max_h)
        r["box"] = (x0, axis - bh, x0 + m.BAR_W + r["depth"], axis)

    for r in rows:
        x0, y0, x1, y1 = r["box"]
        color = m.JOIN_BG if r["rollup"] else (m.ROOT_BG if r["name"] == "Bitcoin" else INK)
        stroke_rect(d, x0, y0, x1, y1, color)


def draw_contracts(d, axis, m):
    """One row. Solid line is the singular, dotted line the plural.
    The wider bar is citations, the thinner bar is the works."""
    plot_h = 280
    work_max = max(m.WORKS.values())
    cite_max = max(m.CITES.values())
    for year in range(1994, 2027):
        x0 = x_of(year, *SPAN) + 1
        x1 = x_of(year + 1, *SPAN) - 1
        if x1 - x0 < 4:
            continue
        color = MUTED if year == 2026 else INK
        slot = x1 - x0
        cites = m.CITES.get(year, 0)
        works = m.WORKS.get(year, 0)
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
            mid = (x_of(year, *SPAN) + x_of(year + 1, *SPAN)) / 2
            pts.append((mid, axis - (raw * 1e6) / 0.6 * plot_h))
        return pts

    d.line(line_pts(m.SINGULAR), fill=INK, width=2)
    m.dashed(d, line_pts(m.PLURAL), m.JOIN, dash=3, gap=7, width=2)


def main():
    authors = load("authors-words.py")
    merkle = load("merkle-lineage.py")
    dh = load("diffie-hellman-lineage.py")
    chains = load("blockchain-lineage.py")
    contracts = load("smart-contract-usage.py")
    # How far the ink runs above and below each axis.
    # Merkle's arc and the Diffie–Hellman step hang below the line.
    spans = (
        (480, 14),
        (28 + 5 * 42, 46),
        (28 + 3 * 42, 78),
        (430, 14),
        (280, 14),
    )
    axes = []
    y = MARGIN
    for above, below in spans:
        axes.append(y + above)
        y += above + below + GAP
    height = y - GAP + MARGIN
    im = Image.new("RGB", (W, height), BG)
    d = ImageDraw.Draw(im)
    draw_authors(d, axes[0], authors)
    draw_merkle(d, axes[1], merkle)
    draw_dh(d, axes[2], dh)
    draw_chains(d, axes[3], chains)
    draw_contracts(d, axes[4], contracts)
    im.save(OUT, "PNG")
    print(OUT.name, im.size)


if __name__ == "__main__":
    main()
