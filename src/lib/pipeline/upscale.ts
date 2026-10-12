// ============================================================================
// Upscale Engine - Detail-preserving image magnification
// ============================================================================
// Uses Catmull-Rom bicubic interpolation with adaptive unsharp masking.
// Designed to enhance soft phone photos before segmentation.
// ============================================================================

import { boxBlur3, clamp255, luminance, smoothstep } from './pixels';

export type UpscaleOptions = {
  factor: 2 | 3;
  sharpening?: number;    // 0..1 texture sharpening strength
  crispness?: number;     // 0..1 extra gain for high-contrast structure
};

export type UpscaledImage = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
};

// Catmull-Rom cubic kernel (a = -0.5)
function catmullRomWeights(t: number): [number, number, number, number] {
  const a = -0.5;
  const t1 = Math.abs(t);
  const w = new Array<number>(4) as [number, number, number, number];
  const d = [1 + t1, t1, Math.abs(1 - t1), 2 - t1];
  
  for (let i = 0; i < 4; i++) {
    const dt = d[i];
    if (dt <= 1) {
      w[i] = (a + 2) * dt * dt * dt - (a + 3) * dt * dt + 1;
    } else if (dt < 2) {
      w[i] = a * dt * dt * dt - 5 * a * dt * dt + 8 * a * dt - 4 * a;
    } else {
      w[i] = 0;
    }
  }
  return w;
}

type AxisPlan = {
  idx: Int32Array;
  w: Float32Array;
};

function buildAxisPlan(srcSize: number, outSize: number, factor: number): AxisPlan {
  const idx = new Int32Array(4 * outSize);
  const w = new Float32Array(4 * outSize);
  
  for (let o = 0; o < outSize; o++) {
    const s = (o + 0.5) / factor - 0.5;
    const base = Math.floor(s);
    const t = s - base;
    const weights = catmullRomWeights(t);
    
    for (let k = 0; k < 4; k++) {
      const raw = base - 1 + k;
      idx[o * 4 + k] = raw < 0 ? 0 : raw >= srcSize ? srcSize - 1 : raw;
      w[o * 4 + k] = weights[k];
    }
    
    // Normalize weights
    const sum = w[o * 4] + w[o * 4 + 1] + w[o * 4 + 2] + w[o * 4 + 3];
    if (sum > 0) {
      w[o * 4] /= sum;
      w[o * 4 + 1] /= sum;
      w[o * 4 + 2] /= sum;
      w[o * 4 + 3] /= sum;
    }
  }
  
  return { idx, w };
}

