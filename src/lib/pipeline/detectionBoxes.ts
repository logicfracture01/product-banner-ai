// Pure geometry for Stage-1 object detection.
//
// Deliberately free of any MediaPipe import: these helpers are plain arithmetic,
// so they can be unit-tested in Bun (no DOM, no WASM, no model download). The
// model-loading half lives in objectDetection.ts and re-exports these for
// callers that already depend on it.

import type { DetectedObject } from "./segment";

/** A detection in source-pixel coordinates. */
export interface DetectResult {
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
  confidence: number;
  label: string;
}

export type Box = { x: number; y: number; w: number; h: number };

/** Intersection-over-union of two boxes. 0 when the union is empty. */
export function boxIoU(a: Box, b: Box): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Convert a detection bbox to the box shape the segment engine uses. */
export function detectionToBox(d: DetectResult | null): Box | null {
  if (!d) return null;
  const { bbox } = d;
  const w = bbox.xMax - bbox.xMin;
  const h = bbox.yMax - bbox.yMin;
  if (w <= 0 || h <= 0) return null;
  return { x: bbox.xMin, y: bbox.yMin, w, h };
}

/**
 * The single detection worth framing: the highest-confidence one that is
 * actually inside the frame and has a non-degenerate box.
 */
export function primaryDetection(detections: DetectResult[]): DetectResult | null {
  let best: DetectResult | null = null;
  for (const d of detections) {
    const { bbox } = d;
    if (bbox.xMax <= bbox.xMin || bbox.yMax <= bbox.yMin) continue;
    if (bbox.xMin < 0 || bbox.yMin < 0) continue;
    if (!best || d.confidence > best.confidence) best = d;
  }
  return best;
}

/**
 * Pick the candidate whose box best agrees with what the detector saw.
 *
 * The segment engine ranks candidates by size/centrality/edge contact, which is
 * the right prior when there is no other information — but it happily prefers a
 * large off-centre prop (a rug, a wall, a shadow) over the actual product. When
 * Stage 1 has an opinion, agreement with the detected object is stronger
 * evidence than any of those priors, so it wins as long as the boxes really do
 * overlap.
 *
 * Returns `-1` when there is no detection, no candidates, or nothing overlaps;
 * the caller then keeps the segmenter's own top pick.
 */
export function pickDetectionAlignedCandidate(
  candidates: DetectedObject[],
  detection: DetectResult | null,
): number {
  const target = detectionToBox(detection);
  if (!target || candidates.length === 0) return -1;
  let bestIdx = -1;
  let bestIoU = 0;
  for (let i = 0; i < candidates.length; i++) {
    const iou = boxIoU(candidates[i].box, target);
    if (iou > bestIoU) {
      bestIoU = iou;
      bestIdx = i;
    }
  }
  // Require real overlap; a grazing hit is noise, not identity.
  return bestIoU >= 0.25 ? bestIdx : -1;
}
