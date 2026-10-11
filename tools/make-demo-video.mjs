// Build the demo video: video/demo.html -> video/relight-demo.mp4
//
// THE METHOD (HTML -> MP4)
//   1. Render video/demo.html in a headless Chromium.
//   2. Seek it frame by frame. The page exposes window.__seek(t) and is a pure
//      function of `t` — no CSS transitions, no wall-clock animation — so every
//      frame is deterministic and the whole thing is reproducible.
//   3. Screenshot each frame as JPEG and pipe it straight into ffmpeg's
//      image2pipe demuxer. Frames never touch the disk, so a 1300-frame render
//      needs no scratch space.
//   4. Synthesize the soundtrack as a WAV (music bed + scene-transition
//      whooshes + UI ticks, all generated from the page's own scene table so
//      the sound stays in sync with the picture), and mux it in the same ffmpeg
//      pass.
//
// WHY NOT Playwright's recordVideo: that path is real-time and best-effort —
// frames get dropped when the encoder falls behind, which is exactly the
// failure mode a demo video can't have. Seeking is slower but exact.
//
// REQUIREMENTS (all present in this container):
//   - a chromium build: `bunx playwright install chromium-headless-shell`
//   - a real ffmpeg with libx264 + aac: `apt-get install -y --no-install-recommends ffmpeg`
//   - system fonts, or text renders as boxes: `fonts-dejavu-core`
//
// USAGE
//   node tools/make-demo-video.mjs [--fps 24] [--out video/relight-demo.mp4]
//                                  [--seconds N]  # render only the first N seconds
//                                  [--no-audio]

import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FPS = Number(argOf("--fps", "24"));
const OUT = path.resolve(ROOT, argOf("--out", "video/relight-demo.mp4"));
const MAX_SECONDS = Number(argOf("--seconds", "0")) || Infinity;
const WITH_AUDIO = !argv.includes("--no-audio");

const W = 1280;
const H = 720;

// =============================================================== the soundtrack
// 48 kHz stereo, 16-bit PCM. Pure maths — no audio assets to ship.

const RATE = 48_000;

/** Chords as semitone offsets from A2, so the progression reads cleanly. */
const CHORDS = [
  { root: 220.0, notes: [220.0, 261.63, 329.63] }, // Am
  { root: 174.61, notes: [174.61, 220.0, 261.63] }, // F
  { root: 196.0, notes: [196.0, 246.94, 293.66] }, // G
  { root: 261.63, notes: [261.63, 329.63, 392.0] }, // C
];

/** Deterministic noise (mulberry32) — the audio must be reproducible too. */
function rngFactory(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesizeAudio(durationSec, sceneStarts) {
  const n = Math.ceil(durationSec * RATE);
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const add = (startSec, fn, pan = 0) => {
    const i0 = Math.max(0, Math.floor(startSec * RATE));
    const lg = Math.sqrt((1 - pan) / 2);
    const rg = Math.sqrt((1 + pan) / 2);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / RATE;
      const v = fn(t);
      if (v === 0) continue;
      L[i] += v * lg;
      R[i] += v * rg;
    }
  };

  const env = (t, attack, release, hold) => {
    if (t < 0 || t > attack + hold + release) return 0;
    if (t < attack) return t / attack;
    if (t < attack + hold) return 1;
    return Math.max(0, 1 - (t - attack - hold) / release);
  };

  // ---- music bed: one chord per quarter of the runtime --------------------
  const seg = durationSec / CHORDS.length;
  CHORDS.forEach((chord, ci) => {
    const start = ci * seg;
    const hold = Math.max(0.1, seg - 1.5);
    for (const f of chord.notes) {
      // three slightly detuned partials = a soft, slightly wide pad
      for (const [det, g] of [
        [0.997, 0.030],
        [1.0, 0.042],
        [1.004, 0.028],
      ]) {
        add(start, (t) => Math.sin(2 * Math.PI * f * det * t) * g * env(t, 0.9, 1.4, hold), -0.18);
      }
    }
    // bass, one octave down
    add(start, (t) => Math.sin(2 * Math.PI * (chord.root / 2) * t) * 0.052 * env(t, 0.5, 1.2, hold), 0.05);

    // gentle pulse to give the bed a heartbeat
    for (let k = 0; k < Math.floor(seg / 1.6); k++) {
      const at = start + k * 1.6;
      add(at, (t) => {
        const e = Math.exp(-t * 9);
        return e < 0.001 ? 0 : Math.sin(2 * Math.PI * chord.root * 2 * t) * 0.034 * e;
      }, 0.1);
    }
  });

  // ---- whoosh on every scene change (except the first) -------------------
  const noise = rngFactory(0x51ed7);
  sceneStarts.slice(1).forEach((at, i) => {
    add(at - 0.22, (() => {
      let lp = 0;
      return (t) => {
        if (t > 0.7) return 0;
        const p = t / 0.7;
        // sweep the one-pole cutoff up and back down
        const alpha = 0.02 + 0.5 * Math.sin(Math.PI * p);
        lp += alpha * ((noise() * 2 - 1) - lp);
        const e = Math.sin(Math.PI * p) ** 1.6;
        return lp * 0.34 * e;
      };
    })(), i % 2 ? -0.3 : 0.3);
  });

  // ---- UI ticks: one per workflow card, spread across its scene ----------
  const workflowStart = sceneStarts[2] ?? 8;
  for (let k = 0; k < 5; k++) {
    add(workflowStart + 0.9 + k * 1.35, (t) => {
      const e = Math.exp(-t * 46);
      return e < 0.001 ? 0 : Math.sin(2 * Math.PI * 2100 * t) * 0.14 * e;
    }, (k % 2 ? 1 : -1) * 0.22);
  }

  // ---- rising sweep during the upscale beat ------------------------------
  const upscaleStart = (sceneStarts[6] ?? 35) + 3.4;
  add(upscaleStart, (() => {
    let phase = 0;
    return (t) => {
      if (t > 1.5) return 0;
      const p = t / 1.5;
      const f = 420 + p * 2600;
      phase += (2 * Math.PI * f) / RATE;
      const e = Math.sin(Math.PI * Math.min(1, p * 1.05)) ** 1.2;
      return Math.sin(phase) * 0.16 * e;
    };
  })(), 0.25);

  // ---- outro chime -------------------------------------------------------
  const outro = sceneStarts[sceneStarts.length - 1] ?? durationSec - 3.4;
  for (const [f, g, dec] of [
    [880, 0.11, 2.4],
    [1318.5, 0.085, 2.0],
    [1760, 0.05, 1.6],
  ]) {
    add(outro + 0.35, (t) => {
      const e = Math.exp(-t * dec);
      return e < 0.0008 ? 0 : (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * g * e;
    }, 0);
  }

  // ---- soft clip + normalise --------------------------------------------
  const out = Buffer.alloc(n * 4);
  const soft = (v) => Math.tanh(v * 1.15);
  for (let i = 0; i < n; i++) {
    // 8 ms fade in / out so there is never a click at the boundaries
    const fade = Math.min(1, i / (RATE * 0.008), (n - i) / (RATE * 0.02));
    const l = soft(L[i]) * 0.92 * fade;
    const r = soft(R[i]) * 0.92 * fade;
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), i * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), i * 4 + 2);
  }
  return out;
}