export function upscaleImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: UpscaleOptions
): UpscaledImage {
  const f = opts.factor;
  const W = width * f;
  const H = height * f;
  const n = W * H;
  
  const px = buildAxisPlan(width, W, f);
  const py = buildAxisPlan(height, H, f);
  
  // Stage 1: Catmull-Rom bicubic interpolation
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const A = new Float32Array(n);
  
  // Horizontal pass
  const midR = new Float32Array(W * height);
  const midG = new Float32Array(W * height);
  const midB = new Float32Array(W * height);
  const midA = new Float32Array(W * height);
  
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4;
    const dstRow = y * W;
    
    for (let x = 0; x < W; x++) {
      const i0 = px.idx[x * 4] * 4;
      const i1 = px.idx[x * 4 + 1] * 4;
      const i2 = px.idx[x * 4 + 2] * 4;
      const i3 = px.idx[x * 4 + 3] * 4;
      const w0 = px.w[x * 4];
      const w1 = px.w[x * 4 + 1];
      const w2 = px.w[x * 4 + 2];
      const w3 = px.w[x * 4 + 3];
      
      midR[dstRow + x] = rgba[srcRow + i0] * w0 + rgba[srcRow + i1] * w1 +
                         rgba[srcRow + i2] * w2 + rgba[srcRow + i3] * w3;
      midG[dstRow + x] = rgba[srcRow + i0 + 1] * w0 + rgba[srcRow + i1 + 1] * w1 +
                         rgba[srcRow + i2 + 1] * w2 + rgba[srcRow + i3 + 1] * w3;
      midB[dstRow + x] = rgba[srcRow + i0 + 2] * w0 + rgba[srcRow + i1 + 2] * w1 +
                         rgba[srcRow + i2 + 2] * w2 + rgba[srcRow + i3 + 2] * w3;
      midA[dstRow + x] = rgba[srcRow + i0 + 3] * w0 + rgba[srcRow + i1 + 3] * w1 +
                         rgba[srcRow + i2 + 3] * w2 + rgba[srcRow + i3 + 3] * w3;
    }
  }
  
  // Vertical pass
  for (let y = 0; y < H; y++) {
    const j0 = py.idx[y * 4] * W;
    const j1 = py.idx[y * 4 + 1] * W;
    const j2 = py.idx[y * 4 + 2] * W;
    const j3 = py.idx[y * 4 + 3] * W;
    const w0 = py.w[y * 4];
    const w1 = py.w[y * 4 + 1];
    const w2 = py.w[y * 4 + 2];
    const w3 = py.w[y * 4 + 3];
    const dstRow = y * W;
    
    for (let x = 0; x < W; x++) {
      const j = dstRow + x;
      R[j] = midR[j0 + x] * w0 + midR[j1 + x] * w1 + midR[j2 + x] * w2 + midR[j3 + x] * w3;
      G[j] = midG[j0 + x] * w0 + midG[j1 + x] * w1 + midG[j2 + x] * w2 + midG[j3 + x] * w3;
      B[j] = midB[j0 + x] * w0 + midB[j1 + x] * w1 + midB[j2 + x] * w2 + midB[j3 + x] * w3;
      A[j] = midA[j0 + x] * w0 + midA[j1 + x] * w1 + midA[j2 + x] * w2 + midA[j3 + x] * w3;
    }
  }
  
  // Stage 2: Adaptive unsharp masking on luminance
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = luminance(R[i], G[i], B[i]);
  }
  
  const sharpening = Math.max(0, Math.min(1, opts.sharpening ?? 0.55));
  const crispness = Math.max(0, Math.min(1, opts.crispness ?? 0.7));
  
  const lo = boxBlur3(L.slice(), W, H, Math.max(1, Math.round(f / 2)));
  const hi = boxBlur3(L.slice(), W, H, 1);
  
  // Edge magnitude for halo suppression
  const edgeMag = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = row + x;
      const gx = Math.abs(L[i - 1] - L[i + 1]);
      const gy = Math.abs(L[i - W] - L[i + W]);
      edgeMag[i] = gx + gy;
    }
  }
  const edgeSoft = boxBlur3(edgeMag, W, H, Math.max(1, f));
  
  for (let i = 0; i < n; i++) {
    const l = L[i];
    const sup = smoothstep(0, 1, 1 - Math.min(1, edgeSoft[i] / 60));
    
    let lNew = l + (l - lo[i]) * (sharpening * sup * 1.6);
    
    // Crisp pass for high-contrast details
    const micro = l - hi[i];
    const contrast = Math.abs(micro);
    if (contrast > 2.5) {
      lNew += micro * (crispness * sup * Math.min(1, (contrast - 2.5) / 12) * 1.3);
    }
    
    lNew = clamp255(lNew);
    const ratio = l > 0.5 ? lNew / l : 1;
    
    R[i] = clamp255(l <= 0.5 ? lNew + (R[i] - l) : R[i] * ratio);
    G[i] = clamp255(l <= 0.5 ? lNew + (G[i] - l) : G[i] * ratio);
    B[i] = clamp255(l <= 0.5 ? lNew + (B[i] - l) : B[i] * ratio);
  }
  
  // Stage 3: BT.601 chroma cleanup on semi-transparent edges
  const Cr = new Float32Array(n);
  const Cb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y2 = luminance(R[i], G[i], B[i]);
    Cr[i] = (R[i] - y2) * 0.713;
    Cb[i] = (B[i] - y2) * 0.564;
  }
  
  const CrS = boxBlur3(Cr, W, H, 1);
  const CbS = boxBlur3(Cb, W, H, 1);
  
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = A[i];
    
    if (a > 0 && a < 250) {
      const y2 = luminance(R[i], G[i], B[i]);
      const cr = Cr[i] * 0.55 + CrS[i] * 0.45;
      const cb = Cb[i] * 0.55 + CbS[i] * 0.45;
      out[p] = y2 + 1.402 * cr;
      out[p + 1] = y2 - 0.344 * cb - 0.714 * cr;
      out[p + 2] = y2 + 1.773 * cb;
    } else {
      out[p] = R[i];
      out[p + 1] = G[i];
      out[p + 2] = B[i];
    }
    out[p + 3] = a;
  }
  
  return { rgba: out, width: W, height: H };
}

export function upscaleToImageData(
  src: ImageData,
  opts: UpscaleOptions
): ImageData {
  const up = upscaleImage(src.data, src.width, src.height, opts);
  const cv = new ImageData(up.width, up.height);
  cv.data.set(up.rgba);
  return cv;
}
