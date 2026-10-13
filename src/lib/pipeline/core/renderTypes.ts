// ============================================================================
// Render Types - shared parameter/analysis shapes for the render stage
// ============================================================================

/** Tunable pipeline parameters (mirrored by the banner compositor). */
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

/** A rendering flaw the adaptive-fix pass can act on. */
export interface DetectedFlaw {
  type: string;
  severity: number; // 0..1
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  description: string;
}
