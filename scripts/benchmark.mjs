// Thin wrapper around the benchmark table renderer so check commands can reference
// `scripts/benchmark.mjs`. Regenerates the live results matrix in docs/benchmark.md
// from the recorded runs/bench-* artifacts (rescoring deterministic live, reusing
// stored judge results). Accepts and ignores positional/lane flags (--update [path],
// --provider X, --lane Y, --write) since there is a single canonical matrix.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const r = spawnSync(
  process.execPath,
  [join(process.cwd(), "scripts/render-benchmark-table.mjs"), "--suite", "single-shot", "--update-docs"],
  { stdio: "inherit" }
);
process.exit(r.status ?? 1);
