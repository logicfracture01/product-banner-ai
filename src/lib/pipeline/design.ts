// ============================================================================
// Generative Design Engine - Unique, product-matched studio scenes
// ============================================================================
// Creates coherent backdrop designs based on the product's color palette.
// Uses harmony rules (not pure randomness) to ensure the design flatters
// the product.
// ============================================================================

import type { StyleAnalysis } from './styles';

const GRAIN_TILE_SIZE = 96;
const grainTileCache = new Map<string, HTMLCanvasElement>();

export type GeneratedDesign = {
  seed: number;
  top: string;
  bottom: string;
  accentHue: number;
  light: {
    direction: number;
    softness: number;
    opacity: number;
    temperature: number;
  };
  surface: {
    vignette: number;
    grain: number;
    shapes: Array<{
      kind: 'circle' | 'arc' | 'band';
      x: number; y: number; r: number;
      alpha: number;
      hue: number;
    }>;
    floor: 'seam' | 'reflect' | 'none';
  };
  family: string;
};

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { makeRng };
function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

const FAMILIES = [
  { name: 'Editorial', baseHueRange: [0, 30], satRange: [15, 30], lightDir: [40, 80], temp: [0.2, 0.5] },
  { name: 'Atelier', baseHueRange: [200, 240], satRange: [20, 35], lightDir: [120, 160], temp: [-0.3, 0.1] },
  { name: 'Gallery', baseHueRange: [0, 360], satRange: [5, 15], lightDir: [30, 60], temp: [-0.2, 0.3] },
  { name: 'Sunlit', baseHueRange: [20, 50], satRange: [25, 45], lightDir: [20, 50], temp: [0.4, 0.7] },
  { name: 'Nocturne', baseHueRange: [220, 280], satRange: [10, 25], lightDir: [100, 140], temp: [-0.5, -0.2] },
  { name: 'Pastel Study', baseHueRange: [0, 360], satRange: [20, 35], lightDir: [45, 75], temp: [0.1, 0.4] },
] as const;

export function generateDesign(analysis: StyleAnalysis | null, seed: number): GeneratedDesign {
  const rng = makeRng(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  
  // Extract product hue from palette
  let productHue = 0;
  let productSat = 0;
  
  if (analysis && analysis.palette.length > 0) {
    for (const hex of analysis.palette) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      
      if (sat > productSat) {
        productSat = sat;
        if (mx !== mn) {
          const d = mx - mn;
          if (mx === r) productHue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (mx === g) productHue = ((b - r) / d + 2) * 60;
          else productHue = ((r - g) / d + 4) * 60;
        }
      }
    }
  }
  
  // Pick a family
  const family = pick(FAMILIES);
  const isDark = family.name === 'Nocturne' || (family.name === 'Gallery' && rng() < 0.4);
  
  // Derive backdrop hue from product
  let baseHue: number;
  
  if (productSat > 0.2) {
    // Harmonize with product
    const strategies = ['analogous', 'analogous', 'complement'];
    const strategy = pick(strategies);
    
    if (strategy === 'analogous') {
      baseHue = productHue + (rng() * 40 - 20);
    } else {
      baseHue = productHue + 180 + (rng() * 30 - 15);
    }
  } else {
    // Neutral product - use family default
    const [hMin, hMax] = family.baseHueRange;
    baseHue = hMin + rng() * (hMax - hMin);
  }
  
  const sat = isDark
    ? 8 + rng() * 12
    : family.satRange[0] + rng() * (family.satRange[1] - family.satRange[0]);
  
  // Light setup
  const [lightMin, lightMax] = family.lightDir;
  const direction = Math.round(lightMin + rng() * (lightMax - lightMin));
  const temperature = family.temp[0] + rng() * (family.temp[1] - family.temp[0]);
  
  // Surface treatment
  const vignette = 0.1 + rng() * 0.25;
  const grain = 0.1 + rng() * 0.3;
  
  const shapeCount = Math.floor(rng() * 3);
  const shapes: GeneratedDesign['surface']['shapes'] = [];
  
  for (let i = 0; i < shapeCount; i++) {
    shapes.push({
      kind: pick(['circle', 'arc', 'band'] as const),
      x: 0.1 + rng() * 0.8,
      y: 0.1 + rng() * 0.5,
      r: 0.15 + rng() * 0.35,
      alpha: 0.03 + rng() * 0.06,
      hue: baseHue + (rng() * 30 - 15),
    });
  }
  
  // Floor style
  const floor = pick(['none', 'seam', 'reflect'] as const);
  
  return {
    seed,
    top: hsl(baseHue, sat, isDark ? 15 + rng() * 10 : 85 + rng() * 8),
    bottom: hsl(baseHue + (rng() * 15 - 7), sat * 0.8, isDark ? 8 + rng() * 5 : 70 + rng() * 12),
    accentHue: baseHue,
    light: { direction, softness: 0.5 + rng() * 0.3, opacity: 0.35 + rng() * 0.2, temperature },
    surface: { vignette, grain, shapes, floor },
    family: family.name,
  };
}

