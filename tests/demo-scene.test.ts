import { describe, expect, test } from "bun:test";
import { DEMO_FALLBACK_BOX, isDegenerateCutout } from "../src/lib/pipeline/demo";

/**
 * The demo scene is procedural, so its geometry is known exactly. These tests
 * guard the safety net that keeps the hero/sample from ever rendering a
 * broken banner when the segmenter degenerates.
 */

// Scene dimensions in src/lib/pipeline/demo.ts (W × H).
const SCENE_W = 860;
const SCENE_H = 645;

describe("demo cutout degeneracy", () => {
  test("whole-frame leak is degenerate", () => {
    expect(isDegenerateCutout({ x: 0, y: 0, w: SCENE_W, h: SCENE_H }, SCENE_W, SCENE_H)).toBe(true);
  });

  test("wide-but-short box (border-clipped product) is degenerate", () => {
    expect(isDegenerateCutout({ x: 0, y: 300, w: SCENE_W, h: 40 }, SCENE_W, SCENE_H)).toBe(true);
  });

  test("near-empty detection is degenerate", () => {
    expect(isDegenerateCutout({ x: 400, y: 300, w: 20, h: 20 }, SCENE_W, SCENE_H)).toBe(true);
  });

  test("zero/negative box is degenerate", () => {
    expect(isDegenerateCutout({ x: 10, y: 10, w: 0, h: 0 }, SCENE_W, SCENE_H)).toBe(true);
    expect(isDegenerateCutout({ x: 10, y: 10, w: -5, h: 50 }, SCENE_W, SCENE_H)).toBe(true);
  });

  test("a plausible product cutout is NOT degenerate", () => {
    expect(isDegenerateCutout(DEMO_FALLBACK_BOX, SCENE_W, SCENE_H)).toBe(false);
  });

  test("the laptop's known box sits inside the scene", () => {
    const b = DEMO_FALLBACK_BOX;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(SCENE_W);
    expect(b.y + b.h).toBeLessThanOrEqual(SCENE_H);
  });

  test("the fallback box is centred enough to frame well", () => {
    const cx = DEMO_FALLBACK_BOX.x + DEMO_FALLBACK_BOX.w / 2;
    const cy = DEMO_FALLBACK_BOX.y + DEMO_FALLBACK_BOX.h / 2;
    // Product centre should be near the scene centre (within 15% each axis).
    expect(Math.abs(cx - SCENE_W / 2)).toBeLessThan(SCENE_W * 0.15);
    expect(Math.abs(cy - SCENE_H / 2)).toBeLessThan(SCENE_H * 0.15);
  });

  test("scale-invariant: predicate holds on a downscaled frame", () => {
    const b = DEMO_FALLBACK_BOX;
    const s = 0.5;
    const half = { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s };
    expect(isDegenerateCutout(half, SCENE_W * s, SCENE_H * s)).toBe(false);
  });
});