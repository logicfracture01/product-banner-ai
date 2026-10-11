// Custom product cutout engine — the custom-math fallback + refinement stage
// for the AI matting pipeline (see aiMatting.ts for the primary model).
//
// DATA FLOW (one `segmentPass` call):
//
//   rgba in
//     │
//     ├─ Stage 1  sobel() ──────────────► edge map (Float32 per pixel)
//     ├─ Stage 1  border ring ─► kmeans ► bg color model (≤4 clusters + scale)
//     │
//     ├─ Stage 2  flood fill from borders, guided by the color model and
//     │           damped near strong edges → "flood" binary (bg = 1)
//     │
//     ├─ Stage 3  morphological cleanup:
//     │             · shave by color (remove fg pixels whose color is
//     │               too close to bg clusters)
//     │             · opening (erode 1, dilate 1) — kill sub-3px speckles
//     │               and strip the ~1px anti-aliasing halo left by the
//     │               sobel-based fill, so the contour lands on the real
//     │               product edge rather than on its blend fringe.
//     │             · connected-component labeling, score, rank, keep top
//     │             · closing (dilate 1, erode 1) — seal pinholes
//     │             · fill holes
//     │
//     ├─ Stage 4  signed-distance transform of "filled" → alpha matting
//     │           (soft edge band = softness px inside the contour; full
//     │           opacity inside, fully transparent outside)
//     │           + edge-decontamination (push semi-transparent pixels
//     │           toward the nearest pure-opaque / pure-transparent sample)
//     │
//     └─ Stage 5  crop to bbox → Cutout { alpha, box, candidates }

import { boxBlur3, clamp255, mulberry32, boxDilate8 } from "./pixels";

// Re-export the public schema so the rest of the app can import it from here.
export interface Cutout {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  softPixels: number;
  touchedEdges: Set<number>;
  box: { x: number; y: number; w: number; h: number };
  candidates: DetectedObject[];
  confidence: number;
}

export interface DetectedObject {
  box: { x: number; y: number; w: number; h: number };
  area: number;
  score: number;
}

// ---------------------------------------------------------------- constants

const INF = 1e9;

// ---------------------------------------------------------------- morph helpers (generic; used by segment + upscale)

function boxErode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h || !src[yy * w + x]) {
          v = 0;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w || !tmp[y * w + xx]) {
          v = 0;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function boxDilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && src[yy * w + x]) {
          v = 1;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && tmp[y * w + xx]) {
          v = 1;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Chebyshev-ish chamfer distance inside the given binary mask. */
function distanceInside(fg: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(fg.length);
  for (let i = 0; i < fg.length; i++) d[i] = fg[i] ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] < INF) continue;
      let rx = x;
      for (; rx < w; rx++) if (!fg[i]) break;
      let ry = y;
      for (; ry < h; ry++) if (!fg[ry * w + x]) break;
      for (let iy = y; iy < ry; iy++) {
        for (let ix = x; ix < rx; ix++) {
          d[iy * w + ix] = Math.min(d[iy * w + ix], (iy - y) ** 2 + (ix - x) ** 2);
        }
      }
      x = rx - 1;
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] < INF) continue;
      let rx = x;
      for (; rx >= 0; rx--) if (!fg[i]) break;
      let ry = y;
      for (; ry >= 0; ry--) if (!fg[ry * w + x]) break;
      for (let iy = y; iy >= ry; iy--) {
        for (let ix = x; ix >= rx; ix--) {
          d[iy * w + ix] = Math.min(d[iy * w + ix], (iy - y) ** 2 + (ix - x) ** 2);
        }
      }
      x = rx + 1;
    }
  }

  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

