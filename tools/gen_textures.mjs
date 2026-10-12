import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "canvas";

const W = 1920;
const H = 1080;

function noiseByte() {
  return Math.floor(Math.random() * 256);
}

function grainPath(outPath) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = noiseByte();
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log("wrote", outPath);
}

function smoothRandom(radius = 60) {
  const grid = new Float32Array((Math.ceil(W / radius) + 1) * (Math.ceil(H / radius) + 1));
  let k = 0;
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  return (x, y) => {
    const gx = x / radius;
    const gy = y / radius;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const ix = (x0 + 1) * (Math.ceil(H / radius) + 1) + (y0 + 1);
    const v =
      grid[x0 * (Math.ceil(H / radius) + 1) + y0] * (1 - fx) * (1 - fy) +
      grid[(x0 + 1) * (Math.ceil(H / radius) + 1) + y0] * fx * (1 - fy) +
      grid[x0 * (Math.ceil(H / radius) + 1) + (y0 + 1)] * (1 - fx) * fy +
      grid[(x0 + 1) * (Math.ceil(H / radius) + 1) + (y0 + 1)] * fx * fy;
    return v;
  };
}

function tealBloomPath(outPath) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const sample = smoothRandom(80);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2;
      const dy = y - H / 2;
      const dist = Math.sqrt(dx * dx + dy * dy) / (W * 0.6);
      const t = Math.max(0, 1 - dist);
      const grain = sample(x, y) * 0.06;
      const glow = Math.pow(t, 1.2) * 0.9;
      let r = 0;
      let g = 0.88 + glow * 0.12 + grain;
      let b = 0.82 + glow * 0.18 + grain;
      const a = glow * 0.5 + grain * 0.2;
      const idx = (y * W + x) * 4;
      d[idx] = Math.round(r * 255);
      d[idx + 1] = Math.round(Math.min(255, g * 255));
      d[idx + 2] = Math.round(Math.min(255, b * 255));
      d[idx + 3] = Math.round(Math.min(255, a * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log("wrote", outPath);
}

const mode = process.argv[2];
if (mode === "grain") {
  grainPath(process.argv[3] || "video/assets/textures/grain_1080p.png");
} else if (mode === "bloom") {
  tealBloomPath(process.argv[3] || "video/assets/textures/teal_bloom.png");
} else {
  console.log("usage: node tools/gen_textures.mjs grain|bloom [outPath]");
}
