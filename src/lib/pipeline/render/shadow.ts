// ============================================================================
// Shadow Engine - Physically-based shadow rendering
// ============================================================================
// Implements realistic contact and cast shadows:
//   1. Contact shadow: Ambient occlusion band hugging the silhouette bottom
//   2. Cast shadow: Silhouette swept along light vector with area-light physics
//   3. Two-scale filtering: Sharp at contact, soft away (studio look)
// ============================================================================

import type { Cutout } from '../segmentation/segment';
import { boxBlur3, distanceInside, distanceOutside, mulberry32 } from '../core/pixels';

export type ShadowOptions = {
  direction: number;      // Light azimuth in degrees (0 = from right, 90 = from above)
  length: number;         // Cast length as fraction of max(bboxW, bboxH)
  softness: number;       // 0..1 penumbra width and overall blur
  opacity: number;        // 0..1 maximum darkness of shadow core
  contact: boolean;       // Render tight contact (AO) band
};

export const DEFAULT_SHADOW: ShadowOptions = {
  direction: 55,
  length: 0.7,
  softness: 0.6,
  opacity: 0.42,
  contact: true,
};

// ----------------------------------------------------------------------------
// Shadow tone mapping (cheap, can be re-run for slider updates)
// ----------------------------------------------------------------------------

export function toneMapShadow(
  intensity: Float32Array,
  canvasW: number,
  canvasH: number,
  opts: ShadowOptions
): Uint8ClampedArray {
  const n = canvasW * canvasH;
  const mask = new Uint8ClampedArray(n);
  const op = Math.max(0, Math.min(1, opts.opacity));
  
  for (let i = 0; i < n; i++) {
    let v = intensity[i] * op;
    if (v > 0) {
      v = Math.pow(Math.min(1, v), 1.15);
      mask[i] = Math.round(v * 255);
    }
  }
  return mask;
}

// ----------------------------------------------------------------------------
// Shadow intensity computation (expensive, cacheable)
// ----------------------------------------------------------------------------

export function renderShadowIntensity(
  cutout: Cutout,
  place: { x: number; y: number; scale: number },
  canvasW: number,
  canvasH: number,
  opts: ShadowOptions
): Float32Array {
  const n = canvasW * canvasH;
  const intensity = new Float32Array(n);
  
  // Rasterize silhouette at placement
  const sil = new Uint8Array(n);
  const { alpha, width: cw, height: ch, box } = cutout;
  
  // Calculate placement in canvas coordinates
  const productCenterX = (box.x + box.w / 2) * place.scale;
  const productCenterY = (box.y + box.h / 2) * place.scale;
  const baseX = Math.round(place.x - productCenterX);
  const baseY = Math.round(place.y - productCenterY);
  
  // Find silhouette pixels
  const silList: number[] = [];
  const scaledW = Math.round(box.w * place.scale);
  const scaledH = Math.round(box.h * place.scale);
  
  for (let dy = 0; dy < scaledH; dy++) {
    const sy = Math.min(ch - 1, Math.floor((dy) / place.scale));
    for (let dx = 0; dx < scaledW; dx++) {
      const sx = Math.min(cw - 1, Math.floor((dx) / place.scale));
      const alphaIdx = (sy * cw + sx) * 4 + 3;
      if (alpha[alphaIdx] > 60) {
        const px = baseX + dx;
        const py = baseY + dy;
        if (px >= 0 && py >= 0 && px < canvasW && py < canvasH) {
          const j = py * canvasW + px;
          if (!sil[j]) {
            sil[j] = 1;
            silList.push(j);
          }
        }
      }
    }
  }
  
  if (silList.length === 0) return intensity;
  
  const longest = Math.max(box.w, box.h) * place.scale;
  
  // --------------------------------------------------------------------------
  // 1. Cast shadow: Coverage accumulation (area-light physics)
  // --------------------------------------------------------------------------
  const travel = longest * opts.length;
  const cast = new Float32Array(n);
  
  if (travel > 0.5) {
    const rad = (opts.direction * Math.PI) / 180;
    const dirX = -Math.cos(rad);  // Shadow falls AWAY from light
    const dirY = Math.sin(rad) * 0.85; // Ground plane foreshortening
    
    // Use more steps for longer shadows
    const steps = Math.max(15, Math.round(50 * (0.45 + opts.length)));
    
    // Deterministic jitter for organic edges
    const rng = mulberry32(0x9e3779b9);
    const phase1 = rng() * Math.PI * 2;
    const phase2 = rng() * Math.PI * 2;
    
    // Compute weights for normalization
    let wSum = 0;
    const weights = new Float32Array(steps);
    for (let s = 0; s < steps; s++) {
      const t = (s + 1) / steps;
      weights[s] = Math.pow(1 - t, 1.6);
      wSum += weights[s];
    }
    
    // Pre-dilated silhouettes for area-light spread
    const dil: Uint8Array[] = [sil];
    for (let r = 1; r <= 3; r++) {
      dil.push(dilate8(dil[r - 1], canvasW, canvasH));
    }
    
    for (let s = 0; s < steps; s++) {
      const t = (s + 1) / steps;
      const dist = travel * t;
      const w = weights[s];
      
      // Organic edge wobble
      const jx = 0.5 * Math.sin(phase1 + t * 6.1) + 0.3 * Math.sin(phase2 + t * 13.7);
      const ox = dirX * dist + jx * longest * 0.02;
      const oy = dirY * dist;
      
      const src = dil[Math.min(3, Math.floor(t * 4))];
      stampWeighted(src, silList, canvasW, canvasH, ox, oy, w, cast);
    }
    
    if (wSum > 0) {
      for (let i = 0; i < n; i++) cast[i] /= wSum;
    }
  }
  
  // --------------------------------------------------------------------------
  // 2. Two-scale filtering: Sharp at contact, soft away
  // --------------------------------------------------------------------------
  let castSoft = cast;
  
  if (travel > 0.5) {
    const rNear = Math.max(1, Math.round(longest * 0.012));
    const rFar = Math.max(rNear + 1, Math.round(longest * (0.02 + 0.1 * opts.softness)));
    
    const tight = boxBlur3(cast, canvasW, canvasH, Math.min(rNear, 40));
    const soft = boxBlur3(cast, canvasW, canvasH, Math.min(rFar, 40));
    
    const dOut = distanceOutside(sil, canvasW, canvasH);
    const reach = Math.max(1, longest * (0.12 + 0.5 * opts.softness));
    
    castSoft = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = dOut[i] / reach;
      if (m > 1) m = 1;
      const sm = m * m * (3 - 2 * m); // smoothstep
      castSoft[i] = tight[i] * (1 - sm) + soft[i] * sm;
    }
  }
  
  // --------------------------------------------------------------------------
  // 3. Contact shadow (ambient occlusion)
  // --------------------------------------------------------------------------
  const ao = new Float32Array(n);
  
  if (opts.contact) {
    const inner = distanceInside(sil, canvasW, canvasH);
    const outside = distanceOutside(sil, canvasW, canvasH);
    const band = 3 + 5 * opts.softness;
    const ampOut = 0.32 * (0.75 + 0.25 * opts.softness);
    const ampIn = 0.4;
    
    for (let i = 0; i < n; i++) {
      if (sil[i]) {
        // Inside: darken crevices
        const crevice = Math.max(0, 5 - inner[i]) / 5;
        ao[i] = ampIn * crevice;
      } else {
        // Outside: fall off with distance
        const d = outside[i];
        if (d < band) {
          const t = 1 - d / band;
          ao[i] = ampOut * t * t;
        }
      }
    }
  }
  
  // Composite
  for (let i = 0; i < n; i++) {
    intensity[i] = Math.max(castSoft[i], ao[i]);
  }
  
  return intensity;
}

