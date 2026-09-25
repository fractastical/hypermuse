#!/usr/bin/env python3
"""Timeline of the authentication tree. Position is the year. One line each."""

from PIL import Image, ImageDraw, ImageFont

OUT = "book/merkle-lineage.png"
W, H = 2200, 720
BG = (244, 239, 228)
INK = (28, 24, 20)
RULE = (90, 72, 52)
MUTED = (92, 78, 62)
ROOT_BG = (28, 48, 38)
ROOT_FG = (244, 239, 228)
PAT_BG = (92, 48, 32)
PAT_FG = (255, 244, 232)
JOIN_BG = (46, 62, 88)
BOX = (255, 251, 244)
EDGE = (42, 34, 26)

GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_B = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

F_TITLE = ImageFont.truetype(GEORGIA_B, 36)
F_SUB = ImageFont.truetype(GEORGIA, 18)
F_LABEL = ImageFont.truetype(GEORGIA_B, 18)
F_TICK = ImageFont.truetype(GEORGIA, 14)
F_FOOT = ImageFont.truetype(GEORGIA, 15)

# year is the actual date, as a fraction when the month is known.
# label is one line, and under seven words.
EVENTS = [
    ("patricia", 1968.83, "1968 Patricia", "pat"),
    ("merkle", 1979.45, "1979 Merkle", "root"),
    ("ieee", 1980.33, "1980 Paper", "paper"),
    ("patent", 1982.01, "1982 Patent", "paper"),
    ("mss", 1987.67, "1987 Signatures", "paper"),
    ("bhs", 1993.00, "1993 Timestamps", "time"),
    ("surety", 1994.50, "1994 Surety", "time"),
    ("git", 2005.33, "2005 Git", "sys"),
    ("zfs", 2005.87, "2005 ZFS", "sys"),
    ("dynamo", 2007.83, "2007 Dynamo", "sys"),
    ("cassandra", 2008.58, "2008 Cassandra", "sys"),
    ("bitcoin", 2008.83, "2008 Bitcoin", "sys"),
    ("ct", 2013.45, "2013 CT log", "sys"),
    ("eth", 2014.33, "2014 Ethereum", "join"),
    ("ipfs", 2014.58, "2014 IPFS", "sys"),
    ("verkle", 2018.50, "2018 Verkle", "join"),
]

# Parent, then the things that followed it. Patricia is the exception:
# it is older, and it meets the hash tree at Ethereum.
GROUPS = [
    ("patricia", ["eth"], PAT_BG),
    ("merkle", ["ieee", "patent", "mss"], RULE),
    ("ieee", ["bhs"], RULE),
    ("bhs", ["surety", "git", "zfs", "dynamo", "bitcoin"], RULE),
    ("dynamo", ["cassandra"], RULE),
    ("bitcoin", ["ct", "ipfs", "eth"], RULE),
    ("eth", ["verkle"], RULE),
]

YEAR0, YEAR1 = 1968, 2019
LEFT, RIGHT = 56, W - 56
AXIS = 430
LANE_H = 46
PAD_X = 12


def x_of(year):
    return LEFT + (year - YEAR0) / (YEAR1 - YEAR0) * (RIGHT - LEFT)


