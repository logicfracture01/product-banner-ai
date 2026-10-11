// On-device relighting model.

import type { Cutout } from "./segment";

export type Light = {
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  kind: "key" | "fill" | "rim" | "ambient" | "env";
  size?: number;
};

export type RelightPreset =
  | "soft-box"
  | "hard-sun"
  | "moody-side"
  | "ring"
  | "overcast";

export type SurfaceSample = {
  normal: [number, number, number];
  base: [number, number, number];
  roughness: number;
  position: [number, number, number];
};

function ggxD(nDotH: number, roughness: number): number {
  const a = roughness * roughness;
  const a2 = a * a;
  const denom = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (Math.PI * denom * denom);
}

function ggxG1(nDotV: number, roughness: number): number {
  const a = roughness * roughness;
  const k = a / 2;
  return nDotV / (nDotV * (1 - k) + k);
}

function ggxG(nDotV: number, nDotL: number, roughness: number): number {
  return ggxG1(nDotV, roughness) * ggxG1(nDotL, roughness);
}

function schlickF0(): number {
  return 0.04;
}

function brdf(
  surf: SurfaceSample,
  L: [number, number, number],
  V: [number, number, number],
  lightColor: [number, number, number],
  lightIntensity: number,
): [number, number, number] {
  const N = surf.normal;
  const nDotL = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
  if (nDotL <= 0) return [0, 0, 0];

  const diffuse = 1 / Math.PI;
  const base = surf.base;
  const diff = [
    base[0] * diffuse * nDotL,
    base[1] * diffuse * nDotL,
    base[2] * diffuse * nDotL,
  ];

  const Vc = V;
  const nDotV = Math.max(0.001, Vc[0] * N[0] + Vc[1] * N[1] + Vc[2] * N[2]);
  const Lsum = Math.hypot(L[0] + Vc[0], L[1] + Vc[1], L[2] + Vc[2]) || 1;
  const H = [
    (L[0] + Vc[0]) / Lsum,
    (L[1] + Vc[1]) / Lsum,
    (L[2] + Vc[2]) / Lsum,
  ];
  const nDotH = Math.max(0.001, N[0] * H[0] + N[1] * H[1] + N[2] * H[2]);
  const spec = ggxD(nDotH, surf.roughness) * ggxG(nDotV, nDotL, surf.roughness) / (4 * nDotV * nDotL);
  const f0 = schlickF0();
  const VdotN = Math.max(0, Vc[0] * N[0] + Vc[1] * N[1] + Vc[2] * N[2]);
  const fresnel = f0 + (1 - f0) * Math.pow(1 - VdotN, 5);

  const specColor = [
    fresnel * spec,
    fresnel * spec,
    fresnel * spec,
  ];

  return [
    (diff[0] + specColor[0]) * lightColor[0] * lightIntensity,
    (diff[1] + specColor[1]) * lightColor[1] * lightIntensity,
    (diff[2] + specColor[2]) * lightColor[2] * lightIntensity,
  ];
}

export function integrate(
  surf: SurfaceSample,
  lights: Light[],
  V: [number, number, number] = [0, 0, 1],
): [number, number, number] {
  const out = [0, 0, 0];
  for (const L of lights) {
    const dir = L.position;
    const intensity = L.intensity * (L.size ? 1 + L.size * 0.3 : 1);
    const col = brdf(surf, dir, V, L.color, intensity);
    out[0] += col[0];
    out[1] += col[1];
    out[2] += col[2];
  }
  const ambient = lights.find((l) => l.kind === "ambient");
  if (ambient) {
    const aCol = brdf(surf, [0, 0, 1], V, ambient.color, ambient.intensity * 0.25);
    out[0] += aCol[0];
    out[1] += aCol[1];
    out[2] += aCol[2];
  }
  return [out[0], out[1], out[2]] as [number, number, number];
}

export function estimateSurface(cutout: Cutout, bgColor: [number, number, number] = [0.5, 0.5, 0.5]): SurfaceSample[] {
  const { alpha, width: w, height: h } = cutout;
  const n = w * h;
  const samples = new Array<SurfaceSample>(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = alpha[p + 3];
    const isFg = a > 128;
    if (isFg) {
      const r = alpha[p], g = alpha[p + 1], b = alpha[p + 2];
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const roughness = 0.4 + (1 - l) * 0.2;
      samples[i] = {
        normal: [0, 0, 1],
        base: [r / 255, g / 255, b / 255],
        roughness,
        position: [0, 0, 1],
      };
    } else {
      samples[i] = {
        normal: [0, 0, 1],
        base: bgColor,
        roughness: 0.6,
        position: [0, 0, 1],
      };
    }
  }
  return samples;
}