function distanceOutside(fg: Uint8Array, w: number, h: number): Float32Array {
  const outside = new Uint8Array(fg.length);
  const stack = new Int32Array(fg.length);
  let sp = 0;
  for (let i = 0; i < outside.length; i++) {
    if (i < w || i % w === 0 || i % w === w - 1 || i >= outside.length - w) {
      if (!fg[i]) {
        outside[i] = 1;
        stack[sp++] = i;
      }
    }
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i / w) | 0;
    const nbrs = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
    ];
    for (const j of nbrs) {
      if (j < 0 || outside[j] || fg[j]) continue;
      outside[j] = 1;
      stack[sp++] = j;
    }
  }
  const d = new Float32Array(fg.length);
  for (let i = 0; i < d.length; i++) d[i] = outside[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] < INF) continue;
      const rx = Math.min(w, x + 4);
      const ry = Math.min(h, y + 4);
      for (let iy = Math.max(0, y - 4); iy < ry; iy++) {
        for (let ix = Math.max(0, x - 4); ix < rx; ix++) {
          if (outside[iy * w + ix]) {
            d[i] = Math.min(d[i], (iy - y) ** 2 + (ix - x) ** 2);
          }
        }
      }
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Signed-distance field: negative = inside fg, positive = outside. */
function signedDistance(fg: Uint8Array, w: number, h: number): Float32Array {
  const inside = distanceInside(fg, w, h);
  const outside = distanceOutside(fg, w, h);
  const out = new Float32Array(fg.length);
  for (let i = 0; i < fg.length; i++) out[i] = fg[i] ? -inside[i] : outside[i];
  return out;
}

/** Fill interior holes using boundary-connected BFS. */
function fillHoles(fg: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(fg.length);
  const stack = new Int32Array(fg.length);
  let sp = 0;
  for (let i = 0; i < outside.length; i++) {
    if (i < w || i % w === 0 || i % w === w - 1 || i >= outside.length - w) {
      if (!fg[i]) {
        outside[i] = 1;
        stack[sp++] = i;
      }
    }
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i / w) | 0;
    const nbrs = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
    ];
    for (const j of nbrs) {
      if (j < 0 || outside[j] || fg[j]) continue;
      outside[j] = 1;
      stack[sp++] = j;
    }
  }
  const out = new Uint8Array(fg.length);
  for (let i = 0; i < fg.length; i++) out[i] = fg[i] || !outside[i] ? 1 : 0;
  return out;
}

/** 4-connected component labeling. */
function components(fg: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: Uint32Array } {
  const labels = new Int32Array(fg.length).fill(-1);
  const sizes: number[] = [0];
  const equiv: number[] = [0];
  const stack = new Int32Array(fg.length);
  let next = 0;
  let sp = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!fg[i] || labels[i] >= 0) continue;
      next++;
      if (next >= labels.length) {
        const nn = Math.max(64, next * 2);
        labels.fill(-1, next, nn);
      }
      labels[i] = next - 1;
      sizes.push(1);
      equiv.push(next - 1);
      stack[sp++] = i;
      while (sp > 0) {
        const j = stack[--sp];
        const jx = j % w;
        const jy = (j / w) | 0;
        const nbrs = [
          jx > 0 && fg[j - 1] && labels[j - 1] < 0 ? j - 1 : -1,
          jx < w - 1 && fg[j + 1] && labels[j + 1] < 0 ? j + 1 : -1,
          jy > 0 && fg[j - w] && labels[j - w] < 0 ? j - w : -1,
          jy < h - 1 && fg[j + w] && labels[j + w] < 0 ? j + w : -1,
        ];
        for (const n of nbrs) {
          if (n < 0) continue;
          if (labels[n] >= 0) {
            const r = labels[n];
            if (r !== next - 1 && equiv[r] !== next - 1) {
              equiv[r] = next - 1;
            }
            continue;
          }
          next++;
          if (next >= labels.length) {
            const nn = Math.max(64, next * 2);
            labels.fill(-1, next, nn);
          }
          labels[n] = next - 1;
          sizes.push(1);
          equiv.push(next - 1);
          stack[sp++] = n;
        }
      }
    }
  }
  for (let i = 0; i < equiv.length; i++) {
    if (equiv[i] !== i) {
      let t = i;
      while (equiv[t] !== t) t = equiv[t];
      equiv[i] = equiv[t];
    }
  }
  const final = new Int32Array(labels.length).fill(-1);
  const finalSizes = new Uint32Array(1);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    let root = labels[i];
    while (equiv[root] !== root) root = equiv[root];
    if (final[root] < 0) final[root] = finalSizes.length - 1;
    final[i] = final[root];
    finalSizes[final[root]]++;
  }
  return { labels: final, sizes: finalSizes };
}

// ---------------------------------------------------------------- color helpers

function unpackPacked(s: number): [number, number, number] {
  return [(s >> 16) & 255, (s >> 8) & 255, s & 255];
}

