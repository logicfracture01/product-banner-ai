"""cli — minimal entrypoint for the Python pipeline.

Run with:

    python -m pipeline.py.cli demo

This creates a synthetic RGBA cutout, runs segmentation, picks a style, renders a
banner, and prints a few summary numbers. It does not need a browser, a network
connection, or any heavy model.
"""

from __future__ import annotations

import argparse
import math
import sys
from typing import Any, Dict, List, Tuple

from .banner import get_ratio, render_banner_bytes
from .segmentation import Cutout, SegmentOptions, segment
from .styles import OutputStyleId, analyze_cutout, get_style, recommend_styles


def _make_synthetic_cutout(
    width: int,
    height: int,
    box: Dict[str, int],
) -> bytes:
    """Create a small RGBA buffer with a soft elliptical product on a neutral bg."""
    buf = bytearray(width * height * 4)
    cx = box["x"] + box["w"] / 2.0
    cy = box["y"] + box["h"] / 2.0
    rx = box["w"] / 2.0
    ry = box["h"] / 2.0
    for y in range(height):
        for x in range(width):
            p = (y * width + x) * 4
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            inside = 1.0 - (dx * dx + dy * dy)
            a = 0
            if inside > 0:
                a = min(255, int(255 * inside * 0.98 + 60))
            elif inside > -0.2:
                a = int(255 * max(0.0, inside * 1.2 + 0.2) * 0.6)
            # product color: warm teal
            r = 90
            g = 150
            b = 140
            bg = 230
            if a >= 255:
                buf[p] = r
                buf[p + 1] = g
                buf[p + 2] = b
                buf[p + 3] = 255
            elif a > 0:
                inv = 1.0 / max(1e-5, a / 255.0 + (1.0 - a / 255.0))
                sa = a / 255.0
                da = (1.0 - sa)
                buf[p] = int(round((r * sa + bg * da) * inv))
                buf[p + 1] = int(round((g * sa + bg * da) * inv))
                buf[p + 2] = int(round((b * sa + bg * da) * inv))
                buf[p + 3] = int(round((sa + 0.0 * da) * inv * 255.0))
            else:
                buf[p] = bg
                buf[p + 1] = bg
                buf[p + 2] = bg
                buf[p + 3] = 255
    return bytes(buf)


def demo(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1350)
    ap.add_argument("--box", nargs=4, type=int, default=(360, 420, 360, 540), metavar=("x", "y", "w", "h"))
    ap.add_argument("--style", type=str, default="auto")
    args = ap.parse_args(argv)

    width = args.width
    height = args.height
    box = {"x": args.box[0], "y": args.box[1], "w": args.box[2], "h": args.box[3]}

    rgba = _make_synthetic_cutout(width, height, box)
    opts = SegmentOptions(tolerance=28.0, softness=2.0, no_retry=False)
    cutout = segment(rgba, width, height, opts)

    analysis = analyze_cutout(cutout)
    ranked = recommend_styles(analysis)
    style_id: OutputStyleId
    if args.style == "auto":
        style_id = ranked[0]
    else:
        style_id = args.style

    style = get_style(style_id)
    ratio = get_ratio("4:5")
    out_w = ratio["w"]
    out_h = ratio["h"]

    from .shadow import ShadowOptions
    shadow = ShadowOptions(
        direction=float(style["shadow"]["direction"]),
        length=float(style["shadow"]["length"]),
        softness=float(style["shadow"]["softness"]),
        opacity=float(style["shadow"]["opacity"]),
        contact=bool(style["shadow"]["contact"]),
    )

    banner = render_banner_bytes(cutout, out_w, out_h, style["backdrop"], shadow)

    print("pipeline python demo")
    print("width        ", width)
    print("height       ", height)
    print("input box    ", box)
    print("cutout box   ", cutout.box)
    print("cutout conf  ", round(cutout.confidence, 3))
    print("soft pixels  ", cutout.soft_pixels)
    print("candidates   ", len(cutout.candidates))
    print("palette      ", analysis["palette"])
    print("tone         ", round(analysis["tone"], 3))
    print("category     ", analysis["category"])
    print("recommended  ", ranked)
    print("chosen style ", style_id, style["label"])
    print("banner bytes ", len(banner), " bytes")
    print("banner shape ", out_w, "x", out_h)

    out = render_banner_bytes(
        cutout,
        out_w,
        out_h,
        style["backdrop"],
        shadow,
    )
    if len(out) != len(banner):
        print("ERROR: render_banner_bytes not deterministic", file=sys.stderr)
        return 2

    try:
        from .banner import export_png_bytes
        png = export_png_bytes(out, out_w, out_h)
        print("png bytes    ", len(png))
    except Exception as e:
        print("png export skipped:", e, file=sys.stderr)

    return 0


def main() -> None:
    raise SystemExit(demo())


if __name__ == "__main__":
    main()
