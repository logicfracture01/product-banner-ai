"""segmentation — cutout extraction stage.

Mirrors the TypeScript custom segmentation engine in src/lib/pipeline/segment.ts:
- Sobel edge map
- border ring k-means background color model
- background flood fill from frame edges
- morphological cleanup + connected components ranking
- signed distance alpha matting
- edge decontamination
- Cutout output

Uses the pixels helpers from this package. Input is a flat RGBA byte array or
a numpy array of shape (h, w, 4) uint8. Output Cutout.alpha is always full-frame
and flat.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import pixels as px
from .pixels_fallback import smoothstep as _smoothstep


class Cutout:
    __slots__ = (
        "alpha", "width", "height", "soft_pixels", "touched_edges",
        "box", "candidates", "confidence",
    )

    def __init__(
        self,
        *,
        alpha: Any,
        width: int,
        height: int,
        soft_pixels: int,
        touched_edges: set,
        box: Dict[str, int],
        candidates: List[Dict[str, Any]],
        confidence: float,
    ) -> None:
        self.alpha = alpha
        self.width = width
        self.height = height
        self.soft_pixels = soft_pixels
        self.touched_edges = touched_edges
        self.box = box
        self.candidates = candidates
        self.confidence = confidence


class DetectedObject:
    __slots__ = ("box", "area", "score")

    def __init__(self, *, box: Dict[str, int], area: int, score: float) -> None:
        self.box = box
        self.area = area
        self.score = score


class SegmentOptions:
    __slots__ = ("tolerance", "softness", "no_retry")

    def __init__(
        self,
        *,
        tolerance: Optional[float] = None,
        softness: Optional[float] = None,
        no_retry: bool = False,
    ) -> None:
        self.tolerance = tolerance
        self.softness = softness
        self.no_retry = no_retry


def _has_numpy() -> bool:
    try:
        import numpy as np  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover
        return False
    return True is not None


def _rgba_to_ndarray(rgba, width: int, height: int):
    if _has_numpy():
        import numpy as np
        if isinstance(rgba, np.ndarray):
            arr = rgba
            if arr.shape != (height, width, 4):
                raise ValueError(f"expected (h, w, 4) array, got {arr.shape}")
            return arr.astype(np.float32, copy=False)
        flat = px._ensure_flat_bytes(rgba, width * height * 4)
        return np.frombuffer(flat, dtype=np.uint8).reshape((height, width, 4)).astype(np.float32)
    return None


def _ndarray_to_flat_uint8(arr):
    if _has_numpy():
        import numpy as np
        out = np.clip(arr, 0, 255).round().astype(np.uint8)
        return out.tobytes()
    return bytes(bytearray(px._clamp_each_byte(arr, width := 0, height := 0)))  # pragma: no cover - unreachable


def segment(
    rgba: Any,
    width: int,
    height: int,
    opts: Optional[SegmentOptions] = None,
) -> Cutout:
    if opts is None:
        opts = SegmentOptions()
    tolerance = float(opts.tolerance) if opts.tolerance is not None else 26.0
    softness = float(opts.softness) if opts.softness is not None else 2.0

    arr = _rgba_to_ndarray(rgba, width, height)
    if arr is not None:
        out = _segment_numpy(arr, width, height, tolerance, softness, opts.no_retry)
        out.alpha = out.alpha.tobytes()
        return out

    flat = px._ensure_flat_bytes(rgba, width * height * 4)
    return _segment_fallback(flat, width, height, tolerance, softness, opts.no_retry)


def _segment_numpy(
    rgba: "Any",  # numpy array (h, w, 4) float32
    width: int,
    height: int,
    tolerance: float,
    softness: float,
    no_retry: bool,
) -> Cutout:
    import numpy as np
    from .pixels import clamp255 as _clamp255_np

    h, w, _c = rgba.shape
    n = w * h

    lum = 0.299 * rgba[..., 0] + 0.587 * rgba[..., 1] + 0.114 * rgba[..., 2]
    gy = np.empty_like(lum)
    gx = np.empty_like(lum)
    gy[1:-1, :] = lum[2:, :] - lum[:-2, :]
    gx[:, 1:-1] = lum[:, 2:] - lum[:, :-2]
    edge = np.sqrt(gx * gx + gy * gy) / 4.0
    edge = np.clip(edge, 0, 255)

    ring = max(2, int(round(min(w, h) * 0.06)))
    samples: List[int] = []
    for x in range(0, w, 2):
        for t in range(0, ring, 2):
            samples.append(int((t * w + x)))
            samples.append(int(((h - 1 - t) * w + x)))
    for y in range(ring, h - ring, 2):
        for t in range(0, ring, 2):
            samples.append(int((y * w + t)))
            samples.append(int((y * w + w - 1 - t)))
    sample_cols = rgba.reshape(-1, 4)[samples].astype(np.float32)
    centers = _kmeans_numpy(sample_cols, k=4, iters=10)

    bg = np.zeros((h, w), dtype=np.uint8)
    stack: List[int] = []
    EDGE_STRONG = 60.0
    EDGE_PASS = 35.0

    def enqueue(idx: int) -> None:
        if bg.ravel()[idx]:
            return
        bg.ravel()[idx] = 1
        stack.append(idx)

    top = list(range(w))
    bottom = list(range((h - 1) * w, h * w))
    left = list(range(0, h * w, w))
    right = list(range(w - 1, h * w, w))
    for idx in top + bottom + left + right:
        if edge.ravel()[idx] <= EDGE_STRONG:
            enqueue(idx)

    touched_edges: set = set()
    cutoff = tolerance
    while stack:
        i = stack.pop()
        y = i // w
        x = i % w
        if x == 0:
            touched_edges.add(1)
        if y == 0:
            touched_edges.add(2)
        if x == w - 1:
            touched_edges.add(3)
        if y == h - 1:
            touched_edges.add(4)

        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            j = ny * w + nx
            if bg.ravel()[j]:
                continue
            if edge.ravel()[j] > EDGE_PASS:
                continue
            c = rgba.reshape(-1, 4)[j]
            dist = float(np.min(np.sqrt(((centers - c[:3]) ** 2).sum(axis=1))))
            edge_damp = 1.0 - min(1.0, float(edge.ravel()[j]) / EDGE_PASS) * 0.65
            if dist <= cutoff * edge_damp:
                enqueue(j)
            elif edge.ravel()[j] <= EDGE_PASS * 0.55 and dist <= cutoff * 1.7:
                enqueue(j)

    fg0 = (1 - bg).astype(np.uint8)
    shave_cutoff = max(4.0, cutoff * 0.7)
    shaved = fg0.copy()
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not fg0.ravel()[i]:
                continue
            if (x > 0 and not fg0.ravel()[i - 1]) or (x < w - 1 and not fg0.ravel()[i + 1]) \
                or (y > 0 and not fg0.ravel()[i - w]) or (y < h - 1 and not fg0.ravel()[i + w]):
                c = rgba.reshape(-1, 4)[i]
                dist = float(np.min(np.sqrt(((centers - c[:3]) ** 2).sum(axis=1))))
                if dist < shave_cutoff:
                    shaved.ravel()[i] = 0

    opened = _erode(_dilate(shaved, w, h, 2), w, h, 2)
    labels, sizes = _components(opened, w, h)
    comp_count = len(sizes)
    min_size = max(24, int(n * 0.004))

    comp_area = [0] * comp_count
    comp_sum_x = [0.0] * comp_count
    comp_sum_y = [0.0] * comp_count
    comp_min_x = [w] * comp_count
    comp_min_y = [h] * comp_count
    comp_max_x = [-1] * comp_count
    comp_max_y = [-1] * comp_count
    comp_border = [0.0] * comp_count
    for y in range(h):
        for x in range(w):
            i = y * w + x
            l = labels[y][x]
            if l < 0:
                continue
            comp_area[l] += 1
            comp_sum_x[l] += x
            comp_sum_y[l] += y
            if x < comp_min_x[l]:
                comp_min_x[l] = x
            if y < comp_min_y[l]:
                comp_min_y[l] = y
            if x > comp_max_x[l]:
                comp_max_x[l] = x
            if y > comp_max_y[l]:
                comp_max_y[l] = y
            if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                comp_border[l] += 1

    max_dist = math.hypot(w, h) / 2.0
    def score_of(c: int) -> float:
        af = comp_area[c] / n
        size_score = 0.05 if af >= 0.9 else min(1.0, af / 0.15)
        ccx = comp_sum_x[c] / comp_area[c]
        ccy = comp_sum_y[c] / comp_area[c]
        centrality = max(0.0, 1.0 - math.hypot(ccx - w / 2.0, ccy - h / 2.0) / max_dist)
        border_frac = comp_area[c] / comp_area[c] if comp_area[c] > 0 else 1.0
        border_frac = comp_border[c] / comp_area[c] if comp_area[c] > 0 else 1.0
        sep_sum = 0.0
        sep_count = 0
        for yy in range(comp_min_y[c], comp_max_y[c] + 1):
            for xx in range(comp_min_x[c], comp_max_x[c] + 1):
                if sep_count >= 1000:
                    break
                i = yy * w + xx
                if fg0.ravel()[i]:
                    c2 = rgba.reshape(-1, 4)[i]
                    sep_sum += float(np.min(np.sqrt(((centers - c2[:3]) ** 2).sum(axis=1))))
                    sep_count += 1
        mean_sep = sep_sum / sep_count if sep_count else 0.0
        sep_score = min(1.0, mean_sep / 80.0)
        border_penalty = 0.3 if comp_border[c] > comp_area[c] * 0.1 else 0.0
        return 0.4 * size_score + 0.25 * centrality + 0.2 * (1.0 - border_frac) + 0.15 * sep_score - border_penalty

    keep = [1 if sizes[c] >= min_size else 0 for c in range(comp_count)]
    if all(v == 0 for v in keep) and comp_count > 0:
        big = max(range(comp_count), key=lambda c: sizes[c])
        keep[big] = 1

    fg = np.zeros((h, w), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            l = labels[y][x]
            if l >= 0 and keep[l]:
                fg[y, x] = 1

    ranked = [c for c in range(comp_count) if keep[c]]
    ranked.sort(key=lambda c: score_of(c), reverse=True)
    candidates: List[DetectedObject] = [
        DetectedObject(
            box={
                "x": comp_min_x[c],
                "y": comp_min_y[c],
                "w": comp_max_x[c] - comp_min_x[c] + 1,
                "h": comp_max_y[c] - comp_min_y[c] + 1,
            },
            area=comp_area[c],
            score=score_of(c),
        )
        for c in ranked[:4]
    ]

    closed = _erode(_dilate(fg, w, h, 1), w, h, 1)
    filled = _fill_holes(closed, w, h)

    if int(filled.sum()) == 0:
        filled[...] = 1

    filled_list = filled.ravel().tolist()
    dist_in = px.distance_inside(filled_list, w, h)
    dist_out = px.distance_outside(filled_list, w, h)
    if isinstance(dist_in, list):
        dist_in = np.array(dist_in, dtype=np.float32)
    else:
        dist_in = np.asarray(dist_in, dtype=np.float32)
    if dist_in.ndim == 1:
        dist_in = dist_in.reshape((h, w))
    if isinstance(dist_out, list):
        dist_out = np.array(dist_out, dtype=np.float32)
    else:
        dist_out = np.asarray(dist_out, dtype=np.float32)
    if dist_out.ndim == 1:
        dist_out = dist_out.reshape((h, w))

    soft_range = max(0.5, softness)
    alpha = np.zeros((h, w, 4), dtype=np.float32)
    alpha[..., 0:3] = rgba[..., 0:3]
    alpha_mask = filled > 0
    a = np.where(
        alpha_mask,
        np.clip(np.round(255.0 * np.minimum(1.0, dist_in / soft_range)), 0, 255),
        0.0,
    )
    alpha[..., 3] = a
    soft_pixels = int(np.sum((a > 0) & (a < 255)))

    fg_samples_idx = np.argwhere(alpha[..., 3] >= 250)
    if fg_samples_idx.size:
        sample_vecs = alpha[fg_samples_idx[:, 0], fg_samples_idx[:, 1], 0:3]
        flat_alpha = alpha.reshape(-1, 4)
        flat_a = flat_alpha[:, 3]
        semi = np.argwhere((flat_a > 0) & (flat_a < 255))
        if semi.size:
            semi_rgb = flat_alpha[semi[:, 0], semi[:, 1], 0:3]
            d2 = np.sum((sample_vecs[None, :, :] - semi_rgb[:, None, :]) ** 2, axis=2)
            best = np.argmin(d2, axis=1)
            wgt = 0.7 * (1.0 - flat_alpha[semi[:, 0], semi[:, 1], 3] / 255.0)
            delta = sample_vecs[best] - semi_rgb
            flat_alpha[semi[:, 0], semi[:, 1], 0:3] = np.clip(
                semi_rgb + delta * wgt[:, None], 0, 255
            )
        alpha = flat_alpha.reshape((h, w, 4))

    if candidates:
        box = {
            "x": candidates[0].box["x"],
            "y": candidates[0].box["y"],
            "w": candidates[0].box["w"],
            "h": candidates[0].box["h"],
        }
    else:
        ys, xs = np.argwhere(alpha[..., 3] > 0).T
        if xs.size:
            box = {
                "x": int(xs.min()),
                "y": int(ys.min()),
                "w": int(xs.max() - xs.min() + 1),
                "h": int(ys.max() - ys.min() + 1),
            }
        else:
            box = {"x": 0, "y": 0, "w": 0, "h": 0}

    filled_mask = filled.ravel()
    fg_idx = np.argwhere(filled_mask).ravel()
    if fg_idx.size:
        fg_rgb = rgba.reshape(-1, 4)[fg_idx][:, :3]
        sep_sum = float(np.min(np.sqrt(((centers[None, :, :] - fg_rgb[:, None, :]) ** 2).sum(axis=2)), axis=1).sum())
        fg_pixels = int(fg_idx.size)
        mean_sep = sep_sum / fg_pixels
    else:
        fg_pixels = 0
        mean_sep = 0.0

    coverage = fg_pixels / n
    sep_score = min(1.0, mean_sep / 150.0)
    cov_score = min(1.0, coverage / 0.35)
    presence = 1.0 if candidates else 0.0
    confidence = 0.0 if fg_pixels == 0 else max(
        0.0, min(1.0, 0.45 * sep_score + 0.35 * cov_score + 0.2 * presence)
    )

    return Cutout(
        alpha=alpha,
        width=w,
        height=h,
        soft_pixels=soft_pixels,
        touched_edges=touched_edges,
        box=box,
        candidates=[{"box": c.box, "area": c.area, "score": c.score} for c in candidates],
        confidence=confidence,
    )


def _segment_fallback(
    flat: bytes,
    width: int,
    height: int,
    tolerance: float,
    softness: float,
    no_retry: bool,
) -> Cutout:
    from .pixels_fallback import smoothstep as _smoothstep_fb

    n = width * height
    rgba = list(flat)

    def lum_of(i: int) -> float:
        return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]

    edge = [0.0] * n
    kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
    ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            gx = 0.0
            gy = 0.0
            n2 = 0
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    p = ((y + dy) * width + (x + dx)) * 4
                    l = lum_of(p)
                    gx += l * kx[n2]
                    gy += l * ky[n2]
                    n2 += 1
            edge[y * width + x] = math.sqrt(gx * gx + gy * gy) / 4.0

    ring = max(2, int(round(min(width, height) * 0.06)))
    samples: List[int] = []
    for x in range(0, width, 2):
        for t in range(0, ring, 2):
            samples.append(t * width + x)
            samples.append((height - 1 - t) * width + x)
    for y in range(ring, height - ring, 2):
        for t in range(0, ring, 2):
            samples.append(y * width + t)
            samples.append(y * width + width - 1 - t)

    sample_cols = [(rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2] for i in samples]
    centers = _kmeans_fb(sample_cols, k=4, iters=10)

    bg = [0] * n
    stack: List[int] = []
    EDGE_STRONG = 60.0
    EDGE_PASS = 35.0

    def enqueue(idx: int) -> None:
        if bg[idx]:
            return
        bg[idx] = 1
        stack.append(idx)

    for x in range(width):
        if edge[x] <= EDGE_STRONG:
            enqueue(x)
        if edge[(height - 1) * width + x] <= EDGE_STRONG:
            enqueue((height - 1) * width + x)
    for y in range(1, height - 1):
        if edge[y * width] <= EDGE_STRONG:
            enqueue(y * width)
        if edge[y * width + width - 1] <= EDGE_STRONG:
            enqueue(y * width + width - 1)

    touched_edges: set = set()
    cutoff = tolerance
    bg_centers = centers
    while stack:
        i = stack.pop()
        x = i % width
        y = i // width
        if x == 0:
            touched_edges.add(1)
        if y == 0:
            touched_edges.add(2)
        if x == width - 1:
            touched_edges.add(3)
        if y == height - 1:
            touched_edges.add(4)

        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < width and 0 <= ny < height):
                continue
            j = ny * width + nx
            if bg[j]:
                continue
            if edge[j] > EDGE_PASS:
                continue
            p = j * 4
            r = rgba[p]
            g = rgba[p + 1]
            b = rgba[p + 2]
            dist = _bg_distance_fb(r, g, b, bg_centers)
            edge_damp = 1.0 - min(1.0, edge[j] / EDGE_PASS) * 0.65
            if dist <= cutoff * edge_damp:
                enqueue(j)
            elif edge[j] <= EDGE_PASS * 0.55 and dist <= cutoff * 1.7:
                enqueue(j)

    fg0 = [0 if bg[i] else 1 for i in range(n)]
    shave_cutoff = max(4.0, cutoff * 0.7)
    shaved = fg0[:]
    for y in range(height):
        for x in range(width):
            i = y * width + x
            if not fg0[i]:
                continue
            touches = (
                (x > 0 and not fg0[i - 1])
                or (x < width - 1 and not fg0[i + 1])
                or (y > 0 and not fg0[i - width])
                or (y < height - 1 and not fg0[i + width])
            )
            if not touches:
                continue
            p = i * 4
            r = rgba[p]
            g = rgba[p + 1]
            b = rgba[p + 2]
            if _bg_distance_fb(r, g, b, bg_centers) < shave_cutoff:
                shaved[i] = 0

    opened = _dilate_fb(_erode_fb(shaved, width, height, 2), width, height, 2)
    labels, sizes = _components_fb(opened, width, height)
    comp_count = len(sizes)
    min_size = max(24, int(n * 0.004))

    comp_area = [0] * comp_count
    comp_sum_x = [0.0] * comp_count
    comp_sum_y = [0.0] * comp_count
    comp_min_x = [width] * comp_count
    comp_min_y = [height] * comp_count
    comp_max_x = [-1] * comp_count
    comp_max_y = [-1] * comp_count
    comp_border = [0.0] * comp_count
    for y in range(height):
        for x in range(width):
            i = y * width + x
            l = labels[y][x]
            if l < 0:
                continue
            comp_area[l] += 1
            comp_sum_x[l] += x
            comp_sum_y[l] += y
            if x < comp_min_x[l]:
                comp_min_x[l] = x
            if y < comp_min_y[l]:
                comp_min_y[l] = y
            if x > comp_max_x[l]:
                comp_max_x[l] = x
            if y > comp_max_y[l]:
                comp_max_y[l] = y
            if x == 0 or y == 0 or x == width - 1 or y == height - 1:
                comp_border[l] += 1

    max_dist = math.hypot(width, height) / 2.0
    def score_of(c: int) -> float:
        af = comp_area[c] / n
        size_score = 0.05 if af >= 0.9 else min(1.0, af / 0.15)
        ccx = comp_sum_x[c] / comp_area[c]
        ccy = comp_sum_y[c] / comp_area[c]
        centrality = max(0.0, 1.0 - math.hypot(ccx - width / 2.0, ccy - height / 2.0) / max_dist)
        border_frac = comp_border[c] / comp_area[c] if comp_area[c] > 0 else 1.0
        sep_sum = 0.0
        sep_count = 0
        for yy in range(comp_min_y[c], comp_max_y[c] + 1):
            for xx in range(comp_min_x[c], comp_max_x[c] + 1):
                if sep_count >= 1000:
                    break
                i = yy * width + xx
                if fg0[i]:
                    p = i * 4
                    sep_sum += _bg_distance_fb(rgba[p], rgba[p + 1], rgba[p + 2], bg_centers)
                    sep_count += 1
        mean_sep = sep_sum / sep_count if sep_count else 0.0
        sep_score = min(1.0, mean_sep / 80.0)
        border_penalty = 0.3 if comp_border[c] > comp_area[c] * 0.1 else 0.0
        return 0.4 * size_score + 0.25 * centrality + 0.2 * (1.0 - border_frac) + 0.15 * sep_score - border_penalty

    keep = [1 if sizes[c] >= min_size else 0 for c in range(comp_count)]
    if all(v == 0 for v in keep) and comp_count > 0:
        big = max(range(comp_count), key=lambda c: sizes[c])
        keep[big] = 1

    fg = [0] * n
    for i in range(n):
        l = labels[i // width][i % width]
        if l >= 0 and keep[l]:
            fg[i] = 1

    ranked = [c for c in range(comp_count) if keep[c]]
    ranked.sort(key=lambda c: score_of(c), reverse=True)
    candidates: List[DetectedObject] = [
        DetectedObject(
            box={
                "x": comp_min_x[c],
                "y": comp_min_y[c],
                "w": comp_max_x[c] - comp_min_x[c] + 1,
                "h": comp_max_y[c] - comp_min_y[c] + 1,
            },
            area=comp_area[c],
            score=score_of(c),
        )
        for c in ranked[:4]
    ]

    closed = _erode_fb(_dilate_fb(fg, width, height, 1), width, height, 1)
    filled = _fill_holes_fb(closed, width, height)

    if any(filled):
        pass
    else:
        filled = [1] * n

    dist_in = px.distance_inside(filled, width, height)
    dist_out = px.distance_outside(filled, width, height)

    soft_range = max(0.5, softness)
    alpha = [0] * (n * 4)
    soft_pixels = 0
    for i in range(n):
        p = i * 4
        alpha[p] = rgba[p]
        alpha[p + 1] = rgba[p + 1]
        alpha[p + 2] = rgba[p + 2]
        if filled[i]:
            a = px.clamp255(round(255.0 * min(1.0, dist_in[i] / soft_range)))
        else:
            a = 0
        alpha[p + 3] = a
        if 0 < a < 255:
            soft_pixels += 1

    fg_samples: List[int] = []
    for i in range(n):
        a = alpha[i * 4 + 3]
        if a >= 250 and len(fg_samples) < 128:
            fg_samples.append((alpha[i * 4] << 16) | (alpha[i * 4 + 1] << 8) | alpha[i * 4 + 2])
    if fg_samples:
        for i in range(n):
            p = i * 4
            a = alpha[p + 3]
            if a == 0 or a == 255:
                continue
            r = alpha[p]
            g = alpha[p + 1]
            b = alpha[p + 2]
            best = 0
            best_d = 1e9
            for s in fg_samples:
                dr = r - ((s >> 16) & 255)
                dg = g - ((s >> 8) & 255)
                db = b - (s & 255)
                d = dr * dr + dg * dg + db * db
                if d < best_d:
                    best_d = d
                    best = s
            w = 0.7 * (1.0 - a / 255.0)
            alpha[p] = px.clamp255(round(r + (((best >> 16) & 255) - r) * w))
            alpha[p + 1] = px.clamp255(round(g + (((best >> 8) & 255) - g) * w))
            alpha[p + 2] = px.clamp255(round(b + ((best & 255) - b) * w))

    if candidates:
        box = candidates[0].box
    else:
        min_x = width
        min_y = height
        max_x = -1
        max_y = -1
        for y in range(height):
            for x in range(width):
                if alpha[(y * width + x) * 4 + 3] == 0:
                    continue
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
        if max_x >= min_x and max_y >= min_y:
            box = {"x": min_x, "y": min_y, "w": max_x - min_x + 1, "h": max_y - min_y + 1}
        else:
            box = {"x": 0, "y": 0, "w": 0, "h": 0}

    fg_pixels = 0
    sep_sum = 0.0
    for i in range(n):
        if not filled[i]:
            continue
        fg_pixels += 1
        p = i * 4
        sep_sum += _bg_distance_fb(rgba[p], rgba[p + 1], rgba[p + 2], bg_centers)
    coverage = fg_pixels / n if n else 0.0
    mean_sep = sep_sum / fg_pixels if fg_pixels else 0.0
    sep_score = min(1.0, mean_sep / 150.0)
    cov_score = min(1.0, coverage / 0.35)
    presence = 1.0 if candidates else 0.0
    confidence = 0.0 if fg_pixels == 0 else max(
        0.0, min(1.0, 0.45 * sep_score + 0.35 * cov_score + 0.2 * presence)
    )

    return Cutout(
        alpha=bytes(alpha),
        width=width,
        height=height,
        soft_pixels=soft_pixels,
        touched_edges=touched_edges,
        box=box,
        candidates=[{"box": c.box, "area": c.area, "score": c.score} for c in candidates],
        confidence=confidence,
    )


def _kmeans_numpy(samples: "Any", k: int, iters: int):
    import numpy as np
    if samples.shape[0] == 0:
        return np.array([[255, 255, 255]], dtype=np.float32)
    if samples.shape[0] <= k:
        return samples.astype(np.float32, copy=True)
    order = np.argsort(float.__class__(samples @ np.array([0.299, 0.587, 0.114], dtype=np.float32))).tolist()
    centers = samples[order[0 :: max(1, len(order) // k)]].astype(np.float32)
    centers = centers[:k]
    assign = np.full(samples.shape[0], -1, dtype=np.int32)
    for _ in range(iters):
        d = np.sum((samples[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        new_assign = np.argmin(d, axis=1)
        if np.array_equal(assign, new_assign):
            break
        assign = new_assign
        sums = np.zeros((k, 4), dtype=np.float32)
        np.add.at(sums, assign, np.concatenate([samples, np.ones((samples.shape[0], 1))], axis=1))
        cnts = sums[:, 3]
        mask = cnts > 0
        centers[mask] = sums[mask, :3] / cnts[mask, None]
    return centers


def _kmeans_fb(samples: Sequence[int], k: int, iters: int) -> List[Tuple[int, int, int]]:
    if not samples:
        return [(255, 255, 255)]
    if len(samples) <= k:
        return [((s >> 16) & 255, (s >> 8) & 255, s & 255) for s in samples]

    def lum(s: int) -> int:
        return ((s >> 16) & 255) + ((s >> 8) & 255) + (s & 255)

    order = sorted(range(len(samples)), key=lambda i: (lum(samples[i]), i))
    centers: List[Tuple[int, int, int]] = []
    for c in range(k):
        idx = min(len(samples) - 1, int(((c + 0.5) / k) * len(samples)))
        s = samples[order[idx]]
        centers.append(((s >> 16) & 255, (s >> 8) & 255, s & 255))

    assign = [-1] * len(samples)
    for _ in range(iters):
        moved = False
        for i, s in enumerate(samples):
            r = (s >> 16) & 255
            g = (s >> 8) & 255
            b = s & 255
            bi = 0
            bd = 1e9
            for c_idx, (cr, cg, cb) in enumerate(centers):
                d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
                if d < bd:
                    bd = d
                    bi = c_idx
            if assign[i] != bi:
                assign[i] = bi
                moved = True
        if not moved:
            break
        sums = [[0, 0, 0, 0] for _ in range(k)]
        for i, s in enumerate(samples):
            a = assign[i]
            r = (s >> 16) & 255
            g = (s >> 8) & 255
            b = s & 255
            sums[a][0] += r
            sums[a][1] += g
            sums[a][2] += b
            sums[a][3] += 1
        for c_idx in range(k):
            if sums[c_idx][3] == 0:
                continue
            s3 = sums[c_idx]
            centers[c_idx] = (s3[0] / s3[3], s3[1] / s3[3], s3[2] / s3[3])
    return centers


def _bg_distance_fb(r: float, g: float, b: float, centers: Sequence[Tuple[float, float, float]]) -> float:
    best = 1e9
    for cr, cg, cb in centers:
        d = math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2)
        if d < best:
            best = d
    return best


def _erode(src, w: int, h: int, r: int):
    if _has_numpy():
        import numpy as np
        arr = src.reshape((h, w)).astype(np.uint8, copy=True)
        for _ in range(r):
            pad = np.pad(arr, 1, mode="constant", constant_values=0)
            arr = np.minimum.reduce([
                pad[:-2, 1:-1],
                pad[1:-1, :-2],
                pad[1:-1, 1:-1],
                pad[1:-1, 2:],
                pad[2:, 1:-1],
            ])
        return arr.reshape(-1)
    return _erode_fb(src, w, h, r)


def _dilate(src, w: int, h: int, r: int):
    if _has_numpy():
        import numpy as np
        arr = src.reshape((h, w)).astype(np.uint8, copy=True)
        for _ in range(r):
            pad = np.pad(arr, 1, mode="constant", constant_values=0)
            arr = np.maximum.reduce([
                pad[:-2, 1:-1],
                pad[1:-1, :-2],
                pad[1:-1, 1:-1],
                pad[1:-1, 2:],
                pad[2:, 1:-1],
            ])
        return arr.reshape(-1)
    return _dilate_fb(src, w, h, r)


def _erode_fb(src, w: int, h: int, r: int):
    tmp = [0] * (w * h)
    out = [0] * (w * h)
    for _ in range(r):
        for y in range(h):
            for x in range(w):
                v = 1
                for dy in range(-r, r + 1):
                    yy = y + dy
                    if yy < 0 or yy >= h or not src[yy * w + x]:
                        v = 0
                        break
                tmp[y * w + x] = v
        for y in range(h):
            for x in range(w):
                v = 1
                for dx in range(-r, r + 1):
                    xx = x + dx
                    if xx < 0 or xx >= w or not tmp[y * w + xx]:
                        v = 0
                        break
                out[y * w + x] = v
        src = out[:]
    return out


def _dilate_fb(src, w: int, h: int, r: int):
    tmp = [0] * (w * h)
    out = [0] * (w * h)
    for _ in range(r):
        for y in range(h):
            for x in range(w):
                v = 0
                for dy in range(-r, r + 1):
                    yy = y + dy
                    if 0 <= yy < h and src[yy * w + x]:
                        v = 1
                        break
                tmp[y * w + x] = v
        for y in range(h):
            for x in range(w):
                v = 0
                for dx in range(-r, r + 1):
                    xx = x + dx
                    if 0 <= xx < w and tmp[y * w + xx]:
                        v = 1
                        break
                out[y * w + x] = v
        src = out[:]
    return out


def _components(src, w: int, h: int):
    if _has_numpy():
        import numpy as np
        arr = src.reshape((h, w)).astype(np.int32, copy=False)
        labels = np.full((h, w), -1, dtype=np.int32)
        sizes: List[int] = []
        nxt = 0
        for y in range(h):
            for x in range(w):
                if not arr[y, x] or labels[y, x] >= 0:
                    continue
                stack = [(x, y)]
                labels[y, x] = nxt
                count = 0
                while stack:
                    cx, cy = stack.pop()
                    count += 1
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and arr[ny, nx] and labels[ny, nx] < 0:
                            labels[ny, nx] = nxt
                            stack.append((nx, ny))
                sizes.append(count)
                nxt += 1
        return labels.tolist(), sizes
    return _components_fb(src, w, h)


def _components_fb(src, w: int, h: int):
    labels = [[-1 for _ in range(w)] for _ in range(h)]
    sizes: List[int] = []
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not src[i] or labels[y][x] >= 0:
                continue
            stack = [i]
            cid = len(sizes)
            count = 0
            labels[y][x] = cid
            while stack:
                j = stack.pop()
                count += 1
                jx = j % w
                jy = j // w
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = jx + dx, jy + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        n = ny * w + nx
                        if src[n] and labels[ny][nx] < 0:
                            labels[ny][nx] = cid
                            stack.append(n)
            sizes.append(count)
    return labels, sizes


def _fill_holes(src, w: int, h: int):
    if _has_numpy():
        import numpy as np
        arr = src.reshape((h, w)).astype(np.uint8, copy=False)
        outside = np.zeros((h, w), dtype=np.uint8)
        stack: List[Tuple[int, int]] = []
        for y in range(h):
            for x in range(w):
                if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                    if arr[y, x] == 0 and outside[y, x] == 0:
                        outside[y, x] = 1
                        stack.append((x, y))
        while stack:
            x, y = stack.pop()
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                if outside[ny, nx] or arr[ny, nx]:
                    continue
                outside[ny, nx] = 1
                stack.append((nx, ny))
        out = (arr.astype(bool) | ~outside.astype(bool)).astype(np.uint8)
        return out.reshape(-1)
    return _fill_holes_fb(src, w, h)


def _fill_holes_fb(src, w: int, h: int):
    outside = [0] * (w * h)
    stack: List[int] = []
    for i in range(w * h):
        x = i % w
        y = i // w
        if x == 0 or y == 0 or x == w - 1 or y == h - 1:
            if not src[i] and not outside[i]:
                outside[i] = 1
                stack.append(i)
    while stack:
        i = stack.pop()
        x = i % w
        y = i // w
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            n = ny * w + nx
            if outside[n] or src[n]:
                continue
            outside[n] = 1
            stack.append(n)
    return [src[i] if src[i] or not outside[i] else 0 for i in range(w * h)]