export function renderRelight(
  samples: SurfaceSample[],
  w: number,
  h: number,
  lights: Light[],
  viewDir: [number, number, number] = [0, 0, 1],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = samples[i];
    const rgb = integrate(s, lights, viewDir);
    const p = i * 4;
    out[p] = Math.round(255 * rgb[0]);
    out[p + 1] = Math.round(255 * rgb[1]);
    out[p + 2] = Math.round(255 * rgb[2]);
    out[p + 3] = 255;
  }
  return out;
}

export function lightsForPreset(preset: RelightPreset): Light[] {
  switch (preset) {
    case "soft-box":
      return [
        { position: [0.3, 0.2, 1], color: [1, 0.98, 0.95], intensity: 1.6, kind: "key", size: 0.5 },
        { position: [-0.4, 0.3, 0.8], color: [0.95, 0.96, 1], intensity: 0.5, kind: "fill", size: 0.3 },
        { position: [0, -1, 0.3], color: [0.6, 0.6, 0.65], intensity: 0.3, kind: "rim", size: 0.2 },
        { position: [0, 0, 1], color: [0.5, 0.5, 0.55], intensity: 0.35, kind: "ambient", size: 0 },
      ];
    case "hard-sun":
      return [
        { position: [0.6, 0.1, 1], color: [1, 0.97, 0.9], intensity: 2.2, kind: "key", size: 0.08 },
        { position: [-0.6, 0, 0.7], color: [0.8, 0.82, 0.9], intensity: 0.25, kind: "fill", size: 0.05 },
        { position: [0, -1, 0.2], color: [0.55, 0.55, 0.6], intensity: 0.2, kind: "rim" },
        { position: [0, 0, 1], color: [0.4, 0.4, 0.45], intensity: 0.2, kind: "ambient" },
      ];
    case "moody-side":
      return [
        { position: [-1, 0.1, 0.7], color: [0.95, 0.93, 1], intensity: 1.2, kind: "key", size: 0.2 },
        { position: [0.5, -0.2, 0.6], color: [0.4, 0.38, 0.5], intensity: 0.35, kind: "fill", size: 0.15 },
        { position: [0, -1, 0.3], color: [0.35, 0.32, 0.4], intensity: 0.3, kind: "rim" },
        { position: [0, 0, 1], color: [0.18, 0.17, 0.22], intensity: 0.25, kind: "ambient" },
      ];
    case "ring":
      return [
        { position: [0, 0.5, 1], color: [1, 0.99, 0.98], intensity: 1.8, kind: "key", size: 0.7 },
        { position: [0, -0.6, 0.4], color: [0.7, 0.7, 0.75], intensity: 0.25, kind: "rim" },
        { position: [0, 0, 1], color: [0.5, 0.5, 0.52], intensity: 0.3, kind: "ambient" },
      ];
    case "overcast":
      return [
        { position: [0, 0.8, 0.6], color: [0.92, 0.93, 0.96], intensity: 0.8, kind: "key", size: 1 },
        { position: [0, -1, 0.3], color: [0.85, 0.86, 0.9], intensity: 0.25, kind: "fill", size: 0.5 },
        { position: [0, 0, 1], color: [0.6, 0.6, 0.62], intensity: 0.4, kind: "ambient", size: 0.5 },
      ];
  }
}

export type LightingLookup = {
  azimuthTable: Float32Array;
  elevationTable: Float32Array;
  roughnessTable: Float32Array;
};

export function buildLightingLookupTable(resolution: number = 64): LightingLookup {
  const size = resolution;
  const azimuthTable = new Float32Array(size);
  const elevationTable = new Float32Array(size);
  const roughnessTable = new Float32Array(size);
  const fakeSurface: SurfaceSample = {
    normal: [0, 0, 1],
    base: [0.7, 0.7, 0.7],
    roughness: 0.3,
    position: [0, 0, 1],
  };
  const V: [number, number, number] = [0, 0, 1];
  for (let i = 0; i < size; i++) {
    const az = (i / (size - 1)) * 2 * Math.PI;
    const el = 0.3 + (i / (size - 1)) * 0.8;
    const L = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const Lnorm = Math.hypot(L[0], L[1], L[2]);
    const Ln: [number, number, number] = [L[0] / Lnorm, L[1] / Lnorm, L[2] / Lnorm] as [number, number, number];
    const col = brdf(fakeSurface, Ln, V, [1, 1, 1], 1);
    const lum = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
    azimuthTable[i] = lum;
    elevationTable[i] = lum;
    roughnessTable[i] = lum;
  }
  return { azimuthTable, elevationTable, roughnessTable };
}

export function previewRelight(cutout: Cutout, preset: RelightPreset): Uint8ClampedArray {
  const samples = estimateSurface(cutout);
  const lights = lightsForPreset(preset);
  return renderRelight(samples, cutout.width, cutout.height, lights);
}
