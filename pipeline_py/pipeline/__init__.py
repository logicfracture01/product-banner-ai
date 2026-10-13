"""pipeline.py — deterministic image pipeline in Python.

This package is a ground-up Python reimplementation of the browser image pipeline
that lives in src/lib/pipeline/ in the React app.

It is not a port of the whole project: it only covers the deterministic
image-processing pipeline (segment, shadow, backdrop, banner, style analysis,
enhance), with no React, Tailwind, Convex, MediaPipe, or browser dependencies.

Use it as::

    from pipeline.py import segment, render_banner_bytes, segment_and_analyze
"""

from __future__ import annotations

__all__ = [
    "banner",
    "enhance",
    "pixels",
    "segmentation",
    "shadow",
    "styles",
]