function wavFile(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28); // byte rate
  header.writeUInt16LE(4, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ================================================================ the capture

async function main() {
  const browser = await chromium.launch({
    channel: "chromium-headless-shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });

  let frames = 0;
  const started = Date.now();
  let audioPath = null;
  let ff = null;

  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (err) => console.error("[demo page error]", err.message));

    await page.goto(`file://${path.join(ROOT, "video", "demo.html")}`);
    await page.waitForFunction("window.__READY__ === true", null, { timeout: 15_000 });

    const total = await page.evaluate("window.__TOTAL__");
    const scenes = await page.evaluate("window.__SCENES__");
    const duration = Math.min(total, MAX_SECONDS);
    const frameCount = Math.max(1, Math.round(duration * FPS));

    let sceneStarts = [];
    {
      let acc = 0;
      for (const s of scenes) {
        sceneStarts.push(acc);
        acc += s.dur;
      }
    }

    console.log(
      `demo: ${duration.toFixed(1)}s · ${frameCount} frames @ ${FPS}fps · ${W}x${H} · ${scenes.length} scenes`,
    );

    // ---- soundtrack ------------------------------------------------------
    let audioArgs = [];
    if (WITH_AUDIO) {
      const tail = 0.7;
      const pcm = synthesizeAudio(duration + tail, sceneStarts);
      audioPath = path.join(os.tmpdir(), `relight-demo-${process.pid}.wav`);
      await writeFile(audioPath, wavFile(pcm));
      audioArgs = ["-i", audioPath];
      console.log(`audio: ${(((duration + tail) * RATE * 4) / 1e6).toFixed(1)} MB PCM synthesized`);
    }

    await mkdir(path.dirname(OUT), { recursive: true });

    ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
        ...audioArgs,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "19",
        "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        "-r", String(FPS),
        ...(WITH_AUDIO ? ["-c:a", "aac", "-b:a", "160k", "-shortest"] : []),
        "-movflags", "+faststart",
        OUT,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );

    const ffDone = new Promise((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)),
      );
    });

    const writeFrame = (buf) =>
      new Promise((resolve, reject) => {
        const ok = ff.stdin.write(buf, (err) => (err ? reject(err) : undefined));
        if (ok) resolve();
        else ff.stdin.once("drain", resolve);
      });

    // ---- seek, shoot, pipe ----------------------------------------------
    for (let i = 0; i < frameCount; i++) {
      const t = i / FPS;
      await page.evaluate((tt) => window.__seek(tt), t);
      const buf = await page.screenshot({ type: "jpeg", quality: 92, optimizeForSpeed: true });
      await writeFrame(buf);
      frames++;
      if (i % Math.max(1, Math.round(frameCount / 8)) === 0) {
        const pct = ((i / frameCount) * 100).toFixed(0);
        process.stdout.write(`\r  capture ${pct}% (${i}/${frameCount})   `);
      }
    }
    process.stdout.write("\r  capture 100%             \n");

    ff.stdin.end();
    await ffDone;
  } finally {
    await browser.close().catch(() => {});
    if (audioPath) await import("node:fs/promises").then((m) => m.rm(audioPath, { force: true }));
  }

  const st = await stat(OUT);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n✓ ${path.relative(ROOT, OUT)} — ${frames} frames, ${(st.size / 1e6).toFixed(1)} MB, ${elapsed}s wall`);
}

main().catch((err) => {
  console.error("\ndemo video build failed:", err.message);
  process.exit(1);
});
