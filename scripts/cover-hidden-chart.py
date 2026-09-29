#!/usr/bin/env python3
"""Hide the lineage chart in the cover's colour fringing, and read it back out.

The cover already carries a chromatic aberration split, so the chart is written
in the same language: a shift along the green-magenta axis, with luminance left
exactly alone. The shift flips sign on a one-pixel checkerboard, which is what
makes it both quiet and cheap to read. Any 2x2 square of the checkerboard sums
to zero, so adding one moves no local average, and reading one back cancels
anything in the photograph that varies smoothly across the square or steps
across it in a straight line. The scales and their fringing drop out; the chart,
which was painted a whole square at a time, does not.

    python3 scripts/cover-hidden-chart.py encode
    python3 scripts/cover-hidden-chart.py decode
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
COVER = ROOT / "book" / "blockchain-chronicles-cover-rd1a.png"
CHART = ROOT / "book" / "lineage-abstract-rows.png"
STEGO = ROOT / "book" / "blockchain-chronicles-cover-rd1a-keyed.png"
REVEAL = ROOT / "book" / "blockchain-chronicles-cover-rd1a-revealed.png"
KEY = ROOT / "book" / "cover-key.json"

# The shift runs along red-up/green-down, which is luminance neutral and is the
# axis the cover's own fringing already sits on.
AXIS = np.array([1.0, -0.299 / 0.587, 0.0])
AMPLITUDE = 7.0          # peak red-channel counts, before local shading
QUIET = 0.35             # how much of it survives on flat, neutral paper
BAND = (0.22, 0.97)      # top and bottom of the chart, as a fraction of height
INK = 150                # chart pixels darker than this count as a stroke
COVERAGE = 0.12          # how much of a square a stroke must cover to be kept
# Cr moved per unit of shift along AXIS, which is the full-scale reading.
PER_UNIT = 0.5 + 0.418688 * 0.299 / 0.587


def chroma(rgb):
    """Cr, the green-magenta channel, which is where the mark lives."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b


def shading(rgb):
    """Louder where the picture is already colourful, quieter on plain paper.

    A flat grey field shows a colour comb far more readily than a region that is
    already fringed, so the mark is pushed down there. Decoding does not suffer:
    the noise floor drops in exactly the same places.
    """
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = chroma(rgb)
    energy = np.hypot(cb - 128.0, cr - 128.0)
    spread = Image.fromarray(np.clip(energy, 0, 255).astype(np.uint8))
    spread = np.asarray(spread.filter(ImageFilter.GaussianBlur(12))).astype(float)
    loud = np.clip(spread / 18.0, 0.0, 1.0)
    return QUIET + (1.0 - QUIET) * loud


def board(height, width):
    """The one-pixel checkerboard the mark rides on."""
    y = np.arange(height)[:, None]
    x = np.arange(width)[None, :]
    return np.where((y + x) % 2 == 0, 1.0, -1.0)


