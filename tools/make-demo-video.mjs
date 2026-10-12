#!/usr/bin/env -S node --enable-source-maps
/**
 * Render `video/demo.html` → an mp4 that is a faithful capture of the
 * seekable motion-graphics timeline.
 *
 * The page is a *pure function of t*: every visual is derived from a single
 * CSS variable (`--p`) and `window.__seek(t)`. Seeking to the same t twice
 * gives byte-identical pixels, so this is reproducible, not “usually fine”.
 *
 * Flow
 *  1. Launch headless Chromium (Playwright), load demo.html from the file:// URL.
 *  2. Read the scene table back from `window.__SCENES__` so audio event times
 *     are guaranteed to match the picture (no drift).
 *  3. Seek to every frame time t = 0, 1/24, 2/24, … , TOTAL-(1/24).
 *     At each t, snapshot the canvas as JPEG and write it to ffmpeg's
 *     stdin (image2pipe). No frame ever touches disk.
 *  4. Synthesize a 48 kHz stereo soundtrack in-process: a soft pad, a pulse on
 *     every scene change, a tick per workflow step, and a rising sweep on the
 *     upscale beat, plus an outro chime. Event times come from the page's scene
 *     table.
 *  5. Mux video + audio in a single ffmpeg pass with libx264 + aac.
 *
 * Requirements
 *  - playwright installed: `bunx playwright install chromium-headless-shell`
 *  - ffmpeg with libx264 + aac (system ffmpeg, not Playwright's bundled VP9 build)
 *  - DejaVu Sans (fonts-dejavu-core) for any text rendering inside the page
 *
 * Usage
 *  node tools/make-demo-video.mjs                     # full 54 s render
 *  node tools/make-demo-video.mjs --seconds 6         # quick smoke
 *  node tools/make-demo-video.mjs --no-audio           # picture only
 *  node tools/make-demo-video.mjs --out video/foo.mp4  # custom path
 */

import { createRequire } from "node:module";

let HEADLESS_SHELL_EXE = null;
import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const DEMO_HTML = join(PROJECT_ROOT, "video", "demo.html");
const DEFAULT_OUT = join(PROJECT_ROOT, "video", "relight-demo.mp4");

let TOTAL_OVERRIDE = null;
let AUDIO_FILE = null;
const TOTAL = 54.0;          // must match demo.html's window.__TOTAL__
const FPS = 24;
const W = 1280;
const H = 720;
const QUALITY = 0.92;        // JPEG quality handed to the page

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let out = DEFAULT_OUT;
let seconds = TOTAL;
let audio = true;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--seconds" && args[i + 1] !== undefined) {
    seconds = parseFloat(args[i + 1]);
    if (!isFinite(seconds) || seconds <= 0) die("--seconds must be a positive number");
    i++;
  } else if (a === "--no-audio") {
    audio = false;
  } else if (a === "--out" && args[i + 1] !== undefined) {
    out = args[i + 1];
    i++;
  } else if (a === "--total" && args[i + 1] !== undefined) {
    TOTAL_OVERRIDE = parseFloat(args[i + 1]);
    if (!isFinite(TOTAL_OVERRIDE) || TOTAL_OVERRIDE <= 0) die("--total must be a positive number");
    i++;
  } else if (a === "--audio-file" && args[i + 1] !== undefined) {
    AUDIO_FILE = args[i + 1];
    i++;
  } else if (a.startsWith("--")) {
    die("Unknown flag: " + a);
  }
}

const EFFECTIVE_TOTAL = TOTAL_OVERRIDE != null ? TOTAL_OVERRIDE : TOTAL;
if (seconds > EFFECTIVE_TOTAL) die(`--seconds ${seconds} exceeds the effective timeline TOTAL (${EFFECTIVE_TOTAL}s)`);

const frameCount = Math.max(1, Math.round(seconds * FPS));
const lastT = (frameCount - 1) / FPS;
const AUDIO_TOTAL = EFFECTIVE_TOTAL;

