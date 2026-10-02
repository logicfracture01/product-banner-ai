// Async client for the AI matting worker.
//
// RESPONSIBILITIES:
//   - Spawn and (re)spawn the worker; queue at most one pending request.
//   - Preload the model without occupying that slot (see preloadMatting).
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
  | { type: "preloaded"; id: number; ok: boolean }
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
// Preload has its own slot: it shares the worker's pipeline cache but never
// competes with a real matte for the single `pending` resolver.
let preloadPending: ((ok: boolean) => void) | null = null;

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
      if (res.type === "preloaded") {
        preloadPending?.(res.ok);
        preloadPending = null;
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
  const resolvePreload = preloadPending;
  preloadPending = null;
  progressListener?.(null);
  resolvePreload?.(false);
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
    // upload, two photos landing together) would overwrite the pending
    // resolver and strand the first caller until its watchdog fires.
    // Failing fast to the fallback is correct: the custom engine always
    // works, and the AI stage will be available on the next photo.
    // A background preload never lands here — it uses its own slot.
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
 * Start the model download in the background WITHOUT taking the request slot.
 *
 * This is the first-intent warmup. Spinning the worker up pulls ~549 KB of
 * worker JS plus ~27 MB of ONNX WASM, and the BiRefNet weights then stream on
 * top of that — all of it now happens while the user is still interacting
 * rather than on page load. Crucially it never occupies `pending`, so a photo
 * loaded mid-download still runs the real AI path (with the full load budget)
 * instead of being pushed onto the fallback engine.
 *
 * Resolves true once the pipeline is built and cached in the worker.
 */
export async function preloadMatting(): Promise<boolean> {
  if (!worker) worker = spawn();
  const w = worker;
  if (!w) return false;
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    // Bounded, but deliberately non-destructive: a merely slow load keeps
    // running in the worker, so the next real request may still succeed.
    timer = setTimeout(() => {
      if (preloadPending === done) preloadPending = null;
      done(false);
    }, FIRST_LOAD_TIMEOUT_MS);
    preloadPending = done;
    w.postMessage({ type: "preload", id: ++seq });
  });
}
