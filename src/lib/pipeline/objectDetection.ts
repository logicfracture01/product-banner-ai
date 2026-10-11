import { ObjectDetector } from "@mediapipe/tasks-vision";
import { WasmFileset } from "@mediapipe/tasks-vision";

declare global {
  interface Window {
    loadVisionWasmFileset: (opts: string) => Promise<WasmFileset>;
  }
}

export async function loadObjectDetector(): Promise<ObjectDetector> {
  const wasmFileset = await window.loadVisionWasmFileset({
    wasmPath: "/mediapipe-tasks-vision/wasm",
    wasmBinaryPath: "/mediapipe-tasks-vision/wasm",
  });
  return ObjectDetector.createFromModelPath(
    wasmFileset,
    "/mediapipe-models/object-detector/float16 {}.rescore_v16_ng_g1/saved_model_2",
  );
}

export interface DetectResult {
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
  confidence: number;
  label: string;
  categoryIndex: number;
}

export async function detectObject(
  detector: ObjectDetector,
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData
): Promise<DetectResult[]> {
  const results = await detector.detect(image);
  if (!results.detections) return [];

  return results.detections.map((d) => ({
    bbox: {
      xMin: d.boundingBox.origin.x,
      yMin: d.boundingBox.origin.y,
      xMax: d.boundingBox.origin.x + d.boundingBox.size.width,
      yMax: d.boundingBox.origin.y + d.boundingBox.size.height,
    },
    confidence: d.categories
      ? Math.max(...d.categories.map((c) => c.score ?? 0))
      : 0,
    label: d.categories
      ? d.categories[0].categoryName ?? ""
      : "",
    categoryIndex: d.categories
      ? d.categories[0].categoryIndex
      : -1,
  })).filter((r) => r.confidence > 0.35);
}
