// Procedural demo scene: a "messy phone photo" of a laptop on a sunlit
// wooden deck. Drawn with raw canvas 2D — no image assets, fully
// deterministic, so the hero demo and the studio sample are pixel-identical.
//
// The product (silver laptop, dark graphite) is deliberately high-contrast
// against the warm deck so the on-device color-model segmenter can lift it
// cleanly; everything else is designed to be *messy but separable*.

let cachedBefore: string | null = null;

const W = 860;
const H = 645;

export function getDemoBefore(): string {
  if (cachedBefore) return cachedBefore;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // ---- deck planks (top-down-ish angle, sun from upper-left) -------------
  const base = ctx.createLinearGradient(0, 0, W * 0.6, H);
  base.addColorStop(0, "#c8a274");
  base.addColorStop(0.5, "#b08d61");
  base.addColorStop(1, "#8f6f48");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(20261002);
  // plank bands with slightly varied tone + seams
  const plankH = 92;
  for (let i = 0; i * plankH < H; i++) {
    const y = i * plankH;
    ctx.fillStyle = i % 2 ? "#a9855a" : "#bd9264";
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, y, W, plankH - 2);
    // seam shadow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#6d5334";
    ctx.fillRect(0, y + plankH - 3, W, 3);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#e8cfa8";
    ctx.fillRect(0, y + plankH, W, 1);
  }
  ctx.globalAlpha = 1;

  // wood grain
  ctx.globalAlpha = 0.13;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 130; i++) {
    const y = rng() * H;
    const x = rng() * W;
    const len = 60 + rng() * 220;
    ctx.strokeStyle = rng() > 0.5 ? "#5d4527" : "#d8b585";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + len * 0.3, y + 3, x + len * 0.7, y - 3, x + len, y);
    ctx.stroke();
  }
  // knots
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 4; i++) {
    const x = rng() * W;
    const y = rng() * H;
    for (let r = 16; r > 2; r -= 5) {
      ctx.strokeStyle = "#5d4527";
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---- clutter around the laptop ---------------------------------------
  drawMug(ctx, 118, 168, 0.95);
  drawPhone(ctx, 742, 152, -0.42);
  drawNotebook(ctx, 690, 470, 0.1);
  drawPen(ctx, 168, 520, -0.16, "#e0563f");
  drawSunglasses(ctx, 620, 176, 0.16);
  drawCable(ctx, 96, 372);
  drawCrumbSpecks(ctx, rng, 46);
  drawLeaf(ctx, 806, 596, 0.5);

  // ---- the product: silver laptop, open, slight 3/4 view ---------------
  drawLaptop(ctx, 430, 330);

  // ---- light: hard-ish window sun from upper-left + warm bounce --------
  const sun = ctx.createRadialGradient(150, 60, 20, 300, 240, 720);
  sun.addColorStop(0, "rgba(255,246,214,0.42)");
  sun.addColorStop(0.5, "rgba(255,240,205,0.14)");
  sun.addColorStop(1, "rgba(255,236,200,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  // ---- lens: slight cool cast in shadows, warm highlights --------------
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const n2 = mulberry32(4242);
  for (let i = 0; i < d.length; i += 4) {
    // sensor noise (a touch stronger in the shadows, like real ISO)
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    const g = (n2() - 0.5) * (9 + 9 * (1 - lum));
    d[i] = Math.max(0, Math.min(255, d[i] + g));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g));
  }
  ctx.putImageData(img, 0, 0);

  // ---- vignette + a bit of lens softness at the frame edge --------------
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 1.02);
  vig.addColorStop(0, "rgba(24,12,2,0)");
  vig.addColorStop(1, "rgba(24,12,2,0.34)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  cachedBefore = c.toDataURL("image/jpeg", 0.84);
  return cachedBefore;
}

