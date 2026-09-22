// Async client for the AI matting worker.
//
// RESPONSIBILITIES:
//   - Spawn and (re)spawn the worker; queue at most one pending request.
//   - Watchdog: the worker itself can't be trusted to report a stall
//     (a wedged WASM loop never reaches its own catch), so the MAIN thread
//     owns the deadline. If nothing comes back in time we TERMINATE the
//     worker and resolve null → the caller falls back to the custom
//     segmentation engine. This is what makes "loading forever" impossible:
//     the worst case is always a bounded wait followed by a working app.
//   - Relay download-progress percentages to a UI listener (Studio's chip).
//
// TIMEOUTS: first-load gets a longer budget (weights download + WASM warmup);
// subsequent inferences get a shorter one. A terminated worker is respawned
// lazily on the NEXT request, so one bad run doesn't poison the session —
// but the caller still sees null for THIS image and uses the fallback.

import type { MattingResult } from "./aiMatting";

type WorkerResponse =
  | { type: "progress"; id: number; pct: number }
  | {
      type: "done";
      id: number;
      ok: boolean;
      alpha?: ArrayBuffer;
      width?: number;
      height?: number;
      confidence?: number;
      error?: string;
    };

const FIRST_LOAD_TIMEOUT_MS = 90_000; // model download + WASM warmup
const INFERENCE_TIMEOUT_MS = 45_000;

let worker: Worker | null = null;
let seq = 0;
// Whether the CURRENT worker instance has already completed a job. A freshly
// respawned worker (e.g. after a watchdog kill) must re-download/re-compile
// the model, so it gets the FIRST_LOAD budget, not the short inference one.
let workerLoaded = false;
let pending: ((r: { ok: boolean; result: MattingResult | null }) => void) | null = null;

let progressListener: ((pct: number | null) => void) | null = null;

/**
 * Register a callback that receives model download progress (0..100).
 * Pass null to unregister. Called by Studio on mount/unmount.
 */
export function setMattingProgressListener(
  cb: ((pct: number | null) => void) | null,
): void {
  progressListener = cb;
}

function spawn(): Worker | null {
  try {
    const w = new Worker(new URL("./aiMattingWorker.ts", import.meta.url), {
      type: "module",
    });
    w.addEventListener("message", (e: MessageEvent) => {
      const res = e.data as WorkerResponse;
      if (res.type === "progress") {
        progressListener?.(res.pct);
        return;
      }
      // "done"
      const resolve = pending;
      pending = null;
      if (!res.ok || !res.alpha || res.width == null || res.height == null) {
        console.warn("[aiMatting] worker reported failure:", res.error);
        resolve?.({ ok: false, result: null });
        return;
      }
      resolve?.({
        ok: true,
        result: {
          alpha: new Uint8ClampedArray(res.alpha),
          width: res.width,
          height: res.height,
          confidence: res.confidence ?? 0,
        },
      });
    });
    w.addEventListener("error", (e) => {
      console.warn("[aiMatting] worker crashed:", e.message ?? e);
      kill();
    });
    return w;
  } catch {
    return null; // workers unavailable in this environment
  }
}

/** Terminate the worker and fail any in-flight request immediately. */
function kill(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    workerLoaded = false;
  }
  const resolve = pending;
  pending = null;
  progressListener?.(null);
  resolve?.({ ok: false, result: null });
}

/** Race a pending request against a main-thread deadline. */
function withWatchdog(ms: number): Promise<{ ok: boolean; result: MattingResult | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[aiMatting] no response within ${ms / 1000}s — terminating worker.`);
      kill();
      resolve({ ok: false, result: null });
    }, ms);
    pending = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
  });
}

/**
 * Produce an AI alpha matte for a bitmap, off the main thread.
 *
 * Resolves null on ANY failure — load error, inference error, or watchdog
 * deadline — and the caller falls back to the custom segment.ts engine.
 * The wait is always bounded: even a fully wedged worker gets terminated.
 */
export async function aiMatteAsync(bitmap: ImageBitmap): Promise<MattingResult | null> {
  if (pending) {
    // Single-slot queue: a second concurrent call (double-click, rapid
    // upload, warmup racing a real photo) would overwrite the pending
    // resolver and strand the first caller until its watchdog fires.
    // Failing fast to the fallback is correct: the custom engine always
    // works, and the AI stage will be available on the next photo.
    console.warn("[aiMatting] request already in flight — using fallback for this image.");
    return null;
  }
  if (!worker) worker = spawn();
  if (!worker) return null;

  const job = withWatchdog(workerLoaded ? INFERENCE_TIMEOUT_MS : FIRST_LOAD_TIMEOUT_MS);
  const id = ++seq;
  // Transfer the bitmap (zero-copy); the worker owns it afterwards.
  worker.postMessage({ type: "matte", id, bitmap }, [bitmap]);
  const res = await job;
  workerLoaded = res.ok;
  return res.result;
}

/**
 * Test whether the model can load and run at all (used by the warmup on
 * Studio mount). Resolves quickly with true/false and leaves the loaded
 * pipeline cached in the worker for the next real image.
 */
export async function warmupMatting(): Promise<boolean> {
  // 32x32 bitmap: large enough that BiRefNet's pyramid downsampling cannot
  // produce a degenerate empty mask (a 1x1 input can report "empty mask"
  // even when the model is perfectly healthy), cheap enough to run instantly.
  const cv = new OffscreenCanvas(32, 32);
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#c84040"; // opaque warm block — a trivially matte-able shape
  ctx.fillRect(0, 0, 32, 32);
  const bmp = cv.transferToImageBitmap();
  const r = await aiMatteAsync(bmp as unknown as ImageBitmap);
  return r !== null;
}