def main():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((LEFT, 28), "Where the Merkle tree went", font=F_TITLE, fill=INK)
    d.text((LEFT, 74), "Each name sits on the year it happened.", font=F_SUB, fill=MUTED)

    placed = []
    for key, year, label, kind in EVENTS:
        tw = d.textlength(label, font=F_LABEL)
        bw = tw + PAD_X * 2
        bh = 36
        cx = x_of(year)
        left = cx - bw / 2
        lane = 0
        while True:
            top = AXIS - 28 - (lane + 1) * LANE_H
            hit = False
            for other in placed:
                if other["lane"] != lane:
                    continue
                if left < other["right"] + 10 and left + bw > other["left"] - 10:
                    hit = True
                    break
            if not hit:
                break
            lane += 1
        placed.append({
            "key": key, "year": year, "label": label, "kind": kind,
            "left": left, "right": left + bw, "top": top, "bottom": top + bh,
            "cx": cx, "lane": lane,
        })

    by = {p["key"]: p for p in placed}
    fills = {
        "root": (ROOT_BG, ROOT_FG),
        "paper": (BOX, INK),
        "time": (BOX, INK),
        "sys": (BOX, INK),
        "join": (JOIN_BG, ROOT_FG),
        "pat": (PAT_BG, PAT_FG),
    }

    # Links hang under the axis, so they never cross a label.
    # Longer spans sit further down.
    spans = []
    for parent, kids, color in GROUPS:
        xs = [by[parent]["cx"]] + [by[k]["cx"] for k in kids]
        spans.append((max(xs) - min(xs), parent, kids, color))
    spans.sort()
    for i, (_, parent, kids, color) in enumerate(spans):
        y = AXIS + 36 + i * 22
        xs = [by[parent]["cx"]] + [by[k]["cx"] for k in kids]
        x0, x1 = min(xs), max(xs)
        d.line((x0, y, x1, y), fill=color, width=3 if color == PAT_BG else 2)
        for key in [parent, *kids]:
            d.line((by[key]["cx"], AXIS, by[key]["cx"], y), fill=color, width=2)

    # Drop a stem from each box to its year. Stop if a lower box is in the way.
    for p in placed:
        y = p["bottom"]
        blocked = AXIS
        for o in placed:
            if o is p:
                continue
            if o["left"] - 2 <= p["cx"] <= o["right"] + 2 and o["top"] >= p["bottom"] - 1:
                blocked = min(blocked, o["top"])
        end = min(AXIS, blocked)
        if end > y + 2:
            d.line((p["cx"], y, p["cx"], end), fill=RULE, width=2)
        d.ellipse((p["cx"] - 4, AXIS - 4, p["cx"] + 4, AXIS + 4), fill=INK)

    d.line((LEFT, AXIS, RIGHT, AXIS), fill=INK, width=2)

    for p in placed:
        fill, fg = fills[p["kind"]]
        d.rounded_rectangle(
            (p["left"], p["top"], p["right"], p["bottom"]),
            radius=8, fill=fill, outline=EDGE, width=2,
        )
        d.text((p["left"] + 12, p["top"] + 7), p["label"], font=F_LABEL, fill=fg)

    foot_y = AXIS + 36 + (len(GROUPS) - 1) * 22 + 28
    d.text((LEFT, foot_y), "Years along the line. Brown is Patricia meeting Ethereum.", font=F_FOOT, fill=MUTED)

    im.save(OUT, "PNG")
    print(OUT, im.size, "lanes", max(p["lane"] for p in placed) + 1)


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


def abstract():
    """Same dates, no names. Color and the branches carry it."""
    im = Image.new("RGB", (W, 640), BG)
    d = ImageDraw.Draw(im)
    axis = 460
    by = {key: x_of(year) for key, year, _label, _kind in EVENTS}
    kind = {key: k for key, _year, _label, k in EVENTS}

    depth = {"merkle": 0}
    for parent, kids, _color in GROUPS:
        if parent == "patricia":
            continue
        for kid in kids:
            depth[kid] = depth[parent] + 1

    def hy(level):
        return axis - 28 - level * 42

    for parent, kids, color in GROUPS:
        if parent == "patricia":
            continue
        xs = [by[parent]] + [by[k] for k in kids]
        y = hy(depth[kids[0]])
        d.line((min(xs), y, max(xs), y), fill=color, width=2)
        d.line((by[parent], hy(depth[parent]), by[parent], y), fill=color, width=2)

    for key, level in depth.items():
        d.line((by[key], axis, by[key], hy(level)), fill=RULE, width=2)

    eth_x = by["eth"]
    pat_x = by["patricia"]
    arc = quad((pat_x, axis), ((pat_x + eth_x) / 2, axis + 78), (eth_x, axis))
    d.line(arc, fill=PAT_BG, width=3)

    d.line((LEFT, axis, RIGHT, axis), fill=INK, width=2)

    for year in range(1970, 2020, 10):
        x = x_of(year)
        d.line((x, axis, x, axis + 8), fill=MUTED, width=1)
        lab = str(year)
        tw = d.textlength(lab, font=F_TICK)
        d.text((x - tw / 2, axis + 96), lab, font=F_TICK, fill=MUTED)

    radius = {"root": 9, "pat": 8, "join": 7}
    fill = {"root": ROOT_BG, "pat": PAT_BG, "join": JOIN_BG, "paper": INK, "time": INK, "sys": INK}
    for key, x in by.items():
        r = radius.get(kind[key], 5)
        c = fill[kind[key]]
        d.ellipse((x - r, axis - r, x + r, axis + r), fill=c, outline=BG)

    out = "book/merkle-lineage-abstract.png"
    im.save(out, "PNG")
    print(out, im.size)


if __name__ == "__main__":
    main()
    abstract()
