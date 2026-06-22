// Regression test: the promises_made array stays populated (no dropout).
//
// promises_made is the array most prone to collapsing to empty on weak models.
// This test asserts two things, both from static artifacts (no API calls):
//   1. The prompt-adaptation registry still carries an explicit promises scan.
//   2. Every re-run weak-model onto benchmark run recorded promises_made_count >= 1.
// Weak vs strong is per prompt-adaptation.mjs: density adaptations apply only when
// a.applies(traits) is true (buildPromptAdaptations :74-78) and those adaptations
// gate on (t) => t.isWeak, which excludes codex (isStrong, :36/:58/:85-86). So
// codex onto runs are out of scope and excluded.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let failed = 0;

// 1. The adaptation source must still instruct an explicit promises scan.
const adaptSrc = readFileSync(join(process.cwd(), "scripts/prompt-adaptation.mjs"), "utf8");
if (!/promises_made/.test(adaptSrc) || !/commitment/i.test(adaptSrc)) {
  console.error("FAIL: prompt-adaptation.mjs no longer instructs an explicit promises_made / commitment scan");
  failed++;
} else {
  console.log("PASS: prompt-adaptation.mjs retains the promises_made commitment scan");
}

// 2. Re-run weak-model onto runs must have a non-empty promises_made array.
const RUNS_DIR = join(process.cwd(), "runs");
const dirs = existsSync(RUNS_DIR)
  ? readdirSync(RUNS_DIR)
      .filter((d) => d.startsWith("bench-") && d.endsWith("onto") && !d.includes("codex"))
      .filter((d) => existsSync(join(RUNS_DIR, d, "result.json")))
  : [];
if (dirs.length === 0) {
  console.error("FAIL: no weak-model onto run artifacts found");
  failed++;
}
for (const d of dirs.sort()) {
  const r = JSON.parse(readFileSync(join(RUNS_DIR, d, "result.json"), "utf8"));
  const promises = r.promises_made_count ?? 0;
  if (promises < 1) {
    console.error(`FAIL ${d}: promises_made_count ${promises} < 1 (dropout)`);
    failed++;
  } else {
    console.log(`PASS ${d}: promises_made_count=${promises}`);
  }
}

if (failed) process.exit(1);
console.log("\npromises-made OK: scan present and no array dropout in weak-model onto runs");
