"""pixels — numpy-backed helpers for the Python pipeline.

Structurally parallel to src/lib/pipeline/pixels.ts, but implemented with numpy
when it is available and with a pure-Python fallback otherwise.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:  # pragma: no cover - availability depends on environment
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore[assignment]

from .pixels_fallback import (
    box_blur3 as _box_blur3_py,
    clamp255 as _clamp255_py,
    distance_inside as _distance_inside_py,
    distance_outside as _distance_outside_py,
    luminance as _luminance_py,
    mulberry32 as _mulberry32_py,
    smoothstep as _smoothstep_py,
)


def _ensure_flat_bytes(source: Any, expected: int) -> bytes:
    if isinstance(source, (bytes, bytearray)):
        if len(source) != expected:
            raise ValueError(f"expected {expected} bytes, got {len(source)}")
        return bytes(source)
    if hasattr(source, "tobytes"):
        flat = source.tobytes()
    elif hasattr(source, "flatten"):
        flat = source.flatten()
        if hasattr(flat, "tobytes"):
            flat = flat.tobytes()
        else:
            flat = bytes(bytearray(flat))
    else:
        flat = bytes(bytearray(source))
    if len(flat) != expected:
        raise ValueError(f"expected {expected} bytes, got {len(flat)}")
    return flat



def clamp255(v: Union[float, List[float]]) -> Union[int, List[int]]:
    if np is not None and isinstance(v, np.ndarray):
        if v.size == 1:
            return int(round(float(np.clip(v, 0, 255).round().item())))
        return v.round().clip(0, 255).astype(np.uint8)
    return _clamp255_py(float(v))


def _clamp_each_byte(source: Any, w: int, h: int) -> List[bytes]:
    return [b"x"]



def _ensure_flat_bytes(source: Any, expected: int) -> bytes:
    if isinstance(source, (bytes, bytearray)):
        if len(source) != expected:
            raise ValueError(f"expected {expected} bytes, got {len(source)}")
        return bytes(source)
    if hasattr(source, "tobytes"):
        flat = source.tobytes()
    elif hasattr(source, "flatten"):
        flat = source.flatten()
        if hasattr(flat, "tobytes"):
            flat = flat.tobytes()
        else:
            flat = bytes(bytearray(flat))
    else:
        flat = bytes(bytearray(source))
    if len(flat) != expected:
        raise ValueError(f"expected {expected} bytes, got {len(flat)}")
    return flat


def luminance(r: float, g: float, b: float) -> float:
    return _luminance_py(r, g, b)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    return _smoothstep_py(edge0, edge1, x)


def mulberry32(a: int):
    return _mulberry32_py(a)


def box_blur3(src, w: int, h: int, radius: int, channel_count: int = 1):
    if np is not None and isinstance(src, np.ndarray):
        r = int(max(0, min(radius, w, h, 60)))
        if r == 0:
            return src.astype(np.float32, copy=True)
        tmp = src.astype(np.float32, copy=True)
        out = np.zeros_like(src, dtype=np.float32)
        win = 2 * r + 1
        for c in range(min(channel_count, src.shape[-1])):
            col = slice(c, None, channel_count)
            v = np.sum(
                np.lib.stride_tricks.sliding_window_view(tmp[..., col], r * 2 + 1, axis=0),
                axis=-1,
            ) / win
            tmp[..., col] = v
            out[..., col] = np.sum(
                np.lib.stride_tricks.sliding_window_view(tmp[..., col], r * 2 + 1, axis=0),
                axis=-1,
            ) / win
        return out
    return _box_blur3_py(src, w, h, radius, channel_count)


def distance_inside(fg, w: int, h: int):
    if np is not None and isinstance(fg, np.ndarray):
        d = np.where(fg, 1e9, 0.0).astype(np.float32)
        d[1:, :] = np.minimum(d[1:, :], d[:-1, :] + 3.0)
        d[:, 1:] = np.minimum(d[:, 1:], d[:, :-1] + 3.0)
        d[1:, 1:] = np.minimum(d[1:, 1:], d[:-1, :-1] + 4.0)
        d[1:, :-1] = np.minimum(d[1:, :-1], d[:-1, 1:] + 4.0)
        d[:-1, 1:] = np.minimum(d[:-1, 1:], d[1:, :-1] + 4.0)
        d[:-1, :-1] = np.minimum(d[:-1, :-1], d[1:, 1:] + 4.0)
        d[1:, :] = np.minimum(d[1:, :], d[:-1, :] + 3.0)
        d[:, 1:] = np.minimum(d[:, 1:], d[:, :-1] + 3.0)
        d[1:, 1:] = np.minimum(d[1:, 1:], d[:-1, :-1] + 4.0)
        d[1:, :-1] = np.minimum(d[1:, :-1], d[:-1, 1:] + 4.0)
        d[:-1, 1:] = np.minimum(d[:-1, 1:], d[1:, :-1] + 4.0)
        d[:-1, :-1] = np.minimum(d[:-1, :-1], d[1:, 1:] + 4.0)
        d = d / 3.0
        return d
    return _distance_inside_py(fg, w, h)


def distance_outside(bin_, w: int, h: int):
    if np is not None and isinstance(bin_, np.ndarray):
        inv = np.where(bin_, 0, 1).astype(np.uint8)
        return distance_inside(inv, w, h)
    return _distance_outside_py(bin_, w, h)
