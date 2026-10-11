// Orchestration layer for the studio pipeline.

import type { Cutout } from "./segment";
import type { EnhancePlan } from "./enhance";
import { detectObject, loadObjectDetector, type DetectResult } from "./objectDetection";
import { segmentAsync } from "./segmentClient";
import { enhanceImage } from "./enhance";

export type PipelineState =
  | { kind: "idle" }
  | {
      kind: "loaded";
      source: { rgba: Uint8ClampedArray; width: number; height: number };
      focus: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
      detections: DetectResult[];
      cutout: Cutout | null;
      plan: EnhancePlan | null;
    };

export const loadDetector = loadObjectDetector;

export async function ingestSource(
  file: File,
): Promise<{ source: { rgba: Uint8ClampedArray; width: number; height: number }; cutout: Cutout | null }> {
  const bitmap = await createImageBitmap(file);
  const targetSide = 1400;
  const s = Math.min(1, targetSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);

  let detections: DetectResult[] = [];
  let focus: { xMin: number; yMin: number; xMax: number; yMax: number } | null = null;
  try {
    const detector = await loadDetector();
    detections = await detectObject(detector, data);
    if (detections.length > 0) {
      const top = detections[0];
      focus = {
        xMin: Math.max(0, top.bbox.xMin),
        yMin: Math.max(0, top.bbox.yMin),
        xMax: Math.min(w, top.bbox.xMax),
        yMax: Math.min(h, top.bbox.yMax),
      };
    }
  } catch {
    // detection unavailable: keep the whole frame
  }

  let cutout: Cutout | null = null;
  try {
    cutout = await segmentAsync({ rgba: data.data, width: w, height: h, tolerance: 26 });
  } catch {
    cutout = null;
  }

  return {
    source: { rgba: data.data, width: w, height: h },
    cutout,
  };
}

export async function enhanceSource(
  plan: EnhancePlan,
  source: { rgba: Uint8ClampedArray; width: number; height: number },
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  return enhanceImage(plan, source);
}

// Re-export the public API surface only.
export type { EnhancePlan } from "./enhance";
export { detectObject, type DetectResult } from "./objectDetection";
export { segmentAsync } from "./segmentClient";
