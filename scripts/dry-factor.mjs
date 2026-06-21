#!/usr/bin/env node
// Deterministic "dry factor" detector for compaction provider wiring.
//
// The dry factor is the number of distinct code sites a developer must edit to
// add one new compaction provider. It is computed by scanning a target file for
// per-provider coupling: `PROVIDER === "<name>"` comparisons, per-provider
// constant declarations (CODEX_/GEMINI_/XAI_/MANTLE_...), and the
// provider allowlist. Lower is better; a registry-driven design collapses the
// repeated `if (PROVIDER === ...)` chains toward zero.
//
// Usage: node scripts/dry-factor.mjs [--file <path>] [--json]

import { readFileSync } from "fs";
import { resolve } from "path";

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const FILE = resolve(argValue("--file", "scripts/compact-full-transcript.mjs"));
const asJson = process.argv.includes("--json");

// Known provider names. Extend if a provider is added; the detector reports
// coupling for each so the count reflects reality rather than a fixed list.
const PROVIDERS = ["codex", "gemini", "xai", "mantle"];
const CONST_PREFIXES = ["CODEX_", "GEMINI_", "XAI_", "MANTLE_"];

const lines = readFileSync(FILE, "utf8").split(/\r?\n/);

const sites = [];
function record(category, lineNo, text) {
  sites.push({ category, line: lineNo, text: text.trim().slice(0, 140) });
}

const reProviderCmp = /PROVIDER\s*===\s*["']([a-z0-9.-]+)["']/g;
const reProviderLiteralInChain = /provider\s*===\s*["']([a-z0-9.-]+)["']/g;
const reConst = new RegExp("\\b(" + CONST_PREFIXES.join("|") + ")[A-Z0-9_]+", "g");

lines.forEach((line, idx) => {
  const lineNo = idx + 1;
  // 1. PROVIDER === "name" runtime dispatch comparisons (the core coupling)
  let m;
  reProviderCmp.lastIndex = 0;
  while ((m = reProviderCmp.exec(line)) !== null) {
    record("provider_compare", lineNo, line);
  }
  // 2. lowercase `provider === "name"` (normalizeProvider allowlist)
  reProviderLiteralInChain.lastIndex = 0;
  while ((m = reProviderLiteralInChain.exec(line)) !== null) {
    record("allowlist_compare", lineNo, line);
  }
  // 3. per-provider constant references (declarations and uses)
  reConst.lastIndex = 0;
  while ((m = reConst.exec(line)) !== null) {
    record("provider_constant", lineNo, m[0]);
  }
});

// Distinct lines that carry any provider coupling = the real edit-site count.
const distinctLines = new Set(sites.map((s) => s.line));

// Per-category line counts (distinct lines per category).
const byCategory = {};
for (const s of sites) {
  byCategory[s.category] = byCategory[s.category] || new Set();
  byCategory[s.category].add(s.line);
}
const categoryCounts = Object.fromEntries(
  Object.entries(byCategory).map(([k, v]) => [k, v.size])
);

const report = {
  file: FILE,
  providers: PROVIDERS,
  dry_factor: distinctLines.size,
  total_couplings: sites.length,
  by_category: categoryCounts,
  sites: sites.sort((a, b) => a.line - b.line),
};

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  console.log("DRY FACTOR for " + FILE);
  console.log("  distinct provider-coupled lines (edit sites): " + report.dry_factor);
  console.log("  total provider couplings: " + report.total_couplings);
  console.log("  by category:");
  for (const [k, v] of Object.entries(categoryCounts)) {
    console.log("    " + k + ": " + v);
  }
  console.log("  sites:");
  for (const s of report.sites) {
    console.log("    " + String(s.line).padStart(5) + "  [" + s.category + "] " + s.text);
  }
}