function bgDistance(
  r: number,
  g: number,
  b: number,
  centers: Array<[number, number, number]>,
  scale: [number, number, number],
): number {
  let best = INF;
  const ar: [number, number, number] = [r, g, b];
  for (const [cr, cg, cb] of centers) {
    const dr = ar[0] - cr;
    const dg = ar[1] - cg;
    const db = ar[2] - cb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- main pass

function segmentPass(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance: number,
  softness: number,
): Cutout {
  const n = width * height;

  // ---- Stage 1: edge map + background color model -------------------------
  // Background model is built ONLY from a border ring, not the full image.
  // This keeps the bg clusters anchored to the actual backdrop (which usually
  // surrounds the product at the frame edges) and avoids the product itself
  // contaminating the color model.
  const edge = sobel(rgba, width, height);
  const EDGE_STRONG = 60;

  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const maxSamples = Math.ceil(width / 2) * Math.ceil(ring / 2) * 2 * 2 + Math.ceil((height - 2 * ring) / 2) * Math.ceil(ring / 2) * 2 * 2;
  const samples = new Uint32Array(maxSamples);
  let sc = 0;
  const addSample = (x: number, y: number) => {
    if (sc >= maxSamples) return;
    const p = (y * width + x) * 4;
    samples[sc++] = ((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) >>> 0;
  };
  // top + bottom border strips
  for (let x = 0; x < width; x += 2) {
    for (let t = 0; t < ring; t += 2) {
      addSample(x, t);
      addSample(x, height - 1 - t);
    }
  }
  // left + right border strips (excluding the already-sampled corners)
  for (let y = ring; y < height - ring; y += 2) {
    for (let t = 0; t < ring; t += 2) {
      addSample(t, y);
      addSample(width - 1 - t, y);
    }
  }
  const bgCenters = kmeans(sc, samples);

  // Per-channel sigma for the bg clusters → adaptive color distance scale.
  // Far-apart bg clusters (e.g. a two-tone backdrop) widen the tolerance,
  // tight clusters tighten it — so one global tolerance works on more scenes.
  const scale: [number, number, number] = [12, 12, 12];
  {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (const [r, g, b] of bgCenters) {
      sr += r;
      sg += g;
      sb += b;
    }
    const mr = sr / bgCenters.length;
    const mg = sg / bgCenters.length;
    const mb = sb / bgCenters.length;
    let vr = 0;
    let vg = 0;
    let vb = 0;
    for (const [r, g, b] of bgCenters) {
      vr += (r - mr) ** 2;
      vg += (g - mg) ** 2;
      vb += (b - mb) ** 2;
    }
    scale[0] = Math.max(8, Math.sqrt(vr / bgCenters.length) * 0.75 + 6);
    scale[1] = Math.max(8, Math.sqrt(vg / bgCenters.length) * 0.75 + 6);
    scale[2] = Math.max(8, Math.sqrt(vb / bgCenters.length) * 0.75 + 6);
  }

  // ---- Stage 2: flood fill from outside, guided by bg color model ---------
  // Start from the frame border and walk inward while pixels are plausibly bg
  // (low sobel + close to one of the bg clusters). This gives a much cleaner
  // "definitely-background" seed than a pure-edge threshold.
  const flood = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;

  // Seed from border pixels that aren't strong edges.
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      if (edge[y * width + x] > EDGE_STRONG) continue;
      stack[sp++] = y * width + x;
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      if (edge[y * width + x] > EDGE_STRONG) continue;
      stack[sp++] = y * width + x;
    }
  }

  const touchedEdges = new Set<number>();
  const cutoff = tolerance / 12;
  while (sp > 0) {
    const i = stack[--sp];
    flood[i] = 1;
    const x = i % width;
    const y = (i / width) | 0;
    if (x === 0) touchedEdges.add(1);
    if (y === 0) touchedEdges.add(2);
    if (x === width - 1) touchedEdges.add(3);
    if (y === height - 1) touchedEdges.add(4);
    const p = i * 4;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
      const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (flood[j]) continue;
      if (edge[j] > EDGE_STRONG) continue;
      const q = j * 4;
      const dist = bgDistance(rgba[q], rgba[q + 1], rgba[q + 2], bgCenters, scale);

      const edgeDamp = 1 - Math.min(1, edge[j] / EDGE_STRONG) * 0.65;
      if (dist <= cutoff * edgeDamp) {
        stack[sp++] = j;
      }
    }
    if (sp >= n) break;
  }

  // ---- Stage 3: cleanup ---------------------------------------------------
  // fg0 = 1 where we have NOT yet proven it's background.
  const fg0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg0[i] = flood[i] ? 0 : 1;

  // Shave: fg pixels that touch the bg and whose color is too close to bg
  // clusters are probably fringed / near-transparent and shouldn't count as
  // product. This is the first line of defense against blend halos.
  const shaveCutoff = cutoff * 0.5;
  const shaved = new Uint8Array(fg0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!fg0[i]) continue;
      const touchesBg =
        (x > 0 && !fg0[i - 1]) ||
        (x < width - 1 && !fg0[i + 1]) ||
        (y > 0 && !fg0[i - width]) ||
        (y < height - 1 && !fg0[i + width]);
      if (!touchesBg) continue;
      const p = i * 4;
      if (bgDistance(rgba[p], rgba[p + 1], rgba[p + 2], bgCenters, scale) < shaveCutoff) {
        shaved[i] = 0;
      }
    }
  }

  // Opening (erode 1 + dilate 1): strips the remaining 1px blend halo and
  // kills sub-3px speckles in one move.
  const opened = boxErode(boxDilate(shaved, width, height, 1), width, height, 1);
  const { labels, sizes } = components(opened, width, height);
  const minSize = Math.max(24, n * 0.004);
  const compCount = sizes.length;

  // Aggregate per-component geometry + statistics.
  const compArea = new Float64Array(compCount);
  const compSumX = new Float64Array(compCount);
  const compSumY = new Float64Array(compCount);
  const compMinX = new Int32Array(compCount).fill(width);
  const compMinY = new Int32Array(compCount).fill(height);
  const compMaxX = new Int32Array(compCount).fill(-1);
  const compMaxY = new Int32Array(compCount).fill(-1);
  const compBorder = new Float64Array(compCount);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = labels[i];
      if (l < 0) continue;
      compArea[l]++;
      compSumX[l] += x;
      compSumY[l] += y;
      if (x < compMinX[l]) compMinX[l] = x;
      if (y < compMinY[l]) compMinY[l] = y;
      if (x > compMaxX[l]) compMaxX[l] = x;
      if (y > compMaxY[l]) compMaxY[l] = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) compBorder[l]++;
    }
  }

  // Score candidates by a blend of:
  //   · size (bigger is better, but once >85% of frame we assume full-bleed
  //     and penalize, since a true product cutout is usually a smaller subject)
  //   · centrality (product tends to be near frame center)
  //   · border contact (a component touching the frame edge is probably a
  //     crop artifact / backdrop bleed, not the product)
  const maxDist = Math.hypot(width, height) / 2;
  const scoreOf = (c: number): number => {
    const af = compArea[c] / n;
    const sizeScore = af >= 0.85 ? 0.15 : Math.min(1, af / 0.18);
    const ccx = compSumX[c] / compArea[c];
    const ccy = compSumY[c] / compArea[c];
    const centrality = 1 - Math.hypot(ccx - width / 2, ccy - height / 2) / maxDist;
    const borderFrac = compArea[c] > 0 ? compBorder[c] / compArea[c] : 1;
    return 0.55 * sizeScore + 0.3 * Math.max(0, centrality) + 0.15 * (1 - borderFrac);
  };

  const keep = new Uint8Array(compCount);
  for (let c = 0; c < compCount; c++) {
    keep[c] = sizes[c] >= minSize ? 1 : 0;
  }
  if (keep.every((v) => v === 0) && compCount > 0) {
    let big = 0;
    for (let c = 1; c < compCount; c++) if (sizes[c] > sizes[big]) big = c;
    keep[big] = 1;
  }

  const ranked: number[] = [];
  for (let c = 0; c < compCount; c++) if (keep[c]) ranked.push(c);
  ranked.sort((a, b) => scoreOf(b) - scoreOf(a));
  const candidates: DetectedObject[] = ranked.slice(0, 4).map((c) => ({
    box: { x: compMinX[c], y: compMinY[c], w: compMaxX[c] - compMinX[c] + 1, h: compMaxY[c] - compMinY[c] + 1 },
    area: compArea[c],
    score: scoreOf(c),
  }));
  const primary = ranked.length > 0 ? ranked[0] : -1;

  // Rebuild the kept mask from the labeled components.
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    fg[i] = l >= 0 && keep[l] ? 1 : 0;
  }

  // Closing (dilate 1 + erode 1): seals pinholes and gaps without growing
  // the contour (net-neutral on straight edges — critical for IoU accuracy).
  const closedPair = boxDilate(boxErode(fg, width, height, 1), width, height, 1);
  const filled = fillHoles(closedPair, width, height);

  // ---- Stage 4: signed-distance alpha matting + decontamination ------------
  const alpha = new Uint8ClampedArray(n * 4);
  let softPixels = 0;
  const sd = signedDistance(filled, width, height);

  // Soften the edge band according to the `softness` parameter.
  const softRange = 1 + softness;
  const softDenom = softRange * softRange;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const s = sd[i];
    if (s <= -0.5) {
      alpha[p + 3] = 255;
    } else if (s >= softRange) {
      alpha[p + 3] = 0;
    } else {
      const t = s / softRange;
      alpha[p + 3] = clamp255(Math.round((1 - t * t) * 255));
      if (alpha[p + 3] > 0 && alpha[p + 3] < 255) softPixels++;
    }
  }

  // Edge-decontamination: sample the pure-opaque and pure-transparent pixels,
  // then pull semi-transparent pixels toward whichever side they're more
  // similar to. This removes the washed-out fringe a naive alpha ramp leaves
  // on hair / glass / fine product edges.
  {
    const fgSample = new Uint32Array(64);
    const bgSample = new Uint32Array(64);
    let fgCount = 0;
    let bgCount = 0;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const a = alpha[p + 3];
        if (a >= 250 && a <= 255) {
          const packed = ((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) >>> 0;
          if (fgCount < fgSample.length) fgSample[fgCount++] = packed;
        } else if (a >= 0 && a <= 5) {
          const packed = ((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) >>> 0;
          if (bgCount < bgSample.length) bgSample[bgCount++] = packed;
        }
      }
    }
    const fgL = fgSample.slice(0, fgCount);
    const bgL = bgSample.slice(0, bgCount);

    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const a = alpha[p + 3];
      if (a >= 250 || a <= 5) continue;
      const packed = ((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) >>> 0;
      const r = (packed >> 16) & 255;
      const g = (packed >> 8) & 255;
      const b = packed & 255;

      let fgBest = INF;
      for (let k = 0; k < fgL.length; k++) {
        const s = fgL[k];
        const dr = r - ((s >> 16) & 255);
        const dg = g - ((s >> 8) & 255);
        const db = b - (s & 255);
        const d = dr * dr + dg * dg + db * db;
        if (d < fgBest) fgBest = d;
      }
      const fgDist = Math.sqrt(fgBest);

      let bgBest = INF;
      for (let k = 0; k < bgL.length; k++) {
        const s = bgL[k];
        const dr = r - ((s >> 16) & 255);
        const dg = g - ((s >> 8) & 255);
        const db = b - (s & 255);
        const d = dr * dr + dg * dg + db * db;
        if (d < bgBest) bgBest = d;
      }
      const bgDist = Math.sqrt(bgBest);

      const total = fgDist + bgDist;
      const fgFrac = total > 0 ? fgDist / total : 0.5;
      const targetA = Math.round((1 - fgFrac) * 255);

      const blended = Math.round(a * 0.6 + targetA * 0.4);
      alpha[p + 3] = clamp255(blended);
      if (alpha[p + 3] > 0 && alpha[p + 3] < 255) softPixels++;
    }
  }

  // ---- Stage 5: crop + output ---------------------------------------------
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alpha[(y * width + x) * 4 + 3];
      if (a === 0) continue;
      const i4 = (y * width + x) * 4;
      if (alpha[i4] === 0 && alpha[i4 + 1] === 0 && alpha[i4 + 2] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX > maxX || minY > maxY) {
    return {
      alpha: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      softPixels: 0,
      touchedEdges,
      box: { x: 0, y: 0, w: 0, h: 0 },
      candidates,
      confidence: 0,
    };
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = y + minY;
    for (let x = 0; x < cw; x++) {
      const sx = x + minX;
      const si = (sy * width + sx) * 4;
      const di = (y * cw + x) * 4;
      out[di] = alpha[si];
      out[di + 1] = alpha[si + 1];
      out[di + 2] = alpha[si + 2];
      out[di + 3] = alpha[si + 3];
    }
  }

  const primaryBox = primary >= 0 ? candidates[primary] : null;
  const box = primaryBox ? primaryBox.box : { x: minX, y: minY, w: cw, h: ch };

  let fgCount = 0;
  for (let c = 0; c < compCount; c++) {
    if (keep[c]) fgCount += sizes[c];
  }
  const confidence = compCount > 0 ? Math.min(1, (fgCount / n) * 5 + (primary >= 0 ? 0.5 : 0)) : 0;

  return {
    alpha: out,
    width: cw,
    height: ch,
    softPixels,
    touchedEdges,
    box,
    candidates,
    confidence,
  };
}

