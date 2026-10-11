import { describe, expect, test } from "bun:test";
import { segment } from "../src/lib/pipeline/segment.ts";

function makePhoto(
  bg: [number, number, number],
  product: [number, number, number],
  w = 40,
  h = 40,
) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const inside =
      i % w >= 8 && i % w < w - 8 && Math.floor(i / w) >= 8 && Math.floor(i / w) < h - 8;
    const c = inside ? product : bg;
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

describe("seg probe integration", () => {
  test("dump diag plus raw alpha region for the failing scene", () => {
    ;(globalThis as unknown as { __segDiag?: Record<string, number> }).__segDiag = {};

    const photo = makePhoto([210, 208, 202], [200, 60, 60]);
    const c = segment(photo, 40, 40, { tolerance: 26, softness: 2 });

    const diag = (globalThis as unknown as { __segDiag?: Record<string, number> }).__segDiag ?? {};

    let fg = 0;
    const rows: string[] = [];
    for (let y = 0; y < 40; y++) {
      const cells: string[] = [];
      for (let x = 0; x < 40; x++) {
        const a = c.alpha[(y * 40 + x) * 4 + 3];
        if (a >= 128) fg++;
        cells.push(a >= 128 ? "X" : ".");
      }
      rows.push(cells.join(""));
    }

    console.log(`fg=${fg}`);
    console.log(rows.join("\n"));
    console.log("DIAG:", JSON.stringify(diag));
    console.log("SHAVED_ROWS:");
    for (let y = 0; y < 40; y++) {
      const cells: string[] = [];
      for (let x = 0; x < 40; x++) {
        const p = (y * 40 + x) * 4;
        const a = c.alpha[p + 3];
        cells.push(a >= 128 ? `X${a}` : `.${a}`);
      }
      console.log(cells.join(" "));
    }
    console.log("BOX:", JSON.stringify(c.box));
    console.log("CAND0:", JSON.stringify(c.candidates[0] ? c.candidates[0].box : null));

    expect(c.box).toBeDefined();
  });
});
