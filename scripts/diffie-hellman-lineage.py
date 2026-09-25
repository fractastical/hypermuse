#!/usr/bin/env python3
"""Timeline of Diffie–Hellman. Position is the year. One line each."""

from PIL import Image, ImageDraw, ImageFont

OUT = "book/diffie-hellman-lineage.png"
W, H = 2200, 720
BG = (244, 239, 228)
INK = (28, 24, 20)
RULE = (90, 72, 52)
MUTED = (92, 78, 62)
ROOT_BG = (28, 48, 38)
ROOT_FG = (244, 239, 228)
PRIOR_BG = (92, 48, 32)
PRIOR_FG = (255, 244, 232)
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
    ("ellis", 1970.04, "1970 Ellis", "prior"),       # CESG, January 1970
    ("will", 1974.06, "1974 Williamson", "prior"),   # 21 January 1974
    ("dh", 1976.87, "1976 Diffie–Hellman", "root"),  # IEEE IT, November 1976
    ("patent", 1980.33, "1980 Patent", "paper"),     # US4200770, 29 April 1980
    ("curves", 1985.63, "1985 Curves", "join"),      # Miller, CRYPTO, August 1985
    ("sts", 1992.42, "1992 STS", "paper"),           # Designs Codes Crypto, 1 June 1992
    ("mqv", 1995.38, "1995 MQV", "paper"),           # SAC, May 1995
    ("ssl", 1996.88, "1996 SSL", "sys"),             # SSL 3.0, 18 November 1996
    ("ike", 1998.87, "1998 IKE", "sys"),             # RFC 2409, November 1998
    ("ecdh", 2000.66, "2000 ECDH", "join"),          # IEEE 1363, 29 August 2000
    ("x3dh", 2016.84, "2016 Signal", "join"),        # X3DH rev 1, 4 November 2016
    ("tls13", 2018.61, "2018 TLS 1.3", "sys"),       # RFC 8446, 10 August 2018
]

# Parent, then what followed. Ellis and Williamson are the exception:
# the same exchange, written at GCHQ and not published until 1997.
GROUPS = [
    ("ellis", ["will"], PRIOR_BG),
    ("will", ["dh"], PRIOR_BG),
    ("dh", ["patent", "curves", "sts", "mqv", "ssl"], RULE),
    ("curves", ["ecdh"], RULE),
    ("sts", ["ike"], RULE),
    ("ecdh", ["x3dh", "tls13"], RULE),
]

YEAR0, YEAR1 = 1968, 2022
LEFT, RIGHT = 56, W - 56
AXIS = 400
LANE_H = 46
PAD_X = 12


def x_of(year):
    return LEFT + (year - YEAR0) / (YEAR1 - YEAR0) * (RIGHT - LEFT)


def main():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((LEFT, 28), "Where Diffie–Hellman went", font=F_TITLE, fill=INK)
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
        "sys": (BOX, INK),
        "join": (JOIN_BG, ROOT_FG),
        "prior": (PRIOR_BG, PRIOR_FG),
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
        d.line((x0, y, x1, y), fill=color, width=3 if color == PRIOR_BG else 2)
        for key in [parent, *kids]:
            d.line((by[key]["cx"], AXIS, by[key]["cx"], y), fill=color, width=2)

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
    d.text(
        (LEFT, foot_y),
        "Years along the line. Brown is GCHQ: the idea in 1970, the exchange in 1974, released in 1997.",
        font=F_FOOT, fill=MUTED,
    )

    im.save(OUT, "PNG")
    print(OUT, im.size, "lanes", max(p["lane"] for p in placed) + 1)


def abstract():
    """Same dates, no names. Color and the branches carry it."""
    im = Image.new("RGB", (W, 640), BG)
    d = ImageDraw.Draw(im)
    axis = 460
    by = {key: x_of(year) for key, year, _label, _kind in EVENTS}
    kind = {key: k for key, _year, _label, k in EVENTS}

    depth = {"dh": 0}
    for parent, kids, _color in GROUPS:
        if parent in ("ellis", "will"):
            continue
        for kid in kids:
            depth[kid] = depth[parent] + 1

    def hy(level):
        return axis - 28 - level * 42

    for parent, kids, color in GROUPS:
        if parent in ("ellis", "will"):
            continue
        xs = [by[parent]] + [by[k] for k in kids]
        y = hy(depth[kids[0]])
        d.line((min(xs), y, max(xs), y), fill=color, width=2)
        d.line((by[parent], hy(depth[parent]), by[parent], y), fill=color, width=2)

    for key, level in depth.items():
        d.line((by[key], axis, by[key], hy(level)), fill=RULE, width=2)

    # The classified line sits under the axis: Ellis, then Williamson, then the public paper.
    y_prior = axis + 72
    d.line((by["ellis"], y_prior, by["dh"], y_prior), fill=PRIOR_BG, width=3)
    for key in ("ellis", "will", "dh"):
        d.line((by[key], axis, by[key], y_prior), fill=PRIOR_BG, width=3)

    d.line((LEFT, axis, RIGHT, axis), fill=INK, width=2)

    for year in range(1970, 2030, 10):
        x = x_of(year)
        d.line((x, axis, x, axis + 8), fill=MUTED, width=1)
        lab = str(year)
        tw = d.textlength(lab, font=F_TICK)
        d.text((x - tw / 2, axis + 108), lab, font=F_TICK, fill=MUTED)

    radius = {"root": 9, "prior": 8, "join": 7}
    fill = {"root": ROOT_BG, "prior": PRIOR_BG, "join": JOIN_BG, "paper": INK, "sys": INK}
    for key, x in by.items():
        r = radius.get(kind[key], 5)
        c = fill[kind[key]]
        d.ellipse((x - r, axis - r, x + r, axis + r), fill=c, outline=BG)

    out = "book/diffie-hellman-lineage-abstract.png"
    im.save(out, "PNG")
    print(out, im.size)


if __name__ == "__main__":
    main()
    abstract()
