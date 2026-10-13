// Image enhancement engine — 100% Canvas 2D / typed-array pixel math, no servers.

export type EnhancePlan = {
  whitePoint?: number;
  blackPoint?: number;
  shadows?: number;
  midtones?: number;
  highlights?: number;
  tint?: number;
  exposure?: number;
  contrast?: number;
  hue?: number;
  sat?: number;
  lum?: number;
  clarity?: number;
  denoise?: number;
  sharpen?: number;
  grain?: number;
  vignette?: number;
  bloom?: number;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function srgbToLinear8(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb8(c: number): number {
  const v = clamp01(c);
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
}

interface Rgb { r: number; g: number; b: number }

function rgb8FromLinear(c: Rgb): Rgb {
  return {
    r: linearToSrgb8(c.r),
    g: linearToSrgb8(c.g),
    b: linearToSrgb8(c.b),
  };
}

function rgbY(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function whiteBalance(rgb: Rgb, tint: number): Rgb {
  const wb = 1 + tint * 0.25;
  return { r: rgb.r * wb, g: rgb.g, b: rgb.b / wb };
}

function toneCurve(rgb: Rgb, plan: EnhancePlan): Rgb {
  const { exposure = 0, contrast = 1, whitePoint = 1, blackPoint = 0 } = plan;
  const gain = Math.pow(2, exposure);
  const pivot = 0.18;
  let r = rgb.r * gain;
  let g = rgb.g * gain;
  let b = rgb.b * gain;
  r = pivot + (r - pivot) * contrast;
  g = pivot + (g - pivot) * contrast;
  b = pivot + (b - pivot) * contrast;
  r = (r - blackPoint) / Math.max(1e-5, (whitePoint - blackPoint));
  g = (g - blackPoint) / Math.max(1e-5, (whitePoint - blackPoint));
  b = (b - blackPoint) / Math.max(1e-5, (whitePoint - blackPoint));
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

function hslGrade(rgb: Rgb, plan: EnhancePlan): Rgb {
  const { hue = 0, sat = 1, lum = 0 } = plan;
  if (hue === 0 && sat === 1 && lum === 0) return rgb;
  const r = rgb.r, g = rgb.g, b = rgb.b;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + hue / 360 + 1) % 1;
  s = clamp01(s * sat);
  const l2 = clamp01(l + lum * 0.15);
  if (s === 0) return { r: l2, g: l2, b: l2 };
  const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
  const p = 2 * l2 - q;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: hue2rgb(p, q, h + 1 / 3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1 / 3),
  };
}

function channelGrade(rgb: Rgb, plan: EnhancePlan, shadowW: (l: number) => number, highlightW: (l: number) => number): Rgb {
  const l = rgbY(rgb);
  const amount = ((shadowW(l) + highlightW(l)) * 0.5);
  const t = (plan.tint || 0) * amount;
  return whiteBalance(rgb, t * 0.4);
}

function buildGradeFn(plan: EnhancePlan) {
  const shadowsAmt = plan.shadows ?? 0;
  const highlightAmt = plan.highlights ?? 0;
  const shadowW = (l: number) => Math.max(0, 1 - l * 2) * Math.max(0, shadowsAmt);
  const highlightW = (l: number) => Math.max(0, (l - 0.5) * 2) * Math.max(0, highlightAmt);
  return (rgb: Rgb) => channelGrade(rgb, plan, shadowW, highlightW);
}

function makeKernel(radius: number, fn: (dx: number, dy: number) => number) {
  const size = radius * 2 + 1;
  const arr = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fn(x - radius, y - radius);
      arr[y * size + x] = v;
      sum += v;
    }
  }
  if (sum > 0) {
    for (let i = 0; i < arr.length; i++) arr[i] /= sum;
  }
  return { arr, size };
}

function convolve(
  src: Float32Array,
  w: number,
  h: number,
  kernel: ReturnType<typeof makeKernel>,
  channel: number,
  // Pixels per element OF THIS BUFFER. RGBA planes need 4; the single-channel
  // luminance planes built by `clarity` and `bloom` need 1. Getting this wrong
  // reads far outside the buffer (Float32Array yields `undefined` → NaN → a
  // fully black image), which is exactly what happened before this parameter
  // existed.
  stride: number = 4,
): Float32Array {
  const { arr, size } = kernel;
  const half = (size - 1) / 2;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let ky = 0; ky < size; ky++) {
        const sy = y + ky - half;
        if (sy < 0 || sy >= h) continue;
        for (let kx = 0; kx < size; kx++) {
          const sx = x + kx - half;
          if (sx < 0 || sx >= w) continue;
          const k = arr[ky * size + kx];
          if (k === 0) continue;
          const si = (sy * w + sx) * stride + channel;
          sum += src[si] * k;
        }
      }
      out[y * w + x] = sum;
    }
  }
  return out;
}

function sharpen(src: Float32Array, w: number, h: number, amount: number, radius: number): Float32Array {
  const blur = convolve(src, w, h, makeKernel(radius, (dx, dy) => Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius))), 0);
  const out = src.slice();
  for (let i = 0; i < w * h; i++) {
    const bi = i * 4;
    for (let c = 0; c < 3; c++) {
      const detail = src[bi + c] - blur[i];
      out[bi + c] = Math.max(0, Math.min(255, src[bi + c] + detail * amount));
    }
  }
  return out;
}

