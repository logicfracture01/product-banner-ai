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
