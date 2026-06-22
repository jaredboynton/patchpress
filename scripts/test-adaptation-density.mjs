// Verifies the adaptation density floor and promises_made integrity from recorded
// artifacts (no API calls). Flags:
//   --min-capsules N         capsule floor for the flash-lite onto lane (the goal's
//                            target lane; default 50). Other weak lanes are reported
//                            for context but not gated, since their floors differ.
//   --require-promises-array every weak-model onto run must have promises_made >= 1.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const minIdx = argv.indexOf("--min-capsules");
const MIN_CAPSULES = minIdx >= 0 ? Number.parseInt(argv[minIdx + 1], 10) : 50;
const REQUIRE_PROMISES = argv.includes("--require-promises-array");

const RUNS_DIR = join(process.cwd(), "runs");
function read(dir) {
  return JSON.parse(readFileSync(join(RUNS_DIR, dir, "result.json"), "utf8"));
}
const weak = existsSync(RUNS_DIR)
  ? readdirSync(RUNS_DIR)
      .filter((d) => d.startsWith("bench-") && d.endsWith("onto") && !d.includes("codex"))
      .filter((d) => existsSync(join(RUNS_DIR, d, "result.json")))
      .sort()
  : [];

let failed = 0;

// Capsule floor on the flash-lite onto lane (goal subject).
const flLane = "bench-gemini-flashlite-onto";
if (!weak.includes(flLane)) {
  console.error(`FAIL: ${flLane}/result.json not found (cannot check capsule floor)`);
  failed++;
} else {
  const caps = read(flLane).rehydrated_span_count ?? 0;
  if (caps < MIN_CAPSULES) {
    console.error(`FAIL ${flLane}: capsules ${caps} < ${MIN_CAPSULES}`);
    failed++;
  } else {
    console.log(`PASS ${flLane}: capsules=${caps} >= ${MIN_CAPSULES}`);
  }
}

// Promises integrity across all weak onto lanes.
if (REQUIRE_PROMISES) {
  for (const d of weak) {
    const promises = read(d).promises_made_count ?? 0;
    if (promises < 1) {
      console.error(`FAIL ${d}: promises_made_count ${promises} < 1`);
      failed++;
    } else {
      console.log(`PASS ${d}: promises_made_count=${promises}`);
    }
  }
}

// Context (not gated): capsule counts for the other weak lanes.
for (const d of weak.filter((d) => d !== flLane)) {
  console.log(`info ${d}: capsules=${read(d).rehydrated_span_count ?? 0}`);
}

if (failed) process.exit(1);
console.log("\nadaptation-density OK");
