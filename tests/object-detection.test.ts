// Stage-1 object detection: pure geometry + asset-configuration invariants.
//
// These deliberately do NOT import objectDetection.ts, because doing so pulls
// the whole MediaPipe browser bundle into the test process. The geometry lives
// in detectionBoxes.ts for exactly that reason.
import { describe, expect, test } from "bun:test";

import {
  boxIoU,
  detectionToBox,
  pickDetectionAlignedCandidate,
  primaryDetection,
  type DetectResult,
} from "../src/lib/pipeline/analysis/detectionBoxes";
import {
  OBJECT_DETECTOR_MODEL_URL,
  TASKS_VISION_VERSION,
  TASKS_VISION_WASM_BASE,
} from "../src/lib/pipeline/analysis/mediapipeAssets";
import type { DetectedObject } from "../src/lib/pipeline/segmentation/segment";

function det(xMin: number, yMin: number, xMax: number, yMax: number, confidence = 0.9, label = "laptop"): DetectResult {
  return { bbox: { xMin, yMin, xMax, yMax }, confidence, label };
}

function cand(x: number, y: number, w: number, h: number, score = 0.5): DetectedObject {
  return { box: { x, y, w, h }, area: w * h, score };
}

describe("object detection geometry", () => {
  test("boxIoU: identical boxes are 1, disjoint boxes are 0", () => {
    const a = { x: 10, y: 10, w: 20, h: 20 };
    expect(boxIoU(a, { ...a })).toBeCloseTo(1, 10);
    expect(boxIoU(a, { x: 100, y: 100, w: 20, h: 20 })).toBe(0);
  });

  test("boxIoU: half-overlap is 1/3 (sanity on the algebra)", () => {
    // Two 10x10 boxes offset by 5 in x: inter = 50, union = 150.
    const iou = boxIoU({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 });
    expect(iou).toBeCloseTo(50 / 150, 10);
  });

  test("boxIoU: empty boxes never divide by zero", () => {
    expect(boxIoU({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
    expect(boxIoU({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 5, h: 5 })).toBe(0);
  });

  test("detectionToBox: converts and rejects degenerate boxes", () => {
    expect(detectionToBox(det(10, 20, 30, 60))).toEqual({ x: 10, y: 20, w: 20, h: 40 });
    expect(detectionToBox(det(10, 20, 10, 60))).toBeNull();
    expect(detectionToBox(det(10, 20, 30, 20))).toBeNull();
    expect(detectionToBox(null)).toBeNull();
  });

  test("primaryDetection: highest confidence wins, degenerate/off-frame dropped", () => {
    const chosen = primaryDetection([
      det(0, 0, 50, 50, 0.4, "cup"),
      det(10, 10, 60, 60, 0.92, "laptop"),
      det(0, 0, 0, 0, 0.99, "degenerate"),
      det(-5, 0, 40, 40, 0.95, "off-frame"),
    ]);
    expect(chosen?.label).toBe("laptop");
    expect(primaryDetection([])).toBeNull();
  });

  test("pickDetectionAlignedCandidate: the detector overrules the size prior", () => {
    // The segmenter's own top pick is the big off-centre prop...
    const candidates = [cand(0, 0, 200, 200, 0.9), cand(300, 300, 60, 60, 0.3)];
    // ...but the detector saw the small object at 300,300.
    expect(pickDetectionAlignedCandidate(candidates, det(300, 300, 360, 360))).toBe(1);
  });

  test("pickDetectionAlignedCandidate: -1 when there is nothing to align to", () => {
    expect(pickDetectionAlignedCandidate([], det(0, 0, 10, 10))).toBe(-1);
    expect(pickDetectionAlignedCandidate([cand(0, 0, 10, 10)], null)).toBe(-1);
    // No real overlap -> no opinion.
    expect(pickDetectionAlignedCandidate([cand(0, 0, 10, 10)], det(500, 500, 600, 600))).toBe(-1);
  });

  test("pickDetectionAlignedCandidate: a grazing hit below the threshold is ignored", () => {
    // 10x10 candidate vs a 10x10 detection offset by 9: IoU = 1/19 < 0.25.
    expect(pickDetectionAlignedCandidate([cand(0, 0, 10, 10)], det(9, 0, 19, 10))).toBe(-1);
  });
});

describe("object detection assets", () => {
  // The Wasm runtime and the JS bundle must be the SAME version or MediaPipe
  // aborts at runtime with an opaque error. Pinning the version here means a
  // dependency bump fails the build instead of silently breaking the detector.
  test("pinned Wasm version matches the installed @mediapipe/tasks-vision", async () => {
    const pkg = await import("@mediapipe/tasks-vision/package.json");
    expect(TASKS_VISION_VERSION).toBe(pkg.default.version);
    expect(TASKS_VISION_WASM_BASE).toContain(`@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`);
  });

  test("model URL points at the float16 EfficientDet-Lite0 detector over https", () => {
    expect(OBJECT_DETECTOR_MODEL_URL.startsWith("https://")).toBe(true);
    expect(OBJECT_DETECTOR_MODEL_URL).toContain("efficientdet_lite0");
    expect(OBJECT_DETECTOR_MODEL_URL).toContain("float16");
    expect(OBJECT_DETECTOR_MODEL_URL.endsWith(".tflite")).toBe(true);
  });

  test("no local /mediapipe-* asset paths remain (the old, never-shipped config)", async () => {
    const src = await Bun.file(
      new URL("../src/lib/pipeline/analysis/objectDetection.ts", import.meta.url).pathname,
    ).text();
    expect(src).not.toContain('"/mediapipe-tasks-vision');
    expect(src).not.toContain('"/mediapipe-models');
    expect(src).not.toContain("loadVisionWasmFileset");
  });
});
