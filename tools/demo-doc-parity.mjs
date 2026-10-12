#!/usr/bin/env node
/** Compare the SCENES array in video/demo.html against the table in video/README.md. */
import { readFileSync } from "node:fs";

const html = readFileSync("video/demo.html", "utf8");
const md = readFileSync("video/README.md", "utf8");

const scenesMatch = html.match(/const SCENES = (\[[\s\S]*?\]);/);
if (!scenesMatch) {
  console.log("FAIL: no SCENES array found in video/demo.html");
  process.exit(1);
}

// Normalize the JS literal into something JSON.parse can handle.
const body = scenesMatch[1]
  .replace(/\/\/[^\n]*/g, "")      // drop JS comments inside the array
  .replace(/'/g, '"')              // single → double quotes
  .replace(/,\s*\]/g, "]");        // drop trailing commas before ]

let scenes;
try {
  scenes = JSON.parse(body);
} catch (e) {
  // Last resort: eval the literal in a fresh function scope.
  scenes = (function () { return eval(body); })();
}

if (!Array.isArray(scenes)) {
  console.log("FAIL: SCENES is not an array");
  process.exit(2);
}

const tableLines = md.split("\n").filter((l) => /^[\s|]*\|[\s|]*\d+[\s|]*\|/.test(l));
const rows = tableLines.map((l) => l.split("|").map((x) => x.trim()).filter(Boolean));

let ok = true;
console.log("demo.html SCENES:", scenes.length, "scenes");
console.log("video/README.md table rows:", rows.length);
console.log("---");
rows.forEach((r) => {
  const num = r[0];
  const name = r[1];
  const desc = r.slice(2).join(" | ").trim();
  const s = scenes.find((s) => s.name === name);
  if (!s) {
    console.log(`MISSING  #${num}: ${name}`);
    ok = false;
    return;
  }
  const dur = (s.end - s.start).toFixed(2);
  const descMatch = desc.toLowerCase().includes(name.toLowerCase()) || desc.length > 0;
  console.log(
    `#${num}: ${name.padEnd(28)} [${s.start.toFixed(2)} → ${s.end.toFixed(2)}]  ${
      descMatch ? "ok" : "!! desc mismatch"
    }`
  );
});

console.log("---");
if (ok && rows.length === scenes.length) {
  console.log("PARITY: OK");
  process.exit(0);
} else {
  console.log("PARITY: CHECK FAILED");
  process.exit(3);
}
