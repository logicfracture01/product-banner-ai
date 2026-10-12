#!/usr/bin/env node
/** Quick self-consistency check for video/demo.html. */
import { readFileSync } from "node:fs";

const html = readFileSync("video/demo.html", "utf8");
const sections = (html.match(/<section class="stage"/g) || []).length;
const cams = (html.match(/data-cam="[^"]+"/g) || []).length;
const hasSeek = /window\.__seek/.test(html);
const hasTotal = /window\.__TOTAL__/.test(html);
const hasScenes = /SCENES\s*=\s*\[/.test(html);

let sceneCount = 0, sceneNames = [];
const scenesMatch = html.match(/const SCENES = (\[[\s\S]*?\]);/);
if (scenesMatch) {
  try {
    // Pull the raw array body and re-bracket it so JSON.parse can handle the
    // single-quoted strings. JSON.parse does not accept JS identifiers like
    // `true`/`false`/`null` when they appear unquoted, but here the array only
    // contains string literals and numbers, so a targeted normalize is enough.
    const raw = scenesMatch[1];
    // Walk the array body, drop comment tokens, and replace single quotes with
    // double quotes so JSON.parse can handle it.
    const normalized = raw
      .replace(/\/\/[^\n]*/g, "")
      .replace(/'/g, '"')
      .replace(/,\s*\]/g, "]");
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch (e) {
      // Fallback: the array body may still contain JS-number tokens like
      // 3.40 that JSON.parse cannot handle when they follow a comma with no
      // quotes. As a last resort, shell out to a tiny in-memory eval of the
      // re-bracketed array expression.
      const expr = "[" + normalized.slice(1, -1) + "]";
      // eslint-disable-next-line no-new-func
      parsed = new Function("return " + expr)();
    }
    if (Array.isArray(parsed)) {
      sceneCount = parsed.length;
      sceneNames = parsed.map(s => (s && (s.name || s.id)) || "???").filter(Boolean);
    }
  } catch (e) {
    console.log("SCENES parse warning:", e.message);
  }
}

console.log("section.stage count:", sections);
console.log("data-cam attrs:", cams);
console.log("window.__seek:", hasSeek);
console.log("window.__TOTAL__:", hasTotal);
console.log("SCENES array:", hasScenes);
console.log("SCENES entries:", sceneCount);
console.log("section count == SCENES count:", sections === sceneCount);
console.log("every scene has data-cam:", cams >= sections);
console.log("scene names:", sceneCount ? sceneNames.join(" · ") : "(none)");
console.log("integrity:", (sections === sceneCount && cams >= sections && hasSeek && hasTotal) ? "OK" : "CHECK FAILED");
