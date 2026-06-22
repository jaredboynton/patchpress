// Verifies the recorded RESULTS of the affected weak-model onto lanes: each lane's
// run is ok, its stored semantic-judge verdict passes, and its evidence density is
// above floor. Static artifact check (no API calls).
// Flag: --affected-weak-model-lanes (default scope).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LANES = [
  "bench-gemini-flashlite-onto",
  "bench-gemini35flash-onto",
  "bench-grok420-onto",
  "bench-grok43-onto",
];
const RUNS_DIR = join(process.cwd(), "runs");
const SPAN_FLOOR = 30;
let failed = 0;

for (const lane of LANES) {
  const dir = join(RUNS_DIR, lane);
  const resPath = join(dir, "result.json");
  const judgePath = join(dir, "semantic-judge", "semantic-judge-result.json");
  if (!existsSync(resPath) || !existsSync(judgePath)) {
    console.error(`FAIL ${lane}: missing result.json or semantic-judge result`);
    failed++;
    continue;
  }
  const r = JSON.parse(readFileSync(resPath, "utf8"));
  const j = JSON.parse(readFileSync(judgePath, "utf8"));
  const spans = r.rehydrated_span_count ?? 0;
  const problems = [];
  if (!r.ok) problems.push("run not ok");
  if (!j.overall_pass) problems.push(`judge fail (${j.total_level_score}/10)`);
  if (spans < SPAN_FLOOR) problems.push(`spans ${spans} < ${SPAN_FLOOR}`);
  if (problems.length) {
    console.error(`FAIL ${lane}: ${problems.join("; ")}`);
    failed++;
  } else {
    console.log(`PASS ${lane}: ok, judge ${j.total_level_score}/10 pass, spans=${spans}`);
  }
}

if (failed) process.exit(1);
console.log(`\nverify-flash-lite-results OK: ${LANES.length} affected lanes recorded passing results`);
