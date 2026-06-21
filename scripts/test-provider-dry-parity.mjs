#!/usr/bin/env node
// Regression gate for the provider refactor: every provider x renderer must
// produce a byte-identical dry-run request body (volatile ids/timestamps
// normalized) versus the committed golden fixtures under
// tests/fixtures/dry-run-golden/. This is the oracle that proves a DRY
// refactor of provider dispatch changed no observable request behavior.
//
// Regenerate fixtures intentionally with --update after a deliberate change.
//
// Usage: node scripts/test-provider-dry-parity.mjs [--update]

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");
const fixtureDir = join(repoRoot, "tests", "fixtures", "dry-run-golden");
const inputPath = process.env.DRY_PARITY_INPUT || "/tmp/e-reduced.jsonl";
const update = process.argv.includes("--update");

const PROVIDERS = ["codex", "gemini", "xai", "mantle"];
const RENDERERS = ["sentinel", "stripped", "onto"];

// Normalize volatile fields so only request logic is compared.
function normalize(text) {
  return text
    .replace(
      /"(sessionId|threadId|installationId|windowId|x-client-request-id|session-id|thread-id|x-codex-installation-id|x-codex-window-id)":\s*"[^"]*"/g,
      '"$1":"<v>"'
    )
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "<uuid>"
    );
}

function dryRun(provider, renderer) {
  const out = execFileSync(
    "node",
    [
      compactScript,
      "--provider",
      provider,
      "--transcript-renderer",
      renderer,
      "--input",
      inputPath,
      "--out-dir",
      "/tmp/fixed-dry",
      "--dry-run",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  return normalize(out);
}

if (!existsSync(inputPath)) {
  console.error("Missing input fixture: " + inputPath);
  console.error("Set DRY_PARITY_INPUT or create a small reduced transcript first.");
  process.exit(2);
}

if (update) mkdirSync(fixtureDir, { recursive: true });

let fail = 0;
for (const provider of PROVIDERS) {
  for (const renderer of RENDERERS) {
    const got = dryRun(provider, renderer);
    const fixturePath = join(fixtureDir, provider + "-" + renderer + ".json");
    if (update) {
      writeFileSync(fixturePath, got);
      console.log("WROTE  " + provider + "/" + renderer);
      continue;
    }
    if (!existsSync(fixturePath)) {
      console.log("MISSING fixture " + provider + "/" + renderer);
      fail = 1;
      continue;
    }
    const want = readFileSync(fixturePath, "utf8");
    if (got === want) {
      console.log("MATCH  " + provider + "/" + renderer);
    } else {
      console.log("DIFFER " + provider + "/" + renderer);
      fail = 1;
    }
  }
}

if (update) {
  console.log("Fixtures updated.");
  process.exit(0);
}
if (fail) {
  console.error("Provider dry-run parity FAILED: request body changed for at least one provider.");
  process.exit(1);
}
console.log("Provider dry-run parity PASS (all " + PROVIDERS.length * RENDERERS.length + " combinations).");
