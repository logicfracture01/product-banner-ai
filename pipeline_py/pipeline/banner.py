"""banner — backdrop rendering, shadow painting, product draw, export.

Mirrors src/lib/pipeline/banner.ts. All image output is produced as raw bytes so
it can be saved, piped, or re-imported without any browser/CANVAS dependency.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

from .shadow import ShadowOptions, paint_shadow, render_shadow_intensity, tone_map_shadow
from .segmentation import Cutout


BackdropId = str
RatioId = str

BACKDROPS: List[Dict[str, Any]] = [
    {"id": "studio", "label": "Studio", "from": "#f7f6f3", "to": "#e9e6df", "swatch": "#f0eee8"},
    {"id": "warm", "label": "Warm", "from": "#f6efe4", "to": "#e7d7c2", "swatch": "#efe3d2"},
    {"id": "mint", "label": "Mint", "from": "#e8f2ee", "to": "#d2e5dc", "swatch": "#dcebe4"},
    {"id": "blush", "label": "Blush", "from": "#f7edeb", "to": "#ecd9d6", "swatch": "#f1e3e0"},
    {"id": "sky", "label": "Sky", "from": "#eaf0f6", "to": "#d4e1ee", "swatch": "#dfe9f2"},
    {"id": "paper", "label": "Paper", "from": "#fbfaf7", "to": "#f2f0ea", "swatch": "#f6f5f0"},
    {"id": "walnut", "label": "Walnut", "from": "#6b4a34", "to": "#452e20", "swatch": "#5a3e2b", "dark": True},
    {"id": "charcoal", "label": "Charcoal", "from": "#33373b", "to": "#1e2124", "swatch": "#282c30", "dark": True},
]

RATIOS: List[Dict[str, Any]] = [
    {"id": "4:5", "label": "4:5", "w": 1080, "h": 1350, "hint": "Vinted / Depop / IG feed"},
    {"id": "1:1", "label": "1:1", "w": 1080, "h": 1080, "hint": "Square listing"},
    {"id": "16:9", "label": "16:9", "w": 1280, "h": 720, "hint": "Shop banner"},
]


def get_ratio(id_: RatioId) -> Dict[str, Any]:
    for r in RATIOS:
        if r["id"] == id_:
            return r
    return RATIOS[0]


def get_backdrop(id_: BackdropId) -> Dict[str, Any]:
    for b in BACKDROPS:
        if b["id"] == id_:
            return b
    return BACKDROPS[0]


def _hex_to_rgb(hex_: str) -> Tuple[float, float, float]:
    h = hex_.lstrip("#")
    if len(h) != 6:
        return (255.0, 255.0, 255.0)
    return (
        int(h[0:2], 16),
        int(h[2:4], 16),
        int(h[4:6], 16),
    )


def draw_backdrop_bytes(width: int, height: int, backdrop: BackdropId) -> bytes:
    bd = get_backdrop(backdrop)
    top = _hex_to_rgb(bd["from"])
    bottom = _hex_to_rgb(bd["to"])
    n = width * height
    out = bytearray(n * 4)
    for y in range(height):
        t = y / max(1, height - 1)
        r = top[0] + (bottom[0] - top[0]) * t
        g = top[1] + (bottom[1] - top[1]) * t
        b = top[2] + (bottom[2] - top[2]) * t
        row_start = y * width * 4
        for x in range(width):
            p = row_start + x * 4
            out[p] = int(round(r))
            out[p + 1] = int(round(g))
            out[p + 2] = int(round(b))
            out[p + 3] = 255
    cx = width / 2.0
    cy = height * 0.16
    max_r = width * 0.95
    for y in range(height):
        for x in range(width):
            d = math.hypot(x - cx, y - cy) / max(1.0, max_r)
            radial = max(0.0, 1.0 - d)
            if bd.get("dark"):
                extra_a = 0.08 * radial
            else:
                extra_a = 0.45 * radial
            p = (y * width + x) * 4
            lum_boost = extra_a * 255.0
            out[p] = int(round(min(255.0, out[p] + lum_boost)))
            out[p + 1] = int(round(min(255.0, out[p + 1] + lum_boost)))
            out[p + 2] = int(round(min(255.0, out[p + 2] + lum_boost)))

    for y in range(height):
        t = y / max(1, height - 1)
        if bd.get("dark"):
            fg = 0.0 if t < 0.5 else (t - 0.5) * 0.5 * 0.25
        else:
            fg = 0.0 if t < 0.5 else (t - 0.5) * 0.16 * 0.5
        darken = int(round(fg * 255.0))
        row_start = y * width * 4
        for x in range(width):
            p = row_start + x * 4
            out[p] = max(0, out[p] - darken)
            out[p + 1] = max(0, out[p + 1] - darken)
            out[p + 2] = max(0, out[p + 2] - darken)
    return bytes(out)


def draw_product_bytes(
    canvas_buf: bytes,
    canvas_w: int,
    canvas_h: int,
    cutout: Cutout,
    place: Dict[str, float],
) -> bytes:
    from .pixels import clamp255
    out = bytearray(canvas_buf)
    alpha = cutout.alpha
    box = cutout.box
    scale = float(place["scale"])
    cx = (box["x"] + box["w"] / 2.0) * scale
    cy = (box["y"] + box["h"] / 2.0) * scale
    base_x = round(place["x"] - cx)
    base_y = round(place["y"] - cy)
    scaled_w = max(1, round(box["w"] * scale))
    scaled_h = max(1, round(box["h"] * scale))
    cw = cutout.width
    ch = cutout.height
    for dy in range(scaled_h):
        sy = min(ch - 1, int(dy / scale))
        for dx in range(scaled_w):
            sx = min(cw - 1, int(dx / scale))
            p = (sy * cw + sx) * 4
            a = alpha[p + 3]
            if a == 0:
                continue
            px = base_x + dx
            py = base_y + dy
            if not (0 <= px < canvas_w and 0 <= py < canvas_h):
                continue
            dst = (py * canvas_w + px) * 4
            src = p
            if a >= 255:
                out[dst] = alpha[src]
                out[dst + 1] = alpha[src + 1]
                out[dst + 2] = alpha[src + 2]
                out[dst + 3] = 255
            else:
                src_a = a / 255.0
                dst_a = out[dst + 3] / 255.0 if out[dst + 3] else 0.0
                out_a = src_a + dst_a * (1.0 - src_a)
                if out_a > 0:
                    inv = 1.0 / out_a
                    out[dst] = int(round((alpha[src] * src_a + out[dst] * dst_a * (1.0 - src_a)) * inv))
                    out[dst + 1] = int(round((alpha[src + 1] * src_a + out[dst + 1] * dst_a * (1.0 - src_a)) * inv))
                    out[dst + 2] = int(round((alpha[src + 2] * src_a + out[dst + 2] * dst_a * (1.0 - src_a)) * inv))
                    out[dst + 3] = int(round(out_a * 255.0))
    return bytes(out)


def _apply_opaque_overlay_bytes(
    base: bytes,
    overlay: bytes,
    width: int,
    height: int,
    ox: int,
    oy: int,
) -> bytes:
    """Blend an overlay RGBA buffer at a given offset into a base buffer.

    This is used by the banner engine when it composites shadow/product layers
    without needing a browser Canvas. It is deliberately small and does not aim
    to be fast; it exists so the Python pipeline can run end-to-end with no
    browser dependencies.
    """
    out = bytearray(base)
    ol = len(overlay)
    if ol < width * height * 4:
        return base
    for dy in range(height):
        sy = dy + oy
        if sy < 0 or sy >= height:
            continue
        for dx in range(width):
            sx = dx + ox
            if sx < 0 or sx >= width:
                continue
            dst = (dy * width + dx) * 4
            src = (sy * width + sx) * 4
            if src + 3 >= ol:
                continue
            a = overlay[src + 3]
            if a == 0:
                continue
            if a >= 255:
                out[dst] = overlay[src]
                out[dst + 1] = overlay[src + 1]
                out[dst + 2] = overlay[src + 2]
                out[dst + 3] = 255
                continue
            sa = a / 255.0
            da = out[dst + 3] / 255.0 if out[dst + 3] else 0.0
            out_a = sa + da * (1.0 - sa)
            if out_a > 0:
                inv = 1.0 / out_a
                for c in range(3):
                    out[dst + c] = int(round(
                        (overlay[src + c] * sa + out[dst + c] * da * (1.0 - sa)) * inv
                    ))
                out[dst + 3] = int(round(out_a * 255.0))
    return bytes(out)


def render_banner_bytes(
    cutout: Cutout,
    width: int,
    height: int,
    backdrop: BackdropId,
    shadow: ShadowOptions,
    place: Optional[Dict[str, float]] = None,
) -> bytes:
    if place is None:
        place = auto_placement(cutout, width, height)
    buf = draw_backdrop_bytes(width, height, backdrop)
    intensity = render_shadow_intensity(cutout, place, width, height, shadow)
    mask = tone_map_shadow(intensity, width, height, shadow)
    shadow_layer = paint_shadow_alpha_mask(mask, width, height)
    ox = round(place["x"] - ((cutout.box["x"] + cutout.box["w"] / 2.0) * place["scale"]))
    oy = round(place["y"] - ((cutout.box["y"] + cutout.box["h"] / 2.0) * place["scale"]))
    shadow_ox = ox
    shadow_oy = oy
    buf = _apply_opaque_overlay_bytes(shadow_layer, buf, width, height, shadow_ox, shadow_oy)
    buf = draw_product_bytes(buf, width, height, cutout, place)
    return buf


def paint_shadow(
    mask: bytes,
    canvas_w: int,
    canvas_h: int,
    into: Optional[bytes] = None,
) -> bytes:
    if into is None:
        into = bytearray(canvas_w * canvas_h * 4)
    else:
        into = bytearray(into)
    shadow_r = 45
    shadow_g = 40
    shadow_b = 35
    n = canvas_w * canvas_h
    for i in range(n):
        a = mask[i]
        if a > 0:
            p = i * 4
            into[p] = shadow_r
            into[p + 1] = shadow_g
            into[p + 2] = shadow_b
            into[p + 3] = a
    return bytes(into)


def paint_shadow_alpha_mask(
    mask: bytes,
    canvas_w: int,
    canvas_h: int,
    shadow_color: Optional[Tuple[int, int, int]] = None,
) -> bytes:
    """Render only the shadow layer from a tone-mapped mask.

    Returns an RGBA buffer that can be composited by
    :func:`_apply_opaque_overlay_bytes` or :func:`draw_product_bytes`.
    """
    color = shadow_color or (45, 40, 35)
    n = canvas_w * canvas_h
    out = bytearray(n * 4)
    for i in range(n):
        a = mask[i]
        if a == 0:
            continue
        p = i * 4
        out[p] = color[0]
        out[p + 1] = color[1]
        out[p + 2] = color[2]
        out[p + 3] = a
    return bytes(out)


Placement = Dict[str, float]


def auto_placement(cutout: Cutout, w: int, h: int) -> Placement:
    box = cutout.box
    if box["w"] <= 0 or box["h"] <= 0:
        return {"x": w / 2.0, "y": h * 0.75, "scale": 1.0}
    target_height_ratio = 0.65
    target_width_ratio = 0.75
    scale_by_height = (h * target_height_ratio) / box["h"]
    scale_by_width = (w * target_width_ratio) / box["w"]
    scale = max(scale_by_height, scale_by_width)
    scale = max(0.25, min(2.5, scale))
    return {"x": w / 2.0, "y": h * 0.75, "scale": scale}


def export_png_bytes(buf: bytes, width: int, height: int) -> bytes:
    """Return PNG bytes for the RGBA buffer."""
    try:
        import numpy as np
        from PIL import Image
        arr = np.frombuffer(buf, dtype=np.uint8).reshape((height, width, 4))
        img = Image.fromarray(arr, "RGBA")
        out = bytearray()
        img.save(out, format="PNG")
        return bytes(out)
    except Exception:  # pragma: no cover - only used when PIL is absent
        return _png_from_rgba_fb(buf, width, height)


def _png_from_rgba_fb(buf: bytes, width: int, height: int) -> bytes:
    """Minimal PNG writer for RGBA byte buffers, no dependencies.

    This is intentionally small and correct enough for export regression tests; it
    is not a full encoder and does not aim to be fast.
    """
    import struct
    import zlib

    def chunk(ctype: bytes, data: bytes) -> bytes:
        c = ctype + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    raw = b""
    scanline = b""
    for y in range(height):
        scanline = b"\x00"
        p = y * width * 4
        for x in range(width):
            scanline += bytes([buf[p + 0], buf[p + 1], buf[p + 2], buf[p + 3]])
            p += 4
        raw += scanline
    compressed = zlib.compress(raw, 6)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


def export_png_path(
    buf: bytes,
    width: int,
    height: int,
    path: str,
) -> None:
    data = export_png_bytes(buf, width, height)
    with open(path, "wb") as f:
        f.write(data)
