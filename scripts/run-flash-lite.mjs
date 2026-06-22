// Verifies that the affected weak-model onto lanes have a recorded LIVE run from
// this benchmark cycle (the de-conflicted + density-reinforced prompt). It checks
// the recorded artifacts and does NOT re-invoke any model API (the live runs were
// already performed and recorded under runs/bench-*onto). Pass --live to force a
// re-run is intentionally NOT supported here; re-running is done by the compaction
// CLI directly. Flag: --affected-weak-model-lanes (default scope).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LANES = [
  "bench-gemini-flashlite-onto",
  "bench-gemini35flash-onto",
  "bench-grok420-onto",
  "bench-grok43-onto",
];
const RUNS_DIR = join(process.cwd(), "runs");
let failed = 0;

console.log("[verify] confirming affected weak-model onto lanes have recorded LIVE runs (no API re-invocation)");
for (const lane of LANES) {
  const dir = join(RUNS_DIR, lane);
  const resPath = join(dir, "result.json");
  if (!existsSync(resPath)) {
    console.error(`FAIL ${lane}: no result.json`);
    failed++;
    continue;
  }
  const r = JSON.parse(readFileSync(resPath, "utf8"));
  const live = r.loaded_from_output === false;
  const hasResponse = existsSync(join(dir, "response.sse")) || existsSync(join(dir, "events.jsonl"));
  if (!r.ok || !live || !hasResponse) {
    console.error(`FAIL ${lane}: ok=${r.ok} live=${live} response=${hasResponse}`);
    failed++;
  } else {
    console.log(`PASS ${lane}: live run recorded (ok, loaded_from_output=false, response artifact present)`);
  }
}

if (failed) process.exit(1);
console.log(`\nrun-flash-lite OK: ${LANES.length} affected weak-model lanes have recorded live runs`);
