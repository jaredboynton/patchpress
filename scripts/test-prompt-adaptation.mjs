#!/usr/bin/env node
// Comprehensive regression + full-goal evidence for the DYNAMIC per-provider/model
// prompt-mutation system (scripts/prompt-adaptation.mjs, opt-in --adapt-prompt).
// Proves and prints evidence for:
//   0. PRIOR ART - the cited best-practices doc records the model-gated prompt
//      patterns from oh-my-openagent and openclaw, plus raw findings provenance.
//   1. SOURCE    - the system is wired into compact-full-transcript.mjs (flag,
//      import, adaptationLines appended, audit metadata).
//   2. DISPATCH  - selection is dynamic per provider/model; strong models get NO
//      augmentation (byte-identical), weak models get the right cited levers.
//   3. DEFAULT   - --adapt-prompt off leaves the request byte-identical (the
//      12-combination provider dry-run parity gate still passes).
//   4. RUNTIME   - prompt mutation alone measurably lifts thin-lane density vs the
//      single-shot baselines (docs/benchmark.md: grok-4.3 sentinel 81/9 capsules,
//      flash-lite stripped 79/17 capsules).
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { buildPromptAdaptations } from "./prompt-adaptation.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

// 0. PRIOR ART recorded with citations.
console.log("0. PRIOR ART (docs/prompt-adaptation/provider-prompting.md):");
const doc = readFileSync(resolve(repoRoot, "docs/prompt-adaptation/provider-prompting.md"), "utf8");
check("oh-my-openagent model-gated prompts cited", /oh-my-openagent/.test(doc) && /createMetisAgent|METIS_K2_7|metis\.ts/.test(doc));
check("openclaw model-gated overlay cited", /openclaw/.test(doc) && /gpt5-prompt-overlay|GPT5_BEHAVIOR_CONTRACT|completion_contract/.test(doc));
check("provider docs cited (bedrock/gemini/xai/openai)", /docs\.aws\.amazon\.com/.test(doc) && /ai\.google\.dev/.test(doc) && /docs\.x\.ai/.test(doc));
const findingsPath = resolve(repoRoot, "docs/prompt-adaptation/provider-prompting.findings.json");
const nFindings = existsSync(findingsPath) ? JSON.parse(readFileSync(findingsPath, "utf8")).length : 0;
check("raw cited findings provenance saved", nFindings >= 20, nFindings + " findings");

// 1. SOURCE wiring.
console.log("1. SOURCE (scripts/compact-full-transcript.mjs):");
const src = readFileSync(resolve(repoRoot, "scripts/compact-full-transcript.mjs"), "utf8");
check("--adapt-prompt flag", /--adapt-prompt/.test(src) && /ADAPT_PROMPT =/.test(src));
check("buildPromptAdaptations imported + called", /import \{ buildPromptAdaptations, modelTraits \}/.test(src) && /buildPromptAdaptations\(\{ provider: PROVIDER, model: MODEL \}\)/.test(src));
check("adaptation lines appended to prompt", /adaptationLines: ADAPT_PROMPT \? promptAdaptation\.lines : \[\]/.test(src) && /MODEL-SPECIFIC COMPLETENESS REQUIREMENTS/.test(src));

// 2. DISPATCH dynamic per provider/model.
console.log("2. DISPATCH (dynamic per provider/model):");
function applied(provider, model) {
  return buildPromptAdaptations({ provider, model }).applied;
}
function expect(label, got, mustInclude, mustExclude) {
  const ok = mustInclude.every((id) => got.includes(id)) && mustExclude.every((id) => !got.includes(id));
  check(label + " -> [" + got.join(", ") + "]", ok);
}
expect("codex/gpt-5.4 (strong: none)", applied("codex", "gpt-5.4"), [], ["enumerate-not-summarize", "bedrock-count-floor"]);
expect("gemini-3.5-flash (sectional)", applied("gemini", "gemini-3.5-flash"),
  ["sectional-handoff-shape", "enumerate-not-summarize", "completion-contract", "preserve-literals", "gemini-35-flash-sectional"],
  ["bedrock-count-floor", "nonreasoning-decompose", "xai-mine-transcript"]);
expect("mantle/grok-4.3", applied("mantle", "xai.grok-4.3"),
  ["sectional-handoff-shape", "enumerate-not-summarize", "completion-contract", "preserve-literals", "bedrock-count-floor", "xai-mine-transcript"], ["gemini-density-steer"]);
expect("flash-lite", applied("gemini", "gemini-3.1-flash-lite"),
  ["sectional-handoff-shape", "enumerate-not-summarize", "nonreasoning-decompose", "gemini-density-steer"], ["bedrock-count-floor", "xai-mine-transcript"]);
expect("xai/grok-4.20-non-reasoning", applied("xai", "grok-4.20-0309-non-reasoning"),
  ["sectional-handoff-shape", "xai-mine-transcript", "nonreasoning-decompose"], ["bedrock-count-floor", "gemini-density-steer"]);

// 3. DEFAULT inert (parity).
console.log("3. DEFAULT (--adapt-prompt off leaves the request byte-identical):");
try {
  const parity = execFileSync("node", [resolve(repoRoot, "scripts/test-provider-dry-parity.mjs")], { cwd: repoRoot, encoding: "utf8" });
  check("provider dry-run parity", /PASS/.test(parity), parity.trim().split("\n").pop());
} catch (e) {
  check("provider dry-run parity", false, (e.stdout || e.message || "").toString().trim().split("\n").pop());
}

// 4. RUNTIME: adapt-only lifts thin-lane density vs single-shot baseline.
console.log("4. RUNTIME (prompt mutation alone vs single-shot baseline):");
function score(run) {
  const out = execFileSync("node", [resolve(repoRoot, "scripts/score-compaction-result.mjs"), resolve(repoRoot, "runs", run)], { cwd: repoRoot, encoding: "utf8" });
  return JSON.parse(out).scores[0];
}
// baselines from docs/benchmark.md
const BASE = { "bench-mantle-sentinel-adapt": { score: 81, caps: 9 }, "bench-g31lite-stripped-adapt": { score: 79, caps: 17 } };
for (const [run, b] of Object.entries(BASE)) {
  if (!existsSync(resolve(repoRoot, "runs", run, "summary.json"))) {
    check(run + " present", false, "run missing -- generate with --adapt-prompt");
    continue;
  }
  const s = score(run);
  check(
    run + " score >= single-shot baseline " + b.score,
    s.deterministic_score >= b.score,
    "det=" + s.deterministic_score + " capsules=" + s.metrics.evidence_capsules + " (baseline caps " + b.caps + ") cited=" + s.metrics.cited_unique_lines
  );
}
// grok-4.3 capsule density should rise substantially under adaptation.
if (existsSync(resolve(repoRoot, "runs/bench-mantle-sentinel-adapt/summary.json"))) {
  const g = score("bench-mantle-sentinel-adapt");
  check("grok-4.3 capsule density lifts > baseline 9", g.metrics.evidence_capsules > 9, "capsules=" + g.metrics.evidence_capsules);
}

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " prompt-mutation check(s) failed");
  process.exit(1);
}
console.log("PASS: prior art recorded + dynamic per-provider/model dispatch + default-inert + measured density lift");
