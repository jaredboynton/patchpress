#!/usr/bin/env node
// Asserts two properties of the compaction prompt, answering: does the prompt
// vary by renderer, and does it include a few-shot example?
//   1. The prompt IS renderer-conditional: buildFullTranscriptPrompt splices
//      rendererEvidenceInstructions(stats.transcriptRenderer), and that function
//      returns distinct evidence-span instructions for sentinel / onto / stripped.
//   2. The prompt has NO few-shot example: it is instruction-only; structure is
//      carried by the strict json_schema, not a demonstrated output.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const src = readFileSync(resolve(repoRoot, "scripts/compact-full-transcript.mjs"), "utf8");
let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

console.log("1. Renderer-conditional evidence block:");
check("prompt splices rendererEvidenceInstructions(stats.transcriptRenderer)",
  src.includes("rendererEvidenceInstructions(stats.transcriptRenderer)"));
check("sentinel variant present", /sentinel records beginning with @@RECORD/.test(src));
check("onto variant present", /ONTO columnar framing/.test(src));
check("stripped variant present", /wrapped as <record line=/.test(src));

console.log("2. No few-shot example in the prompt:");
const exampleMarkers = ["few-shot", "one-shot example", "sample output", "sample json", "example item"];
const found = exampleMarkers.filter((m) => src.toLowerCase().includes(m));
check("no example/few-shot markers", found.length === 0, found.length ? "found: " + found.join(", ") : "0 markers");

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS: prompt is renderer-conditional (sentinel/onto/stripped); no few-shot example");
