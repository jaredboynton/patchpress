#!/usr/bin/env node
// Asserts the compaction prompt varies by renderer and includes format read/output
// guides (not a full handoff few-shot; structure still comes from json_schema).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const src = readFileSync(resolve(repoRoot, "scripts/compact-full-transcript.mjs"), "utf8");
const guides = readFileSync(resolve(repoRoot, "scripts/renderer-prompt-guides.mjs"), "utf8");
let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

console.log("1. Renderer-conditional evidence block:");
check("prompt splices rendererEvidenceInstructions(stats.transcriptRenderer)",
  src.includes("rendererEvidenceInstructions(stats.transcriptRenderer)"));
check("sentinel rules in guides", guides.includes("sentinel records beginning with @@RECORD"));
check("onto rules in guides", guides.includes("schema-once row-major framing"));
check("stripped rules in guides", guides.includes('wrapped as <record line="000001">'));

console.log("2. Renderer format guides (read + output mini-examples):");
check("rendererTranscriptGuide module wired", /renderer-prompt-guides\.mjs/.test(src));
check("how-to-read sentinel", guides.includes("How to read (sentinel renderer):"));
check("how-to-read onto", guides.includes("How to read (onto renderer):"));
check("how-to-output stripped", guides.includes("How to output (stripped renderer):"));

console.log("3. No full handoff few-shot in prompt builder:");
const exampleMarkers = ["few-shot", "one-shot example", "sample output"];
const found = exampleMarkers.filter((m) => src.toLowerCase().includes(m));
check("no full-handoff few-shot markers in harness", found.length === 0, found.length ? "found: " + found.join(", ") : "0 markers");

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS: prompt is renderer-conditional with format read/output guides");