// ---------------------------------------------------------------- public API

export interface SegmentOptions {
  tolerance?: number;
  softness?: number;
  noRetry?: boolean;
}

export function segment(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: SegmentOptions = {},
): Cutout {
  const tolerance = opts.tolerance ?? 26;
  const softness = opts.softness ?? 2;

  const first = segmentPass(rgba, width, height, tolerance, softness);
  if (!opts.noRetry && first.softPixels > first.width * first.height * 0.18) {
    const retry = segmentPass(rgba, width, height, Math.max(8, tolerance - 6), Math.max(1, softness - 1));
    return {
      ...retry,
      candidates: first.candidates,
      confidence: Math.max(retry.confidence, first.confidence * 0.7),
    };
  }
  return first;
}

// ---------------------------------------------------------------- internal: kmeans, sobel

function kmeans(
  count: number,
  samples: Uint32Array,
): Array<[number, number, number]> {
  if (count === 0) return [[255, 255, 255]];
  const k = 4;
  if (count <= k) {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < count; i++) out.push(unpackPacked(samples[i]));
    return out;
  }

  const keyed = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const lum = ((s >> 16) & 255) + ((s >> 8) & 255) + (s & 255);
    keyed[i] = (lum << 22) | i;
  }
  const sorted = keyed.slice().sort();
  const unpack = unpackPacked;

  const centers: Array<[number, number, number]> = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.min(
      sorted.length - 1,
      Math.floor(((c + 0.5) / k) * sorted.length),
    );
    centers.push(unpack(sorted[idx] & 0x3fffff));
  }

  const assign = new Uint8Array(count);
  const iters = 10;
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    for (let i = 0; i < count; i++) {
      const [r, g, b] = unpack(samples[i]);
      let bi = 0;
      let bd = INF;
      for (let c = 0; c < centers.length; c++) {
        const [cr, cg, cb] = centers[c];
        const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        moved = true;
      }
    }
    if (!moved && iter > 0) break;
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i++) {
      const a = sums[assign[i]];
      const [r, g, b] = unpack(samples[i]);
      a[0] += r;
      a[1] += g;
      a[2] += b;
      a[3] += 1;
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c];
      if (s[3] === 0) continue;
      centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
  }

  return centers;
}

function sobel(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const gx = [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1],
  ];
  const gy = [
    [-1, -2, -1],
    [0, 0, 0],
    [1, 2, 1],
  ];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let rx = 0;
      let gx_ = 0;
      let bx = 0;
      let rgy = 0;
      let ggy = 0;
      let bgy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const p = ((y + ky) * w + (x + kx)) * 4;
          const r = rgba[p];
          const g = rgba[p + 1];
          const b = rgba[p + 2];
          rx += r * gx[ky + 1][kx + 1];
          gx_ += g * gx[ky + 1][kx + 1];
          bx += b * gx[ky + 1][kx + 1];
          rgy += r * gy[ky + 1][kx + 1];
          ggy += g * gy[ky + 1][kx + 1];
          bgy += b * gy[ky + 1][kx + 1];
        }
      }
      const mag = Math.sqrt(
        (rx * rx + gx_ * gx_ + bx * bx) / 3 +
        (rgy * rgy + ggy * ggy + bgy * bgy) / 3,
      );
      out[y * w + x] = mag;
    }
  }
  return out;
}
