// ============================================================================
// Object Detection - Stage 1: Identify the main product in the image
// ============================================================================
// Uses MediaPipe EfficientDet-Lite0 for ML-based detection, with a custom
// color/contrast-based fallback for when the model is unavailable.
// ============================================================================

import {
  FilesetResolver,
  ObjectDetector,
  type ObjectDetectorOptions,
} from '@mediapipe/tasks-vision';

// MediaPipe model URLs (loaded from CDN)
const TASKS_VISION_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm';
const OBJECT_DETECTOR_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/localhost_android_latest/float16/efficientdet_lite0.task';

export interface DetectResult {
  bbox: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  confidence: number;
  label: string;
}

// Geometry helpers (pure, testable)
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

export function detectionToBox(d: DetectResult): Box | null {
  if (!d || d.bbox.xMax <= d.bbox.xMin || d.bbox.yMax <= d.bbox.yMin) {
    return null;
  }
  return {
    x: d.bbox.xMin,
    y: d.bbox.yMin,
    w: d.bbox.xMax - d.bbox.xMin,
    h: d.bbox.yMax - d.bbox.yMin,
  };
}

export function primaryDetection(detections: readonly DetectResult[]): DetectResult | null {
  if (!detections.length) return null;
  return detections.reduce((best, curr) =>
    curr.confidence > (best?.confidence ?? 0) ? curr : best
  , null as DetectResult | null);
}

export function pickDetectionAlignedCandidate(
  detections: DetectResult[],
  target: Box | null,
  threshold = 0.1
): DetectResult | null {
  if (!target || !detections.length) return null;
  const aligned = detections
    .map(d => ({ d, iou: boxIoU(detectionToBox(d) ?? { x: 0, y: 0, w: 0, h: 0 }, target) }))
    .filter(x => x.iou >= threshold)
    .sort((a, b) => b.d.confidence - a.d.confidence);
  return aligned[0]?.d ?? null;
}

// MediaPipe detector (lazy-loaded, promise-memoized)
let detectorPromise: Promise<ObjectDetector> | null = null;

async function createDetector(): Promise<ObjectDetector> {
  const fileset = await FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE);
  
  const sharedOptions = {
    runningMode: 'IMAGE' as const,
    scoreThreshold: 0.3,
    maxResults: 5,
  };
  
  // Try GPU first, fall back to CPU
  try {
    return await ObjectDetector.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: OBJECT_DETECTOR_MODEL_URL,
        delegate: 'GPU',
      },
      ...sharedOptions,
    } as ObjectDetectorOptions);
  } catch (gpuErr) {
    console.warn('[objectDetection] GPU unavailable, using CPU:', gpuErr);
    return await ObjectDetector.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: OBJECT_DETECTOR_MODEL_URL,
        delegate: 'CPU',
      },
      ...sharedOptions,
    } as ObjectDetectorOptions);
  }
}

export async function loadObjectDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    const attempt = createDetector();
    detectorPromise = attempt;
    attempt.catch(() => {
      if (detectorPromise === attempt) detectorPromise = null;
    });
  }
  return detectorPromise;
}

export type DetectInput = 
  | HTMLImageElement 
  | HTMLCanvasElement 
  | HTMLVideoElement 
  | ImageBitmap 
  | ImageData;

export async function detectObject(
  detector: ObjectDetector,
  image: DetectInput
): Promise<DetectResult[]> {
  try {
    const results = await detector.detect(image);
    const detections = results?.detections ?? [];
    return detections.map(d => {
      const cats = d.categories ?? [];
      const bestCat = cats.reduce((best, c) =>
        (c.score ?? 0) > (best.score ?? 0) ? c : best
      , cats[0] ?? { categoryName: '', score: 0 });
      return {
        bbox: {
          xMin: d.boundingBox?.originX ?? 0,
          yMin: d.boundingBox?.originY ?? 0,
          xMax: (d.boundingBox?.originX ?? 0) + (d.boundingBox?.width ?? 0),
          yMax: (d.boundingBox?.originY ?? 0) + (d.boundingBox?.height ?? 0),
        },
        confidence: bestCat.score ?? 0,
        label: bestCat.categoryName ?? '',
      };
    });
  } catch (err) {
    console.warn('[objectDetection] detect failed:', err);
    return [];
  }
}

export async function detectObjects(image: DetectInput): Promise<DetectResult[]> {
  try {
    const detector = await loadObjectDetector();
    return detectObject(detector, image);
  } catch (err) {
    console.warn('[objectDetection] detector unavailable:', err);
    return [];
  }
}

// ============================================================================
// Custom fallback: color/contrast-based subject detection
// ============================================================================
// When ML detection fails, use a simple heuristic:
// 1. Find regions with highest contrast from surroundings
// 2. Look for coherent connected components
// 3. Prefer central, reasonably-sized objects

export interface ColorDetectionResult {
  bbox: Box;
  confidence: number;
  label: string;
}

export function detectByColorContrast(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): ColorDetectionResult {
  // Compute local contrast (standard deviation in small windows)
  const blockSize = Math.max(16, Math.min(width, height) / 8);
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  
  const blocks: Array<{ x: number; y: number; contrast: number; meanR: number; meanG: number; meanB: number }> = [];
  
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, width);
      const endY = Math.min(startY + blockSize, height);
      
      let sumR = 0, sumG = 0, sumB = 0;
      let sumR2 = 0, sumG2 = 0, sumB2 = 0;
      let count = 0;
      
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = (y * width + x) * 4;
          const r = rgba[i];
          const g = rgba[i + 1];
          const b = rgba[i + 2];
          sumR += r; sumG += g; sumB += b;
          sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          count++;
        }
      }
      
      if (count > 0) {
        const meanR = sumR / count;
        const meanG = sumG / count;
        const meanB = sumB / count;
        const varR = sumR2 / count - meanR * meanR;
        const varG = sumG2 / count - meanG * meanG;
        const varB = sumB2 / count - meanB * meanB;
        // Contrast = total variance across channels
        const contrast = Math.sqrt(varR + varG + varB);
        blocks.push({ x: startX, y: startY, contrast, meanR, meanG, meanB });
      }
    }
  }
  
  // Find the most contrasting block
  const bestBlock = blocks.reduce((best, b) =>
    b.contrast > (best?.contrast ?? 0) ? b : best
  , null as typeof blocks[0] | null);
  
  if (!bestBlock) {
    return { bbox: { x: 0, y: 0, w: width, h: height }, confidence: 0, label: 'unknown' };
  }
  
  // Expand to include neighboring high-contrast blocks
  const threshold = bestBlock.contrast * 0.5;
  let minX = bestBlock.x;
  let minY = bestBlock.y;
  let maxX = bestBlock.x + blockSize;
  let maxY = bestBlock.y + blockSize;
  
  for (const block of blocks) {
    if (block.contrast >= threshold) {
      minX = Math.min(minX, block.x);
      minY = Math.min(minY, block.y);
      maxX = Math.max(maxX, block.x + blockSize);
      maxY = Math.max(maxY, block.y + blockSize);
    }
  }
  
  const w = Math.min(maxX - minX, width - minX);
  const h = Math.min(maxY - minY, height - minY);
  
  return {
    bbox: { x: minX, y: minY, w, h },
    confidence: Math.min(1, bestBlock.contrast / 50),
    label: 'product',
  };
}
