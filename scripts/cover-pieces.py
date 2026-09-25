#!/usr/bin/env python3
"""Two generated panels for the Blockchain Chronicles cover.

The Bitcoin field is drawn, not a stock photo: a B with the two bars, filled
with small 0s and 1s, and larger 0s and 1s behind it.

The network is the settlement graph from L2BEAT's public scaling summary,
fetched 23 September 2026 (https://l2beat.com/api/scaling/summary). A line
means that chain posts to that host. Node area follows total value secured.
"""

import math

from PIL import Image, ImageDraw, ImageFont

DIGIT = "/System/Library/Fonts/Supplemental/Courier New.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"

# name, host, total value secured in USD. Host None is the root.
# L2BEAT scaling summary, 23 September 2026. TVS is their figure, not a market cap.
SETTLEMENT = [
    ("Ethereum", None, None),
    ("Base", "Ethereum", 16_101_752_832),
    ("Arbitrum", "Ethereum", 11_626_419_200),
    ("Polygon", "Ethereum", 3_961_928_448),
    ("Robinhood", "Ethereum", 2_946_556_928),
    ("OP Mainnet", "Ethereum", 1_876_063_360),
    ("Mantle", "Ethereum", 1_500_981_760),
    ("Lighter", "Ethereum", 1_500_382_976),
    ("Starknet", "Ethereum", 444_751_584),
    ("Ink", "Ethereum", 419_649_728),
    ("World", "Ethereum", 406_678_016),
    ("Hyperliquid", "Arbitrum", 7_455_518_720),
]


