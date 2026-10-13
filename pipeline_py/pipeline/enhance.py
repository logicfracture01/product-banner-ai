"""enhance — tone / color / local adjustment engine.

Mirrors src/lib/pipeline/enhance.ts. Operates on flat RGBA byte buffers or numpy
arrays of shape (h, w, 4). Returns the same shape and layout.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple, Union

from .pixels import clamp255, smoothstep, luminance


EnhancePlan = Dict[str, float]


def enhance_image(
    plan: EnhancePlan,
    source: Union[bytes, Any],
    width: int,
    height: int,
) -> bytes:
    plan0 = {
        "white_point": 1.0,
        "black_point": 0.0,
        "exposure": 0.0,
        "contrast": 1.0,
        "tint": 0.0,
        "hue": 0.0,
        "sat": 1.0,
        "lum": 0.0,
        "shadows": 0.0,
        "midtones": 0.0,
        "highlights": 0.0,
        "clarity": 0.0,
        "denoise": 0.0,
        "sharpen": 0.0,
        "grain": 0.0,
        "bloom": 0.0,
        "vignette": 0.0,
    }
    plan0.update({k: float(v) for k, v in plan.items()})

    if hasattr(source, "shape") and getattr(source, "shape", None) == (height, width, 4):
        import numpy as np
        src = source.astype(np.float32, copy=True)
        graded = _enhance_numpy(src, width, height, plan0)
        out = np.clip(graded, 0, 255).round().astype(np.uint8)
        return bytes(out.tobytes())
    flat = list(source) if isinstance(source, (bytes, bytearray)) else list(source)
    return _enhance_fb(flat, width, height, plan0)


def _srgb_to_linear8(c: float) -> float:
    v = c / 255.0
    return v / 12.92 if v <= 0.04045 else math.pow((v + 0.055) / 1.055, 2.4)


def _linear_to_srgb8(c: float) -> float:
    v = max(0.0, min(1.0, c))
    return 255.0 * (12.92 * v if v <= 0.0031308 else 1.055 * math.pow(v, 1 / 2.4) - 0.055)


def _channel_grade(
    r: float, g: float, b: float, plan: EnhancePlan
) -> Tuple[float, float, float]:
    shadows = plan.get("shadows", 0.0)
    highlights = plan.get("highlights", 0.0)
    l = luminance(r, g, b) / 255.0
    shadow_w = max(0.0, 1.0 - l * 2.0) * max(0.0, shadows)
    highlight_w = max(0.0, (l - 0.5) * 2.0) * max(0.0, highlights)
    amount = (shadow_w + highlight_w) * 0.5
    tint = plan.get("tint", 0.0) * amount
    wb = 1.0 + tint * 0.25
    return (r * wb, g, b / wb)


def _grade(r: float, g: float, b: float, plan: EnhancePlan) -> Tuple[float, float, float]:
    return _channel_grade(r, g, b, plan)


def _hue_sat_lum(
    r: float, g: float, b: float, plan: EnhancePlan
) -> Tuple[float, float, float]:
    hue = plan.get("hue", 0.0)
    sat = plan.get("sat", 1.0)
    lum = plan.get("lum", 0.0)
    if hue == 0 and sat == 1 and lum == 0:
        return (r, g, b)
    mx = max(r, g, b)
    mn = min(r, g, b)
    l = (mx + mn) / 2.0
    if mx == mn:
        h = 0.0
        s = 0.0
    else:
        d = mx - mn
        s = (l > 127.5 and d / (510.0 - mx - mn)) or (d / (mx + mn))
        if mx == r:
            h = ((g - b) / d + (6.0 if g < b else 0.0)) / 6.0
        elif mx == g:
            h = ((b - r) / d + 2.0) / 6.0
        else:
            h = ((r - g) / d + 4.0) / 6.0
    h = (h + hue / 360.0 + 1.0) % 1.0
    s = max(0.0, min(1.0, s * sat))
    l2 = max(0.0, min(1.0, l / 255.0 + lum * 0.15))
    if s == 0:
        lv = l2 * 255.0
        return (lv, lv, lv)
    q = l2 * (1.0 + s) if l2 < 0.5 else l2 + s - l2 * s
    p = 2.0 * l2 - q
    def hue2rgb(p: float, q: float, t: float) -> float:
        if t < 0:
            t += 1.0
        if t > 1:
            t -= 1.0
        if t < 1 / 6:
            return p + (q - p) * 6.0 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0
        return p
    return (
        hue2rgb(p, q, h + 1.0 / 3.0) * 255.0,
        hue2rgb(p, q, h) * 255.0,
        hue2rgb(p, q, h - 1.0 / 3.0) * 255.0,
    )


def _tone_curve(
    r: float, g: float, b: float, plan: EnhancePlan
) -> Tuple[float, float, float]:
    exposure = plan.get("exposure", 0.0)
    contrast = plan.get("contrast", 1.0)
    white = plan.get("white_point", 1.0)
    black = plan.get("black_point", 0.0)
    gain = math.pow(2.0, exposure)
    pivot = 0.18 * 255.0
    r = pivot + (r * gain - pivot) * contrast
    g = pivot + (g * gain - pivot) * contrast
    b = pivot + (b * gain - pivot) * contrast
    denom = max(1e-5, white * 255.0 - black * 255.0)
    r = (r - black * 255.0) / denom
    g = (g - black * 255.0) / denom
    b = (b - black * 255.0) / denom
    return (max(0.0, min(1.0, r)) * 255.0, max(0.0, min(1.0, g)) * 255.0, max(0.0, min(1.0, b)) * 255.0)


def _enhance_fb(rgba: List[float], w: int, h: int, plan: EnhancePlan) -> bytes:
    n = w * h
    out = [0.0] * (n * 4)
    for i in range(n):
        p = i * 4
        r = rgba[p]
        g = rgba[p + 1]
        b = rgba[p + 2]
        grade = _grade(r, g, b, plan)
        curve = _tone_curve(*grade, plan)
        hsl = _hue_sat_lum(*curve, plan)
        out[p] = hsl[0]
        out[p + 1] = hsl[1]
        out[p + 2] = hsl[2]
        out[p + 3] = rgba[p + 3]

    rgba = out[:]
    if plan.get("denoise", 0.0) > 0:
        rgba = _denoise_fb(rgba, w, h, plan["denoise"], 3)
    if plan.get("clarity", 0.0) > 0:
        rgba = _clarity_fb(rgba, w, h, plan["clarity"])
    if plan.get("sharpen", 0.0) > 0:
        rgba = _sharpen_fb(rgba, w, h, plan["sharpen"], 1)
    if plan.get("bloom", 0.0) > 0:
        rgba = _bloom_fb(rgba, w, h, plan["bloom"])
    if plan.get("vignette", 0.0) > 0:
        rgba = _vignette_fb(rgba, w, h, plan["vignette"])
    if plan.get("grain", 0.0) > 0:
        rgba = _grain_fb(rgba, w, h, plan["grain"], int(plan.get("hue", 0.0)) or 1)

    out = bytearray(n * 4)
    for i in range(n * 4):
        out[i] = clamp255(rgba[i])
    return bytes(out)


def _enhance_numpy(src, w: int, h: int, plan: EnhancePlan):
    import numpy as np
    n = w * h
    grade_r = np.empty((h, w), dtype=np.float32)
    grade_g = np.empty((h, w), dtype=np.float32)
    grade_b = np.empty((h, w), dtype=np.float32)
    for y in range(h):
        for x in range(w):
            p = (y * w + x) * 4
            r, g, b, a = src[y, x]
            gr = _grade(r, g, b, plan)
            cu = _tone_curve(*gr, plan)
            hs = _hue_sat_lum(*cu, plan)
            grade_r[y, x] = hs[0]
            grade_g[y, x] = hs[1]
            grade_b[y, x] = hs[2]
    out = np.zeros_like(src)
    out[..., 0] = grade_r
    out[..., 1] = grade_g
    out[..., 2] = grade_b
    out[..., 3] = src[..., 3]

    if plan.get("denoise", 0.0) > 0:
        out[..., 0:3] = _denoise_np(out[..., 0:3], w, h, plan["denoise"], 3)
    if plan.get("clarity", 0.0) > 0:
        out[..., 0:3] = _clarity_np(out[..., 0:3], w, h, plan["clarity"])
    if plan.get("sharpen", 0.0) > 0:
        out[..., 0:3] = _sharpen_np(out[..., 0:3], w, h, plan["sharpen"], 1)
    if plan.get("bloom", 0.0) > 0:
        out[..., 0:3] = _bloom_np(out[..., 0:3], w, h, plan["bloom"])
    if plan.get("vignette", 0.0) > 0:
        out[..., 0:3] = _vignette_np(out[..., 0:3], w, h, plan["vignette"])
    if plan.get("grain", 0.0) > 0:
        amount = plan["grain"] * 22.0
        state = [int(plan.get("hue", 0.0)) or 1]
        def rng() -> float:
            state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
            t = (state[0] ^ (state[0] >> 15)) & 0xFFFFFFFF
            t = (t + ((t ^ (t >> 7)) * 61)) & 0xFFFFFFFF
            return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
        noise = np.random.default_rng().normal(0, amount, (h, w)).astype(np.float32)
        out[..., 0:3] = np.clip(out[..., 0:3] + noise[..., None], 0, 255)
    return out


def _denoise_fb(rgba, w: int, h: int, amount: float, radius: int) -> List[float]:
    lum = [luminance(rgba[i], rgba[i + 1], rgba[i + 2]) for i in range(0, len(rgba), 4)]
    def gkernel(dx: int, dy: int) -> float:
        return math.exp(-(dx * dx + dy * dy) / (2.0 * radius * radius))
    winsize = radius * 2 + 1
    out = rgba[:]
    for i in range(len(rgba)):
        p = i
        bi = i
        cx = bi % w
        cy = bi // w
        lc = lum[cy * w + cx]
        r = 0.0
        g = 0.0
        b = 0.0
        s = 0.0
        for ky in range(winsize):
            sy = cy + ky - radius
            if sy < 0 or sy >= h:
                continue
            for kx in range(winsize):
                sx = cx + kx - radius
                if sx < 0 or sx >= w:
                    continue
                sidx = sy * w + sx
                spatial = gkernel(kx - radius, ky - radius)
                delta = lum[sidx] - lc
                range_ = math.exp(-(delta * delta) / 120.0)
                wgt = spatial * range_ * amount
                r += rgba[sidx * 4] * wgt
                g += rgba[sidx * 4 + 1] * wgt
                b += rgba[sidx * 4 + 2] * wgt
                s += wgt
        if s > 0:
            out[bi * 4] = r / s
            out[bi * 4 + 1] = g / s
            out[bi * 4 + 2] = b / s
    return out


def _clarity_fb(rgba, w: int, h: int, amount: float) -> List[float]:
    lum = [luminance(rgba[i], rgba[i + 1], rgba[i + 2]) for i in range(0, len(rgba), 4)]
    def gkernel(dx: int, dy: int) -> float:
        return math.exp(-(dx * dx + dy * dy) / 4.0)
    winsize = 5
    half = (winsize - 1) // 2
    blur = [0.0] * (w * h)
    for y in range(h):
        for x in range(w):
            s = 0.0
            for ky in range(winsize):
                sy = y + ky - half
                if sy < 0 or sy >= h:
                    continue
                for kx in range(winsize):
                    sx = x + kx - half
                    if sx < 0 or sx >= w:
                        continue
                    s += lum[sy * w + sx] * gkernel(kx - half, ky - half)
            blur[y * w + x] = s / (winsize * winsize)
    detail = [lum[i] - blur[i] for i in range(w * h)]
    out = rgba[:]
    for i in range(len(rgba)):
        p = i
        d = detail[i // 4]
        gain = amount * (1.0 - math.exp(-abs(d) / 25.0))
        for c in range(3):
            out[p + c] = max(0.0, min(255.0, rgba[p + c] + d * gain * 1.2))
    return out


def _sharpen_fb(rgba, w: int, h: int, amount: float, radius: int) -> List[float]:
    lum = [luminance(rgba[i], rgba[i + 1], rgba[i + 2]) for i in range(0, len(rgba), 4)]
    blur = _box_blur_fb(lum, w, h, radius)
    out = rgba[:]
    for i in range(len(rgba)):
        p = i
        detail = lum[i // 4] - blur[i // 4]
        for c in range(3):
            out[p + c] = max(0.0, min(255.0, rgba[p + c] + detail * amount))
    return out


def _box_blur_fb(src, w: int, h: int, radius: int) -> List[float]:
    r = max(0, min(radius, w, h, 60))
    if r == 0:
        return src[:]
    win = 2 * r + 1
    tmp = [0.0] * (w * h)
    for y in range(h):
        row_start = y * w
        for x in range(w):
            s = 0.0
            for k in range(-r, r + 1):
                sx = max(0, min(w - 1, x + k))
                s += src[row_start + sx]
            tmp[y * w + x] = s / win
    out = [0.0] * (w * h)
    for x in range(w):
        for y in range(h):
            s = 0.0
            for k in range(-r, r + 1):
                sy = max(0, min(h - 1, y + k))
                s += tmp[sy * w + x]
            out[y * w + x] = s / win
    return out


def _bloom_fb(rgba, w: int, h: int, amount: float) -> List[float]:
    lum = [luminance(rgba[i], rgba[i + 1], rgba[i + 2]) for i in range(0, len(rgba), 4)]
    bright = [max(0.0, lum[i] - 200.0) * amount * 0.02 for i in range(w * h)]
    glow = _box_blur_fb(bright, w, h, 8)
    out = rgba[:]
    glow_amt = amount * 0.6
    for i in range(len(rgba)):
        p = i
        g = max(0.0, glow[i // 4]) * glow_amt
        for c in range(3):
            out[p + c] = min(255.0, rgba[p + c] + g)
    return out


def _vignette_fb(rgba, w: int, h: int, amount: float) -> List[float]:
    out = rgba[:]
    cx = w / 2.0
    cy = h / 2.0
    max_r = math.hypot(cx, cy)
    for i in range(len(rgba)):
        p = i
        x = (i // 4) % w
        y = (i // 4) // w
        d = math.hypot(x - cx, y - cy) / max(1.0, max_r)
        f = max(0.0, d * amount * 1.5)
        v = 1.0 - f
        for c in range(3):
            out[p + c] = rgba[p + c] * v
    return out


def _grain_fb(rgba, w: int, h: int, amount: float, seed: int) -> List[float]:
    s = seed & 0xFFFFFFFF
    def rng() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = (s ^ (s >> 15)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * 61)) & 0xFFFFFFFF
        return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    strength = amount * 22.0
    out = rgba[:]
    for i in range(len(rgba)):
        p = i
        g = (rng() - 0.5) * strength
        for c in range(3):
            out[p + c] = max(0.0, min(255.0, rgba[p + c] + g))
    return out


def _denoise_np(rgb, w: int, h: int, amount: float, radius: int):
    import numpy as np
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)
    kernel = _gaussian_kernel_np(radius)
    out = rgb.astype(np.float32, copy=True)
    for y in range(h):
        for x in range(w):
            cx = x
            cy = y
            lc = lum[cy, cx]
            r = 0.0
            g = 0.0
            b = 0.0
            s = 0.0
            for ky in range(kernel.shape[0]):
                sy = cy + ky - radius
                if sy < 0 or sy >= h:
                    continue
                for kx in range(kernel.shape[1]):
                    sx = cx + kx - radius
                    if sx < 0 or sx >= w:
                        continue
                    spatial = kernel[ky, kx]
                    delta = lum[sy, sx] - lc
                    range_ = math.exp(-(delta * delta) / 120.0)
                    wgt = spatial * range_ * amount
                    r += rgb[sy, sx, 0] * wgt
                    g += rgb[sy, sx, 1] * wgt
                    b += rgb[sy, sx, 2] * wgt
                    s += wgt
            if s > 0:
                out[cy, cx, 0] = r / s
                out[cy, cx, 1] = g / s
                out[cy, cx, 2] = b / s
    return out


def _gaussian_kernel_np(radius: int):
    import numpy as np
    size = radius * 2 + 1
    ys, xs = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    k = np.exp(-(xs * xs + ys * ys) / (2.0 * radius * radius))
    k /= k.sum()
    return k.astype(np.float32)


def _clarity_np(rgb, w: int, h: int, amount: float):
    import numpy as np
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)
    kernel = _gaussian_kernel_np(2)
    from scipy.ndimage import convolve
    blur = convolve(lum, kernel, mode="constant", cval=0.0)
    detail = lum - blur
    gain = amount * (1.0 - np.exp(-np.abs(detail) / 25.0))
    out = rgb.astype(np.float32, copy=True) + (detail[..., None] * gain[..., None]) * 1.2
    return np.clip(out, 0, 255)


def _sharpen_np(rgb, w: int, h: int, amount: float, radius: int):
    import numpy as np
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)
    kernel = _gaussian_kernel_np(radius)
    from scipy.ndimage import convolve
    blur = convolve(lum, kernel, mode="constant", cval=0.0)
    detail = lum - blur
    out = rgb.astype(np.float32, copy=True) + detail[..., None] * amount
    return np.clip(out, 0, 255)


def _bloom_np(rgb, w: int, h: int, amount: float):
    import numpy as np
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)
    bright = np.maximum(lum - 200.0, 0.0) * amount * 0.02
    kernel = _gaussian_kernel_np(8)
    from scipy.ndimage import convolve
    glow = convolve(bright, kernel, mode="constant", cval=0.0)
    glow_amt = amount * 0.6
    out = rgb.astype(np.float32, copy=True) + np.maximum(glow, 0.0)[..., None] * glow_amt
    return np.clip(out, 0, 255)


def _vignette_np(rgb, w: int, h: int, amount: float):
    import numpy as np
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = w / 2.0
    cy = h / 2.0
    d = np.hypot(xs - cx, ys - cy) / max(1.0, math.hypot(cx, cy))
    v = 1.0 - np.maximum(0.0, d * amount * 1.5)
    out = rgb.astype(np.float32, copy=True) * v[..., None]
    return np.clip(out, 0, 255)
