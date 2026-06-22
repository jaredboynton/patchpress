// Regression test for the density-reinforcement prompt work.
//
// Guards the invariant that the de-conflicted + density-reinforced prompt keeps
// the canonical `onto` benchmark runs DENSE: enough evidence spans, a populated
// promises_made array (the array most prone to dropout), and a multi-section
// handoff. Reads the recorded run artifacts under runs/bench-*onto/result.json --
// it does NOT invoke any model API, so it is safe to run repeatedly.
//
// Floors are deliberately conservative (below every observed value) so the test
// fails only on a real regression, not on run-to-run variance.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const RUNS_DIR = join(process.cwd(), "runs");
const SPAN_FLOOR = 30; // observed onto: flash-lite 57, grok43 44, g35flash 72, grok420 91
const BLOCK_FLOOR = 8; // sectional-handoff-shape requires >= 8 named blocks
const PROMISES_FLOOR = 1; // promises_made must not drop to empty

// Density reinforcement targets WEAK models only (prompt-adaptation.mjs: isWeak).
// Codex (gpt-5.x) is isStrong and receives NO adaptation lines, so its onto runs
// are out of scope for this regression and are excluded.
function ontoRunDirs() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((d) => d.startsWith("bench-") && d.endsWith("onto"))
    .filter((d) => !d.includes("codex"))
    .filter((d) => existsSync(join(RUNS_DIR, d, "result.json")));
}

const dirs = ontoRunDirs();
if (dirs.length === 0) {
  console.error("FAIL: no runs/bench-*onto/result.json artifacts found to check");
  process.exit(1);
}

let failed = 0;
for (const d of dirs.sort()) {
  const r = JSON.parse(readFileSync(join(RUNS_DIR, d, "result.json"), "utf8"));
  const spans = r.rehydrated_span_count ?? 0;
  const blocks = r.summary_block_count ?? 0;
  const promises = r.promises_made_count ?? 0;
  const problems = [];
  if (spans < SPAN_FLOOR) problems.push(`spans ${spans} < ${SPAN_FLOOR}`);
  if (blocks < BLOCK_FLOOR) problems.push(`blocks ${blocks} < ${BLOCK_FLOOR}`);
  if (promises < PROMISES_FLOOR) problems.push(`promises ${promises} < ${PROMISES_FLOOR}`);
  if (problems.length) {
    failed++;
    console.error(`FAIL ${d}: ${problems.join("; ")}`);
  } else {
    console.log(`PASS ${d}: spans=${spans} blocks=${blocks} promises=${promises}`);
  }
}

if (failed) {
  console.error(`\ndensity-reinforcement: ${failed}/${dirs.length} onto runs below floor`);
  process.exit(1);
}
console.log(`\ndensity-reinforcement OK: ${dirs.length} onto runs all >= floors (spans>=${SPAN_FLOOR}, blocks>=${BLOCK_FLOOR}, promises>=${PROMISES_FLOOR})`);