mkdirSync(join(out, ".."), { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

function which(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function ffmpegArgs(videoOnly = false, audioInputFile = null) {
  const args = [
    "-hide_banner",
    "-y",
    "-f", "image2pipe",
    "-framerate", String(FPS),
    "-i", "pipe:0",
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=disable,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-video_track_timescale", "24",
  ];
  if (!videoOnly && audio) {
    if (audioInputFile) {
      // Audio comes from a file; ffmpeg will read it as a separate input.
      // (The -i for the file is added by the caller.)
      args.push("-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k");
    } else {
      args.push("-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k");
    }
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart");
  return args;
}

// ---------------------------------------------------------------------------
// Sound synthesis — pure additive synth in JS, written to a PCM buffer, then
// fed to ffmpeg as raw s16le audio alongside the video pipe.
// ---------------------------------------------------------------------------

function makeAudioBuffer(durationSec, events) {
  const sr = 48000;
  const n = Math.ceil(durationSec * sr);
  const stereo = new Float32Array(n * 2);

  // master bus: a soft pad that breathes through the whole piece.
  const pad = (t) => {
    const env = Math.min(1, Math.max(0, (t - 0.5) / 2.5)) * Math.min(1, Math.max(0, 1 - (t - durationSec + 1.5) / 1.5));
    const f = 65 + 8 * Math.sin(t * 0.15);
    const w = Math.sin(2 * Math.PI * f * t) * 0.06
            + Math.sin(2 * Math.PI * (f * 1.5) * t) * 0.025
            + Math.sin(2 * Math.PI * (f * 2) * t) * 0.012;
    return w * env;
  };

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const s = pad(t);
    stereo[i * 2] = s;
    stereo[i * 2 + 1] = s;
  }

  // event bus: scene-change pulse + tick + sweeps.
  for (const ev of events) {
    const t0 = ev.t;
    if (t0 < 0 || t0 > durationSec) continue;
    if (ev.kind === "scene") {
      // whoosh + chime on scene changes.
      const len = 0.55;
      const start = Math.max(0, Math.floor((t0) * sr));
      const end = Math.min(n, Math.ceil((t0 + len) * sr));
      for (let i = start; i < end; i++) {
        const t = (i - start) / sr;
        const env = Math.max(0, 1 - t / len);
        const f = 220 + 220 * t * 6;
        const w = Math.sin(2 * Math.PI * f * t) * 0.10
                + Math.sin(2 * Math.PI * (f * 1.5) * t) * 0.05;
        const i0 = i * 2;
        stereo[i0] += w * env;
        stereo[i0 + 1] += w * env * 0.9;
      }
      // soft sub thump.
      const thumpStart = Math.max(0, Math.floor((t0) * sr));
      const thumpEnd = Math.min(n, Math.ceil((t0 + 0.18) * sr));
      for (let i = thumpStart; i < thumpEnd; i++) {
        const t = (i - thumpStart) / sr;
        const env = Math.max(0, 1 - t / 0.18);
        const w = Math.sin(2 * Math.PI * 70 * t) * 0.18;
        const i0 = i * 2;
        stereo[i0] += w * env;
        stereo[i0 + 1] += w * env;
      }
    } else if (ev.kind === "tick") {
      // crisp high tick per workflow card.
      const start = Math.max(0, Math.floor(t0 * sr));
      const end = Math.min(n, Math.ceil((t0 + 0.06) * sr));
      for (let i = start; i < end; i++) {
        const t = (i - start) / sr;
        const env = Math.max(0, 1 - t / 0.06);
        const w = Math.sin(2 * Math.PI * 1800 * t) * 0.05;
        const i0 = i * 2;
        stereo[i0] += w * env;
        stereo[i0 + 1] += w * env;
      }
    } else if (ev.kind === "sweep") {
      // rising sweep on the upscale beat.
      const len = 0.9;
      const start = Math.max(0, Math.floor(t0 * sr));
      const end = Math.min(n, Math.ceil((t0 + len) * sr));
      for (let i = start; i < end; i++) {
        const t = (i - start) / sr;
        const env = Math.max(0, Math.min(1, t / 0.18) * Math.max(0, 1 - (t - 0.5) / 0.4));
        const f = 300 + 900 * Math.min(1, t / len);
        const w = Math.sin(2 * Math.PI * f * t) * 0.06;
        const i0 = i * 2;
        stereo[i0] += w * env;
        stereo[i0 + 1] += w * env;
      }
    } else if (ev.kind === "chime") {
      // outro chime: gentle major triad.
      const len = 1.6;
      const start = Math.max(0, Math.floor(t0 * sr));
      const end = Math.min(n, Math.ceil((t0 + len) * sr));
      const triad = [523.25, 659.25, 783.99];
      for (let i = start; i < end; i++) {
        const t = (i - start) / sr;
        const env = Math.max(0, 1 - t / len);
        let s = 0;
        for (const f of triad) {
          s += Math.sin(2 * Math.PI * f * t) * 0.05 / triad.length;
        }
        s += Math.sin(2 * Math.PI * 1046.5 * t) * 0.03;
        const i0 = i * 2;
        stereo[i0] += s * env;
        stereo[i0 + 1] += s * env;
      }
    }
  }

  // gentle limiting + soft fade at the very end.
  let peak = 0;
  for (let i = 0; i < stereo.length; i++) {
    const a = Math.abs(stereo[i]);
    if (a > peak) peak = a;
  }
  const gain = peak > 0.95 ? 0.95 / peak : 1;
  const fadeLen = Math.min(n, Math.ceil(0.4 * sr));
  for (let i = 0; i < n; i++) {
    const f = i >= n - fadeLen ? Math.min(1, (n - i) / fadeLen) : 1;
    const i0 = i * 2;
    stereo[i0] *= gain * f;
    stereo[i0 + 1] *= gain * f;
  }

  return { sampleRate: sr, channels: 2, data: stereo };
}

function floatToS16LE(buf) {
  const out = new Uint8Array(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    let s = Math.max(-1, Math.min(1, buf[i])) * 32767;
    s = Math.round(s);
    const i2 = i * 2;
    out[i2] = s & 0xff;
    out[i2 + 1] = (s >> 8) & 0xff;
  }
  return out;
}

function buildEventsFromSceneTable(scenes, total) {
  const events = [];
  scenes.forEach((s, i) => {
    // scene change pulse at scene start.
    events.push({ kind: "scene", t: s.start });
    // tick per workflow card in workflow scene.
    if (s.name === "Workflow") {
      for (let k = 1; k <= 4; k++) {
        const t = s.start + (k / 4) * (s.end - s.start);
        events.push({ kind: "tick", t });
      }
    }
    // sweep on the upscale beat (stages 04 + 05 scene).
    if (s.name === "Stages 04 + 05") {
      events.push({ kind: "sweep", t: s.start + (s.end - s.start) * 0.65 });
    }
  });
  // outro chime near the end.
  const outro = scenes[scenes.length - 1];
  events.push({ kind: "chime", t: Math.max(0, total - 2.6) });
  return events;
}

// ---------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------

async function ensurePlaywright() {
  // `bunx playwright install chromium-headless-shell` should have been run;
  // we only need the browser to be available. If it is missing, fail loudly.
  const { chromium } = require("playwright");
  const fs = require("node:fs");
  const path = require("node:path");
  function resolveHeadlessShell() {
    const candidates = [
      // explicit headless shell binary that exists in this cache layout
      path.join(process.env.HOME || "/root", ".cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell"),
      path.join(process.env.XDG_CACHE_HOME || (process.env.HOME || "/root") + "/.cache", "ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // fallback: ask Playwright for its preferred path and use it if present
    try {
      const p = require("path").dirname(require("path").dirname(chromium.executablePath()));
      if (fs.existsSync(p)) {
        const bin = path.join(p, "chrome-headless-shell");
        if (fs.existsSync(bin)) return bin;
      }
    } catch { /* ignore */ }
    return null;
  }
  const exe = resolveHeadlessShell();
  HEADLESS_SHELL_EXE = exe;
  if (!HEADLESS_SHELL_EXE) die("No Playwright headless shell found. Expected: $HOME/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell");
  if (!fs.existsSync(HEADLESS_SHELL_EXE)) die("Headless shell binary missing at: " + HEADLESS_SHELL_EXE);
}

async function launchBrowser() {
  const { chromium } = require("playwright");
  if (!HEADLESS_SHELL_EXE) await ensurePlaywright();
  const launch = { executablePath: HEADLESS_SHELL_EXE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--headless=new"] };
  const browser = await chromium.launch(launch);
  return browser;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensurePlaywright();

  if (!existsSync(DEMO_HTML)) die(`demo.html not found at ${DEMO_HTML}`);

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Load from the file URL so fonts/images resolve relative to the file.
  await page.goto(`file://${DEMO_HTML}`, { waitUntil: "networkidle" });

  // Read the scene table back from the page so audio stays in sync with the
  // picture. This is the source of truth; if the page exposes __SCENES__, use
  // it. Otherwise fall back to a built-in table that must match demo.html.
  let scenes = [];
  try {
    const raw = await page.evaluate(() => window.__SCENES__);
    if (raw && Array.isArray(raw)) scenes = raw;
  } catch { /* built-in fallback below */ }
  if (scenes.length === 0) {
    // Built-in fallback table matching the demo.html we just wrote.
    scenes = [
      { name: "Intro",           start: 0.00, end: 3.40 },
      { name: "Problem",         start: 3.40, end: 8.00 },
      { name: "Workflow",        start: 8.00, end: 17.00 },
      { name: "Stage 01 · Detect", start: 17.00, end: 22.40 },
      { name: "Stage 02 · Matte",  start: 22.40, end: 28.80 },
      { name: "Stage 03 · Plan",   start: 28.80, end: 34.20 },
      { name: "Stages 04 + 05",    start: 34.20, end: 40.60 },
      { name: "The app",           start: 40.60, end: 47.00 },
      { name: "Deployment",        start: 47.00, end: 50.60 },
      { name: "Outro",             start: 50.60, end: 54.00 },
    ];
  }

  // Validate against the known TOTAL so a stray edit can't silently drift.
  // Validate against the known TOTAL so a stray edit can't silently drift.
  let pageTotalAny;
  try {
    pageTotalAny = await page.evaluate(() => window.__TOTAL__);
    if (typeof pageTotalAny !== "number" || !isFinite(pageTotalAny)) {
      pageTotalAny = TOTAL;
    }
  } catch { /* ignore */ }
  if (typeof pageTotalAny === "number" && isFinite(pageTotalAny)) {
    if (Math.abs(pageTotalAny - EFFECTIVE_TOTAL) > 0.05) {
      die(`demo.html reports __TOTAL__=${pageTotalAny} but this script expects ${EFFECTIVE_TOTAL}. Use --total ${pageTotalAny} or edit demo.html.`);
    }
  }

  console.log(`Rendering ${frameCount} frames @ ${FPS} fps → ${out}`);
  console.log(`Timeline: 0.00s → ${seconds.toFixed(2)}s of ${EFFECTIVE_TOTAL}s`);
  console.log(`Audio: ${audio ? "on" : "off"}`);

  // Spawn ffmpeg writing the output file. video pipe on fd 0 (stdin), audio
  // pipe on fd 3 when we're synthesizing audio.
  const ffmpeg = execSync("command -v ffmpeg", { encoding: "utf8" }).trim();
  if (!ffmpeg || !existsSync(ffmpeg)) die("ffmpeg not on PATH");

  const videoOnly = !audio;
  const ffmpegArgsArr = ffmpegArgs(videoOnly, AUDIO_FILE);
  const ffmpegArgv = [ffmpeg, ...ffmpegArgsArr];
  // Append the output file path (required by ffmpeg).
  ffmpegArgv.push(out);
  if (AUDIO_FILE) {
    // Audio input must come before the output file.
    const ai = ffmpegArgv.indexOf("-an");
    if (ai !== -1) {
      ffmpegArgv.splice(ai, 1);
    }
    ffmpegArgv.splice(ffmpegArgv.length - 1, 0, "-i", AUDIO_FILE);
  }
  const ff = require("child_process").spawn(ffmpegArgv[0], ffmpegArgv.slice(1), {
    stdio: videoOnly
      ? ["pipe", "inherit", "inherit"]
      : ["pipe", "inherit", "pipe", "pipe", "inherit"],
    windowsHide: false,
  });
  // ffmpeg stdin for audio is only available when we synthesized audio.
  function maybeCloseAudioPipe() {
    if (!videoOnly && audio && ff.stdio[3]) {
      try { ff.stdio[3].end(); } catch { /* ignore */ }
    }
  }

  ff.stderr?.on("data", (d) => process.stderr.write(d));

  let stdoutClosed = false;
  ff.on("close", (code) => {
    stdoutClosed = true;
    if (code !== 0 && code !== null) {
      console.error("ffmpeg exited with code", code);
    }
  });

  // Pipe video frames to ffmpeg's stdin.
  const videoStream = ff.stdin;
  if (!videoStream) die("ffmpeg stdin not available");

  // Seek each frame.
  // Seek each frame.
  const seekPage = async (t) => {
    await page.evaluate((tt) => window.__seek(tt), t);
    await new Promise((r) => setTimeout(r, 40));
  };

  const screenshotFrame = async (t) => {
    await seekPage(t);
    const buf = await page.screenshot({
      type: "jpeg",
      quality: Math.round(QUALITY * 100),
      omitBackground: false,
      fullPage: false,
    });
    return buf;
  };

  // If we're doing audio, write the audio stream on fd 3 after ffmpeg is ready.
  let audioFd = null;
  if (!videoOnly && audio) {
    // Wait briefly for ffmpeg to open the audio pipe.
    await new Promise((r) => setTimeout(r, 250));
    audioFd = ff.stdio[3] || null;
    if (!audioFd || audioFd.closed) die("ffmpeg audio pipe (fd 3) not available");
  }

  console.log("Capturing frames…");

  // Build audio once we have the scene table (already done above).
  const audioBuf = (!videoOnly && audio)
    ? floatToS16LE(makeAudioBuffer(seconds, buildEventsFromSceneTable(scenes, seconds)).data)
    : null;

  try {
    for (let i = 0; i < frameCount; i++) {
      const t = i / FPS;
      const jpeg = await screenshotFrame(t);
      const written = videoStream.write(jpeg, "buffer");
      if (!written) {
        // backpressure: wait until the pipe drains.
        await once(videoStream, "drain");
      }
      if (i % 60 === 0) {
        process.stdout.write(`\rframe ${i + 1}/${frameCount}  (t=${t.toFixed(2)}s)`);
      }
      // If we have an audio buffer, write it once at the very first frame so
      // it's all queued before video finishes. We chunk it to keep memory sane.
      if (audioFd && i === 0 && audioBuf) {
        const chunkSize = 1024 * 1024;
        for (let j = 0; j < audioBuf.length; j += chunkSize) {
          const end = Math.min(j + chunkSize, audioBuf.length);
          const wrote = audioFd.write(audioBuf.subarray(j, end));
          if (!wrote) await once(audioFd, "drain");
        }
        // Signal end of audio stream.
        audioFd.end();
        audioFd = null;
      }
    }
  } catch (err) {
    videoStream.destroy();
    if (audioFd) { try { audioFd.end(); } catch {} }
    die("frame capture failed: " + err.message);
  }

  // Finish video pipe.
  videoStream.end();
  await new Promise((resolve) => {
    const onClose = () => resolve();
    ff.on("close", onClose);
    setTimeout(() => {
      // ffmpeg should have exited by now; if not, force-kill.
      try { process.kill(-ff.pid, "SIGKILL"); } catch {}
      resolve();
    }, 120_000).unref();
  });

  // Give ffmpeg a moment to flush the moov atom.
  await new Promise((r) => setTimeout(r, 300));

  await browser.close();
  console.log(`\nDone → ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
