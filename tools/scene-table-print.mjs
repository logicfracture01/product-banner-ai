#!/usr/bin/env node
/** Print the SCENES table from video/demo.html. */
import { readFileSync } from "node:fs";

const html = readFileSync("video/demo.html", "utf8");
const m = html.match(/const SCENES = (\[[\s\S]*?\]);/);
if (!m) {
  console.log("no SCENES array");
  process.exit(1);
}

// Normalize the JS literal so JSON.parse can handle it.
let body = m[1]
  .replace(/\/\/[^\n]*/g, "")   // drop JS comments inside the array
  .replace(/'/g, '"')           // single quotes → double quotes
  .replace(/,\s*\]/g, "]");     // drop trailing commas before ]

let scenes;
try {
  scenes = JSON.parse(body);
} catch (e) {
  // Last resort: eval the literal in a fresh function scope.
  scenes = (function () { return eval(body); })();
}

if (!Array.isArray(scenes)) {
  console.log("SCENES is not an array");
  process.exit(2);
}

let line = "";
scenes.forEach((x, i) => {
  const dur = (x.end - x.start).toFixed(2);
  line += `${i ? "\n" : ""}  ${i + 1}. ${String(x.name).padEnd(30)} [${x.start.toFixed(2)}s → ${x.end.toFixed(2)}s]  (${dur} s)`;
});
console.log(line);
console.log(`\nTotal scenes: ${scenes.length}`);
console.log(`Total duration: ${(scenes[scenes.length - 1].end).toFixed(2)} s`);
