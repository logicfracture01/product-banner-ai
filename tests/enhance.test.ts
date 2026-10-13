// Regression tests for the enhancement engine.
//
// The engine had no coverage, and carried a bug that made two of its stages
// (clarity and bloom) output an entirely black image: `convolve` was called
// with a single-channel luminance plane while indexing it with the RGBA stride,
// so it read past the end of the Float32Array, produced NaN, and NaN clamps to
// 0 in a Uint8ClampedArray. These tests pin the stride handling down.
import { describe, expect, test } from "bun:test";

import { enhanceImage, type EnhancePlan } from "../src/lib/pipeline/core/enhance";

function photo(w: number, h: number): { rgba: Uint8ClampedArray; width: number; height: number } {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = 60 + x * 3;
      rgba[i + 1] = 80 + y * 4;
      rgba[i + 2] = 140;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width: w, height: h };
}

function meanLuma(rgba: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return sum / (rgba.length / 4);
}

describe("enhance engine", () => {
  test("identity plan leaves the image byte-identical", async () => {
    const src = photo(16, 12);
    const out = await enhanceImage({}, src);
    expect(out.width).toBe(16);
    expect(out.height).toBe(12);
    for (let i = 0; i < src.rgba.length; i++) {
      expect(out.rgba[i]).toBe(src.rgba[i]);
    }
  });

  test("clarity does not blacken the frame (single-channel stride regression)", async () => {
    const src = photo(24, 18);
    const before = meanLuma(src.rgba);
    const out = await enhanceImage({ clarity: 0.6 }, src);
    const after = meanLuma(out.rgba);
    expect(after).toBeGreaterThan(before * 0.5);
    // every channel is a real number, not an artifact of NaN clamping
    for (let i = 0; i < out.rgba.length; i++) {
      expect(Number.isFinite(out.rgba[i])).toBe(true);
    }
  });

  test("bloom does not blacken the frame (single-channel stride regression)", async () => {
    const src = photo(24, 18);
    const before = meanLuma(src.rgba);
    const out = await enhanceImage({ bloom: 0.5 }, src);
    const after = meanLuma(out.rgba);
    expect(after).toBeGreaterThan(before * 0.5);
  });

  test("every plan key at maximum keeps values in range and the image alive", async () => {
    const src = photo(20, 16);
    const plan: EnhancePlan = {
      whitePoint: 1,
      blackPoint: 0,
      shadows: 0.5,
      midtones: 0,
      highlights: 0.5,
      tint: 0.2,
      exposure: 0.3,
      contrast: 1.2,
      hue: 10,
      sat: 1.2,
      lum: 0.1,
      clarity: 0.5,
      denoise: 0.5,
      sharpen: 0.8,
      grain: 0.2,
      vignette: 0.3,
      bloom: 0.4,
    };
    const out = await enhanceImage(plan, src);
    expect(meanLuma(out.rgba)).toBeGreaterThan(10);
    for (let i = 0; i < out.rgba.length; i++) {
      expect(out.rgba[i]).toBeGreaterThanOrEqual(0);
      expect(out.rgba[i]).toBeLessThanOrEqual(255);
    }
  });

  test("determinism: same plan and source give identical output", async () => {
    const src = photo(18, 14);
    const a = await enhanceImage({ clarity: 0.4, grain: 0.3, bloom: 0.2 }, src);
    const b = await enhanceImage({ clarity: 0.4, grain: 0.3, bloom: 0.2 }, src);
    for (let i = 0; i < a.rgba.length; i++) expect(a.rgba[i]).toBe(b.rgba[i]);
  });

  test("alpha channel is preserved (enhance must not erase transparency)", async () => {
    const src = photo(12, 12);
    for (let i = 0; i < 12 * 6; i++) src.rgba[i * 4 + 3] = 0;
    const out = await enhanceImage({ exposure: 0.5, clarity: 0.4 }, src);
    expect(out.rgba[0 * 4 + 3]).toBe(0);
    expect(out.rgba[(12 * 10) * 4 + 3]).toBe(255);
  });
});
