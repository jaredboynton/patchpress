#!/usr/bin/env node
import { combinedIndex, qualityIndex, speedIndex } from "./benchmark-ranking.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

// Quality: 0.65*94 + 0.35*100 = 96.1
check("quality index (passing lane)", qualityIndex({ deterministicScore: 94, judgeScore: 10, gatePass: true }) === 96.1);

// Gate fail: 96.1 * 0.88 = 84.568 -> 84.6
check(
  "gate fail multiplier",
  qualityIndex({ deterministicScore: 94, judgeScore: 10, gatePass: false }) === 84.6,
);

// Speed: 15/36.4*100 = 41.208 -> 41.2
check("speed index", speedIndex(36.4) === 41.2);
check("speed capped at 100", speedIndex(3.4) === 100);

// Combined: 0.6*96.1 + 0.4*41.2 = 74.14 -> 74.1
check("combined index", combinedIndex(96.1, 41.2) === 74.1);

// Fast high-quality lane beats slow top-quality lane.
const grokStripped = combinedIndex(
  qualityIndex({ deterministicScore: 90, judgeScore: 10, gatePass: true }),
  speedIndex(13.5),
);
const gptOnto = combinedIndex(
  qualityIndex({ deterministicScore: 94, judgeScore: 10, gatePass: true }),
  speedIndex(36.4),
);
check("grok-4.20 stripped outranks gpt-5.4 onto on combined", grokStripped > gptOnto, grokStripped + " > " + gptOnto);

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " benchmark-ranking check(s) failed");
  process.exit(1);
}
console.log("PASS: bench-combined.v1 formula checks");
