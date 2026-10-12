// ============================================================================
// Banner Composer - Final image composition
// ============================================================================
// Layer order (back to front):
//   1. Backdrop (gradient or generative design)
//   2. Shadow (contact + cast)
//   3. Product cutout
// ============================================================================

import type { Cutout } from './segmentation';
import { renderShadowIntensity, toneMapShadow, paintShadow, type ShadowOptions } from './shadow';
import { paintDesign, type GeneratedDesign } from './design';
import type { PipelineParams, DetectedFlaw } from './renderTypes';

// Pipeline params are now defined in renderTypes.ts
// These functions are kept for backward compatibility
export type { PipelineParams, DetectedFlaw } from './renderTypes';

export function renderWithParams(
  ctx: CanvasRenderingContext2D,
  cutout: Cutout,
  params: PipelineParams,
  W: number,
  H: number,
  backdropId: BackdropId = 'studio'
): { flaws: DetectedFlaw[]; qualityScore: number } {
  const { autoPlacement, drawBanner } = require('./banner');
  
  const shadowOpts: ShadowOptions = {
    direction: params.shadowDirection,
    length: params.shadowLength,
    softness: 0.6,
    opacity: params.shadowOpacity,
    contact: true,
  };
  
  const place = {
    x: W / 2,
    y: H * 0.75,
    scale: Math.max(0.25, Math.min(2.5, params.placementScale)),
  };
  
  drawBanner(ctx, cutout, place, {
    backdrop: backdropId,
    ratio: '4:5',
    shadow: shadowOpts,
  });
  
  // Analyze the result for flaws
  const result = analyzeRenderQuality(ctx, cutout, place, shadowOpts, W, H);
  
  return {
    flaws: result.flaws,
    qualityScore: result.qualityScore,
  };
}

