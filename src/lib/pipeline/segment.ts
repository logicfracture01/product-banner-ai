// Custom product cutout engine — the custom-math fallback + refinement stage
// for the AI matting pipeline (see aiMatting.ts for the primary model).
//
// DATA FLOW (one `segmentPass` call):
//
//   rgba in
//     │
//     ├─ Stage 1  sobel() ──────────────► edge map (Float32 per pixel)
//     ├─ Stage 1  border ring ─► kmeans ► bg colour model (≤4 clusters + scale)
//     │
//     ├─ Stage 2  flood fill from the frame border, guided by the colour model
//     │           and stopped at strong edges → "bg" (proven background)
//     │
//     ├─ Stage 3  cleanup:
//     │             · shave  — drop product pixels that are really backdrop colour
//     │             · opening (erode 1 → dilate 1) — kill speckles + the 1px
//     │               anti-aliasing halo so the contour lands on the real edge
//     │             · 4-connected labelling, score, rank, keep the best
//     │             · closing (dilate 1 → erode 1) — seal pinholes
//     │             · fillHoles — make the mask solid
//     │
//     ├─ Stage 4  signed-distance alpha matting + edge decontamination, with the
//     │           source RGB carried through so style analysis can read colour
//     │
//     └─ Stage 5  full-frame Cutout { alpha, box, candidates, confidence }
//
// CONTRACT: `alpha` is always FULL FRAME (width × height of the input) so every
// consumer can index it with source coordinates. `box` carries the framing.

import { clamp255, distanceInside, distanceOutside } from "./pixels";

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

export interface SegmentOptions {
  tolerance?: number;
  softness?: number;
  noRetry?: boolean;
}

const INF = 1e9;

// ---------------------------------------------------------------- morph helpers

function boxErode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -r; dy <= r && v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h || !src[yy * w + x]) v = 0;
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dx = -r; dx <= r && v; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w || !tmp[y * w + xx]) v = 0;
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
      for (let dy = -r; dy <= r && !v; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && src[yy * w + x]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dx = -r; dx <= r && !v; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && tmp[y * w + xx]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Fill interior holes: background pixels not reachable from the border. */
function fillHoles(fg: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(fg.length);
  const stack = new Int32Array(fg.length);
  let sp = 0;
  for (let i = 0; i < outside.length; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      if (!fg[i] && !outside[i]) {
        outside[i] = 1;
        stack[sp++] = i;
      }
    }
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i / w) | 0;
    const nbr = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
    ];
    for (const j of nbr) {
      if (j < 0 || outside[j] || fg[j]) continue;
      outside[j] = 1;
      stack[sp++] = j;
    }
  }
  const out = new Uint8Array(fg.length);
  for (let i = 0; i < fg.length; i++) out[i] = fg[i] || !outside[i] ? 1 : 0;
  return out;
}

/** 4-connected component labelling. Returns per-pixel labels (or -1) + sizes. */
function components(fg: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: Uint32Array } {
  const labels = new Int32Array(fg.length).fill(-1);
  const stack = new Int32Array(fg.length);
  const sizeList: number[] = [];
  let sp = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!fg[i] || labels[i] >= 0) continue;
      const id = sizeList.length;
      let size = 0;
      labels[i] = id;
      stack[sp++] = i;
      while (sp > 0) {
        const j = stack[--sp];
        size++;
        const jx = j % w;
        const jy = (j / w) | 0;
        const nbr = [
          jx > 0 ? j - 1 : -1,
          jx < w - 1 ? j + 1 : -1,
          jy > 0 ? j - w : -1,
          jy < h - 1 ? j + w : -1,
        ];
        for (const n of nbr) {
          if (n < 0 || !fg[n] || labels[n] >= 0) continue;
          labels[n] = id;
          stack[sp++] = n;
        }
      }
      sizeList.push(size);
    }
  }
  return { labels, sizes: Uint32Array.from(sizeList) };
}