// ----------------------------------------------------------------------------
// Paint shadow to canvas
// ----------------------------------------------------------------------------

export function paintShadow(
  ctx: CanvasRenderingContext2D,
  mask: Uint8ClampedArray,
  w: number,
  h: number
) {
  const img = ctx.createImageData(w, h);
  
  // Warm dark shadow color (more natural than pure black)
  const shadowR = 45;
  const shadowG = 40;
  const shadowB = 35;
  
  for (let i = 0; i < w * h; i++) {
    const a = mask[i];
    if (a > 0) {
      img.data[i * 4] = shadowR;
      img.data[i * 4 + 1] = shadowG;
      img.data[i * 4 + 2] = shadowB;
      img.data[i * 4 + 3] = a;
    }
  }
  
  ctx.putImageData(img, 0, 0);
}

// ----------------------------------------------------------------------------
// One-shot convenience
// ----------------------------------------------------------------------------

export function renderShadow(
  cutout: Cutout,
  place: { x: number; y: number; scale: number },
  canvasW: number,
  canvasH: number,
  opts: ShadowOptions
): Uint8ClampedArray {
  return toneMapShadow(
    renderShadowIntensity(cutout, place, canvasW, canvasH, opts),
    canvasW, canvasH, opts
  );
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function stampWeighted(
  src: Uint8Array,
  silList: number[],
  w: number,
  h: number,
  ox: number,
  oy: number,
  weight: number,
  dst: Float32Array
) {
  const ioX = Math.round(ox);
  const ioY = Math.round(oy);
  
  for (let k = 0; k < silList.length; k++) {
    const i = silList[k];
    if (!src[i]) continue;
    
    const x = (i % w) + ioX;
    const y = ((i / w) | 0) + ioY;
    
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    dst[y * w + x] += weight;
  }
}

function dilate8(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) {
        out[i] = 1;
        continue;
      }
      
      if (
        (x > 0 && src[i - 1]) ||
        (x < w - 1 && src[i + 1]) ||
        (y > 0 && src[i - w]) ||
        (y < h - 1 && src[i + w]) ||
        (x > 0 && y > 0 && src[i - w - 1]) ||
        (x < w - 1 && y > 0 && src[i - w + 1]) ||
        (x > 0 && y < h - 1 && src[i + w - 1]) ||
        (x < w - 1 && y < h - 1 && src[i + w + 1])
      ) {
        out[i] = 1;
      }
    }
  }
  
  return out;
}
