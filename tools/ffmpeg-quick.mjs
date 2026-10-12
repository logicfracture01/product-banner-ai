#!/usr/bin/env node
/**
 * Minimal standalone ffmpeg render of video/demo.html (picture only, no audio).
 * Seeks window.__seek(t) at 24 fps and pipes JPEG frames into ffmpeg's
 * image2pipe demuxer. Intended as a smoke-test / fallback when the main
 * capture tool (make-demo-video.mjs) is being repaired.
 *
 * Usage:
 *   node tools/ffmpeg-quick.mjs [--seconds N] [--out path]
 */

import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEMO_HTML = join(ROOT, "video", "demo.html");
const DEFAULT_OUT = join(ROOT, "video", "relight-demo.mp4");

const FPS = 24;
const W = 1280;
const H = 720;
const QUALITY = 0.92;
const TOTAL = 54.0;

const args = process.argv.slice(2);
let seconds = TOTAL;
let out = DEFAULT_OUT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seconds" && args[i + 1] !== undefined) {
    seconds = parseFloat(args[i + 1]);
    if (!isFinite(seconds) || seconds <= 0) throw new Error("--seconds must be a positive number");
    i++;
  } else if (args[i] === "--out" && args[i + 1] !== undefined) {
    out = args[i + 1];
    i++;
  } else if (args[i].startsWith("--")) {
    throw new Error("Unknown flag: " + args[i]);
  }
}
if (seconds > TOTAL) throw new Error(`--seconds ${seconds} exceeds TOTAL=${TOTAL}`);
const frameCount = Math.max(1, Math.round(seconds * FPS));

mkdirSync(join(out, ".."), { recursive: true });

const ffmpeg = require("child_process").spawn(
  "ffmpeg",
  [
    "-hide_banner", "-y",
    "-f", "image2pipe", "-framerate", String(FPS),
    "-i", "pipe:0",
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=disable,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+faststart",
    out,
  ],
  { stdio: ["pipe", "inherit", "inherit"], windowsHide: false },
);

ffmpeg.stderr?.on("data", (d) => process.stderr.write(d));

if (!existsSync(DEMO_HTML)) throw new Error(`demo.html not found at ${DEMO_HTML}`);

const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
function resolveHeadlessShell() {
  const home = process.env.HOME || "/root";
  const c = path.join(home, ".cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell");
  if (fs.existsSync(c)) return c;
  return null;
}
const exe = resolveHeadlessShell();
if (!exe) throw new Error("No Playwright headless shell found");
if (!fs.existsSync(exe)) throw new Error("Headless shell missing: " + exe);

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--headless=new"] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, bypassCSP: true });
const page = await context.newPage();
await page.goto(`file://${DEMO_HTML}`, { waitUntil: "networkidle" });

const seekPage = async (t) => {
  await page.evaluate((tt) => window.__seek(tt), t);
  await new Promise((r) => setTimeout(r, 40));
};

process.stdout.write(`Rendering ${frameCount} frames @ ${FPS} fps → ${out}\n`);
const videoStream = ffmpeg.stdin;
if (!videoStream) throw new Error("ffmpeg stdin not available");

try {
  for (let i = 0; i < frameCount; i++) {
    const t = i / FPS;
    await seekPage(t);
    const buf = await page.screenshot({ type: "jpeg", quality: Math.round(QUALITY * 100), omitBackground: false, fullPage: false });
    if (!videoStream.write(buf, "buffer")) {
      await once(videoStream, "drain");
    }
    if (i % 60 === 0) process.stdout.write(`\rframe ${i + 1}/${frameCount}  (t=${t.toFixed(2)}s)`);
  }
} catch (err) {
  videoStream.destroy();
  throw err;
}
videoStream.end();
await once(ffmpeg, "close");
await browser.close();
console.log(`\nDone → ${out}`);
