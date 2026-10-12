// ============================================================================
// Iterative Render Loop - Mode 1 (find flaws) & Mode 2 (fix)
// ============================================================================
// This module implements an adaptive rendering loop that:
//   Mode 1: Renders multiple passes and identifies flaws/strengths
//   Mode 2: Applies fixes based on detected flaws and re-renders
//
// The loop continues until results converge or complexity increases.

import type { Cutout } from './segmentation';
import type { RenderResult, RenderedImage, ImageComplexity, PipelineParams, DetectedFlaw } from './renderTypes';

// Pipeline parameters are now in renderTypes.ts

// Default starting parameters
function defaultParams(): PipelineParams {
  return {
    tolerance: 26,
    morphRadius: 2,
    shaveMultiplier: 0.7,
    shadowOpacity: 0.42,
    shadowLength: 0.7,
    shadowDirection: 55,
    placementScale: 1,
    backdropContrast: 0.5,
  };
}

// Generate a more complex test image
function generateComplexImage(
  width: number,
  height: number,
  complexity: number,
  rng: () => number
): ImageData {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  
  // Base background with increasing complexity
  const baseHue = rng() * 360;
  const bgBase = `hsl(${baseHue}, ${20 + complexity * 15}%, ${60 - complexity * 10}%)`;
  ctx.fillStyle = bgBase;
  ctx.fillRect(0, 0, width, height);
  
  // Add noise/grain (increases with complexity)
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const noiseAmount = 10 + complexity * 40;
  
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rng() - 0.5) * noiseAmount;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);
  
  // Add cluttered objects
  const numObjects = Math.floor(5 + complexity * 20);
  for (let i = 0; i < numObjects; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const size = 5 + rng() * 30 * (1 + complexity);
    const hue = baseHue + (rng() - 0.5) * 60;
    const sat = 30 + rng() * 70;
    const light = 40 + rng() * 40;
    
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    
    if (rng() > 0.7) {
      // Rectangle
      ctx.fillRect(x, y, size, size * (0.5 + rng() * 0.5));
    } else if (rng() > 0.5) {
      // Circle
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Line
      ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
      ctx.lineWidth = 2 + rng() * 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 100, y + (rng() - 0.5) * 100);
      ctx.stroke();
    }
  }
  
  // Add gradient overlay (simulating uneven lighting)
  const grad = ctx.createRadialGradient(
    width * (0.3 + rng() * 0.4),
    height * (0.3 + rng() * 0.4),
    0,
    width * (0.3 + rng() * 0.4),
    height * (0.3 + rng() * 0.4),
    width * 0.8
  );
  grad.addColorStop(0, `rgba(255,255,255,${0.1 + complexity * 0.15})`);
  grad.addColorStop(1, `rgba(0,0,0,${0.1 + complexity * 0.15})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  
  return ctx.getImageData(0, 0, width, height);
}

// Place a product cutout in the scene (simplified)
function placeCutoutInScene(
  scene: ImageData,
  cutout: Uint8ClampedArray,
  cutoutW: number,
  cutoutH: number,
  x: number,
  y: number
): ImageData {
  const result = new ImageData(scene.width, scene.height);
  
  for (let cy = 0; cy < scene.height; cy++) {
    for (let cx = 0; cx < scene.width; cx++) {
      const si = (cy * scene.width + cx) * 4;
      const di = si;
      
      // Copy scene background
      result.data[di] = scene.data[si];
      result.data[di + 1] = scene.data[si + 1];
      result.data[di + 2] = scene.data[si + 2];
      result.data[di + 3] = 255;
      
      // Overlay cutout if in range
      const cutoutX = cx - x;
      const cutoutY = cy - y;
      
      if (cutoutX >= 0 && cutoutX < cutoutW && cutoutY >= 0 && cutoutY < cutoutH) {
        const ci = (cutoutY * cutoutW + cutoutX) * 4;
        const alpha = cutout[ci + 3] / 255;
        
        if (alpha > 0) {
          result.data[di] = cutout[ci] * alpha + scene.data[si] * (1 - alpha);
          result.data[di + 1] = cutout[ci + 1] * alpha + scene.data[si + 1] * (1 - alpha);
          result.data[di + 2] = cutout[ci + 2] * alpha + scene.data[si + 2] * (1 - alpha);
        }
      }
    }
  }
  
  return result;
}

// Render an image through the pipeline and detect flaws
function renderAndAnalyze(
  sceneData: ImageData,
  params: PipelineParams,
  cutout: Uint8ClampedArray,
  cutoutW: number,
  cutoutH: number
): RenderResult {
  // Create canvas for rendering
  const canvas = new OffscreenCanvas(sceneData.width, sceneData.height);
  const ctx = canvas.getContext('2d')!;
  
  // Draw the scene with cutout
  const rendered = placeCutoutInScene(
    sceneData,
    cutout,
    cutoutW,
    cutoutH,
    Math.round(sceneData.width / 2 - cutoutW / 2),
    Math.round(sceneData.height * 0.65 - cutoutH / 2)
  );
  
  ctx.putImageData(rendered, 0, 0);
  
  // Analyze the result
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = canvas.width;
  const h = canvas.height;      const flaws: DetectedFlaw[] = [];
  let qualityScore = 1;
  
  // Check for background bleed (transparency artifacts around product)
  let bgBleedPixels = 0;
  let totalProductPixels = 0;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const alpha = data[i + 3];
      
      if (alpha > 0 && alpha < 255) {
        // Semi-transparent pixel - potential bleed
        bgBleedPixels++;
      }
      
      if (alpha > 128) {
        totalProductPixels++;
      }
    }
  }
  
  const bleedRatio = totalProductPixels > 0 ? bgBleedPixels / totalProductPixels : 0;
  if (bleedRatio > 0.05) {
    flaws.push({
      type: 'background_bleed',
      severity: Math.min(1, bleedRatio * 5),
      description: `Background bleed: ${(bleedRatio * 100).toFixed(1)}% of product pixels are semi-transparent`,
      regions: [{ x: 0, y: 0, w: w, h: h }],
    });
    qualityScore -= bleedRatio * 3;
  }
  
  // Check for shadow quality
  let shadowPixels = 0;
  const shadowRegionStartY = Math.round(h * 0.7);
  const shadowRegionHeight = Math.round(h * 0.2);
  
  for (let y = shadowRegionStartY; y < shadowRegionStartY + shadowRegionHeight && y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Shadow should be dark and warm-colored
      if (a > 10 && r < 80 && g < 65 && b < 55) {
        shadowPixels++;
      }
    }
  }
  
  const shadowCoverage = (shadowRegionHeight * w) > 0 ? shadowPixels / (shadowRegionHeight * w) : 0;
  
  if (shadowCoverage < 0.01) {
    flaws.push({
      type: 'shadow_missing',
      severity: 0.8,
      description: 'Shadow is completely missing',
      regions: [{ x: 0, y: shadowRegionStartY, w: w, h: shadowRegionHeight }],
    });
    qualityScore -= 0.8;
  } else if (shadowCoverage < 0.03) {
    flaws.push({
      type: 'shadow_missing',
      severity: 0.5,
      description: `Shadow is very faint (${shadowCoverage.toFixed(3)} coverage)`,
      regions: [{ x: 0, y: shadowRegionStartY, w: w, h: shadowRegionHeight }],
    });
    qualityScore -= 0.5;
  }
  
  // Check for plate/table connection (background included in product)
  // Look for background-colored pixels within the product silhouette
  const productCenterX = Math.round(w / 2);
  const productCenterY = Math.round(h * 0.65);
  
  let bgInProduct = 0;
  let productPixels = 0;
  
  for (let y = Math.max(0, productCenterY - cutoutH); y < Math.min(h, productCenterY + cutoutH) && y < h; y++) {
    for (let x = Math.max(0, productCenterX - cutoutW); x < Math.min(w, productCenterX + cutoutW) && x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      
      if (a > 128) {
        productPixels++;
        // Check if this pixel color matches the background (simple heuristic)
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Sample background from corners
        const cornerSamples = [
          data[0], data[1], data[2],
          data[(h - 1) * w * 4], data[(h - 1) * w * 4 + 1], data[(h - 1) * w * 4 + 2],
        ];
        
        // If pixel is close to background color, it's likely background bleed
        for (let c = 0; c < cornerSamples.length; c += 3) {
          const bgR = cornerSamples[c];
          const bgG = cornerSamples[c + 1];
          const bgB = cornerSamples[c + 2];
          
          const dist = Math.sqrt(
            (r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2
          );
          
          if (dist < 30) {
            bgInProduct++;
            break;
          }
        }
      }
    }
  }
  
  const bgInclusionRatio = productPixels > 0 ? bgInProduct / productPixels : 0;
  if (bgInclusionRatio > 0.1) {
    flaws.push({
      type: 'plate_connected',
      severity: Math.min(1, bgInclusionRatio * 3),
      description: `Background included in cutout: ${(bgInclusionRatio * 100).toFixed(1)}%`,
      regions: [{ x: Math.max(0, productCenterX - cutoutW), y: Math.max(0, productCenterY - cutoutH), w: cutoutW * 2, h: cutoutH * 2 }],
    });
    qualityScore -= bgInclusionRatio * 2;
  }
  
  // Check for missing details (product cut off)
  let edgeCutoffPixels = 0;
  
  // Check product edges against canvas edges
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < 5; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128) edgeCutoffPixels++;
    }
    for (let y = h - 5; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128) edgeCutoffPixels++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 5; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128) edgeCutoffPixels++;
    }
    for (let x = w - 5; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128) edgeCutoffPixels++;
    }
  }
  
  if (edgeCutoffPixels > 50) {
    flaws.push({
      type: 'missing_details',
      severity: Math.min(1, edgeCutoffPixels / 200),
      description: `Product cut off at edge: ${edgeCutoffPixels} pixels`,
      regions: [
        { x: 0, y: 0, w: w, h: 5 },
        { x: 0, y: h - 5, w: w, h: 5 },
        { x: 0, y: 0, w: 5, h: h },
        { x: w - 5, y: 0, w: 5, h: h },
      ],
    });
    qualityScore -= Math.min(0.5, edgeCutoffPixels / 500);
  }
  
  // Clamp quality score
  qualityScore = Math.max(0.1, Math.min(1, qualityScore));
  
  // Convert canvas to blob URL for display
  let url = '';
  let revoke = () => {};
  
  try {
    const canvasEle = canvas as unknown as HTMLCanvasElement;
    if (typeof (canvas as any).toDataURL === 'function') {
      url = (canvas as any).toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  
  return {
    url,
    revoke,
    flaws,
    qualityScore,
    complexity: {
      level: 0,
      description: `Quality: ${(qualityScore * 100).toFixed(0)}%, ${flaws.length} flaws detected`,
    },
  };
}

// Generate fixes based on detected flaws
function generateFixes(
  flaws: DetectedFlaw[],
  currentParams: PipelineParams
): PipelineParams {
  const newParams = { ...currentParams };
  
  for (const flaw of flaws) {
    switch (flaw.type) {
      case 'background_bleed':
        // Reduce tolerance to tighten the cutout
        newParams.tolerance = Math.max(4, newParams.tolerance - 4 * flaw.severity);
        break;
        
      case 'plate_connected':
        // Increase morph radius to break thin connections
        newParams.morphRadius = Math.min(8, newParams.morphRadius + 1 * flaw.severity);
        // More aggressive shave
        newParams.shaveMultiplier = Math.max(0.3, newParams.shaveMultiplier - 0.1 * flaw.severity);
        break;
        
      case 'shadow_missing':
        // Increase shadow opacity
        newParams.shadowOpacity = Math.min(1, newParams.shadowOpacity + 0.1 * flaw.severity);
        // Increase shadow length
        newParams.shadowLength = Math.min(1.5, newParams.shadowLength + 0.05 * flaw.severity);
        break;
        
      case 'missing_details':
        // Adjust placement
        newParams.placementScale = Math.max(0.5, newParams.placementScale - 0.05);
        break;
    }
  }
  
  return newParams;
}

// Main iterative render function
export async function iterativeRender(
  cutoutData: Uint8ClampedArray,
  cutoutW: number,
  cutoutH: number,
  mode: 1 | 2,
  maxIterations: number = 5,
  complexityLevel: number = 0
): Promise<RenderedImage> {
  // Create a test scene with appropriate complexity
  const sceneWidth = 800;
  const sceneHeight = 600;
  
  // Generate deterministic RNG for reproducibility
  let rngSeed = 12345 + complexityLevel * 1000;
  const rng = () => {
    rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff;
    return rngSeed / 0x7fffffff;
  };
  
  const sceneData = generateComplexImage(sceneWidth, sceneHeight, complexityLevel, rng);
  
  // Start with default params
  let params: PipelineParams = defaultParams();
  let bestResult: RenderResult | null = null;
  let bestQuality = 0;
  
  // Mode 1: Find flaws - render and analyze multiple times
  if (mode === 1) {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const result = renderAndAnalyze(sceneData, params, cutoutData, cutoutW, cutoutH);
      
      if (result.qualityScore > bestQuality) {
        bestQuality = result.qualityScore;
        bestResult = result;
      }
      
      // In mode 1, we just report the flaws without fixing
      // But we vary params slightly to explore the space
      params = {
        ...params,
        tolerance: params.tolerance + (iteration % 3 - 1) * 2,
        shadowOpacity: params.shadowOpacity + (iteration % 2) * 0.05,
      };
    }
  }
  // Mode 2: Fix flaws - adaptively adjust params
  else {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const result = renderAndAnalyze(sceneData, params, cutoutData, cutoutW, cutoutH);
      
      // Track best result
      if (result.qualityScore > bestQuality) {
        bestQuality = result.qualityScore;
        bestResult = result;
      }
      
      // Generate fixes based on flaws
      const newParams = generateFixes(result.flaws, params);
      
      // Only update if we have improvements or haven't converged
      const paramDiff = Math.abs(
        newParams.tolerance - params.tolerance +
        newParams.morphRadius - params.morphRadius +
        newParams.shadowOpacity - params.shadowOpacity
      );
      
      if (paramDiff > 0.5 || iteration === 0) {
        params = newParams;
      }
      
      // If quality is good enough, stop early
      if (result.qualityScore > 0.95) {
        break;
      }
    }
  }
  
  if (!bestResult) {
    // Fallback render
    bestResult = renderAndAnalyze(sceneData, defaultParams(), cutoutData, cutoutW, cutoutH);
  }
  
  // If mode 1 found significant flaws, escalate complexity
  if (mode === 1 && bestResult.flaws.length > 0) {
    const totalSeverity = bestResult.flaws.reduce((sum: number, f: DetectedFlaw) => sum + f.severity, 0);
    if (totalSeverity > 1.5 && complexityLevel < 5) {
      // Recursively try with higher complexity
      const harderResult = await iterativeRender(
        cutoutData,
        cutoutW,
        cutoutH,
        1,
        maxIterations,
        complexityLevel + 1
      );
      
      // Return the harder result if it's better
      if (harderResult.result.qualityScore > bestResult.qualityScore) {
        return harderResult;
      }
    }
  }
  
  return {
    result: bestResult!,
    params,
    iteration: maxIterations,
    mode,
    complexityLevel,
  };
}

// Quick preview render (single pass)
export async function quickRender(
  cutoutData: Uint8ClampedArray,
  cutoutW: number,
  cutoutH: number
): Promise<RenderedImage> {
  return iterativeRender(cutoutData, cutoutW, cutoutH, 1, 1, 0);
}