// ---------------------------------------------------------------- colour helpers

function unpackPacked(s: number): [number, number, number] {
  return [(s >> 16) & 255, (s >> 8) & 255, s & 255];
}

function packedLum(s: number): number {
  return ((s >> 16) & 255) + ((s >> 8) & 255) + (s & 255);
}

function bgDistance(
  r: number,
  g: number,
  b: number,
  centers: Array<[number, number, number]>,
): number {
  let best = INF;
  for (const [cr, cg, cb] of centers) {
    const dr = r - cr;
    const dg = g - cg;
    const db = b - cb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Deterministic k-means over packed RGB samples.
 * Seeded with luminance quantiles spread across the sample set, then refined
 * with Lloyd iterations. (The previous implementation seeded each cluster by
 * unpacking a *sample index* as if it were a colour, which produced nonsense
 * centroids for any non-uniform backdrop.)
 */
function kmeans(count: number, samples: Uint32Array, k = 4, iters = 10): Array<[number, number, number]> {
  if (count === 0) return [[255, 255, 255]];
  if (count <= k) {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < count; i++) out.push(unpackPacked(samples[i]));
    return out;
  }

  const order = Array.from({ length: count }, (_, i) => i);
  order.sort((a, b) => packedLum(samples[a]) - packedLum(samples[b]) || a - b);

  const centers: Array<[number, number, number]> = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.min(count - 1, Math.floor(((c + 0.5) / k) * count));
    centers.push(unpackPacked(samples[order[idx]]));
  }

  const assign = new Int32Array(count).fill(-1);
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    for (let i = 0; i < count; i++) {
      const [r, g, b] = unpackPacked(samples[i]);
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
      const [r, g, b] = unpackPacked(samples[i]);
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

/** Sobel gradient magnitude of the RGB image (a cheap local-contrast proxy). */
function sobel(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let gx = 0;
      let gy = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const p = ((y + dy) * w + (x + dx)) * 4;
          const l = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
          gx += l * kx[n];
          gy += l * ky[n];
          n++;
        }
      }
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  return out;
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

  // ---- Stage 1: edge map + background colour model -------------------------
  const edge = sobel(rgba, width, height);
  const EDGE_STRONG = 60; // seed rejection
  const EDGE_PASS = 35; // flood barrier

  // The colour model is built from a border ring only: the backdrop surrounds
  // the product at the frame edges, so the ring is the cleanest bg sample set.
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const maxSamples =
    Math.ceil(width / 2) * Math.ceil(ring / 2) * 2 * 2 +
    Math.ceil((height - 2 * ring) / 2) * Math.ceil(ring / 2) * 2 * 2;
  const samples = new Uint32Array(Math.max(1, maxSamples));
  let sc = 0;
  const addSample = (x: number, y: number) => {
    if (sc >= samples.length) return;
    const p = (y * width + x) * 4;
    samples[sc++] = ((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]) >>> 0;
  };
  for (let x = 0; x < width; x += 2) {
    for (let t = 0; t < ring; t += 2) {
      addSample(x, t);
      addSample(x, height - 1 - t);
    }
  }
  for (let y = ring; y < height - ring; y += 2) {
    for (let t = 0; t < ring; t += 2) {
      addSample(t, y);
      addSample(width - 1 - t, y);
    }
  }
  const bgCenters = kmeans(sc, samples);

  // ---- Stage 2: background flood fill -------------------------------------
  // `bg` is marked AT PUSH TIME so each pixel is enqueued once and the stack
  // can never overflow n and abort the fill part-way (which previously left
  // whole background regions classified as product).
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const enqueue = (idx: number) => {
    if (bg[idx]) return;
    bg[idx] = 1;
    stack[sp++] = idx;
  };

  for (let x = 0; x < width; x++) {
    if (edge[x] <= EDGE_STRONG) enqueue(x);
    const bottom = (height - 1) * width + x;
    if (edge[bottom] <= EDGE_STRONG) enqueue(bottom);
  }
  for (let y = 1; y < height - 1; y++) {
    const left = y * width;
    if (edge[left] <= EDGE_STRONG) enqueue(left);
    const right = y * width + width - 1;
    if (edge[right] <= EDGE_STRONG) enqueue(right);
  }

  const touchedEdges = new Set<number>();
  // `tolerance` is a colour distance in RGB units: a pixel within `tolerance` of
  // any modelled background colour is treated as backdrop. It must be generous
  // enough to absorb smooth gradients between k-means centroids (a gradient
  // background is otherwise never recognised and the entire frame reads as
  // foreground), while staying well below a real product's colour separation.
  const cutoff = tolerance;
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % width;
    const y = (i / width) | 0;
    if (x === 0) touchedEdges.add(1);
    if (y === 0) touchedEdges.add(2);
    if (x === width - 1) touchedEdges.add(3);
    if (y === height - 1) touchedEdges.add(4);

    const nbr = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const j of nbr) {
      if (j < 0 || bg[j]) continue;
      // A strong edge is the product silhouette: never walk through it.
      if (edge[j] > EDGE_PASS) continue;
      const q = j * 4;
      const dist = bgDistance(rgba[q], rgba[q + 1], rgba[q + 2], bgCenters);
      const edgeDamp = 1 - Math.min(1, edge[j] / EDGE_PASS) * 0.65;
      if (dist <= cutoff * edgeDamp) {
        enqueue(j);
      } else if (edge[j] <= EDGE_PASS * 0.55 && dist <= cutoff * 1.7) {
        // Weak edge + reasonably bg-coloured: accept so the flood can pierce
        // minor colour noise near a real edge instead of haloing around it.
        enqueue(j);
      }
    }
  }

  // ---- Stage 3: cleanup ---------------------------------------------------
  const fg0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg0[i] = bg[i] ? 0 : 1;

  // Shave: drop product pixels whose colour is essentially backdrop. Only
  // boundary-touching pixels are considered so interior detail is untouched.
  // Use a more aggressive shave to remove background-colored edges (like plates
  // that match the table color).
  const shaveCutoff = Math.max(4, cutoff * 0.7);
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
      if (bgDistance(rgba[p], rgba[p + 1], rgba[p + 2], bgCenters) < shaveCutoff) {
        shaved[i] = 0;
      }
    }
  }

  // Opening (erode 2 → dilate 2): more aggressive cleanup to remove thin
  // background connections (like plates touching tables) and small speckles.
  const opened = boxDilate(boxErode(shaved, width, height, 2), width, height, 2);
  const { labels, sizes } = components(opened, width, height);
  const compCount = sizes.length;
  const minSize = Math.max(24, n * 0.004);

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

  // Rank by size, centrality, border touch, and color separation from bg.
  // A full-frame component is almost always a leak, so it is heavily discounted.
  // Also penalize components that touch the frame border (likely background).
  const maxDist = Math.hypot(width, height) / 2;
  const scoreOf = (c: number): number => {
    const af = compArea[c] / n;
    const sizeScore = af >= 0.9 ? 0.05 : Math.min(1, af / 0.15);
    const ccx = compSumX[c] / compArea[c];
    const ccy = compSumY[c] / compArea[c];
    const centrality = Math.max(0, 1 - Math.hypot(ccx - width / 2, ccy - height / 2) / maxDist);
    const borderFrac = compArea[c] > 0 ? compBorder[c] / compArea[c] : 1;
    // Color separation: how different this component is from background model
    let sepSum = 0;
    let sepCount = 0;
    for (let y = compMinY[c]; y <= compMaxY[c] && sepCount < 1000; y++) {
      for (let x = compMinX[c]; x <= compMaxX[c] && sepCount < 1000; x++) {
        const i = y * width + x;
        if (fg[i]) {
          const p = i * 4;
          sepSum += bgDistance(rgba[p], rgba[p + 1], rgba[p + 2], bgCenters);
          sepCount++;
        }
      }
    }
    const meanSep = sepCount > 0 ? sepSum / sepCount : 0;
    const sepScore = Math.min(1, meanSep / 80);
    // Penalize components touching frame border (likely background)
    const borderPenalty = compBorder[c] > compArea[c] * 0.1 ? 0.3 : 0;
    return 0.4 * sizeScore + 0.25 * centrality + 0.2 * (1 - borderFrac) + 0.15 * sepScore - borderPenalty;
  };

  const keep = new Uint8Array(compCount);
  for (let c = 0; c < compCount; c++) keep[c] = sizes[c] >= minSize ? 1 : 0;
  if (keep.every((v) => v === 0) && compCount > 0) {
    // Nothing cleared the floor — keep the single largest component so a real
    // but small product still yields a cutout instead of an empty result.
    let big = 0;
    for (let c = 1; c < compCount; c++) if (sizes[c] > sizes[big]) big = c;
    keep[big] = 1;
  }

  // Build the fg mask BEFORE scoring so scoreOf can access it
  // (moved here for iterative rendering to work correctly)
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    fg[i] = l >= 0 && keep[l] ? 1 : 0;
  }

  const ranked: number[] = [];
  for (let c = 0; c < compCount; c++) if (keep[c]) ranked.push(c);
  ranked.sort((a, b) => scoreOf(b) - scoreOf(a));

  const candidates: DetectedObject[] = ranked.slice(0, 4).map((c) => ({
    box: {
      x: compMinX[c],
      y: compMinY[c],
      w: compMaxX[c] - compMinX[c] + 1,
      h: compMaxY[c] - compMinY[c] + 1,
    },
    area: compArea[c],
    score: scoreOf(c),
  }));

  // Closing (dilate 1 → erode 1) then fill: solid mask, contour unchanged.
  const closedPair = boxErode(boxDilate(fg, width, height, 1), width, height, 1);
  const filled = fillHoles(closedPair, width, height);

  // Degenerate case: the background model consumed every pixel, so nothing is
  // left to call a product. This happens when the subject genuinely fills the
  // frame (no backdrop to model) — and, indistinguishably, on a photo of a bare
  // wall. Both cases are better served by a full-frame opaque cutout than by a
  // silent empty result, which would render as a blank canvas downstream.
  let anyFg = false;
  for (let i = 0; i < n; i++) {
    if (filled[i]) {
      anyFg = true;
      break;
    }
  }
  if (!anyFg) filled.fill(1);

  // ---- Stage 4: signed-distance alpha matting ------------------------------
  // Signed distance to the mask boundary, in pixels: negative inside, positive
  // outside. Reuses the shared, tested chamfer helpers from ./pixels so this
  // engine and the shadow engine agree on the same distance metric.
  const distIn = distanceInside(filled, width, height); // 0 outside, ↑ inside
  const distOut = distanceOutside(filled, width, height); // 0 inside, ↑ outside

  const alpha = new Uint8ClampedArray(n * 4);
  let softPixels = 0;
  const softRange = Math.max(0.5, softness);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    // Carry the source RGB: analyzeCutout() and the banner renderer read it.
    alpha[p] = rgba[p];
    alpha[p + 1] = rgba[p + 1];
    alpha[p + 2] = rgba[p + 2];

    let a: number;
    if (filled[i]) {
      // Ramp 0 → 255 over `softRange` pixels measured inward from the contour.
      a = clamp255(Math.round((255 * Math.min(1, distIn[i] / softRange))));
    } else {
      // Outside is fully transparent. distOut is used only to keep the ramp
      // symmetric for potential future feathering.
      void distOut[i];
      a = 0;
    }
    alpha[p + 3] = a;
    if (a > 0 && a < 255) softPixels++;
  }

  // Edge decontamination (RGB ONLY — alpha is owned by the distance matte).
  // Semi-transparent pixels are a blend of product and backdrop, so their colour
  // is contaminated by the backdrop. Pull only the colour toward the nearest
  // fully-opaque product colour, weighted by (1 - alpha); coverage never moves,
  // which keeps the mask geometry and the IoU metric honest.
  {
    const fgSamples: number[] = [];
    for (let i = 0; i < n; i++) {
      if (alpha[i * 4 + 3] >= 250 && fgSamples.length < 128) {
        const p = i * 4;
        fgSamples.push((alpha[p] << 16) | (alpha[p + 1] << 8) | alpha[p + 2]);
      }
    }
    if (fgSamples.length) {
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const a = alpha[p + 3];
        if (a === 0 || a === 255) continue;
        const r = alpha[p];
        const g = alpha[p + 1];
        const b = alpha[p + 2];
        let best = 0;
        let bestD = INF;
        for (const s of fgSamples) {
          const dr = r - ((s >> 16) & 255);
          const dg = g - ((s >> 8) & 255);
          const db = b - (s & 255);
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        // More contaminated (lower alpha) → pushed harder toward product colour.
        const w = 0.7 * (1 - a / 255);
        alpha[p] = clamp255(Math.round(r + (((best >> 16) & 255) - r) * w));
        alpha[p + 1] = clamp255(Math.round(g + (((best >> 8) & 255) - g) * w));
        alpha[p + 2] = clamp255(Math.round(b + ((best & 255) - b) * w));
      }
    }
  }

  // ---- Stage 5: output -----------------------------------------------------
  // Full-frame alpha (see CONTRACT at the top of the file).
  let box: { x: number; y: number; w: number; h: number };
  if (candidates.length > 0) {
    box = candidates[0].box;
  } else {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alpha[(y * width + x) * 4 + 3] === 0) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    box = maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
      : { x: 0, y: 0, w: 0, h: 0 };
  }

  // Confidence blends three explainable signals: how far the product colour is
  // from the backdrop (separation), how much of the frame it fills (coverage),
  // and whether we actually locked onto a component (presence). It must be able
  // to rank a clean scene above an ambiguous one, so area alone is not enough.
  let fgPixels = 0;
  let sepSum = 0;
  for (let i = 0; i < n; i++) {
    if (!filled[i]) continue;
    fgPixels++;
    const p = i * 4;
    sepSum += bgDistance(rgba[p], rgba[p + 1], rgba[p + 2], bgCenters);
  }
  const coverage = fgPixels / n;
  const meanSep = fgPixels > 0 ? sepSum / fgPixels : 0;
  const sepScore = Math.min(1, meanSep / 150);
  const covScore = Math.min(1, coverage / 0.35);
  const presence = candidates.length > 0 ? 1 : 0;
  const confidence = fgPixels === 0
    ? 0
    : Math.max(0, Math.min(1, 0.45 * sepScore + 0.35 * covScore + 0.2 * presence));

  return {
    alpha,
    width,
    height,
    softPixels,
    touchedEdges,
    box,
    candidates,
    confidence,
  };
}

// ---------------------------------------------------------------- public API

export function segment(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: SegmentOptions = {},
): Cutout {
  const tolerance = opts.tolerance ?? 26;
  const softness = opts.softness ?? 2;

  const first = segmentPass(rgba, width, height, tolerance, softness);
  // If far too many pixels are semi-transparent the tolerance was probably too
  // loose and the fill leaked; retry once with a tighter setting.
  if (!opts.noRetry && first.softPixels > first.width * first.height * 0.18) {
    const retry = segmentPass(rgba, width, height, Math.max(8, tolerance - 6), Math.max(1, softness - 1));
    return {
      ...retry,
      candidates: retry.candidates.length ? retry.candidates : first.candidates,
      confidence: Math.max(retry.confidence, first.confidence * 0.7),
    };
  }
  return first;
}
