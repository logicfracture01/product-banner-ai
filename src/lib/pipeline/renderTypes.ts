// ============================================================================
// Render Types - Shared types for iterative rendering
// ============================================================================

export interface DetectedFlaw {
  type: string;
  severity: number; // 0..1
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  description: string;
}

export interface RenderResult {
  url: string;
  revoke: () => void;
  flaws: DetectedFlaw[];
  qualityScore: number;
  complexity: {
    level: number;
    description: string;
  };
}

export interface RenderedImage {
  result: RenderResult;
  params: {
    tolerance: number;
    morphRadius: number;
    shaveMultiplier: number;
    shadowOpacity: number;
    shadowLength: number;
    shadowDirection: number;
    placementScale: number;
  };
  iteration: number;
  complexityLevel: number;
  mode: 1 | 2;
}

export interface ImageComplexity {
  level: number;
  description: string;
}

export interface AdaptiveFix {
  kind: string;
  value: number;
  reason: string;
}

// Pipeline parameters (mirrored by banner.ts / iterativeRender.ts)
export interface PipelineParams {
  tolerance: number;
  morphRadius: number;
  shaveMultiplier: number;
  shadowOpacity: number;
  shadowLength: number;
  shadowDirection: number;
  placementScale: number;
  backdropContrast?: number;
}

// Flaw types
export type FlawType =
  | 'background_bleed'
  | 'plate_connected'
  | 'shadow_missing'
  | 'missing_details'
  | 'halo_effect'
  | 'cutoff'
  | 'color_contamination';

export interface DetectedFlawDetailed extends DetectedFlaw {
  type: FlawType;
}