/** Recompose the demo: run cutout + banner pipeline over the messy scene. */
export async function renderDemoAfter(
  place: { x: number; y: number; scale: number },
  opts: { backdrop: string; shadow: import("./shadow").ShadowOptions },
): Promise<DemoRender> {
  const before = getDemoBefore();
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("demo image failed"));
    img.src = before;
  });

  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);

  const { segment } = await import("./segment");
  const cutout = segment(data.data, cv.width, cv.height, { tolerance: 30 });

  // Never ship a broken demo: a degenerate cutout falls back to the laptop's
  // known bounding box.
  const finalCutout = isDegenerateCutout(cutout.box, cv.width, cv.height)
    ? boxCutout(data.data, cv.width, cv.height, DEMO_FALLBACK_BOX)
    : cutout;

  const out = document.createElement("canvas");
  out.width = 1080;
  out.height = 1350;
  const octx = out.getContext("2d")!;
  const { drawBanner } = await import("./banner");
  drawBanner(octx, finalCutout, place, {
    backdrop: opts.backdrop as never,
    ratio: "4:5",
    shadow: opts.shadow,
  });

  return encodePreview(out, out.width, out.height, 0.92);
}

/**
 * Encode a full-resolution canvas for on-screen display.
 *
 * `toDataURL("image/png")` on a 1080×1350 canvas costs ~150ms of blocking
 * main-thread base64 encoding and produces a ~1.5 MB string. `convertToBlob`
 * encodes off the interaction path and hands back a cheap object URL; the
 * synchronous JPEG path is only a fallback.
 */
export async function encodePreview(
  source: HTMLCanvasElement,
  sw: number,
  sh: number,
  quality: number,
): Promise<DemoRender> {
  const pw = sw;
  const ph = sh;
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const oc = new OffscreenCanvas(pw, ph);
      const octx = oc.getContext("2d");
      if (octx) {
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        octx.drawImage(source, 0, 0, pw, ph);
        const blob = await oc.convertToBlob({ type: "image/jpeg", quality });
        const url = URL.createObjectURL(blob);
        return { url, revoke: () => URL.revokeObjectURL(url) };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    url: source.toDataURL("image/jpeg", quality),
    revoke: () => {},
  };
}

/** Where the laptop lands in the 1080×1350 banner. */
export const DEMO_PLACE = { x: 540, y: 1010, scale: 0.66 };

/**
 * Bounding box of the laptop inside the procedural scene, in scene pixels.
 * Used as a safety net wherever the demo photo is cut out — the scene is
 * procedural and deterministic, so this box is exact.
 */
export const DEMO_FALLBACK_BOX = { x: 136, y: 154, w: 562, h: 302 };

export type Box = { x: number; y: number; w: number; h: number };

/**
 * A cutout is *degenerate* when the segmenter grabbed the whole frame
 * (background leak), or found something too small in either axis to frame as
 * a banner subject. Both make for a broken result, so callers fall back to
 * {@link DEMO_FALLBACK_BOX}.
 *
 * Thresholds are fractional so the test is scale-invariant, and so a frame
 * that has already been downscaled by the studio (or upscaled by the detail
 * boost) is judged identically to the raw scene.
 *
 * Exported (and pure) so the hero and the studio sample share one definition
 * and so it can be unit-tested without a canvas.
 */
export function isDegenerateCutout(box: Box, frameW: number, frameH: number): boolean {
  if (box.w <= 0 || box.h <= 0) return true;
  // Background leaked across the whole frame.
  if (box.w >= frameW * 0.9 && box.h >= frameH * 0.9) return true;
  // Too thin/small on an axis to be a believable subject.
  return box.w < frameW * 0.08 || box.h < frameH * 0.08;
}

/** Rendered demo banner plus the revoker for its object URL. */
export type DemoRender = { url: string; revoke: () => void };

/**
 * Build a soft-edged cutout from a known box. A 2px feather on the corners
 * keeps the fallback from reading as a hard rectangle when it IS used.
 */
