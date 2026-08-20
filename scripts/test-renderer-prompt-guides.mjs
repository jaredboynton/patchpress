#!/usr/bin/env node
// Verifies renderer-specific read/output format guides are spliced into the prompt.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rendererTranscriptGuide } from "./renderer-prompt-guides.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const src = readFileSync(resolve(repoRoot, "scripts/compact-full-transcript.mjs"), "utf8");
let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

console.log("1. SOURCE wiring:");
check("rendererTranscriptGuide imported", /rendererTranscriptGuide/.test(src));
check("rendererEvidenceInstructions delegates to guide", /return rendererTranscriptGuide\(renderer\)/.test(src));

console.log("2. Per-renderer read/output guides:");
for (const [renderer, mustInclude] of [
  ["sentinel", ["How to read (sentinel", "@@RECORD line=000042", "How to output (sentinel", '"start_line": 42']],
  ["stripped", ["How to read (stripped", '<record line="000042"', "How to output (stripped"]],
  ["onto", ["How to read (onto", "@@ONTO Transcript", "42|user", "How to output (onto", "Current live state"]],
]) {
  const text = rendererTranscriptGuide(renderer).join("\n");
  for (const needle of mustInclude) {
    check(renderer + " contains " + JSON.stringify(needle), text.includes(needle));
  }
}

console.log("3. Shared format tail:");
check("shared tail rejects copied example domains", rendererTranscriptGuide("onto").join("\n").includes("do not copy these example domains"));

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " renderer guide check(s) failed");
  process.exit(1);
}
console.log("PASS: renderer read/output format guides present for sentinel, stripped, onto");
