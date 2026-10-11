// Object detection (Stage 1 of the pipeline): find the main product in a messy
// photo so the matting stage knows what to keep.
//
// MODEL: EfficientDet-Lite0 (COCO-80) via MediaPipe Tasks Vision. ~7.2 MB
// float16 weights, streamed from the public mediapipe-models bucket; the Wasm
// runtime comes from jsDelivr. Both send permissive CORS headers, so the app
// stays a pure static deploy — no model bytes in the bundle and no server work.
//
// The detector is loaded once and reused (promise-memoized). A failed load is
// NOT cached: the next caller retries, so a transient network blip doesn't
// disable Stage 1 for the whole session.

import {
  FilesetResolver,
  ObjectDetector,
  type BoundingBox,
  type Detection,
  type ObjectDetectorOptions,
} from "@mediapipe/tasks-vision";

import {
  DETECTION_MAX_RESULTS,
  DETECTION_SCORE_THRESHOLD,
  OBJECT_DETECTOR_MODEL_URL,
  TASKS_VISION_WASM_BASE,
} from "./mediapipeAssets";
import type { DetectResult } from "./detectionBoxes";

// Re-export the pure geometry half so callers get one import for the whole
// Stage-1 surface. The implementations live in detectionBoxes.ts, which has no
// MediaPipe dependency and is therefore unit-testable.
export {
  boxIoU,
  detectionToBox,
  pickDetectionAlignedCandidate,
  primaryDetection,
  type Box,
  type DetectResult,
} from "./detectionBoxes";

/** Image source MediaPipe can consume directly. */
export type DetectInput =
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ImageBitmap
  | ImageData;

let detectorPromise: Promise<ObjectDetector> | null = null;

/**
 * Load (once) the shared object detector.
 *
 * Tries the GPU delegate first (much faster when WebGL is available) and falls
 * back to CPU — importantly, a GPU failure here is *expected* on headless and
 * low-end devices rather than exceptional, so it is a warn, not an error.
 */
export function loadObjectDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    const attempt = createDetector();
    detectorPromise = attempt;
    // Do not memoize a rejection: allow a later retry.
    attempt.catch(() => {
      if (detectorPromise === attempt) detectorPromise = null;
    });
  }
  return detectorPromise;
}

async function createDetector(): Promise<ObjectDetector> {
  const fileset = await FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE);
  const shared = {
    runningMode: "IMAGE" as const,
    scoreThreshold: DETECTION_SCORE_THRESHOLD,
    maxResults: DETECTION_MAX_RESULTS,
  };
  try {
    return await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJECT_DETECTOR_MODEL_URL, delegate: "GPU" },
      ...shared,
    } satisfies ObjectDetectorOptions);
  } catch (gpuErr) {
    console.warn("[objectDetection] GPU delegate unavailable, using CPU:", gpuErr);
    return await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJECT_DETECTOR_MODEL_URL, delegate: "CPU" },
      ...shared,
    } satisfies ObjectDetectorOptions);
  }
}

function bboxOf(box: BoundingBox | undefined): DetectResult["bbox"] {
  if (!box) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  return {
    xMin: box.originX,
    yMin: box.originY,
    xMax: box.originX + box.width,
    yMax: box.originY + box.height,
  };
}

/** Highest-scoring category of a detection (MediaPipe returns them sorted). */
function topCategory(d: Detection): { label: string; score: number } {
  const cats = d.categories ?? [];
  if (!cats.length) return { label: "", score: 0 };
  let best = cats[0];
  for (const c of cats) if ((c.score ?? 0) > (best.score ?? 0)) best = c;
  return { label: best.categoryName ?? "", score: best.score ?? 0 };
}

/**
 * Run a single-image detection pass.
 *
 * Resolves `[]` (never throws) when detection is unavailable — Stage 1 is an
 * enhancement, and every later stage degrades gracefully without it.
 */
export async function detectObject(
  detector: ObjectDetector,
  image: DetectInput,
): Promise<DetectResult[]> {
  try {
    const results = await detector.detect(image);
    const detections = results?.detections ?? [];
    return detections.map((d) => {
      const { label, score } = topCategory(d);
      return { bbox: bboxOf(d.boundingBox), confidence: score, label };
    });
  } catch (err) {
    console.warn("[objectDetection] detect() failed:", err);
    return [];
  }
}

/** Convenience: load the detector if needed, then detect. `[]` on any failure. */
export async function detectObjects(image: DetectInput): Promise<DetectResult[]> {
  try {
    const detector = await loadObjectDetector();
    return await detectObject(detector, image);
  } catch (err) {
    console.warn("[objectDetection] detector unavailable:", err);
    return [];
  }
}