export function boxCutout(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  box: { x: number; y: number; w: number; h: number },
): import("./segment").Cutout {
  const alpha = new Uint8ClampedArray(w * h * 4);
  const feather = 2;
  const { x, y, w: bw, h: bh } = box;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = (yy * w + xx) * 4;
      const dx = Math.max(x - xx, xx - (x + bw), 0);
      const dy = Math.max(y - yy, yy - (y + bh), 0);
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, Math.min(1, 1 - (d - 0.5) / feather)) * 255;
      alpha[i] = src[i];
      alpha[i + 1] = src[i + 1];
      alpha[i + 2] = src[i + 2];
      alpha[i + 3] = a;
    }
  }
  return {
    alpha,
    width: w,
    height: h,
    softPixels: feather * (bw + bh) * 2,
    touchedEdges: new Set(),
    box,
    candidates: [{ box, area: bw * bh, score: 1 }],
    confidence: 0.5,
  };
}

// ---- scene helpers ---------------------------------------------------------

/**
 * Open laptop seen from a low 3/4 angle: lid + brushed-metal screen well,
 * aluminium chassis, keyboard deck with key grid and trackpad, plus the
 * soft contact shadow that the pipeline will re-light on the clean banner.
 */
function drawLaptop(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.translate(cx, cy);
  // slight perspective skew so it doesn't read as a flat sticker
  ctx.transform(1, 0, -0.13, 1, 0, 0);

  const HW = 232; // half width of the chassis
  const lidTop = -168;
  const deckY = 26;

  // cast shadow on the deck (part of the messy photo)
  ctx.fillStyle = "rgba(48,28,10,0.26)";
  ctx.beginPath();
  ctx.ellipse(34, deckY + 54, HW + 44, 34, 0.02, 0, Math.PI * 2);
  ctx.fill();

  // ---- lid / screen back panel -----------------------------------------
  const lidGrad = ctx.createLinearGradient(-HW, lidTop, HW, deckY);
  lidGrad.addColorStop(0, "#e8eaee");
  lidGrad.addColorStop(0.42, "#c3c8d0");
  lidGrad.addColorStop(1, "#8f959e");
  ctx.fillStyle = lidGrad;
  ctx.beginPath();
  ctx.roundRect(-HW, lidTop, HW * 2, deckY - lidTop + 12, 12);
  ctx.fill();

  // inner bezel + screen
  const bez = 13;
  ctx.fillStyle = "#1c1f24";
  ctx.beginPath();
  ctx.roundRect(-HW + bez, lidTop + bez - 4, HW * 2 - bez * 2, deckY - lidTop - bez + 6, 7);
  ctx.fill();

  const scr = ctx.createLinearGradient(-HW, lidTop, HW * 0.4, deckY);
  scr.addColorStop(0, "#33445c");
  scr.addColorStop(0.45, "#1f2a3a");
  scr.addColorStop(1, "#141a24");
  ctx.fillStyle = scr;
  ctx.beginPath();
  ctx.roundRect(-HW + bez + 6, lidTop + bez + 2, HW * 2 - (bez + 6) * 2, deckY - lidTop - bez * 2 - 2, 4);
  ctx.fill();

  // fake UI on the screen: a photo-viewer window (ties into the product story)
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.roundRect(-HW + 46, lidTop + 44, HW - 70, deckY - lidTop - 96, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(244,178,62,0.55)";
  ctx.fillRect(-HW + 46, lidTop + 44, HW - 70, 12);
  ctx.fillStyle = "rgba(45,212,191,0.42)";
  ctx.beginPath();
  ctx.roundRect(-HW + 58, lidTop + 68, 74, 52, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.24)";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(-HW + 142, lidTop + 70 + i * 13, 52 - (i % 2) * 14, 5);
  }
  // camera dot
  ctx.fillStyle = "#0a0d11";
  ctx.beginPath();
  ctx.arc(0, lidTop + 6, 3.1, 0, Math.PI * 2);
  ctx.fill();

  // glass reflection sweeping across the lid
  const gloss = ctx.createLinearGradient(-HW, lidTop, HW * 0.2, deckY);
  gloss.addColorStop(0, "rgba(255,255,255,0.30)");
  gloss.addColorStop(0.35, "rgba(255,255,255,0.06)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.roundRect(-HW, lidTop, HW * 2, deckY - lidTop + 12, 12);
  ctx.fill();

  // ---- keyboard deck ---------------------------------------------------
  const deckGrad = ctx.createLinearGradient(-HW, deckY - 10, HW, deckY + 74);
  deckGrad.addColorStop(0, "#d7dbe1");
  deckGrad.addColorStop(0.5, "#aeb4bd");
  deckGrad.addColorStop(1, "#7e848d");
  ctx.fillStyle = deckGrad;
  ctx.beginPath();
  ctx.moveTo(-HW - 6, deckY);
  ctx.lineTo(HW + 10, deckY);
  ctx.lineTo(HW + 44, deckY + 74);
  ctx.quadraticCurveTo(0, deckY + 92, -HW - 40, deckY + 74);
  ctx.closePath();
  ctx.fill();

  // keyboard well
  ctx.fillStyle = "rgba(28,32,38,0.92)";
  ctx.beginPath();
  ctx.moveTo(-HW + 22, deckY + 8);
  ctx.lineTo(HW - 4, deckY + 8);
  ctx.lineTo(HW + 6, deckY + 46);
  ctx.lineTo(-HW + 2, deckY + 46);
  ctx.closePath();
  ctx.fill();
  // key grid (perspective-compressed)
  ctx.fillStyle = "rgba(226,230,236,0.34)";
  for (let r = 0; r < 4; r++) {
    const y = deckY + 12 + r * 8.6;
    const inset = 26 + r * 1.5;
    for (let k = 0; k < 13; k++) {
      const x = -HW + inset + k * 13.6;
      ctx.fillRect(x, y, 10, 5.4);
    }
  }
  // trackpad
  ctx.fillStyle = "rgba(226,230,236,0.22)";
  ctx.beginPath();
  ctx.roundRect(-64, deckY + 54, 128, 26, 4);
  ctx.fill();

  // front edge highlight (the "lip" of the chassis)
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-HW - 38, deckY + 72);
  ctx.quadraticCurveTo(0, deckY + 90, HW + 42, deckY + 72);
  ctx.stroke();

  // engraved logo dot on the lid back
  ctx.fillStyle = "rgba(60,66,74,0.5)";
  ctx.beginPath();
  ctx.arc(HW - 30, lidTop + 34, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawMug(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(48,28,10,0.28)";
  ctx.beginPath();
  ctx.ellipse(12, 74, 62, 15, 0.05, 0, Math.PI * 2);
  ctx.fill();
  // handle
  ctx.strokeStyle = "#cfc9c1";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.arc(50, 4, 26, -1.2, 1.2);
  ctx.stroke();
  // body
  const body = ctx.createLinearGradient(-46, -62, 50, 68);
  body.addColorStop(0, "#efeae2");
  body.addColorStop(0.55, "#d5cfc6");
  body.addColorStop(1, "#a9a298");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-46, -62);
  ctx.lineTo(46, -62);
  ctx.quadraticCurveTo(52, 24, 38, 66);
  ctx.lineTo(-38, 66);
  ctx.quadraticCurveTo(-52, 24, -46, -62);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e6e1da";
  ctx.beginPath();
  ctx.ellipse(0, -62, 47, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#40382f";
  ctx.beginPath();
  ctx.ellipse(0, -62, 39, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-32, -46);
  ctx.quadraticCurveTo(-38, 0, -30, 48);
  ctx.stroke();
  ctx.restore();
}

function drawPhone(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(48,28,10,0.26)";
  ctx.beginPath();
  ctx.roundRect(-30, -54, 66, 118, 12);
  ctx.fill();
  ctx.fillStyle = "#22252a";
  ctx.beginPath();
  ctx.roundRect(-34, -58, 66, 118, 12);
  ctx.fill();
  const scr = ctx.createLinearGradient(-30, -50, 30, 50);
  scr.addColorStop(0, "#40608c");
  scr.addColorStop(1, "#1d2c42");
  ctx.fillStyle = scr;
  ctx.beginPath();
  ctx.roundRect(-29, -53, 56, 108, 7);
  ctx.fill();
  ctx.fillStyle = "#101319";
  ctx.beginPath();
  ctx.roundRect(-12, -49, 22, 6, 3);
  ctx.fill();
  // cracked-corner glare
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.moveTo(-29, -53);
  ctx.lineTo(-4, -53);
  ctx.lineTo(-29, -22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawNotebook(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(48,28,10,0.22)";
  ctx.beginPath();
  ctx.roundRect(-84, -58, 178, 124, 7);
  ctx.fill();
  ctx.fillStyle = "#33506f";
  ctx.beginPath();
  ctx.roundRect(-88, -62, 178, 124, 7);
  ctx.fill();
  ctx.fillStyle = "#d9d2c5";
  ctx.beginPath();
  ctx.roundRect(-82, -56, 166, 112, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,105,85,0.45)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-68, -34 + i * 19);
    ctx.lineTo(70, -34 + i * 19);
    ctx.stroke();
  }
  ctx.strokeStyle = "#7c4a2c";
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-82, -56);
  ctx.bezierCurveTo(-30, -18, 24, 34, 72, 46);
  ctx.stroke();
  ctx.restore();
}

function drawPen(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(48,28,10,0.24)";
  ctx.beginPath();
  ctx.roundRect(-2, 3, 92, 8, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, -4, 86, 9, 4.5);
  ctx.fill();
  ctx.fillStyle = "#eceae4";
  ctx.beginPath();
  ctx.roundRect(80, -3.4, 13, 7.4, 3.5);
  ctx.fill();
  ctx.fillStyle = "#26282c";
  ctx.beginPath();
  ctx.moveTo(92, -2);
  ctx.lineTo(102, 0);
  ctx.lineTo(92, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSunglasses(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(48,28,10,0.2)";
  ctx.beginPath();
  ctx.ellipse(4, 16, 78, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  const lens = ctx.createLinearGradient(0, -18, 0, 14);
  lens.addColorStop(0, "#3a4658");
  lens.addColorStop(1, "#1b2330");
  ctx.fillStyle = lens;
  ctx.beginPath();
  ctx.roundRect(-74, -16, 62, 32, [16, 16, 12, 12]);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(12, -16, 62, 32, [12, 12, 16, 16]);
  ctx.fill();
  ctx.strokeStyle = "#2b333f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-12, -2);
  ctx.lineTo(12, -2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-74, -8);
  ctx.lineTo(-104, -18);
  ctx.moveTo(74, -8);
  ctx.lineTo(104, -18);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.roundRect(-66, -12, 44, 10, 5);
  ctx.fill();
  ctx.restore();
}

/** Tangled charging cable — the kind of thing that's always in the shot. */
function drawCable(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(52,54,58,0.85)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + 90, y - 60, x + 20, y + 80, x + 130, y + 40);
  ctx.bezierCurveTo(x + 210, y + 8, x + 150, y + 130, x + 236, y + 96);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawCrumbSpecks(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  n: number,
) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const s = 1 + rng() * 2.4;
    ctx.fillStyle = `rgba(${60 + rng() * 60},${45 + rng() * 40},${28 + rng() * 26},${0.2 + rng() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const g = ctx.createLinearGradient(0, 0, -50, 26);
  g.addColorStop(0, "#3f8f5f");
  g.addColorStop(1, "#276b43");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-34, 22, -56, 4);
  ctx.quadraticCurveTo(-32, -18, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(20,60,36,0.55)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(-52, 4);
  ctx.stroke();
  ctx.restore();
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}