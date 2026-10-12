// ============================================================================
// relight-pipeline: Complete image processing pipeline from ground zero
// ============================================================================
// Architecture:
//   1. objectDetection.ts  - Find main subject using MediaPipe or color analysis
//   2. segmentation.ts    - Extract foreground with edge-guided flood fill
//   3. aiMatting.ts       - AI-powered matting with BiRefNet (optional enhancement)
//   4. upscale.ts         - Detail-preserving upscale (Catmull-Rom bicubic)
//   5. shadow.ts          - Physically-based shadow rendering
//   6. design.ts          - Generative backdrop matching product palette
//   7. banner.ts          - Compose final image: backdrop + shadow + product
//   8. styles.ts          - Output style definitions and recommendations
// ============================================================================

export * from './objectDetection';
export * from './segmentation';
export * from './aiMatting';
export * from './upscale';
export * from './shadow';
export * from './design';
export * from './banner';
export * from './styles';