// Analyze the rendered image for common flaws
export function analyzeRenderQuality(
  ctx: CanvasRenderingContext2D,
  cutout: Cutout,
  place: { x: number; y: number; scale: number },
  shadowOpts: ShadowOptions,
  W: number,
  H: number,
  complexityLevel: number = 0
): { flaws: DetectedFlaw[]; qualityScore: number; complexityNotes: string[] } {
  const flaws: DetectedFlaw[] = [];
  const complexityNotes: string[] = [];
  
  // Get pixel data from canvas
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  const n = W * H;
  
  // ============ FLAW DETECTION ============
  
  // Check for background bleed (semi-transparent pixels around product edge)
  let bgBleedPixels = 0;
  let totalFgPixels = 0;
  let edgePixels = 0;
  let contaminatedEdgePixels = 0;
  
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const p = i * 4;
      const a = data[p + 3];
      
      if (a > 128) {
        totalFgPixels++;
        
        // Check if this pixel is on the edge (has transparent neighbor)
        const hasTransparentNeighbor =
          data[((y - 1) * W + x) * 4 + 3] < 128 ||
          data[((y + 1) * W + x) * 4 + 3] < 128 ||
          data[(y * W + (x - 1)) * 4 + 3] < 128 ||
          data[(y * W + (x + 1)) * 4 + 3] < 128;
        
        if (hasTransparentNeighbor) {
          edgePixels++;
          
          // Check if edge pixel is contaminated (low alpha or wrong color)
          if (a < 200 || a > 240) {
            contaminatedEdgePixels++;
          }
          
          // Check for halo effect (edge pixel lighter than interior)
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          
          // Sample interior pixels
          let interiorR = 0, interiorG = 0, interiorB = 0, interiorCount = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const ni = ((y + dy) * W + (x + dx)) * 4;
              const na = data[ni + 3];
              if (na > 200) {
                interiorR += data[ni];
                interiorG += data[ni + 1];
                interiorB += data[ni + 2];
                interiorCount++;
              }
            }
          }
          
          if (interiorCount > 0) {
            interiorR /= interiorCount;
            interiorG /= interiorCount;
            interiorB /= interiorCount;
            
            const edgeLum = (r * 0.299 + g * 0.587 + b * 0.114);
            const interiorLum = (interiorR * 0.299 + interiorG * 0.587 + interiorB * 0.114);
            
            // Halo: edge is significantly lighter than interior
            if (edgeLum > interiorLum + 30) {
              bgBleedPixels += 2; // Weight halo higher
            }
          }
        }
      }
    }
  }
  
  const edgeContaminationRatio = edgePixels > 0 ? contaminatedEdgePixels / edgePixels : 0;
  if (edgeContaminationRatio > 0.3) {
    flaws.push({
      type: 'background_bleed',
      severity: Math.min(1, edgeContaminationRatio * 1.5),
      regions: [{ x: 0, y: 0, w: W, h: H }],
      description: `Edge contamination: ${(edgeContaminationRatio * 100).toFixed(0)}% of edge pixels have issues`,
    });
    complexityNotes.push(`Edge contamination: ${(edgeContaminationRatio * 100).toFixed(0)}%`);
  }
  
  // Check for shadow quality
  let shadowPixels = 0;
  let shadowAvgAlpha = 0;
  const groundY = Math.round(H * 0.7);
  
  // Scan the ground area for shadow
  for (let x = Math.round(W * 0.1); x < Math.round(W * 0.9); x++) {
    for (let dy = 0; dy < Math.round(H * 0.25); dy++) {
      const y = groundY + dy;
      const p = (y * W + x) * 4;
      const a = data[p + 3];
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      
      // Shadow detection: dark warm pixels
      if (a > 15 && r < 100 && g < 85 && b < 75) {
        shadowPixels++;
        shadowAvgAlpha += a;
      }
    }
  }
  
  shadowAvgAlpha /= Math.max(1, shadowPixels);
  const shadowCoverage = shadowPixels / (W * 0.8 * H * 0.25);
  
  if (shadowCoverage < 0.02) {
    flaws.push({
      type: 'shadow_missing',
      severity: 0.9,
      regions: [{ x: 0, y: groundY, w: W, h: Math.round(H * 0.25) }],
      description: 'Shadow is missing or invisible',
    });
    complexityNotes.push('Shadow: MISSING');
  } else if (shadowCoverage < 0.08) {
    flaws.push({
      type: 'shadow_missing',
      severity: 0.5,
      regions: [{ x: 0, y: groundY, w: W, h: Math.round(H * 0.25) }],
      description: `Shadow is very faint (${shadowCoverage.toFixed(3)} coverage)`,
    });
    complexityNotes.push(`Shadow: faint (${shadowCoverage.toFixed(3)})`);
  } else if (shadowAvgAlpha < 50) {
    flaws.push({
      type: 'shadow_missing',
      severity: 0.4,
      regions: [{ x: 0, y: groundY, w: W, h: Math.round(H * 0.25) }],
      description: `Shadow too weak (avg alpha ${shadowAvgAlpha.toFixed(0)})`,
    });
    complexityNotes.push(`Shadow: weak (${shadowAvgAlpha.toFixed(0)} alpha)`);
  } else {
    complexityNotes.push(`Shadow: OK (${shadowCoverage.toFixed(3)} cov, ${shadowAvgAlpha.toFixed(0)} alpha)`);
  }
  
  // Check for plate/table connection (background included in cutout)
  const { box } = cutout;
  if (box.w > 0 && box.h > 0) {
    // Check if the cutout box is too large relative to frame
    const fgRatio = (box.w * box.h) / (W * H);
    if (fgRatio > 0.45) {
      flaws.push({
        type: 'plate_connected',
        severity: Math.min(1, (fgRatio - 0.35) * 2),
        regions: [box],
        description: `Cutout includes background: ${fgRatio.toFixed(2)} of frame`,
      });
      complexityNotes.push(`Plate connected: ${fgRatio.toFixed(2)} coverage`);
    }
    
    // Check for thin connections (product silhouette includes narrow bg strips)
    let thinConnections = 0;
    for (let y = box.y; y < Math.min(H, box.y + box.h); y++) {
      let fgRun = 0;
      let maxFgRun = 0;
      let inFg = false;
      
      for (let x = box.x; x < Math.min(W, box.x + box.w); x++) {
        const a = data[((y * W + x) * 4) + 3];
        if (a > 128) {
          fgRun++;
          inFg = true;
        } else {
          if (inFg && fgRun < 8) {
            thinConnections++;
          }
          fgRun = 0;
          inFg = false;
        }
      }
      if (inFg && fgRun < 8) thinConnections++;
      
      if (thinConnections > 10) break;
    }
    
    if (thinConnections > 10) {
      flaws.push({
        type: 'plate_connected',
        severity: Math.min(1, thinConnections / 50),
        regions: [box],
        description: `Found ${thinConnections} thin background connections (plate/table)`,
      });
      complexityNotes.push(`Thin connections: ${thinConnections}`);
    }
  }
  
  // Check for missing details (product cut off or truncated)
  let productEdgePixels = 0;
  let cutoffIndicators = 0;
  
  // Check if product touches canvas edges (cut off)
  for (let x = 0; x < W; x += 2) {
    for (let y = 0; y < H; y += 2) {
      const i = y * W + x;
      const a = data[i * 4 + 3];
      
      if (a > 128) {
        if (x < 10 || x > W - 10 || y < 10 || y > H - 10) {
          cutoffIndicators++;
        }
        productEdgePixels++;
      }
    }
  }
  
  if (cutoffIndicators > 20) {
    flaws.push({
      type: 'missing_details',
      severity: Math.min(1, cutoffIndicators / 100),
      regions: [
        { x: 0, y: 0, w: W, h: 20 },
        { x: 0, y: H - 20, w: W, h: 20 },
        { x: 0, y: 0, w: 20, h: H },
        { x: W - 20, y: 0, w: 20, h: H },
      ],
      description: `Product appears cut off at canvas edge (${cutoffIndicators} pixels)`,
    });
  }
  
  // ============ QUALITY SCORE ============
  
  let qualityScore = 1;
  for (const flaw of flaws) {
    qualityScore -= flaw.severity * 0.35;
  }
  qualityScore = Math.max(0.1, Math.min(1, qualityScore));
  
  return { flaws, qualityScore, complexityNotes };
}