def bitcoin_field(w, h):
    """Portrait field. Large digits in the ground, the mark in smaller ones."""
    im = Image.new("RGB", (w, h), (0, 0, 0))
    draw = ImageDraw.Draw(im)

    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    bfont = ImageFont.truetype(ARIAL_BOLD, int(h * 0.62))
    bb = md.textbbox((0, 0), "B", font=bfont)
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    bx = (w - bw) // 2 - bb[0]
    by = (h - bh) // 2 - bb[1] - int(h * 0.02)
    md.text((bx, by), "B", font=bfont, fill=255)
    ink = mask.getbbox()
    # Two bars through the B, the part that makes it the Bitcoin mark.
    ix0, iy0, ix1, iy1 = ink
    iw, ih = ix1 - ix0, iy1 - iy0
    bar_w = max(7, iw // 11)
    ext = int(ih * 0.13)
    for frac in (0.28, 0.44):
        cx = ix0 + int(iw * frac)
        md.rectangle((cx - bar_w // 2, iy0 - ext, cx + bar_w // 2, iy1 + ext), fill=255)
    # The font B is short for this panel. Stretch the mark so it fills the field.
    glyph = mask.crop(mask.getbbox())
    target_h = int(h * 0.86)
    target_w = min(int(w * 0.90), int(glyph.width * target_h / glyph.height))
    glyph = glyph.resize((target_w, target_h), Image.Resampling.BOX)
    mask = Image.new("L", (w, h), 0)
    mask.paste(glyph, ((w - target_w) // 2, (h - target_h) // 2))
    ink = mask.getbbox()
    ix0, iy0, ix1, iy1 = ink
    iw, ih = ix1 - ix0, iy1 - iy0

    small = ImageFont.truetype(DIGIT, max(7, w // 34))
    big = ImageFont.truetype(DIGIT, max(18, w // 12))
    huge = ImageFont.truetype(DIGIT, max(28, w // 8))

    def bit(x, y, salt):
        return "1" if ((x * 13 + y * 7 + salt * 17) % 5) > 1 else "0"

    # Larger digits first, so the mark paints over them.
    step = max(28, w // 8)
    for gy in range(-step, h + step, step):
        for gx in range(-step // 2, w + step, step):
            jitter_x = ((gx * 3 + gy) % 11) - 5
            jitter_y = ((gx + gy * 5) % 9) - 4
            x, y = gx + jitter_x, gy + jitter_y
            if not (0 <= x < w and 0 <= y < h):
                continue
            if mask.getpixel((min(w - 1, max(0, x)), min(h - 1, max(0, y)))) > 40:
                continue
            # Keep the ground sparse. Every cell would turn into texture.
            if (gx // step + gy // step) % 3 == 0:
                continue
            font = huge if (gx + gy) % (step * 5) == 0 else big
            shade = 70 + ((x * 5 + y) % 90)
            color = (shade // 3, shade, shade + 15)
            draw.text((x, y), bit(x, y, 2), font=font, fill=color)

    cell = max(8, w // 32)
    sfont = small
    for gy in range(0, h - cell, cell):
        for gx in range(0, w - cell, cell):
            # A cell counts if any of its sample points sit on the mark.
            hits = False
            for sy in (gy + 1, gy + cell // 2, gy + cell - 1):
                for sx in (gx + 1, gx + cell // 2, gx + cell - 1):
                    if 0 <= sx < w and 0 <= sy < h and mask.getpixel((sx, sy)) > 80:
                        hits = True
            if not hits:
                continue
            # Warm on the left of the mark, ash on the right.
            t = (gx - ix0) / max(1, iw)
            hot = int(230 - 70 * t)
            color = (hot, int(hot * 0.78), int(hot * 0.74))
            ch = bit(gx, gy, 1)
            draw.text((gx, gy), ch, font=sfont, fill=color)
    return im


def ground_digits(w, h):
    """The large 0s and 1s alone, for the band under the network."""
    im = Image.new("RGB", (w, h), (0, 0, 0))
    draw = ImageDraw.Draw(im)
    big = ImageFont.truetype(DIGIT, 22)
    step = 34
    for gy in range(-8, h + step, step):
        for gx in range(0, w + step, step):
            if (gx // step + gy // step) % 3 == 0:
                continue
            x = gx + ((gx * 3 + gy) % 7) - 3
            y = gy + ((gx + gy * 5) % 5) - 2
            shade = 80 + ((x * 5 + y) % 70)
            ch = "1" if ((x * 13 + y * 7) % 5) > 1 else "0"
            draw.text((x, y), ch, font=big, fill=(shade // 3, shade, min(255, shade + 15)))
    return im


def settlement_network(w, h):
    """Hub and the chains that post to it. Area is value secured."""
    im = Image.new("RGB", (w, h), (8, 10, 12))
    draw = ImageDraw.Draw(im)
    label_font = ImageFont.truetype(GEORGIA, max(9, w // 26))

    valued = [n for n in SETTLEMENT if n[2]]
    max_tvs = max(n[2] for n in valued)

    def radius(tvs):
        if tvs is None:
            return w / 11
        return max(3.0, (w / 22) * math.sqrt(tvs / max_tvs))

    cx, cy = w * 0.46, h * 0.52
    rx, ry = w * 0.34, h * 0.30
    children = [n for n in SETTLEMENT if n[1] == "Ethereum"]
    # Arbitrum sits toward the upper right so Hyperliquid has room beyond it.
    order = sorted(children, key=lambda n: -n[2])
    arb = next(n for n in order if n[0] == "Arbitrum")
    rest = [n for n in order if n[0] != "Arbitrum"]
    placed = {"Ethereum": (cx, cy, radius(None), None)}
    arb_angle = -0.55
    positions = {arb[0]: arb_angle}
    for i, n in enumerate(rest):
        # Skip the Arbitrum slot.
        k = i if i < 4 else i + 1
        positions[n[0]] = arb_angle + (k + 1) * (2 * math.pi / (len(children)))
    for n in children:
        ang = positions[n[0]]
        placed[n[0]] = (cx + math.cos(ang) * rx, cy + math.sin(ang) * ry, radius(n[2]), "Ethereum")

    ax, ay, _, _ = placed["Arbitrum"]
    hx = ax + (ax - cx) * 0.55
    hy = ay + (ay - cy) * 0.55
    hx = min(w - 14, max(14, hx))
    hy = min(h - 12, max(12, hy))
    placed["Hyperliquid"] = (hx, hy, radius(7_455_518_720), "Arbitrum")

    edges = [(host, name) for name, host, _ in SETTLEMENT if host and host in placed and name in placed]
    for host, name in edges:
        x0, y0, _, _ = placed[host]
        x1, y1, _, _ = placed[name]
        draw.line((x0, y0, x1, y1), fill=(150, 158, 166), width=1)

    # Hubs last so a spoke does not cover them.
    for name, _host, tvs in sorted(SETTLEMENT, key=lambda n: (n[2] or 10**15)):
        if name not in placed:
            continue
        x, y, r, _ = placed[name]
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(236, 238, 240))
        # Only the hub and the two largest, so the names do not pile up.
        if name not in ("Ethereum", "Base", "Hyperliquid"):
            continue
        tw = draw.textlength(name, font=label_font)
        if name == "Hyperliquid":
            lx, ly = x - tw / 2, y - r - 12
        elif name == "Base":
            lx, ly = x + r + 2, y - 5
        else:
            lx, ly = x - tw / 2, y + r + 5
        lx = min(w - tw - 2, max(2, lx))
        ly = min(h - 12, max(1, ly))
        draw.text((lx, ly), name, font=label_font, fill=(210, 214, 218))
    return im


def main():
    field = bitcoin_field(278, 503)
    net = settlement_network(254, 181)
    field.save("book/cover-bitcoin-field.png", "PNG")
    net.save("book/cover-network.png", "PNG")

    src = Image.open(
        "/Users/jdietz/.cursor/projects/Users-jdietz-Documents-GitHub-dev-hypermuse/assets/"
        "De_Filippi_cover_round_3B-ba3ae724-d413-4881-af37-cf7cbfc75014.png"
    ).convert("RGB")
    chart = Image.open("book/blockchain-chronicles-cover.png").convert("RGB").crop((278, 521, 682, 1024))
    cover = src.copy()
    cover.paste(field, (0, 521))
    cover.paste(net, (428, 297))
    # The stock binary used to show in the gap under the network photo.
    band = ground_digits(682, 43)
    src_px = src.load()
    band_px = band.load()
    out_px = cover.load()
    for y in range(478, 521):
        for x in range(0, 682):
            r, g, b = src_px[x, y]
            # Tight on purpose. The stock digits are near-white and a loose test
            # treats them as the cover's gray field.
            flat = abs(r - 219) < 8 and abs(g - 221) < 8 and abs(b - 218) < 8
            if not flat:
                out_px[x, y] = band_px[x, y - 478]
    cover.paste(chart, (278, 521))
    cover.save("book/blockchain-chronicles-cover.png", "PNG")
    print("field", field.size, "network", net.size, "cover", cover.size)


if __name__ == "__main__":
    main()
