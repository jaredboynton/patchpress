// Thin wrapper: runs the provider dry-run parity check and propagates its exit code.
// Exists so check commands can reference `scripts/test-parity.mjs` directly.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const r = spawnSync(process.execPath, [join(process.cwd(), "scripts/test-provider-dry-parity.mjs")], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