def chart_mask(width, height):
    """The chart's strokes, one stroke pixel per 2x2 square of the cover.

    The chart is drawn at half the cover's resolution and then each of its pixels
    is painted over a whole checkerboard square. That is what survives reading:
    a mark smaller than a square would be cancelled along with the photograph.
    """
    art_w, art_h = Image.open(CHART).size
    cells_w = width // 2
    # Keep the sheet's proportions, then sit it in the middle of the band. A
    # squeezed chart still decodes but it is no longer the drawing it came from.
    cells_h = round(cells_w * art_h / art_w)
    span = int(height * (BAND[1] - BAND[0]))
    top = (int(height * BAND[0]) + max(0, span - cells_h * 2) // 2) & ~1
    bottom = top + cells_h * 2
    # Threshold first, shrink second. Shrinking a cream sheet with thin dark
    # strokes turns the strokes grey and they vanish under any ink threshold, so
    # the ink is decided at full size and then a cell counts if enough of it
    # landed there.
    art = Image.open(CHART).convert("L")
    ink = Image.fromarray(((np.asarray(art) < INK) * 255).astype(np.uint8))
    coverage = np.asarray(ink.resize((cells_w, cells_h), Image.BOX)).astype(float) / 255.0
    cells = coverage > COVERAGE
    mask = np.zeros((height, width), dtype=bool)
    mask[top:bottom, : cells_w * 2] = np.kron(cells, np.ones((2, 2), dtype=bool))
    return mask, cells, top, bottom


def encode():
    if not COVER.exists():
        sys.exit(f"put the cover art at {COVER.relative_to(ROOT)} first")
    rgb = np.asarray(Image.open(COVER).convert("RGB")).astype(float)
    height, width = rgb.shape[:2]
    mask, cells, top, bottom = chart_mask(width, height)

    strength = AMPLITUDE * shading(rgb) * mask * board(height, width)
    marked = np.clip(rgb + strength[..., None] * AXIS, 0, 255)

    out = marked.round().astype(np.uint8)
    Image.fromarray(out).save(STEGO)

    delta = np.abs(out.astype(float) - rgb)
    KEY.write_text(json.dumps({
        "carries": "the five lineage rows, as drawn in book/lineage-abstract-rows.png",
        "axis": "red up, green down, blue untouched, luminance unchanged",
        "carrier": "one-pixel checkerboard, sign flips with (x + y)",
        "amplitude": AMPLITUDE,
        "quietFloor": QUIET,
        "band": {"top": top, "bottom": bottom, "ofHeight": height},
        "cells": {"w": cells.shape[1], "h": cells.shape[0]},
        "howToRead": "multiply Cr by the checkerboard, then add up each 2x2 "
                     "square; the photograph cancels and the chart remains",
        "maxChannelShift": float(delta.max()),
        "meanChannelShift": float(delta[delta > 0].mean()),
        "luminanceShift": float(np.abs(
            0.299 * (out[..., 0].astype(float) - rgb[..., 0])
            + 0.587 * (out[..., 1].astype(float) - rgb[..., 1])
            + 0.114 * (out[..., 2].astype(float) - rgb[..., 2])
        ).max()),
    }, indent=2) + "\n")
    print(f"wrote {STEGO.relative_to(ROOT)}")
    print(f"  largest change to any channel: {delta.max():.1f} of 255")
    print(f"  chart band: rows {top} to {bottom} of {height}")


def squares(plane):
    """Add up each 2x2 square. This is the step that cancels the photograph."""
    h, w = plane.shape[0] & ~1, plane.shape[1] & ~1
    blocks = plane[:h, :w].reshape(h // 2, 2, w // 2, 2)
    return blocks.sum(axis=(1, 3))


def decode():
    """The key. Cancel the photograph, keep the chart."""
    rgb = np.asarray(Image.open(STEGO).convert("RGB")).astype(float)
    height, width = rgb.shape[:2]

    lit = squares(chroma(rgb) * board(height, width)) / 4.0
    # Undo the shading so strokes on plain paper read as strongly as strokes in
    # the fringing. It is recomputed from the marked file itself, so the only
    # thing anyone needs in order to read this is the script.
    lit = lit / np.maximum(squares(shading(rgb)) / 4.0, 0.05)

    # Full scale is known in advance, so no guessing from the picture's own
    # statistics: a stroke reads AMPLITUDE * PER_UNIT and nothing else does. The
    # low end is cut away because the little that survives of the photograph
    # lives down there, and a stroke never does.
    level = np.abs(lit) / (AMPLITUDE * PER_UNIT)
    ink = np.clip((level - 0.35) / 0.35, 0, 1)

    paper = np.array([244, 239, 228], dtype=float)
    inkcol = np.array([28, 24, 20], dtype=float)
    art = paper + (inkcol - paper) * ink[..., None]
    Image.fromarray(art.round().astype(np.uint8)).resize(
        (ink.shape[1] * 2, ink.shape[0] * 2), Image.NEAREST
    ).save(REVEAL)

    strong = np.abs(lit) > AMPLITUDE * PER_UNIT * 0.5
    residue = np.abs(lit)[~strong]
    print(f"wrote {REVEAL.relative_to(ROOT)}")
    print(f"  strokes on {strong.mean() * 100:.1f}% of the sheet, "
          f"reading {np.abs(lit)[strong].mean():.2f} of {AMPLITUDE * PER_UNIT:.2f}")
    print(f"  what is left of the photograph: {residue.mean():.3f} mean, "
          f"{residue.max():.2f} worst")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "encode"
    if what == "encode":
        encode()
    elif what == "decode":
        decode()
    else:
        sys.exit(__doc__)
