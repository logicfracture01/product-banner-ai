#!/usr/bin/env -S node --enable-source-maps
/**
 * Bounded production render of the 60-second relight demo timeline.
 *
 * The full 60s @ 24fps = 1440 seek+screenshot frames through headless Chromium
 * exceeds this host's single-command timeout, so we render the master as ten
 * 6-second segments (144 frames each) and stitch them deterministically with
 * ffmpeg concat, then mux in the synthesized audio.
 *
 * Outputs (all in video/):
 *  seg-00.mp4 .. seg-09.mp4        ten 6s video segments (t=0-6, 6-12, ..., 54-60)
 *  concat-list.txt                 ffmpeg concat manifest
 *  relight-demo-60s-video.mp4     video-only master (1440 frames, 60.000s)
 *  audio-60s.wav                   synthesized stereo audio (already present; re-used)
 *  relight-demo-60s.mp4           final master with audio muxed (h264 + aac)
 *  loop-demo-60s.mp4              first 6s loop cut
 *  frame-0000.png                 first frame proof (t=0)
 *  frame-1439.png                 last frame proof (t=59.958)
 *  render-60s-segments.log        full log of this driver
 */
import { execSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VIDEO = join(ROOT, "video");

const SEG_COUNT = 10;
const SEG_SECONDS = 6;
const FPS = 24;
const TOTAL = 60;
const OUT_MASTER = join(VIDEO, "relight-demo-60s.mp4");
const OUT_VIDEO_ONLY = join(VIDEO, "relight-demo-60s-video.mp4");
const OUT_LOOP = join(VIDEO, "loop-demo-60s.mp4");
const OUT_FIRST = join(VIDEO, "frame-0000.png");
const OUT_LAST = join(VIDEO, "frame-1439.png");
const AUDIO_WAV = join(VIDEO, "audio-60s.wav");
const LOG = join(VIDEO, "render-60s-segments.log");

function log(line) {
  const s = typeof line === "string" ? line : String(line);
  writeFileSync(LOG, LOG_CONTENT + s + "\n", "utf8");
  process.stdout.write(s + "\n");
}
let LOG_CONTENT = "";

function sh(cmd, timeoutMs = 180_000) {
  log(`$ ${cmd}`);
  const r = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
  });
  if (r.stderr) log(r.stderr.trim());
  if (r.stdout) log(r.stdout.trim());
  if (r.status !== 0) {
    throw new Error(`command failed (status ${r.status}): ${cmd}`);
  }
  return r.stdout;
}

function ffprobe(path, fields) {
  const cmd = [
    "ffprobe",
    "-v", "error",
    "-show_entries", fields,
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ].join(" ");
  const out = sh(cmd, 30_000).trim();
  return out;
}

const start = new Date().toISOString();
log(`=== render-60s-segments started at ${start} ===`);

