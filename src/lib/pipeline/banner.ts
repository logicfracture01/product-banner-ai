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
