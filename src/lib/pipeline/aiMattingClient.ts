// ============================================================================
// AI Matting Client - Main thread interface to the worker-based matting
// ============================================================================

import type { MattingResult } from './aiMatting';

let worker: Worker | null = null;
let loadPromise: Promise<boolean> | null = null;
const listeners = new Set<(pct: number | null) => void>();

type Listener = (pct: number | null) => void;

export function setMattingProgressListener(fn: Listener | null) {
  if (fn === null) {
    listeners.clear();
  } else {
    listeners.add(fn);
  }
}

function notifyProgress(pct: number | null) {
  for (const l of listeners) l(pct);
}

async function ensureWorker(): Promise<Worker> {
  if (worker) return worker;
  
  // Create worker from inline blob to avoid separate file
  const workerCode = `
    // Import ONNX Runtime and Transformers.js in worker
    import * as ort from 'onnxruntime-web';
    import { pipeline } from '@huggingface/transformers';
    
    let mattingPipeline: any = null;
    let ready = false;
    
    self.onmessage = async (e) => {
      if (e.data.type === 'load') {
        try {
          self.postMessage({ type: 'progress', progress: 10 });
          
          // Load the matting pipeline
          mattingPipeline = await pipeline('image-segmentation', 'Xenova/birefnet-lite');
          
          self.postMessage({ type: 'progress', progress: 60 });
          
          // Warm up with a small test
          const testCanvas = new OffscreenCanvas(10, 10);
          const testCtx = testCanvas.getContext('2d');
          testCtx.fillStyle = '#fff';
          testCtx.fillRect(0, 0, 10, 10);
          
          self.postMessage({ type: 'progress', progress: 80 });
          
          ready = true;
          self.postMessage({ type: 'ready' });
        } catch (err) {
          self.postMessage({ type: 'error', error: String(err) });
        }
      } else if (e.data.type === 'matte' && ready) {
        try {
          const { imageData } = e.data;
          
          // Create canvas from image data
          const canvas = new OffscreenCanvas(imageData.width, imageData.height);
          const ctx = canvas.getContext('2d');
          ctx.putImageData(imageData, 0, 0);
          
          // Run matting
          const results = await mattingPipeline(canvas, {
            threshold: 0.5,
          });
          
          // Extract alpha mask from result
          const result = results[0];
          const mask = result.mask;
          
          const alpha = new Uint8ClampedArray(imageData.width * imageData.height * 4);
          const maskData = mask.data;
          
          for (let i = 0; i < imageData.width * imageData.height; i++) {
            const a = maskData[i * 4 + 3] || 0;
            alpha[i * 4 + 3] = a;
          }
          
          // Compute confidence (simple heuristic based on mask coverage)
          let fgPixels = 0;
          for (let i = 0; i < maskData.length; i += 4) {
            if (maskData[i + 3] > 128) fgPixels++;
          }
          const confidence = Math.min(1, fgPixels / (imageData.width * imageData.height) * 3);
          
          self.postMessage({
            type: 'result',
            matte: {
              alpha,
              width: imageData.width,
              height: imageData.height,
              confidence,
            }
          });
        } catch (err) {
          self.postMessage({ type: 'error', error: String(err) });
        }
      }
    };
  `;
  
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  worker = new Worker(URL.createObjectURL(blob));
  
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      notifyProgress(msg.progress);
    } else if (msg.type === 'ready') {
      notifyProgress(100);
    } else if (msg.type === 'error') {
      notifyProgress(null);
      throw new Error(msg.error);
    }
  };
  
  worker.onerror = (err) => {
    notifyProgress(null);
    throw err;
  };
  
  // Start loading
  worker.postMessage({ type: 'load' });
  
  return worker;
}

export async function preloadMatting(): Promise<boolean> {
  if (loadPromise) return loadPromise;
  
  loadPromise = (async () => {
    try {
      const w = await ensureWorker();
      // Wait for ready message
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Matting load timeout')), 120000);
        const onReady = (e: MessageEvent) => {
          if (e.data.type === 'ready') {
            clearTimeout(timeout);
            w.removeEventListener('message', onReady);
            resolve();
          } else if (e.data.type === 'error') {
            clearTimeout(timeout);
            w.removeEventListener('message', onReady);
            reject(new Error(e.data.error));
          }
        };
        w.addEventListener('message', onReady);
      });
      return true;
    } catch (err) {
      console.error('[aiMattingClient] preload failed:', err);
      return false;
    }
  })();
  
  return loadPromise;
}

export async function aiMatteAsync(imageBitmap: ImageBitmap): Promise<MattingResult | null> {
  try {
    const w = await ensureWorker();
    
    // Convert bitmap to ImageData
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Send to worker
    const result = await new Promise<{ type: string; matte?: any; error?: string }>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'result' || e.data.type === 'error') {
          w!.removeEventListener('message', handler);
          resolve(e.data);
        }
      };
      w.addEventListener('message', handler);
      w.postMessage({ type: 'matte', imageData }, [imageData.data.buffer]);
    });
    
    if (result.type === 'error') {
      console.error('[aiMatteAsync] worker error:', result.error);
      return null;
    }
    
    return result.matte as MattingResult;
  } catch (err) {
    console.error('[aiMatteAsync] failed:', err);
    return null;
  }
}