export function randomSeed(): number {
  return (Math.random() * 2147483647) >>> 0;
}

// Paint the generated design onto a canvas
export function paintDesign(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  design: GeneratedDesign
): void {
  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, design.top);
  bg.addColorStop(1, design.bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  
  // Soft light pool at top
  const lightPool = ctx.createRadialGradient(
    W * 0.5, H * 0.15, 0,
    W * 0.5, H * 0.15, W * 0.8
  );
  
  if (design.light.temperature > 0) {
    lightPool.addColorStop(0, `hsla(${design.accentHue + 30}, 40%, 95%, 0.3)`);
  } else {
    lightPool.addColorStop(0, `hsla(${design.accentHue}, 30%, 90%, 0.25)`);
  }
  lightPool.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lightPool;
  ctx.fillRect(0, 0, W, H);
  
  // Soft shapes
  for (const shape of design.surface.shapes) {
    const x = shape.x * W;
    const y = shape.y * H;
    const r = shape.r * Math.min(W, H);
    
    ctx.beginPath();
    if (shape.kind === 'circle') {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else if (shape.kind === 'arc') {
      ctx.arc(x, y, r, 0, Math.PI);
    } else {
      ctx.ellipse(x, y + r * 0.3, r * 0.6, r * 0.4, 0, 0, Math.PI * 2);
    }
    
    ctx.fillStyle = hsla(shape.hue, 30, 70, shape.alpha);
    ctx.fill();
  }
  
  // Vignette
  if (design.surface.vignette > 0) {
    const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${design.surface.vignette * 0.4})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }
  
  // Grain texture
  if (design.surface.grain > 0) {
    const grainCanvas = getGrainTile(design.seed, design.surface.grain);
    ctx.drawImage(grainCanvas, 0, 0, W, H);
  }
  
  // Floor treatment
  if (design.surface.floor === 'seam') {
    const seamY = H * 0.7;
    const seam = ctx.createLinearGradient(0, seamY, 0, H);
    seam.addColorStop(0, 'rgba(0,0,0,0)');
    seam.addColorStop(0.5, 'rgba(0,0,0,0.03)');
    seam.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = seam;
    ctx.fillRect(0, seamY, W, H - seamY);
    
    // Subtle line
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, seamY);
    ctx.lineTo(W, seamY);
    ctx.stroke();
  } else if (design.surface.floor === 'reflect') {
    const floorY = H * 0.65;
    const grad = ctx.createLinearGradient(0, floorY, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.02)');
    grad.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, floorY, W, H - floorY);
  }
}

function getGrainTile(seed: number, amount: number): HTMLCanvasElement {
  const key = `${seed}-${Math.round(amount * 100)}`;
  const cached = grainTileCache.get(key);
  if (cached) return cached;
  
  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_TILE_SIZE;
  canvas.height = GRAIN_TILE_SIZE;
  const ctx = canvas.getContext('2d')!;
  
  const imageData = ctx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  const data = imageData.data;
  
  const rng = makeRng(seed);
  const intensity = Math.round(amount * 20);
  
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rng() - 0.5) * intensity;
    const base = 128 + noise;
    data[i] = base;
    data[i + 1] = base;
    data[i + 2] = base;
    data[i + 3] = Math.round(amount * 60);
  }
  
  ctx.putImageData(imageData, 0, 0);
  grainTileCache.set(key, canvas);
  return canvas;
}
