"""styles — output style definitions, product analysis, recommendation.

Mirrors src/lib/pipeline/styles.ts. No canvas involved; all color analysis is on
RGBA byte arrays / flat lists.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from .segmentation import Cutout, SegmentOptions, segment


OutputStyleId = str
StyleDef = Dict[str, Any]

OUTPUT_STYLES: List[StyleDef] = [
    {
        "id": "pure-white",
        "label": "Pure white",
        "blurb": "100% product on pure white — no shadow at all.",
        "backdrop": "paper",
        "shadow": {"direction": 55, "length": 0.55, "softness": 0.7, "opacity": 0.34, "contact": True},
        "shadows": False,
    },
    {
        "id": "white-shadow",
        "label": "White + shadow",
        "blurb": "Marketplace white with our signature soft contact + cast shadow.",
        "backdrop": "paper",
        "shadow": {"direction": 55, "length": 0.55, "softness": 0.7, "opacity": 0.34, "contact": True},
        "shadows": True,
    },
    {
        "id": "premium-desk",
        "label": "Premium desk",
        "blurb": "Warm walnut desk, soft falloff, grounded cast — editorial look.",
        "backdrop": "walnut",
        "shadow": {"direction": 50, "length": 0.8, "softness": 0.55, "opacity": 0.46, "contact": True},
        "shadows": True,
    },
    {
        "id": "studio",
        "label": "Studio",
        "blurb": "Cool grey gradient, big soft ring — catalog classic.",
        "backdrop": "studio",
        "shadow": {"direction": 55, "length": 0.65, "softness": 0.75, "opacity": 0.38, "contact": True},
        "shadows": True,
    },
    {
        "id": "moody",
        "label": "Moody",
        "blurb": "Charcoal stage, hard directional light, deep cast.",
        "backdrop": "charcoal",
        "shadow": {"direction": 115, "length": 0.9, "softness": 0.35, "opacity": 0.55, "contact": True},
        "shadows": True,
    },
]


def get_style(id_: OutputStyleId) -> StyleDef:
    for s in OUTPUT_STYLES:
        if s["id"] == id_:
            return s
    return OUTPUT_STYLES[0]


def _srgb_to_hex(r: float, g: float, b: float) -> str:
    def h(v: float) -> str:
        return int(round(max(0.0, min(255.0, v)))).to_bytes(1, "big", signed=False).hex()
    return f"#{h(r)}{h(g)}{h(b)}"


def _lum(r: float, g: float, b: float) -> float:
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def _chroma(r: float, g: float, b: float) -> float:
    mx = max(r, g, b)
    mn = min(r, g, b)
    return 0.0 if mx == 0 else (mx - mn) / mx


def _is_skinish(r: float, g: float, b: float) -> bool:
    l = _lum(r, g, b)
    c = _chroma(r, g, b)
    return r > g and g > b and c > 0.08 and c < 0.55 and l > 0.2 and l < 0.9


def _kmeans_palette(samples: List[Tuple[float, float, float]], k: int) -> List[Tuple[float, float, float]]:
    if not samples:
        return [(255.0, 255.0, 255.0)]
    if len(samples) <= k:
        return samples[:]
    centers = [samples[len(samples) // 2]]
    while len(centers) < k:
        best = samples[0]
        best_d = -1.0
        step = max(1, len(samples) >> 6)
        for i in range(0, len(samples), step):
            s = samples[i]
            d = float("inf")
            for c in centers:
                d = min(d, (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2)
            if d > best_d:
                best_d = d
                best = s
        centers.append(best)
    assign = [0] * len(samples)
    for _ in range(8):
        moved = False
        for i, s in enumerate(samples):
            bi = 0
            bd = float("inf")
            for c_idx, c in enumerate(centers):
                d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2
                if d < bd:
                    bd = d
                    bi = c_idx
            if assign[i] != bi:
                assign[i] = bi
                moved = True
        if not moved:
            break
        sums = [ [0.0, 0.0, 0.0, 0.0] for _ in centers ]
        for i, s in enumerate(samples):
            a = sums[assign[i]]
            a[0] += s[0]
            a[1] += s[1]
            a[2] += s[2]
            a[3] += 1.0
        for c_idx, s in enumerate(sums):
            if s[3] > 0:
                centers[c_idx] = (s[0] / s[3], s[1] / s[3], s[2] / s[3])
    return centers


StyleAnalysis = Dict[str, Any]


def analyze_cutout(cutout: Cutout) -> StyleAnalysis:
    alpha = cutout.alpha
    w = cutout.width
    h = cutout.height

    samples: List[Tuple[float, float, float]] = []
    sum_l = 0.0
    sum_l2 = 0.0
    sum_c = 0.0
    count = 0
    skin_count = 0
    glossy_hits = 0

    for y in range(h):
        for x in range(w):
            i = y * w + x
            a = alpha[i * 4 + 3]
            if a < 128:
                continue
            r = alpha[i * 4]
            g = alpha[i * 4 + 1]
            b = alpha[i * 4 + 2]
            l = _lum(r, g, b)
            sum_l += l
            sum_l2 += l * l
            sum_c += _chroma(r, g, b)
            count += 1
            if _is_skinish(r, g, b):
                skin_count += 1
            if l > 0.93:
                glossy_hits += 1
            if (x & 3) == 0 and (y & 3) == 0:
                samples.append((float(r), float(g), float(b)))

    count = max(1, count)
    tone = sum_l / count
    contrast = math.sqrt(max(0.0, sum_l2 / count - tone * tone))
    saturation = sum_c / count
    glossy = min(1.0, (glossy_hits / count) * 6.0)
    soft_goods = skin_count / count > 0.25
    palette = _kmeans_palette(samples, 4)
    palette_hex = [_srgb_to_hex(r, g, b) for r, g, b in palette]

    if soft_goods:
        category = "Soft goods / apparel"
    elif glossy > 0.35:
        category = "Hard goods / glossy"
    elif tone < 0.35:
        category = "Dark product"
    else:
        category = "General product"

    temp_sum = 0.0
    temp_count = 0
    sheen_hits = 0
    for r, g, b in samples:
        l = _lum(r, g, b)
        c = _chroma(r, g, b)
        if c > 0.08:
            temp_sum += (r - b) / (l + 0.05)
            temp_count += 1
        if l > 0.93:
            sheen_hits += 1
    temperature = (temp_sum / temp_count * 1.2) if temp_count else 0.0
    temperature = max(-1.0, min(1.0, temperature))
    sheen = sheen_hits / max(1, len(samples))

    box = cutout.box
    box_area = max(1, box["w"] * box["h"])
    alpha_area = 0
    for y in range(box["y"], min(h, box["y"] + box["h"])):
        for x in range(box["x"], min(w, box["x"] + box["w"])):
            if alpha[(y * w + x) * 4 + 3] > 128:
                alpha_area += 1
    solidity = min(1.0, alpha_area / box_area)
    aspect = max(box["w"], box["h"]) / max(1, min(box["w"], box["h"]))
    elongation = min(1.0, (aspect - 1.0) / 2.0)

    transitions = 0
    for y in range(box["y"], min(h, box["y"] + box["h"])):
        prev = False
        for x in range(box["x"], min(w, box["x"] + box["w"])):
            cur = alpha[(y * w + x) * 4 + 3] > 128
            if cur != prev:
                transitions += 1
            prev = cur
    intricacy = min(1.0, transitions / max(1, alpha_area * 0.12))

    return {
        "palette": palette_hex,
        "tone": tone,
        "contrast": contrast,
        "saturation": saturation,
        "glossy": glossy,
        "soft_goods": soft_goods,
        "category": category,
        "temperature": temperature,
        "solidity": solidity,
        "elongation": elongation,
        "intricacy": intricacy,
        "sheen": sheen,
    }


def recommend_styles(a: StyleAnalysis) -> List[OutputStyleId]:
    score: Dict[OutputStyleId, float] = {
        "pure-white": 2.2,
        "white-shadow": 2.6,
        "premium-desk": 1.6,
        "studio": 1.8,
        "moody": 0.8,
    }
    if a["tone"] > 0.55:
        score["pure-white"] += 0.8
        score["white-shadow"] += 0.6
        score["moody"] -= 0.4
    elif a["tone"] < 0.35:
        score["moody"] += 1.1
        score["premium-desk"] += 0.5
        score["pure-white"] -= 0.6
    if a["glossy"] > 0.3:
        score["white-shadow"] += 0.35
        score["studio"] += 0.35
    if a["soft_goods"]:
        score["premium-desk"] += 0.7
        score["pure-white"] += 0.2
    if a["saturation"] > 0.45:
        score["pure-white"] += 0.3
        score["moody"] -= 0.3
    ranked = sorted(score.items(), key=lambda kv: kv[1], reverse=True)
    return [k for k, _v in ranked]


def segment_and_analyze(
    rgba: Any,
    width: int,
    height: int,
    opts: Optional[SegmentOptions] = None,
) -> Tuple[Cutout, StyleAnalysis]:
    cutout = segment(rgba, width, height, opts)
    return cutout, analyze_cutout(cutout)
