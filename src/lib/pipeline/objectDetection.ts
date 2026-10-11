import { ObjectDetector } from "@mediapipe/tasks-vision";

type WasmFilesetConfig = {
  wasmPath: string;
  wasmBinaryPath: string;
};

export async function loadObjectDetector(): Promise<ObjectDetector> {
  type W = {
    loadVisionWasmFileset: (cfg: WasmFilesetConfig) => Promise<unknown>;
  };
  const shim = (window as unknown as W).loadVisionWasmFileset;
  if (!shim) throw new Error("MediaPipe vision wasm loader not available");
  const fileset = await shim({
    wasmPath: "/mediapipe-tasks-vision/wasm",
    wasmBinaryPath: "/mediapipe-tasks-vision/wasm",
  });
  return ObjectDetector.createFromModelPath(
    fileset as Parameters<typeof ObjectDetector.createFromModelPath>[0],
    "/mediapipe-models/object-detector/float16 {}.rescore_v16_ng_g1/saved_model_2",
  );
}

export interface DetectResult {
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
  confidence: number;
  label: string;
  /** @deprecated kept only for backward compat; MediaPipe Category has no categoryIndex */
  categoryIndex: number;
}

export async function detectObject(
  detector: ObjectDetector,
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData,
): Promise<DetectResult[]> {
  const results = await detector.detect(image);
  if (!results.detections || !results.detections.length) return [];

  return results.detections.map((d) => {
    const categories = d.categories && d.categories.length ? d.categories : undefined;
    const bestCategory = categories && categories[0] ? categories[0] : undefined;
    const bbox = d.boundingBox;
    return {
      bbox: bbox
        ? { xMin: bbox.originX, yMin: bbox.originY, xMax: bbox.originX + bbox.width, yMax: bbox.originY + bbox.height }
        : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      confidence: categories ? Math.max(...categories.map((c) => c.score ?? 0)) : 0,
      label: bestCategory ? (bestCategory.categoryName ?? "") : "",
      categoryIndex: -1,
    };
  }).filter((r) => r.confidence > 0.35);
}
