"""shadow — contact and cast shadow rendering.

Mirrors src/lib/pipeline/shadow.ts. All distances reuse the same chamfer metric
as pixels.distanceInside / distanceOutside, so the segmentation and shadow engines
agree on edge geometry.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

from .segmentation import Cutout


class ShadowOptions:
    __slots__ = ("direction", "length", "softness", "opacity", "contact")

    def __init__(
        self,
        *,
        direction: float = 55.0,
        length: float = 0.7,
        softness: float = 0.6,
        opacity: float = 0.42,
        contact: bool = True,
    ) -> None:
        self.direction = direction
        self.length = length
        self.softness = softness
        self.opacity = opacity
        self.contact = contact


DEFAULT_SHADOW = ShadowOptions()


def tone_map_shadow(intensity, canvas_w: int, canvas_h: int, opts: ShadowOptions) -> bytes:
    n = canvas_w * canvas_h
    op = max(0.0, min(1.0, opts.opacity))
    out = bytearray(n)
    for i in range(n):
        v = intensity[i] * op
        if v > 0:
            v = math.pow(min(1.0, v), 1.15)
            out[i] = int(round(v * 255.0))
    return bytes(out)


def render_shadow_intensity(
    cutout: Cutout,
    place: Dict[str, float],
    canvas_w: int,
    canvas_h: int,
    opts: ShadowOptions,
) -> List[float]:
    n = canvas_w * canvas_h
    intensity: List[float] = [0.0] * n

    # rasterize silhouette at placement
    sil = [0] * n
    alpha = cutout.alpha
    cw = cutout.width
    ch = cutout.height
    box = cutout.box
    scale = float(place["scale"])
    cx = (box["x"] + box["w"] / 2.0) * scale
    cy = (box["y"] + box["h"] / 2.0) * scale
    base_x = round(place["x"] - cx)
    base_y = round(place["y"] - cy)

    scaled_w = max(1, round(box["w"] * scale))
    scaled_h = max(1, round(box["h"] * scale))
    sil_list: List[int] = []

    for dy in range(scaled_h):
        sy = min(ch - 1, int(dy / scale))
        for dx in range(scaled_w):
            sx = min(cw - 1, int(dx / scale))
            a = alpha[(sy * cw + sx) * 4 + 3]
            if a > 60:
                px = base_x + dx
                py = base_y + dy
                if 0 <= px < canvas_w and 0 <= py < canvas_h:
                    j = py * canvas_w + px
                    if not sil[j]:
                        sil[j] = 1
                        sil_list.append(j)

    if not sil_list:
        return intensity

    longest = max(box["w"], box["h"]) * scale

    # cast shadow
    travel = longest * opts.length
    cast: List[float] = [0.0] * n

    if travel > 0.5:
        rad = (opts.direction * math.pi) / 180.0
        dir_x = -math.cos(rad)
        dir_y = math.sin(rad) * 0.85
        steps = max(15, round(50.0 * (0.45 + opts.length)))

        rng = _mulberry32(0x9e3779b9)
        phase1 = rng() * math.pi * 2
        phase2 = rng() * math.pi * 2

        weights = [0.0] * steps
        w_sum = 0.0
        for s in range(steps):
            t = (s + 1) / steps
            weights[s] = math.pow(1.0 - t, 1.6)
            w_sum += weights[s]

        dil: List[List[int]] = [sil]
        for r in range(1, 4):
            dil.append(_dilate8(dil[-1], canvas_w, canvas_h))

        for s in range(steps):
            t = (s + 1) / steps
            dist = travel * t
            w = weights[s]
            jx = 0.5 * math.sin(phase1 + t * 6.1) + 0.3 * math.sin(phase2 + t * 13.7)
            ox = dir_x * dist + jx * longest * 0.02
            oy = dir_y * dist
            src = dil[min(3, int(t * 4))]
            _stamp_weighted(src, sil_list, canvas_w, canvas_h, ox, oy, w, cast)

        if w_sum > 0:
            for i in range(n):
                cast[i] /= w_sum

    # two-scale filtering
    cast_soft = cast
    if travel > 0.5:
        r_near = max(1, round(longest * 0.012))
        r_far = max(r_near + 1, round(longest * (0.02 + 0.1 * opts.softness)))
        r_near = min(r_near, 40)
        r_far = min(r_far, 40)
        tight = _box_blur3(cast, canvas_w, canvas_h, r_near)
        soft = _box_blur3(cast, canvas_w, canvas_h, r_far)
        d_out = _distance_outside(sil, canvas_w, canvas_h)
        reach = max(1.0, longest * (0.12 + 0.5 * opts.softness))
        cast_soft = [0.0] * n
        for i in range(n):
            m = d_out[i] / reach
            if m > 1:
                m = 1.0
            sm = m * m * (3.0 - 2.0 * m)
            cast_soft[i] = tight[i] * (1.0 - sm) + soft[i] * sm

    # contact shadow
    ao = [0.0] * n
    if opts.contact:
        inner = _distance_inside(sil, canvas_w, canvas_h)
        outside = _distance_outside(sil, canvas_w, canvas_h)
        band = 3.0 + 5.0 * opts.softness
        amp_out = 0.32 * (0.75 + 0.25 * opts.softness)
        amp_in = 0.4
        for i in range(n):
            if sil[i]:
                crevice = max(0.0, 5.0 - inner[i]) / 5.0
                ao[i] = amp_in * crevice
            else:
                d = outside[i]
                if d < band:
                    t = 1.0 - d / band
                    ao[i] = amp_out * t * t

    for i in range(n):
        intensity[i] = max(cast_soft[i], ao[i])

    return intensity


def paint_shadow(intensity_mask: bytes, canvas_w: int, canvas_h: int) -> bytes:
    n = canvas_w * canvas_h
    out = bytearray(n * 4)
    shadow_r = 45
    shadow_g = 40
    shadow_b = 35
    for i in range(n):
        a = intensity_mask[i]
        if a > 0:
            p = i * 4
            out[p] = shadow_r
            out[p + 1] = shadow_g
            out[p + 2] = shadow_b
            out[p + 3] = a
    return bytes(out)


def render_shadow(
    cutout: Cutout,
    place: Dict[str, float],
    canvas_w: int,
    canvas_h: int,
    opts: ShadowOptions,
) -> bytes:
    intensity = render_shadow_intensity(cutout, place, canvas_w, canvas_h, opts)
    return tone_map_shadow(intensity, canvas_w, canvas_h, opts)


# ---------------------------------------------------------------------------
# internal helpers
# ---------------------------------------------------------------------------

def _mulberry32(a: int):
    state = [a & 0xFFFFFFFF]
    def fn() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = (state[0] ^ (state[0] >> 15)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * 61)) & 0xFFFFFFFF
        out = float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
        return out
    return fn


def _stamp_weighted(
    src: List[int],
    sil_list: List[int],
    w: int,
    h: int,
    ox: float,
    oy: float,
    weight: float,
    dst: List[float],
) -> None:
    io_x = round(ox)
    io_y = round(oy)
    for k in sil_list:
        if not src[k]:
            continue
        x = (k % w) + io_x
        y = (k // w) + io_y
        if not (0 <= x < w and 0 <= y < h):
            continue
        dst[y * w + x] += weight


def _dilate8(src: List[int], w: int, h: int) -> List[int]:
    out = [0] * (w * h)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if src[i]:
                out[i] = 1
                continue
            if (
                (x > 0 and src[i - 1])
                or (x < w - 1 and src[i + 1])
                or (y > 0 and src[i - w])
                or (y < h - 1 and src[i + w])
                or (x > 0 and y > 0 and src[i - w - 1])
                or (x < w - 1 and y > 0 and src[i - w + 1])
                or (x > 0 and y < h - 1 and src[i + w - 1])
                or (x < w - 1 and y < h - 1 and src[i + w + 1])
            ):
                out[i] = 1
    return out


def _box_blur3(src: List[float], w: int, h: int, radius: int) -> List[float]:
    r = max(0, min(radius, w, h, 60))
    if r == 0:
        return src[:]
    win = 2 * r + 1
    tmp = [[0.0] * w for _ in range(h)]
    for y in range(h):
        row = src[y * w : (y + 1) * w]
        for x in range(w):
            s = 0.0
            for k in range(-r, r + 1):
                sx = max(0, min(w - 1, x + k))
                s += row[sx]
            tmp[y][x] = s / win
    out = [[0.0] * w for _ in range(h)]
    for x in range(w):
        for y in range(h):
            s = 0.0
            for k in range(-r, r + 1):
                sy = max(0, min(h - 1, y + k))
                s += tmp[sy][x]
            out[y][x] = s / win
    return [out[y][x] for y in range(h) for x in range(w)]


def _distance_inside(src: List[int], w: int, h: int) -> List[float]:
    from .pixels import distance_inside
    return distance_inside(src, w, h)


def _distance_outside(bin_: List[int], w: int, h: int) -> List[float]:
    from .pixels import distance_outside
    return distance_outside(bin_, w, h)
