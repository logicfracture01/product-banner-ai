"""test_smoke — basic regression checks for the Python pipeline.

These are not pixel-exact matches against the TypeScript implementation; they
verify that the Python pipeline runs end-to-end, stays deterministic, and returns
sensible shapes and ranges.
"""

from __future__ import annotations

import math
import sys
from typing import Any, Dict, List, Tuple

import pytest

from .banner import (
    auto_placement,
    draw_backdrop_bytes,
    draw_product_bytes,
    export_png_bytes,
    get_backdrop,
    get_ratio,
    paint_shadow_alpha_mask,
    paint_shadow,
    render_banner_bytes,
)
from .enhance import enhance_image
from .pixels import clamp255, distance_inside, distance_outside, smoothstep
from .segmentation import (
    Cutout,
    SegmentOptions,
    segment,
)
from .styles import (
    OutputStyleId,
    StyleAnalysis,
    analyze_cutout,
    get_style,
    recommend_styles,
    segment_and_analyze,
)


def _rgba_rectangle(
    width: int,
    height: int,
    *,
    fg_box: Dict[str, int],
    fg_color: Tuple[int, int, int],
    bg_color: Tuple[int, int, int] = (235, 235, 235),
    softness: float = 0.0,
) -> bytes:
    buf = bytearray(width * height * 4)
    x0, y0, w, h = fg_box["x"], fg_box["y"], fg_box["w"], fg_box["h"]
    for y in range(height):
        for x in range(width):
            p = (y * width + x) * 4
            if x0 <= x < x0 + w and y0 <= y < y0 + h:
                buf[p : p + 3] = fg_color
                buf[p + 3] = 255 if softness <= 0 else 0
            else:
                buf[p : p + 3] = bg_color
                buf[p + 3] = 0
    if softness > 0:
        for y in range(height):
            for x in range(width):
                p = (y * width + x) * 4
                dx = (x - (x0 + w / 2)) / (w / 2)
                dy = (y - (y0 + h / 2)) / (h / 2)
                d = math.hypot(dx, dy)
                if d < 1.0:
                    a = int(255 * max(0.0, min(1.0, 1.0 - d + softness)))
                    a = min(255, max(0, a))
                    buf[p + 3] = a
    return bytes(buf)


def test_clamp255() -> None:
    assert clamp255(-10) == 0
    assert clamp255(128) == 128
    assert clamp255(300) == 255


def test_smoothstep() -> None:
    assert smoothstep(0, 1, -1) == 0.0
    assert abs(smoothstep(0, 1, 0.5) - 0.5) < 1e-6
    assert smoothstep(0, 1, 2) == 1.0


def test_distance_inside_fills() -> None:
    w, h = 5, 5
    fg: List[List[int]] = [[0 for _ in range(w)] for _ in range(h)]
    fg[2][2] = 1
    d = distance_inside(fg, w, h)
    assert d[2][2] > 0
    assert d[0][0] == 0.0


def test_distance_inside_flat_fills() -> None:
    w, h = 5, 5
    fg: List[int] = [0 for _ in range(w * h)]
    fg[12] = 1
    d = distance_inside(fg, w, h)
    assert d[2][2] > 0
    assert d[0][0] == 0.0


def test_distance_outside_inverts() -> None:
    w, h = 5, 5
    fg: List[List[int]] = [[1 for _ in range(w)] for _ in range(h)]
    fg[2][2] = 0
    d_out = distance_outside(fg, w, h)
    assert d_out[2][2] > 0
    assert d_out[0][0] == 0.0


def test_distance_outside_flat_inverts() -> None:
    w, h = 5, 5
    fg: List[int] = [1 for _ in range(w * h)]
    fg[12] = 0
    d_out = distance_outside(fg, w, h)
    assert d_out[2][2] > 0
    assert d_out[0][0] == 0.0


def test_distance_outside_inverts() -> None:
    w, h = 5, 5
    fg: List[List[int]] = [[1 for _ in range(w)] for _ in range(h)]
    fg[2][2] = 0
    d_out = distance_outside(fg, w, h)
    assert d_out[2][2] > 0
    assert d_out[0][0] == 0.0


def test_segment_solid_rect_produces_cutout() -> None:
    w, h = 64, 64
    rgba = _rgba_rectangle(w, h, fg_box={"x": 16, "y": 16, "w": 32, "h": 32}, fg_color=(80, 120, 120))
    cutout = segment(rgba, w, h)
    assert cutout.width == w
    assert cutout.height == h
    assert cutout.box["w"] > 0
    assert cutout.box["h"] > 0
    assert 0 <= cutout.confidence <= 1


def test_segment_touch_edges_are_recorded() -> None:
    w, h = 48, 48
    rgba = _rgba_rectangle(w, h, fg_box={"x": 2, "y": 2, "w": 44, "h": 44}, fg_color=(120, 120, 120))
    cutout = segment(rgba, w, h)
    assert isinstance(cutout.touched_edges, set)


def test_segment_tall_ellipse_has_confidence() -> None:
    w, h = 128, 128
    cx, cy, rx, ry = 64, 64, 22, 48
    buf = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            p = (y * w + x) * 4
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            inside = 1.0 - (dx * dx + dy * dy)
            if inside > 0:
                a = int(255 * inside)
                buf[p : p + 3] = (90, 150, 140)
                buf[p + 3] = max(0, min(255, a))
            else:
                buf[p : p + 3] = (235, 235, 235)
                buf[p + 3] = 0
    cutout = segment(bytes(buf), w, h)
    assert cutout.confidence > 0
    assert cutout.box["w"] > 0


