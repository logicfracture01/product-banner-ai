"""pixels_fallback — reference helpers that mirrors src/lib/pipeline/pixels.ts
without any numpy dependency. Used only when numpy is not available.

All of these are intentionally pure Python loops for portability and testability.
They match the TypeScript semantics where it matters for the pipeline contract
(clamp, chamfer distance in/out, box blur, smoothstep, luminance).

Distance helpers accept either a list-of-lists mask or a flat list, so the Python
pipeline's pure-python fallback can pass in the 1-D fg list directly.
"""

from __future__ import annotations

import math
from typing import List, Tuple


def clamp255(v: float) -> int:
    if v < 0:
        return 0
    if v > 255:
        return 255
    return int(round(v))


def luminance(r: float, g: float, b: float) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 == edge0:
        t = 0.0 if x <= edge0 else 1.0
    else:
        t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _ensure_2d(src, w: int, h: int):
    if h == 0 or w == 0:
        return [], None
    if src and isinstance(src[0], list):
        return src, None
    return None, src


def distance_inside(fg, w: int, h: int) -> List[List[float]]:
    """Chamfer distance inside foreground. 0 outside, big inside.

    Accepts either a list-of-lists mask or a flat list. The returned value is
    always a list-of-lists so callers can index d[y][x].
    """
    INF = 1e9
    rows, flat = _ensure_2d(fg, w, h)
    if not rows and flat is None:
        return []

    d: List[List[float]] = []
    fg_rows: List[List[float]] = []
    for y in range(h):
        row_d: List[float] = []
        row_fg: List[float] = []
        for x in range(w):
            if rows is not None:
                v = rows[y][x]
            else:
                v = flat[y * w + x]
            is_fg = bool(v)
            row_fg.append(1.0 if is_fg else 0.0)
            row_d.append(INF if is_fg else 0.0)
        fg_rows.append(row_fg)
        d.append(row_d)

    # forward pass
    for y in range(h):
        row_d = d[y]
        for x in range(w):
            if not row_d[x]:
                continue
            m = row_d[x]
            if x > 0:
                m = min(m, row_d[x - 1] + 3.0)
            if y > 0:
                m = min(m, d[y - 1][x] + 3.0)
            if x > 0 and y > 0:
                m = min(m, d[y - 1][x - 1] + 4.0)
            if x < w - 1 and y > 0:
                m = min(m, d[y - 1][x + 1] + 4.0)
            row_d[x] = m

    # backward pass
    for y in range(h - 1, -1, -1):
        row_d = d[y]
        for x in range(w - 1, -1, -1):
            if not row_d[x]:
                continue
            m = row_d[x]
            if x < w - 1:
                m = min(m, row_d[x + 1] + 3.0)
            if y < h - 1:
                m = min(m, d[y + 1][x] + 3.0)
            if x < w - 1 and y < h - 1:
                m = min(m, d[y + 1][x + 1] + 4.0)
            if x > 0 and y < h - 1:
                m = min(m, d[y + 1][x - 1] + 4.0)
            row_d[x] = m

    # Normalize lift so small integer distances are usable for the alpha ramp.
    for y in range(h):
        row_d = d[y]
        row_fg = fg_rows[y]
        for x in range(w):
            if row_fg[x]:
                row_d[x] /= 3.0
            else:
                row_d[x] = 0.0
    return d


def distance_outside(bin_, w: int, h: int) -> List[List[float]]:
    rows, flat = _ensure_2d(bin_, w, h)
    inv: List[List[int]] = []
    for y in range(h):
        row_out: List[int] = []
        for x in range(w):
            if rows is not None:
                v = rows[y][x]
            else:
                v = flat[y * w + x]
            row_out.append(1 - v)
        inv.append(row_out)
    return distance_inside(inv, w, h)


def _box_blur3_flat(src, w: int, h: int, radius: int) -> List[List[float]]:
    rows, flat = _ensure_2d(src, w, h)
    r = max(0, min(radius, w, h, 60))
    if r == 0:
        if rows is not None:
            return [row[:] for row in rows]
        return [[float(flat[y * w + x]) for x in range(w)] for y in range(h)]
    win = 2 * r + 1

    def at(grid, y, x):
        if grid is not None:
            return grid[y][x]
        return flat[y * w + x]

    tmp: List[List[float]] = [[0.0 for _ in range(w)] for _ in range(h)]
    for y in range(h):
        for x in range(w):
            s = 0.0
            for k in range(-r, r + 1):
                sx = max(0, min(w - 1, x + k))
                s += at(src, y, sx)
            tmp[y][x] = s / win

    out: List[List[float]] = [[0.0 for _ in range(w)] for _ in range(h)]
    for x in range(w):
        for y in range(h):
            s = 0.0
            for k in range(-r, r + 1):
                sy = max(0, min(h - 1, y + k))
                s += tmp[sy][x]
            out[y][x] = s / win
    return out


def box_blur3(src, w: int, h: int, radius: int, channel_count: int = 1) -> List[List[float]]:
    """Separable 3-pass-style box blur on a single-channel float grid.

    Portable fallback for pixels.boxBlur3. Keeps the same conceptual contract:
    produces a blurred copy with clamped kernel radius.

    Accepts list-of-lists or flat list.
    """
    rows, flat = _ensure_2d(src, w, h)
    r = max(0, min(radius, w, h, 60))
    if r == 0:
        if rows is not None:
            return [row[:] for row in rows]
        return [[float(flat[y * w + x]) for x in range(w)] for y in range(h)]
    win = 2 * r + 1

    def at(grid, y, x):
        if grid is not None:
            return grid[y][x]
        return flat[y * w + x]

    # horizontal
    tmp: List[List[float]] = [[0.0 for _ in range(w)] for _ in range(h)]
    for y in range(h):
        for x in range(w):
            s = 0.0
            for k in range(-r, r + 1):
                sx = max(0, min(w - 1, x + k))
                s += at(src, y, sx)
            tmp[y][x] = s / win

    # vertical
    out: List[List[float]] = [[0.0 for _ in range(w)] for _ in range(h)]
    for x in range(w):
        for y in range(h):
            s = 0.0
            for k in range(-r, r + 1):
                sy = max(0, min(h - 1, y + k))
                s += tmp[sy][x]
            out[y][x] = s / win
    return out


def mulberry32(a: int):
    state = [a & 0xFFFFFFFF]
    def fn() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = (state[0] ^ (state[0] >> 15)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * 61)) & 0xFFFFFFFF
        out = float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
        return out
    return fn
