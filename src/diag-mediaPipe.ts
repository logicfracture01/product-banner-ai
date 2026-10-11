import manifest from "@mediapipe/tasks-vision";

const task = await manifest.ObjectDetector.createFromOptions(/* modelAssetPath, options */);