def test_segment_and_analyze_returns_analysis() -> None:
    w, h = 64, 64
    rgba = _rgba_rectangle(w, h, fg_box={"x": 16, "y": 16, "w": 32, "h": 32}, fg_color=(80, 120, 120))
    cutout, analysis = segment_and_analyze(rgba, w, h)
    assert isinstance(analysis, dict)
    assert "palette" in analysis
    assert isinstance(analysis["palette"], list)
    assert len(analysis["palette"]) > 0


def test_recommend_styles_returns_ids() -> None:
    analysis: StyleAnalysis = {
        "palette": ["#ffffff"],
        "tone": 0.8,
        "contrast": 0.1,
        "saturation": 0.1,
        "glossy": 0.1,
        "soft_goods": False,
        "category": "General product",
        "temperature": 0.0,
        "solidity": 0.9,
        "elongation": 0.2,
        "intricacy": 0.1,
        "sheen": 0.2,
    }
    ranked = recommend_styles(analysis)
    assert len(ranked) == 5
    for sid in ranked:
        assert sid == get_style(sid)["id"]


def test_get_style_known_id() -> None:
    style = get_style("white-shadow")
    assert style["id"] == "white-shadow"
    assert style["label"] == "White + shadow"


def test_get_style_unknown_defaults() -> None:
    style = get_style("does-not-exist")
    assert style["id"] == "pure-white"


def test_backdrop_known_and_unknown() -> None:
    assert get_backdrop("paper")["id"] == "paper"
    assert get_backdrop("nope")["id"] == "studio"


def test_ratio_known_and_unknown() -> None:
    assert get_ratio("1:1")["id"] == "1:1"
    assert get_ratio("nope")["id"] == "4:5"


def test_render_banner_bytes_shape_and_nonzero() -> None:
    w, h = 96, 96
    rgba = _rgba_rectangle(w, h, fg_box={"x": 24, "y": 24, "w": 48, "h": 48}, fg_color=(100, 130, 130))
    cutout = segment(rgba, w, h)
    from .shadow import ShadowOptions
    shadow = ShadowOptions()
    out = render_banner_bytes(cutout, w, h, "paper", shadow)
    assert len(out) == w * h * 4
    total = sum(out[i] for i in range(0, len(out), 4))
    assert total > 0


def test_render_banner_bytes_deterministic() -> None:
    w, h = 64, 64
    rgba = _rgba_rectangle(w, h, fg_box={"x": 16, "y": 16, "w": 32, "h": 32}, fg_color=(100, 130, 130))
    cutout = segment(rgba, w, h)
    from .shadow import ShadowOptions
    shadow = ShadowOptions()
    a = render_banner_bytes(cutout, w, h, "paper", shadow)
    b = render_banner_bytes(cutout, w, h, "paper", shadow)
    assert a == b


def test_paint_shadow_alpha_mask_produces_alpha() -> None:
    n = 16 * 16
    mask = bytearray(n)
    mask[100] = 120
    layer = paint_shadow_alpha_mask(bytes(mask), 16, 16)
    assert layer[100 * 4 + 3] == 120


def test_draw_product_bytes_preserves_background_where_no_product() -> None:
    w, h = 64, 64
    bg = draw_backdrop_bytes(w, h, "paper")
    rgba = _rgba_rectangle(w, h, fg_box={"x": 24, "y": 24, "w": 16, "h": 16}, fg_color=(120, 120, 120))
    cutout = segment(rgba, w, h)
    out = draw_product_bytes(bg, w, h, cutout, {"x": w / 2, "y": h / 2, "scale": 1.0})
    assert len(out) == w * h * 4


def test_auto_placement_is_centered_horizontally() -> None:
    w, h = 512, 640
    rgba = _rgba_rectangle(w, h, fg_box={"x": 200, "y": 200, "w": 112, "h": 240}, fg_color=(120, 120, 120))
    cutout = segment(rgba, w, h)
    place = auto_placement(cutout, w, h)
    assert abs(place["x"] - w / 2) < 1.0


def test_export_png_bytes_is_png() -> None:
    w, h = 16, 16
    buf = bytes([255, 0, 0, 255] * (w * h))
    png = export_png_bytes(buf, w, h)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_enhance_identity_plan_leaves_pixels_in_range() -> None:
    w, h = 16, 16
    rgba = bytes([128, 64, 32, 255] * (w * h))
    out = enhance_image(
        {"exposure": 0.0},
        rgba,
        w,
        h,
    )
    assert len(out) == w * h * 4
    for i in range(0, len(out), 4):
        for c in range(3):
            assert 0 <= out[i + c] <= 255


def test_enhance_brightness_plan_changes_luminance() -> None:
    w, h = 16, 16
    rgba = bytes([100, 100, 100, 255] * (w * h))
    out = enhance_image(
        {"exposure": 1.0},
        rgba,
        w,
        h,
    )
    avg_in = 100.0
    avg_out = sum(out[i] for i in range(0, len(out), 4)) / (w * h)
    assert avg_out > avg_in


def test_segment_overrides_accept_tolerance() -> None:
    w, h = 64, 64
    rgba = _rgba_rectangle(w, h, fg_box={"x": 16, "y": 16, "w": 32, "h": 32}, fg_color=(80, 120, 120))
    c1 = segment(rgba, w, h, SegmentOptions(tolerance=10.0))
    c2 = segment(rgba, w, h, SegmentOptions(tolerance=100.0))
    assert c1.width == w
    assert c2.width == w


def test_segment_fallback_bytes_input_works() -> None:
    w, h = 64, 64
    rgba = _rgba_rectangle(w, h, fg_box={"x": 16, "y": 16, "w": 32, "h": 32}, fg_color=(80, 120, 120))
    cutout = segment(rgba, w, h)
    assert isinstance(cutout.alpha, (bytes, bytearray))


def test_pipeline_cli_run() -> None:
    from .cli import demo
    code = demo([])
    assert code == 0
