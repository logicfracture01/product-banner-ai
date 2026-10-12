# Demo video

`relight-demo.mp4` — 54 s, 1280×720, 24 fps, H.264 + AAC stereo.

## What is committed, and what is not

| Path | Tracked? | Why |
| --- | --- | --- |
| `demo.html` | yes | The actual source of the video. Reviewable, diffable, one file. |
| `relight-demo.mp4` | **no** | A build artifact. Regenerate it in ~70 s. |
| `../tools/make-demo-video.mjs` | yes | The generator. |

The encoded MP4 is gitignored (`video/*.mp4` in `.gitignore`) because it is
5 MB of binary that is fully reproducible from source. Committing rendered
output is how repos end up with un-reviewable diffs and blown clone sizes.

## How it is made (HTML → MP4)

```sh
node tools/make-demo-video.mjs            # full 54 s render
node tools/make-demo-video.mjs --seconds 6   # quick smoke render
node tools/make-demo-video.mjs --no-audio    # picture only
```

1. **Render** `demo.html` in headless Chromium.
2. **Seek, don't wait.** The page exposes `window.__seek(t)` and is a *pure
   function of `t`*: no CSS transitions, no wall-clock animation, every visual
   derived from one CSS variable (`--p`). Seeking to the same `t` twice gives
   byte-identical pixels, so the output is reproducible rather than
   "usually fine", and frames can't be dropped when the encoder falls behind.
3. **Stream** each frame through ffmpeg's `image2pipe` demuxer, so 1296 JPEG
   frames never touch the disk.
4. **Synthesize** the soundtrack as 48 kHz PCM in-process — a pad, a pulse, a
   whoosh on every scene change, a tick per workflow card, a rising sweep on
   the upscale beat, and an outro chime. Event times come from the page's own
   scene table (read back over the Playwright bridge), so audio and picture
   cannot drift apart.
5. **Mux** video and audio in a single ffmpeg pass.

### Requirements

- `bunx playwright install chromium-headless-shell` — the browser
- an ffmpeg with `libx264` + `aac` (Playwright's bundled ffmpeg is **not**
  enough: it is a stripped VP9/WebM-only build)
- `fonts-dejavu-core`, or every caption renders as boxes

## Structure

Ten seekable scenes, colour-coded to match the app:

| # | Scene | Beat |
| --- | --- | --- |
| 1 | Intro | Logo, tagline |
| 2 | Problem | Messy photo vs. catalogue-ready, the cost of bad listings |
| 3 | Workflow | The 5-stage flowchart, cards revealed one at a time |
| 4 | Stage 01 · Detect | Bounding box sweeping the product, class + confidence chip |
| 5 | Stage 02 · Matte | Background peels away to a transparency checkerboard |
| 6 | Stage 03 · Plan | Shadow direction/softness, backdrops, framing sliders |
| 7 | Stages 04 + 05 | Banner assembling, then the upscale detail beat |
| 8 | The app | Studio UI, live before/after split |
| 9 | Deployment | On-device, static on Vercel, 2-core friendly, never hangs |
| 10 | Outro | Call to action |

## Editing it

Change a duration in the `SCENES` array at the bottom of `demo.html` and the
capture tool picks it up automatically — the frame count, the HUD progress bar
and the audio event times all derive from that one table.

Scenes are positioned by CSS only; add one by copying a `<section class="scene">`
and giving it a `data-cam="scale,x,y|scale,x,y"` for its zoom/pan, plus a
matching entry in `SCENES` (the page throws if the two disagree).

## Background-removal approach (what we use and why)

The studio’s built-in segmenter is a small custom pipeline (`src/lib/pipeline/segment.ts`)
designed to run offline with no model download: a border-ring k-means background model,
edge-guided flood fill, connected-component selection, and a signed-distance alpha matte.
For a quick demo that is fine, but for a messy product shot — e.g. the coffee-mug-on-wooden-desk
case shown in the screenshots — a purpose-built matting model is much more reliable than this
geometry/colour heuristic.

When the real pipeline is not producing a clean cutout, the practical move is to swap in a
battle-tested open-source remover rather than keep fighting the custom engine. Two options
stand out for this project:

- **IMG.LY background removal** — a packaged browser (WebAssembly/WebGPU) and Node solution
  aimed explicitly at e-commerce/product images. First run is ~40 MB; good first-try fit for
  product shots, with a larger-quality mode for harder edges.
  Repo: https://github.com/imgly/background-removal-js
  Docs: https://img.ly/docs/cesdk/js/edit-image/remove-bg-9dfcf7/

- **RMBG-1.4** via Transformers.js — a general matting model (browser WASM/WebGPU and Node)
  that includes e-commerce/object imagery in its training, so it is a better fit than
  portrait-only matting. License note: the model card is non-commercial; commercial use needs
  a separate agreement with BRIA.
  Model: https://huggingface.co/briaai/RMBG-1.4
  Runtime: https://github.com/huggingface/transformers.js

- **rembg-web** — browser ONNX Runtime Web/WASM path with a tiny U²-Netp (~4.7 MB) option
  plus larger general models. Useful when footprint matters and you want to compare mask
  quality against a bigger model on the actual desk shots.
  Repo: https://github.com/bunn-io/rembg-web
  Docs: https://bunn-io.github.io/rembg-web/

Practical guidance for the cup-on-wooden-desk case:
- Start with IMG.LY or RMBG-1.4 for the cleanest first-pass cutout on a cluttered backdrop.
- If keeping the runtime tiny, test rembg-web’s U²-Netp but expect to fall back to a larger
  model when the background is busy and close in tone to the product.
- Whichever model you pick, verify the result on a real photo, not only on the procedural
  laptop scene — the drawn scene is too clean to expose the failure modes that matter here.