export type BackdropId =
  | 'studio'
  | 'warm'
  | 'mint'
  | 'blush'
  | 'sky'
  | 'paper'
  | 'walnut'
  | 'charcoal';

export type RatioId = '4:5' | '1:1' | '16:9';

export const BACKDROPS: Array<{
  id: BackdropId;
  label: string;
  from: string;
  to: string;
  swatch: string;
  dark?: boolean;
}> = [
  { id: 'studio', label: 'Studio', from: '#f7f6f3', to: '#e9e6df', swatch: '#f0eee8' },
  { id: 'warm', label: 'Warm', from: '#f6efe4', to: '#e7d7c2', swatch: '#efe3d2' },
  { id: 'mint', label: 'Mint', from: '#e8f2ee', to: '#d2e5dc', swatch: '#dcebe4' },
  { id: 'blush', label: 'Blush', from: '#f7edeb', to: '#ecd9d6', swatch: '#f1e3e0' },
  { id: 'sky', label: 'Sky', from: '#eaf0f6', to: '#d4e1ee', swatch: '#dfe9f2' },
  { id: 'paper', label: 'Paper', from: '#fbfaf7', to: '#f2f0ea', swatch: '#f6f5f0' },
  { id: 'walnut', label: 'Walnut', from: '#6b4a34', to: '#452e20', swatch: '#5a3e2b', dark: true },
  { id: 'charcoal', label: 'Charcoal', from: '#33373b', to: '#1e2124', swatch: '#282c30', dark: true },
];

export const RATIOS: Array<{ id: RatioId; label: string; w: number; h: number; hint: string }> = [
  { id: '4:5', label: '4:5', w: 1080, h: 1350, hint: 'Vinted / Depop / IG feed' },
  { id: '1:1', label: '1:1', w: 1080, h: 1080, hint: 'Square listing' },
  { id: '16:9', label: '16:9', w: 1280, h: 720, hint: 'Shop banner' },
];

export type Placement = { x: number; y: number; scale: number };
export type BannerOptions = {
  backdrop: BackdropId;
  ratio: RatioId;
  shadow: ShadowOptions;
};

export type AdaptiveFix = {
  kind: 'tolerance' | 'morph' | 'shave' | 'shadowOpacity' | 'shadowLength' | 'shadowDirection' | 'scale' | 'backdrop';
  value: number;
  reason: string;
};

