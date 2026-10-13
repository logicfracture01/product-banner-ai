# Python port of the Relight pipeline

This directory is a ground-up Python reimplementation of the image pipeline that
lives in `src/lib/pipeline/` in the React app. It is not a line-for-line
translation, and it is not a port of the whole project: it only covers the
deterministic image-processing pipeline.

What is ported:
- Cutout extraction: border color model, flood fill, morphology, signed-distance
  alpha matting, edge decontamination.
- Shadow rendering: contact AO + area-light cast shadow with two-scale filtering.
- Backdrop rendering and banner composition.
- Style definitions + product analysis + style recommendation.
- Enhance, upscale, and relight helpers with the same parameter shapes.

What is deliberately out of scope:
- React UI, routing, auth, Convex, Tailwind, Vite.
- MediaPipe / BiRefNet model loading, which require browsers/WASM/servers.
- The video render tooling in the repo root.

Runtime:
- Prefer numpy when available. The pipeline auto-detects it and uses the faster
  array path. If numpy is missing, it falls back to the pure-Python helpers in
  `pixels_fallback.py`, so the pipeline still runs, just more slowly.
- No browser APIs are used anywhere. Every function takes arrays and returns
  arrays or plain objects.

Run:
- `pip install -r requirements.txt` for the fast path.
- `python -m pytest` from this directory for the regression tests.
- `python cli.py demo` to render a synthetic cutout through the Python pipeline
  and print the resulting shape and a few summary numbers.
