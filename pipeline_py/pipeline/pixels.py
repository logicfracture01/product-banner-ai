"""pixels — Fast path for the Python pipeline using numpy when available.

Provides the same contract as src/lib/pipeline/pixels.ts where it matters for
the pipeline contract (clamp, chamfer distance in/out, box blur, smoothstep,
luminance). When numpy is available, these operate on numpy arrays for speed
and return list-of-lists / flat list shapes compatible with the fallback path.
"""

from __future__ import annotations

import math
from typing import Any, List, Optional, Sequence, Tuple, Union

def _has_numpy() -> bool:
    try:
        import numpy as np  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover
        return False
    return True is not None


def clamp255(v: Union[float, Any]) -> Union[int, Any]:
    return _clamp255_fb(v)


def _clamp255_fb(v: Union[float, Any]) -> Union[int, Any]:
    if isinstance(v, (list, tuple)):
        return [int(max(0, min(255, round(float(x)))))
                for x in v]
    try:
        import numpy as np
        if np.ndim(v) != 0:
            return np.clip(np.round(v), 0, 255).astype(np.uint8)
    except Exception:  # pragma: no cover
        pass
    return int(max(0, min(255, round(float(v)))))


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 == edge0:
        t = 0.0 if x <= edge0 else 1.0
    else:
        t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return float(t * t * (3.0 - 2.0 * t))


def luminance(r: float, g: float, b: float) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def _ensure_numpy() -> Any:
    """Return the numpy module when available, otherwise raise RuntimeError."""
    try:
        import numpy as np
    except Exception:  # pragma: no cover
        raise RuntimeError("numpy is required for the fast path") from None
    return np


def _ensure_numpy_array(a: Any) -> Any:
    try:
        np = _ensure_numpy()
    except RuntimeError:
        raise RuntimeError("numpy is required for the fast path") from None
    if isinstance(a, np.ndarray):
        return a
    return np.asarray(a)


def _ensure_flat_bytes(a: Any, size: int) -> bytes:
    if isinstance(a, bytes):
        return a
    if isinstance(a, bytearray):
        return bytes(a)
    v = _ensure_numpy_array(a)
    return v.tobytes() if hasattr(v, 'tobytes') else bytes(v)


def _ensure_nd(rgba: Any, shape: Tuple[int, int, int]) -> Any:
    arr = _ensure_numpy_array(rgba)
    if arr.shape != shape:
        raise ValueError(f"expected {shape}, got {arr.shape}")
    return arr.astype('float32', copy=False)


def _ensure_flat_uint8(arr: Any) -> bytes:
    a = _ensure_numpy_array(arr)
    out = np.clip(a, 0, 255).round().astype('uint8')
    return out.tobytes()


def _ensure_2d_own(src: Any, w: int, h: int):
    if h == 0 or w == 0:
        return [], None
    if isinstance(src, (list, tuple)) and src and isinstance(src[0], (list, tuple)):
        return src, None
    return None, src


def boxBlur3(
    src: Union[Sequence[Sequence[float]], Sequence[float], Any],
    w: int,
    h: int,
    radius: int,
    channel_count: int = 1,
) -> List[List[float]]:
    """Separable box blur returning list-of-lists of floats, matching the fallback."""
    try:
        np = _ensure_numpy()
    except RuntimeError:
        return _box_blur3_fb(src, w, h, radius)
    arr = _ensure_numpy_array(src)
    if arr.ndim == 1:
        arr = arr.reshape((h, w))
    arr = arr.astype('float32', copy=False)
    r = max(0, min(radius, w, h, 60))
    if r == 0:
        return [[float(arr[y, x]) for x in range(w)] for y in range(h)]
    win = 2 * r + 1
    kf = np.ones(2 * r + 1, dtype='float32') / win
    tmp = np.empty_like(arr)
    for y in range(h):
        tmp[y, :] = np.convolve(arr[y, :], kf, mode='same')
    out = np.empty_like(arr)
    for x in range(w):
        out[:, x] = np.convolve(tmp[:, x], kf, mode='same')
    return [[float(out[y, x]) for x in range(w)] for y in range(h)]


