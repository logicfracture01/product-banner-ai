// Platform utilities shared by the pipeline engines (segment / shadow / upscale).

/** Clamp a byte value into [0, 255]. */
export function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v & 0xff;
}

/** 8-connected neighborhood dilation by radius 1. */
export function boxDilate8(src: Uint8Array, w: number, h: number): Uint8Array {
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

/** Chebyshev-ish chamfer distance, *inside* foreground pixels. */
export function distanceInside(fg: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(fg.length);
  for (let i = 0; i < fg.length; i++) d[i] = fg[i] ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!fg[i]) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 3);
      if (y > 0) m = Math.min(m, d[i - w] + 3);
      if (x > 0 && y > 0) m = Math.min(m, d[i - w - 1] + 4);
      if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + 4);
      d[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!fg[i]) continue;
      let m = d[i];
      if (x < w - 1) m = Math.min(m, d[i + 1] + 3);
      if (y < h - 1) m = Math.min(m, d[i + w] + 3);
      if (x < w - 1 && y < h - 1) m = Math.min(m, d[i + w + 1] + 4);
      if (x > 0 && y < h - 1) m = Math.min(m, d[i + w - 1] + 4);
      d[i] = m;
    }
  }
  for (let i = 0; i < fg.length; i++) d[i] /= 3;
  return d;
}

/** Distance from the *outside* of a binary mask (inverts then uses inside). */
export function distanceOutside(bin: Uint8Array, w: number, h: number): Float32Array {
  const inv = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) inv[i] = bin[i] ? 0 : 1;
  return distanceInside(inv, w, h);
}

/** Three-pass separable box blur of `src` in-place (clamped radius). */
export function boxBlur3(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(0, Math.min(radius, 60));
  if (r === 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    let cnt = 0;
    for (let x = 0; x < w + r; x++) {
      if (x < w) {
        sum += src[row + x];
        cnt++;
      }
      if (x >= 2 * r + 1) {
        const k = x - 2 * r - 1;
        if (k >= 0 && k < w) {
          sum -= src[row + k];
          cnt--;
        }
      }
      if (x >= r && x < w) {
        tmp[row + (x - r)] = sum / cnt;
      }
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let cnt = 0;
    for (let y = 0; y < h + r; y++) {
      if (y < h) {
        sum += tmp[y * w + x];
        cnt++;
      }
      if (y >= 2 * r + 1) {
        const k = y - 2 * r - 1;
        if (k >= 0 && k < h) {
          sum -= tmp[k * w + x];
          cnt--;
        }
      }
      if (y >= r && y < h) {
        out[(y - r) * w + x] = sum / cnt;
      }
    }
  }
  return out;
}

/** Deterministic PRNG (mulberry32) used for reproducible organic jitter. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Luminance of an 8-bit RGB pixel (Rec. 709). */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Smoothstep between 0 and 1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}