export function applyFix(Cutout: Cutout, currentParams: PipelineParams, fix: AdaptiveFix): PipelineParams {
  const p = { ...currentParams };
  
  switch (fix.kind) {
    case 'tolerance':
      // Reduce tolerance to tighten cutout
      p.tolerance = Math.max(4, currentParams.tolerance - Math.abs(fix.value));
      break;
    case 'morph':
      // Increase morph radius to remove thin connections
      p.morphRadius = Math.min(6, currentParams.morphRadius + Math.abs(fix.value));
      break;
    case 'shave':
      // More aggressive shave
      p.shaveMultiplier = Math.max(0.3, currentParams.shaveMultiplier - Math.abs(fix.value) * 0.1);
      break;
    case 'shadowOpacity':
      p.shadowOpacity = Math.max(0.1, Math.min(1, currentParams.shadowOpacity + fix.value));
      break;
    case 'shadowLength':
      p.shadowLength = Math.max(0.2, Math.min(1.5, currentParams.shadowLength + fix.value * 0.1));
      break;
    case 'shadowDirection':
      p.shadowDirection = Math.max(0, Math.min(180, currentParams.shadowDirection + fix.value));
      break;
    case 'scale':
      p.placementScale = Math.max(0.25, Math.min(2.5, currentParams.placementScale + fix.value * 0.1));
      break;
    case 'backdrop':
      // Adjust backdrop contrast (would need different implementation)
      break;
  }
  
  return p;
}

export function generateFixes(flaws: DetectedFlaw[], currentParams: PipelineParams): AdaptiveFix[] {
  const fixes: AdaptiveFix[] = [];
  
  for (const flaw of flaws) {
    switch (flaw.type) {
      case 'background_bleed':
        // Tighten tolerance and increase shave
        fixes.push({
          kind: 'tolerance',
          value: -Math.min(10, flaw.severity * 8),
          reason: `Reduce tolerance to fix background bleed (severity: ${flaw.severity.toFixed(2)})`,
        });
        fixes.push({
          kind: 'shave',
          value: Math.min(0.3, flaw.severity * 0.2),
          reason: `Increase shave aggressiveness`,
        });
        break;
        
      case 'plate_connected':
        // Increase morph to break thin connections
        fixes.push({
          kind: 'morph',
          value: Math.min(3, flaw.severity * 4),
          reason: `Increase morph radius to break plate connections`,
        });
        fixes.push({
          kind: 'shave',
          value: Math.min(0.2, flaw.severity * 0.15),
          reason: `More aggressive shave for background connections`,
        });
        break;
        
      case 'shadow_missing':
        // Increase shadow opacity and length
        fixes.push({
          kind: 'shadowOpacity',
          value: Math.min(0.3, flaw.severity * 0.4),
          reason: `Increase shadow opacity (current: ${currentParams.shadowOpacity.toFixed(2)})`,
        });
        fixes.push({
          kind: 'shadowLength',
          value: Math.min(0.3, flaw.severity * 0.5),
          reason: `Increase shadow length for more visible shadow`,
        });
        break;
        
      case 'missing_details':
        // Adjust scale to zoom in/out properly
        fixes.push({
          kind: 'scale',
          value: flaw.severity > 0.5 ? -0.1 : 0.1,
          reason: `Adjust scale to avoid cutoff`,
        });
        break;
    }
  }
  
  // Deduplicate fixes by kind (keep the strongest)
  const byKind = new Map<string, AdaptiveFix>();
  for (const fix of fixes) {
    const existing = byKind.get(fix.kind);
    if (!existing || Math.abs(fix.value) > Math.abs(existing.value)) {
      byKind.set(fix.kind, fix);
    }
  }
  
  return [...byKind.values()];
}

export function getRatio(id: RatioId) {
  return RATIOS.find((r) => r.id === id) ?? RATIOS[0];
}

export function getBackdrop(id: BackdropId) {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0];
}

// ----------------------------------------------------------------------------
// Smart auto-placement with proper framing
// ----------------------------------------------------------------------------