function denoise(src: Float32Array, w: number, h: number, amount: number, radius: number): Float32Array {
  const k = makeKernel(radius, (dx, dy) => Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius)));
  const tmpL = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) tmpL[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  const out = src.slice();
  for (let i = 0; i < w * h; i++) {
    const bi = i * 4;
    const cx = i % w, cy = (i / w) | 0;
    const lc = tmpL[i];
    let r = 0, g = 0, b = 0, sum = 0;
    for (let ky = 0; ky < k.size; ky++) {
      const sy = cy + ky - (k.size - 1) / 2;
      if (sy < 0 || sy >= h) continue;
      for (let kx = 0; kx < k.size; kx++) {
        const sx = cx + kx - (k.size - 1) / 2;
        if (sx < 0 || sx >= w) continue;
        const sidx = sy * w + sx;
        const spatial = k.arr[ky * k.size + kx];
        const range = Math.exp(-Math.pow(tmpL[sidx] - lc, 2) / (2 * 60));
        const wgt = spatial * range * amount;
        r += src[sidx * 4] * wgt;
        g += src[sidx * 4 + 1] * wgt;
        b += src[sidx * 4 + 2] * wgt;
        sum += wgt;
      }
    }
    if (sum > 0) {
      out[bi] = Math.round(r / sum);
      out[bi + 1] = Math.round(g / sum);
      out[bi + 2] = Math.round(b / sum);
    }
  }
  return out;
}

function clarity(src: Float32Array, w: number, h: number, amount: number): Float32Array {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  const k = makeKernel(2, (dx, dy) => Math.exp(-(dx * dx + dy * dy) / 4));
  const blur = convolve(lum, w, h, k, 0, 1);
  const detail = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) detail[i] = lum[i] - blur[i];
  const out = src.slice();
  for (let i = 0; i < w * h; i++) {
    const bi = i * 4;
    const d = detail[i];
    const gain = amount * (1 - Math.exp(-Math.abs(d) / 25));
    for (let c = 0; c < 3; c++) out[bi + c] = Math.max(0, Math.min(255, src[bi + c] + d * gain * 1.2));
  }
  return out;
}

function grain(src: Float32Array, w: number, h: number, amount: number, seed: number): Float32Array {
  let s = seed || 1;
  function rng(): number {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 256) / 255;
  }
  const out = src.slice();
  const strength = amount * 22;
  for (let i = 0; i < w * h; i++) {
    const bi = i * 4;
    const g = (rng() - 0.5) * strength;
    out[bi] = Math.max(0, Math.min(255, src[bi] + g));
    out[bi + 1] = Math.max(0, Math.min(255, src[bi + 1] + g));
    out[bi + 2] = Math.max(0, Math.min(255, src[bi + 2] + g));
  }
  return out;
}

function bloom(src: Float32Array, w: number, h: number, amount: number): Float32Array {
  if (amount <= 0) return src.slice();
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  const bright = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) bright[i] = Math.max(0, lum[i] - 200) * amount * 0.02;
  const k = makeKernel(8, (dx, dy) => Math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8)));
  const glow = convolve(bright, w, h, k, 0, 1);
  const out = src.slice();
  const glowAmt = amount * 0.6;
  for (let i = 0; i < w * h; i++) {
    const bi = i * 4;
    const g = Math.max(0, glow[i]) * glowAmt;
    out[bi] = Math.min(255, src[bi] + g);
    out[bi + 1] = Math.min(255, src[bi + 1] + g);
    out[bi + 2] = Math.min(255, src[bi + 2] + g);
  }
  return out;
}

function vignette(src: Float32Array, w: number, h: number, amount: number): Float32Array {
  if (amount <= 0) return src.slice();
  const out = src.slice();
  const cx = w / 2, cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bi = i * 4;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxR;
      const f = Math.max(0, d * amount * 1.5);
      const v = 1 - f;
      out[bi] = Math.round(src[bi] * v);
      out[bi + 1] = Math.round(src[bi + 1] * v);
      out[bi + 2] = Math.round(src[bi + 2] * v);
    }
  }
  return out;
}

export async function enhanceImage(
  plan: EnhancePlan,
  source: { rgba: Uint8ClampedArray; width: number; height: number },
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const { rgba, width: w, height: h } = source;
  const plan0 = Object.assign({
    whitePoint: 1, blackPoint: 0, exposure: 0, contrast: 1,
    tint: 0, hue: 0, sat: 1, lum: 0,
    shadows: 0, midtones: 0, highlights: 0,
    clarity: 0, denoise: 0, sharpen: 0, grain: 0, bloom: 0, vignette: 0,
  }, plan);

  const src = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i++) src[i] = rgba[i];

  const grade = buildGradeFn(plan0);
  const curve = (rgb: Rgb) => toneCurve(rgb, plan0);
  const hsl = (rgb: Rgb) => hslGrade(rgb, plan0);
  const graded = new Float32Array(src.length);
  for (let i = 0; i < w * h; i++) {
    const bi = i * 4;
    const r = src[bi], g = src[bi + 1], b = src[bi + 2];
    let c = { r: srgbToLinear8(r), g: srgbToLinear8(g), b: srgbToLinear8(b) };
    c = grade(c);
    c = curve(c);
    c = hsl(c);
    const o = rgb8FromLinear(c);
    graded[bi] = o.r; graded[bi + 1] = o.g; graded[bi + 2] = o.b; graded[bi + 3] = src[bi + 3];
  }
  src.set(graded);

  if (plan0.denoise > 0) src.set(denoise(src, w, h, plan0.denoise, 3));
  if (plan0.clarity > 0) src.set(clarity(src, w, h, plan0.clarity));
  if (plan0.sharpen > 0) src.set(sharpen(src, w, h, plan0.sharpen, 1));
  if (plan0.bloom > 0) src.set(bloom(src, w, h, plan0.bloom));
  if (plan0.vignette > 0) src.set(vignette(src, w, h, plan0.vignette));
  if (plan0.grain > 0) src.set(grain(src, w, h, plan0.grain, plan0.hue | 0));

  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(Math.max(0, Math.min(255, src[i])));
  return { rgba: out, width: w, height: h };
}
