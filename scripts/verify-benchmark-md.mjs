// Verifies docs/benchmark.md reflects the re-measured results and carries a live
// results matrix. Static doc check (no API calls). Flags:
//   --require-remeasured   require the 2026-06-22 re-measure provenance note.
//   --require-live-matrix  require the generated matrix markers + a flash-lite onto
//                          row showing deterministic + judge pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const doc = readFileSync(join(process.cwd(), "docs/benchmark.md"), "utf8");
let failed = 0;
function need(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failed++;
  } else {
    console.log("PASS: " + msg);
  }
}

if (argv.includes("--require-remeasured")) {
  need(/2026-06-22/.test(doc), "benchmark.md carries the 2026-06-22 re-measure date");
  need(/re-run live|re-run \(2026-06-22\)|onto lanes re-run/i.test(doc), "benchmark.md notes the live re-run provenance");
}

if (argv.includes("--require-live-matrix")) {
  need(/BENCH_TABLE_SINGLE_SHOT_START/.test(doc), "benchmark.md contains the generated single-shot matrix markers");
  // A flash-lite onto row that passes both deterministic and judge.
  const flRow = doc.split("\n").find((l) => /gemini-3\.1-flash-lite/.test(l) && /onto/.test(l) && /100 pass/.test(l));
  need(Boolean(flRow), "benchmark.md has a flash-lite onto row at 100 deterministic pass");
  need(Boolean(flRow && /10 pass/.test(flRow)), "the flash-lite onto row shows judge 10 pass");
}

if (argv.length === 0) {
  need(/BENCH_TABLE_SINGLE_SHOT_START/.test(doc), "benchmark.md contains the generated matrix markers");
}

if (failed) process.exit(1);
console.log("\nverify-benchmark-md OK");
