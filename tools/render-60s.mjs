#!/usr/bin/env -S node --enable-source-maps
/**
 * Bounded render of the new 60s relight demo timeline.
 *
 * This is the production driver for the 60-second master. It reuses the proven
 * seekable motion-graphics pipeline in `tools/make-demo-video.mjs` and writes
 * its own log + exit status so we can verify success/failure even when the
 * surrounding harness has its own timeout.
 *
 * Outputs:
 *  - video/relight-demo-60s.mp4        (60s master, 24fps, 1280x720, h264+aac)
 *  - video/render-60s.log             (full capture of this driver's run)
 */
import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const LOG_PATH = join(PROJECT_ROOT, "video", "render-60s.log");
const OUT_PATH = join(PROJECT_ROOT, "video", "relight-demo-60s.mp4");

function log(line) {
  const line2 = typeof line === "string" ? line : String(line);
  appendFileSync(LOG_PATH, line2 + "\n");
  process.stdout.write(line2 + "\n");
}

let exitCode = 0;
const start = new Date().toISOString();

try {
  log(`=== render-60s started at ${start} ===`);
  log(`out: ${OUT_PATH}`);
  log(`log: ${LOG_PATH}`);

  // Clean any prior artifact so we can tell success from a stale file.
  try { execSync(`rm -f "${OUT_PATH}"`, { stdio: "pipe" }); } catch {}

  const cmd = [
    "node",
    join(__dirname, "make-demo-video.mjs"),
    "--total", "60",
    "--seconds", "60",
    "--out", OUT_PATH,
  ].join(" ");

  log(`running: ${cmd}`);
  // Run the real render with a generous but bounded timeout and capture its
  // stderr/stdout into the same log.
  const result = execSync(cmd, {
    cwd: PROJECT_ROOT,
    timeout: 600_000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.length) log(result.toString());
  log("render command exited with code 0");
} catch (err) {
  exitCode = err.status || 1;
  log("RENDER FAILED");
  if (err.stderr) log("stderr:\n" + err.stderr.toString());
  if (err.stdout) log("stdout:\n" + err.stdout.toString());
  log(`error: ${err.message}`);
}

const end = new Date().toISOString();
const present = existsSync(OUT_PATH);
const stat = present ? existsSync.bind(null) : null;
let size = 0;
if (present) {
  try {
    const s = existsSync(OUT_PATH) ? require("fs").statSync(OUT_PATH) : null;
    if (s) size = s.size;
  } catch {}
  // stat via fs explicitly
  try {
    const fs = await import("node:fs");
    const s = fs.statSync(OUT_PATH);
    size = s.size;
  } catch {}
}

log(`=== render-60s finished at ${end} ===`);
log(`exitCode: ${exitCode}`);
log(`output present: ${present}`);
log(`output size bytes: ${size}`);
log(`done`);

process.exit(exitCode);