try {
  // ------------------------------------------------------------------
  // 0. Preconditions
  // ------------------------------------------------------------------
  log("prechecks:");
  log("  demo.html TOTAL=60 patch present:",
    readFileSync(join(VIDEO, "demo.html"), "utf8").includes("const TOTAL = 60.0;")
      ? "yes" : "NO");
  log("  make-demo-video.mjs patched for output file:",
    readFileSync(join(__dirname, "make-demo-video.mjs"), "utf8").includes("ffmpegArgv.push(out)")
      ? "yes" : "NO");
  log("  audio-60s.wav present:", existsSync(AUDIO_WAV) ? "yes" : "NO");
  log("  audio-60s.wav duration:", existsSync(AUDIO_WAV)
    ? ffprobe(AUDIO_WAV, "format=duration").split("\n").join(" ")
    : "N/A");

  // ------------------------------------------------------------------
  // 1. Clean prior outputs so success is unambiguous
  // ------------------------------------------------------------------
  for (const name of [
    "seg-*.mp4", "concat-list.txt",
    "relight-demo-60s-video.mp4", "relight-demo-60s.mp4",
    "loop-demo-60s.mp4", "frame-0000.png", "frame-1439.png",
  ]) {
    try {
      execSync(`rm -f "${join(VIDEO, name)}"`, { stdio: "pipe" });
    } catch {}
  }
  log("cleaned prior segment/master/loop/frame artifacts");

  // ------------------------------------------------------------------
  // 2. Render ten 6s segments
  // ------------------------------------------------------------------
  log(`rendering ${SEG_COUNT} segments of ${SEG_SECONDS}s each (${SEG_COUNT * SEG_SECONDS}s total)`);
  for (let i = 0; i < SEG_COUNT; i++) {
    const startTime = i * SEG_SECONDS;
    const segOut = join(VIDEO, `seg-${String(i).padStart(2, "0")}.mp4`);
    log(`--- segment ${i}: t=${startTime}-${startTime + SEG_SECONDS}s -> ${segOut} ---`);
    const cmd = [
      "node", join(__dirname, "make-demo-video.mjs"),
      "--total", String(TOTAL),
      "--seconds", String(SEG_SECONDS),
      "--no-audio",
      "--out", segOut,
    ].join(" ");
    // Each segment is bounded and short; still give it a generous timeout.
    sh(cmd, 240_000);
    // Verify each segment immediately so a bad one stops us before concat.
    const frames = ffprobe(segOut, "stream=nb_read_frames:format=duration");
    log(`  segment ${i} verified: frames=${frames}`);
  }

  // ------------------------------------------------------------------
  // 3. Concat manifest
  // ------------------------------------------------------------------
  const manifestPath = join(VIDEO, "concat-list.txt");
  const lines = [];
  for (let i = 0; i < SEG_COUNT; i++) {
    lines.push(`file '${join(VIDEO, `seg-${String(i).padStart(2, "0")}.mp4`)}'`);
  }
  writeFileSync(manifestPath, lines.join("\n") + "\n", "utf8");
  log(`wrote concat manifest: ${manifestPath}`);

  // ------------------------------------------------------------------
  // 4. Concat into video-only master
  // ------------------------------------------------------------------
  log(`concatenating segments -> ${OUT_VIDEO_ONLY}`);
  sh([
    "ffmpeg", "-hide_banner", "-y",
    "-f", "concat", "-safe", "0", "-i", manifestPath,
    "-c", "copy",
    OUT_VIDEO_ONLY,
  ].join(" "), 120_000);
  const vframes = ffprobe(OUT_VIDEO_ONLY, "stream=nb_read_frames:format=duration:stream=codec_type");
  log(`video-only master: ${vframes}`);

  // Decode-verify the video-only master fully.
  log("decode-verifying video-only master (full pass)...");
  sh([
    "ffmpeg", "-hide_banner", "-v", "error",
    "-i", OUT_VIDEO_ONLY, "-f", "null", "-",
  ].join(" "), 180_000);
  log("video-only master decode OK");

  // ------------------------------------------------------------------
  // 5. Mux audio into final master
  // ------------------------------------------------------------------
  log(`muxing audio -> ${OUT_MASTER}`);
  sh([
    "ffmpeg", "-hide_banner", "-y",
    "-i", OUT_VIDEO_ONLY,
    "-i", AUDIO_WAV,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    OUT_MASTER,
  ].join(" "), 120_000);
  const mframes = ffprobe(OUT_MASTER, "stream=nb_read_frames:format=duration:stream=codec_type");
  log(`final master: ${mframes}`);

  // Full decode verify of the final master.
  log("decode-verifying final master (full pass)...");
  sh([
    "ffmpeg", "-hide_banner", "-v", "error",
    "-i", OUT_MASTER, "-f", "null", "-",
  ].join(" "), 180_000);
  log("final master decode OK");

  // ------------------------------------------------------------------
  // 6. Derivatives: loop cut + first/last frame proofs
  // ------------------------------------------------------------------
  log(`loop cut (first 6s) -> ${OUT_LOOP}`);
  sh([
    "ffmpeg", "-hide_banner", "-y",
    "-i", OUT_MASTER,
    "-t", "6",
    "-c:v", "copy", "-c:a", "copy",
    OUT_LOOP,
  ].join(" "), 60_000);
  log("loop cut: " + ffprobe(OUT_LOOP, "format=duration:stream=nb_read_frames"));

  log("extracting first frame (t=0) -> " + OUT_FIRST);
  sh([
    "ffmpeg", "-hide_banner", "-y",
    "-ss", "0", "-i", OUT_MASTER,
    "-frames:v", "1", "-q:v", "2",
    OUT_FIRST,
  ].join(" "), 60_000);
  log("first frame: " + ffprobe(OUT_FIRST, "stream=width,height"));

  log("extracting last frame (t=59.958) -> " + OUT_LAST);
  sh([
    "ffmpeg", "-hide_banner", "-y",
    "-ss", "59.958", "-i", OUT_MASTER,
    "-frames:v", "1", "-q:v", "2",
    OUT_LAST,
  ].join(" "), 60_000);
  log("last frame: " + ffprobe(OUT_LAST, "stream=width,height"));

  log("=== ALL DERIVATIVES GENERATED AND VERIFIED ===");
} catch (err) {
  log("FATAL: " + err.message);
  process.exitCode = 1;
}

const end = new Date().toISOString();
log(`=== render-60s-segments finished at ${end} ===`);
log("done");