export function autoPlacement(cutout: Cutout, W: number, H: number): Placement {
  const { box } = cutout;
  
  if (box.w <= 0 || box.h <= 0) {
    return { x: W / 2, y: H * 0.75, scale: 1 };
  }
  
  // Target coverage: product should fill 60-75% of canvas
  // For small objects, zoom in more; for large, fit properly
  const targetHeightRatio = 0.65;
  const targetWidthRatio = 0.75;
  
  const scaleByHeight = (H * targetHeightRatio) / box.h;
  const scaleByWidth = (W * targetWidthRatio) / box.w;
  
  // Use larger scale to zoom in on small objects
  let scale = Math.max(scaleByHeight, scaleByWidth);
  
  // Clamp to reasonable range
  scale = Math.max(0.25, Math.min(2.5, scale));
  
  // Center horizontally
  const x = W / 2;
  
  // Baseline at 75% height (leaves room for shadow below)
  const y = H * 0.75;
  
  return { x, y, scale };
}

// ----------------------------------------------------------------------------
// Cutout to canvas (cached)
// ----------------------------------------------------------------------------

const cutoutCanvasCache = new Map<Cutout, HTMLCanvasElement>();

export function cutoutToCanvas(cutout: Cutout): HTMLCanvasElement {
  let c = cutoutCanvasCache.get(cutout);
  if (!c) {
    c = document.createElement('canvas');
    c.width = cutout.width;
    c.height = cutout.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cutout.width, cutout.height);
    const n = cutout.width * cutout.height;
    
    for (let i = 0; i < n; i++) {
      img.data[i * 4] = cutout.alpha[i * 4];
      img.data[i * 4 + 1] = cutout.alpha[i * 4 + 1];
      img.data[i * 4 + 2] = cutout.alpha[i * 4 + 2];
      img.data[i * 4 + 3] = cutout.alpha[i * 4 + 3];
    }
    
    ctx.putImageData(img, 0, 0);
    cutoutCanvasCache.set(cutout, c);
  }
  return c;
}

// ----------------------------------------------------------------------------
// Backdrop rendering
// ----------------------------------------------------------------------------

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  backdrop: BackdropId
) {
  const bd = getBackdrop(backdrop);
  
  // Gradient background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, bd.from);
  g.addColorStop(1, bd.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  
  // Soft top light
  const r = ctx.createRadialGradient(W * 0.5, H * 0.16, 0, W * 0.5, H * 0.16, W * 0.95);
  if (bd.dark) {
    r.addColorStop(0, 'rgba(255,255,255,0.08)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    r.addColorStop(0, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
  
  // Grounding band
  const f = ctx.createLinearGradient(0, H * 0.5, 0, H);
  if (bd.dark) {
    f.addColorStop(0, 'rgba(0,0,0,0)');
    f.addColorStop(1, 'rgba(0,0,0,0.25)');
  } else {
    f.addColorStop(0, 'rgba(60,55,45,0)');
    f.addColorStop(1, 'rgba(60,55,45,0.08)');
  }
  ctx.fillStyle = f;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);
}

export function drawProduct(
  ctx: CanvasRenderingContext2D,
  cutout: Cutout,
  place: Placement
) {
  const { box } = cutout;
  const drawW = Math.max(1, Math.round(box.w * place.scale));
  const drawH = Math.max(1, Math.round(box.h * place.scale));
  const off = cutoutToCanvas(cutout);
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  ctx.drawImage(
    off,
    box.x, box.y, box.w, box.h,
    place.x - drawW / 2,
    place.y - drawH / 2,
    drawW, drawH
  );
}

// ----------------------------------------------------------------------------
// Full banner render
// ----------------------------------------------------------------------------

export function drawBanner(
  ctx: CanvasRenderingContext2D,
  cutout: Cutout,
  place: Placement,
  opts: BannerOptions,
  design?: GeneratedDesign
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  
  // Clear and draw backdrop
  ctx.clearRect(0, 0, W, H);
  
  if (design) {
    paintDesign(ctx, W, H, design);
  } else {
    drawBackdrop(ctx, W, H, opts.backdrop);
  }
  
  // Shadow
  const intensity = renderShadowIntensity(cutout, place, W, H, opts.shadow);
  const mask = toneMapShadow(intensity, W, H, opts.shadow);
  paintShadow(ctx, mask, W, H);
  
  // Product
  drawProduct(ctx, cutout, place);
}

// ----------------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------------

export function exportBanner(
  canvas: HTMLCanvasElement,
  filename = 'relight-banner'
) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}