def _box_blur3_fb(
    src: Union[Sequence[Sequence[float]], Sequence[float], Any],
    w: int,
    h: int,
    radius: int,
) -> List[List[float]]:
    rows, flat = _ensure_2d_own(src, w, h)
    r = max(0, min(radius, w, h, 60))
    if r == 0:
        if rows is not None:
            return [row[:] for row in rows]
        return [[float(flat[y * w + x]) for x in range(w)] for y in range(h)]
    win = float(2 * r + 1)

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


def distance_inside(
    fg: Union[Sequence[Sequence[float]], Sequence[float], Any],
    w: int,
    h: int,
) -> Union[List[List[float]], List[float], Any]:
    """Chamfer distance inside foreground.

    - If numpy is available and the input is a numpy array, returns a numpy array.
    - If the input is a 1-D sequence/flat list and numpy is not available, returns
      a 1-D list so callers that index d[i] directly work without reallocating.
    - Otherwise returns a list-of-lists.
    """
    try:
        np = _ensure_numpy()
    except RuntimeError:
        return _distance_inside_fb(fg, w, h)

    arr = _ensure_numpy_array(fg)
    if arr.ndim == 1:
        flat = fg
        inv = [0.0 if v else 1.0 for v in flat]
        result = _distance_inside_flat(inv, w, h)
        return [float(v) for v in result]

    arr = arr.reshape((h, w))
    arr = arr.astype('float64', copy=False)
    is_fg = arr.astype(bool)

    INF = 1e9
    d = np.zeros((h, w), dtype='float64')
    d[is_fg] = INF

    for y in range(h):
        row = d[y]
        for x in range(w):
            if not row[x]:
                continue
            m = row[x]
            if x > 0:
                m = min(m, row[x - 1] + 3.0)
            if y > 0:
                m = min(m, d[y - 1, x] + 3.0)
            if x > 0 and y > 0:
                m = min(m, d[y - 1, x - 1] + 4.0)
            if x < w - 1 and y > 0:
                m = min(m, d[y - 1, x + 1] + 4.0)
            row[x] = m

    for y in range(h - 1, -1, -1):
        row = d[y]
        for x in range(w - 1, -1, -1):
            if not row[x]:
                continue
            m = row[x]
            if x < w - 1:
                m = min(m, row[x + 1] + 3.0)
            if y < h - 1:
                m = min(m, d[y + 1, x] + 3.0)
            if x < w - 1 and y < h - 1:
                m = min(m, d[y + 1, x + 1] + 4.0)
            if x > 0 and y < h - 1:
                m = min(m, d[y + 1, x - 1] + 4.0)
            row[x] = m

    d[is_fg] /= 3.0
    d[~is_fg] = 0.0
    return d


def _distance_inside_fb(
    fg: Union[Sequence[Sequence[float]], Sequence[float], Any],
    w: int,
    h: int,
) -> Union[List[List[float]], List[float]]:
    rows, flat = _ensure_2d_own(fg, w, h)
    INF = 1e9
    d: List[List[float]] = []
    row_fg: List[List[float]] = []
    for y in range(h):
        rd: List[float] = []
        rf: List[float] = []
        for x in range(w):
            if rows is not None:
                v = rows[y][x]
            else:
                v = flat[y * w + x]
            isfg = bool(v)
            rf.append(1.0 if isfg else 0.0)
            rd.append(INF if isfg else 0.0)
        row_fg.append(rf)
        d.append(rd)

    for y in range(h):
        row = d[y]
        for x in range(w):
            if not row[x]:
                continue
            m = row[x]
            if x > 0:
                m = min(m, row[x - 1] + 3.0)
            if y > 0:
                m = min(m, d[y - 1][x] + 3.0)
            if x > 0 and y > 0:
                m = min(m, d[y - 1][x - 1] + 4.0)
            if x < w - 1 and y > 0:
                m = min(m, d[y - 1][x + 1] + 4.0)
            row[x] = m

    for y in range(h - 1, -1, -1):
        row = d[y]
        for x in range(w - 1, -1, -1):
            if not row[x]:
                continue
            m = row[x]
            if x < w - 1:
                m = min(m, row[x + 1] + 3.0)
            if y < h - 1:
                m = min(m, d[y + 1][x] + 3.0)
            if x < w - 1 and y < h - 1:
                m = min(m, d[y + 1][x + 1] + 4.0)
            if x > 0 and y < h - 1:
                m = min(m, d[y + 1][x - 1] + 4.0)
            row[x] = m

    for y in range(h):
        row = d[y]
        rf = row_fg[y]
        for x in range(w):
            if rf[x]:
                row[x] /= 3.0
            else:
                row[x] = 0.0
    if rows is None:
        return [d[y][x] for y in range(h) for x in range(w)]
    return d


