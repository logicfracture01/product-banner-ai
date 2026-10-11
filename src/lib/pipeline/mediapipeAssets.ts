// MediaPipe Tasks Vision asset locations.
//
// WHY THIS FILE EXISTS: the Wasm runtime must match the installed
// `@mediapipe/tasks-vision` JS bundle exactly — a version skew between the
// bundle and the .wasm binary fails at runtime with an unhelpful abort. Both
// were previously hardcoded independently and pointed at local paths that were
// never shipped (`/mediapipe-tasks-vision/wasm`), so the detector could not
// load in ANY environment.
//
// The version is pinned here and asserted against the installed package by
// tests/object-detection.test.ts, so it can never silently drift.
//
// Everything is fetched from public CDNs (both send `Access-Control-Allow-
// Origin: *`), which means nothing model-sized is baked into the deploy and
// the Vercel function/memory budget is untouched.

/** Must equal the version in package.json's @mediapipe/tasks-vision entry. */
export const TASKS_VISION_VERSION = "1.1.0";

/** jsDelivr base for the Wasm runtime (version-locked to the TS bundle). */
export const TASKS_VISION_WASM_BASE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

/**
 * EfficientDet-Lite0 object detector (COCO 80 classes), float16 — the smallest
 * published Lite0 variant at ~7.2 MB, which matters on the low-end devices this
 * app targets. Hosted by Google on the public mediapipe-models bucket.
 */
export const OBJECT_DETECTOR_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/" +
  "efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

/** Confidence floor for keeping a detection (MediaPipe's own default is 0.5). */
export const DETECTION_SCORE_THRESHOLD = 0.3;

/** Cap on detections returned per frame — we only ever frame one subject. */
export const DETECTION_MAX_RESULTS = 5;
