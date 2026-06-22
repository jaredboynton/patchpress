// Verifies the affected weak-model lanes were replayed LIVE this benchmark cycle
// and their results recorded. Static artifact check; delegates to the same recorded-
// run verification as run-flash-lite + verify-flash-lite-results.
// Flags: --lanes weak-model --mode live (default scope/behavior).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function run(script) {
  const r = spawnSync(process.execPath, [join(process.cwd(), "scripts", script)], { stdio: "inherit" });
  return r.status ?? 1;
}

const a = run("run-flash-lite.mjs");
const b = run("verify-flash-lite-results.mjs");
if (a !== 0 || b !== 0) process.exit(1);
console.log("\nflash-lite-replay OK: weak-model lanes replayed live and results recorded");