def _distance_inside_flat(filled: List[int], w: int, h: int) -> List[float]:
    """Variant of distance_inside that accepts a 1-D fg list and returns a 1-D list.

    This mirrors the pixels_fallback.distance_inside semantics when called with a
    flat list so the segmentation module can index the result with d[i] directly.
    """
    INF = 1e9
    d = [INF if filled[i] else 0.0 for i in range(w * h)]

    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not d[i]:
                continue
            m = d[i]
            if x > 0:
                m = min(m, d[i - 1] + 3.0)
            if y > 0:
                m = min(m, d[i - w] + 3.0)
            if x > 0 and y > 0:
                m = min(m, d[i - w - 1] + 4.0)
            if x < w - 1 and y > 0:
                m = min(m, d[i - w + 1] + 4.0)
            d[i] = m

    for y in range(h - 1, -1, -1):
        for x in range(w - 1, -1, -1):
            i = y * w + x
            if not d[i]:
                continue
            m = d[i]
            if x < w - 1:
                m = min(m, d[i + 1] + 3.0)
            if y < h - 1:
                m = min(m, d[i + w] + 3.0)
            if x < w - 1 and y < h - 1:
                m = min(m, d[i + w + 1] + 4.0)
            if x > 0 and y < h - 1:
                m = min(m, d[i + w - 1] + 4.0)
            d[i] = m

    for i in range(w * h):
        if filled[i]:
            d[i] /= 3.0
        else:
            d[i] = 0.0
    return d


def distance_outside(
    bin_: Union[Sequence[Sequence[float]], Sequence[float], Any],
    w: int,
    h: int,
) -> Union[List[List[float]], List[float], Any]:
    try:
        np = _ensure_numpy()
    except RuntimeError:
        return _distance_outside_fb(bin_, w, h)

    arr = _ensure_numpy_array(bin_)
    if arr.ndim == 1:
        flat = bin_
        inv = [0.0 if v else 1.0 for v in flat]
        result = _distance_inside_flat(inv, w, h)
        return [float(v) for v in result]

    arr = arr.reshape((h, w))
    inv = (1 - arr)
    result = distance_inside(inv, w, h)
    if isinstance(result, np.ndarray):
        return result.tolist()
    if not result:
        return []
    if isinstance(result[0], list):
        return result
    return [[float(result[y * w + x]) for x in range(w)] for y in range(h)]


def _distance_outside_fb(
    bin_: Union[Sequence[Sequence[float]], Sequence[float], Any],
    w: int,
    h: int,
) -> Union[List[List[float]], List[float]]:
    rows, flat = _ensure_2d_own(bin_, w, h)
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
    return _distance_inside_fb(inv, w, h)


def mulberry32(a: int):
    try:
        np = _ensure_numpy()
    except RuntimeError:
        return _mulberry32_fb(a)

    state = np.int32(a & 0xFFFFFFFF)

    def fn() -> float:
        nonlocal state
        state = np.int32((state + np.int32(0x6D2B79F5)) & np.int32(0xFFFFFFFF))
        t = np.int32((state ^ (state >> 15)) & np.int32(0xFFFFFFFF))
        t = np.int32((t + ((t ^ (t >> 7)) * 61)) & np.int32(0xFFFFFFFF))
        return float((t ^ (t >> 14)) & np.int32(0xFFFFFFFF)) / 4294967296.0

    return fn


def _mulberry32_fb(a: int):
    state = [a & 0xFFFFFFFF]

    def fn() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = (state[0] ^ (state[0] >> 15)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * 61)) & 0xFFFFFFFF
        return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return fn
