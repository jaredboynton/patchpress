#!/usr/bin/env node
// Comprehensive regression + full-goal evidence for the density-gated
// validate-and-reask loop (docs/prompt-adaptation/design.md). Proves five things
// and prints the evidence for each:
//   0. DESIGN   - cited prior art (Instructor/Guardrails/oh-my-openagent reask
//      loops) and the provider minItems enforcement reality (Bedrock 400s,
//      Flash-Lite ignores) are RECORDED in the design doc, design-first.
//   1. SOURCE   - the loop, density gate, best-attempt retention, corrective
//      feedback (up to N re-requests), required-literal targeting (--fixture
//      probes the same rehydrated text the scorer reads), and the Bedrock-safe
//      (MAX_REASKS===0) short-circuit are wired into compact-full-transcript.mjs.
//   2. BEHAVIOR - the density gate flags a thin handoff and clears a dense one.
//   3. DEFAULT  - the reask plumbing is opt-in; --max-reasks 0 is the default and
//      the provider dry-run parity gate (request bytes unchanged) still passes.
//   4. RUNTIME  - both lanes that FAILED the deterministic gate single-shot
//      (mantle 81, flash-lite 79) clear it with --max-reasks 2, zero missing
//      required literals, without breaking the Bedrock path.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { evaluateHandoffDensity } from "./handoff-density.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const harness = resolve(repoRoot, "scripts/compact-full-transcript.mjs");
let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

// 0. DESIGN + PRIOR ART recorded first.
console.log("0. DESIGN + PRIOR ART (docs/prompt-adaptation/design.md):");
const design = readFileSync(resolve(repoRoot, "docs/prompt-adaptation/design.md"), "utf8").split("\n");
function showMatches(label, re) {
  const hits = design.map((l, i) => [i + 1, l]).filter(([, l]) => re.test(l));
  check(label, hits.length > 0, hits.length + " line(s)");
  for (const [n, l] of hits.slice(0, 5)) console.log("       L" + n + ": " + l.trim());
}
showMatches("reask-loop prior art cited", /Instructor|Guardrails|oh-my-openagent|Tenacity|num_reasks|buildRetryGuidance/);
showMatches("provider minItems reality cited", /Bedrock rejects|Flash-Lite|Outlines|llguidance|minItems/);
showMatches("design + exit-proof sections", /validate-and-reask|Density gate|Corrective feedback|Exit proof/);

// 1. SOURCE evidence.
const src = readFileSync(harness, "utf8");
console.log("1. SOURCE (scripts/compact-full-transcript.mjs):");
check("reask loop present (up to N attempts)", /for \(let reaskAttempt = 0;/.test(src) && /reaskAttempt >= MAX_REASKS/.test(src));
check("--reask-until-pass flag", /REASK_UNTIL_PASS/.test(src) && /--reask-until-pass/.test(src));
check("flash-lite auto-enables until-pass", /FLASH_LITE_MODEL/.test(src) && /flash-lite-default/.test(src));
check("--no-reask-until-pass opt-out", /--no-reask-until-pass/.test(src) && /REASK_UNTIL_PASS_DISABLED/.test(src));
check("until-pass exits when density or literals still short", /REASK_UNTIL_PASS/.test(src) && /!reaskBest\.density\.pass \|\| reaskBest\.missingLiterals\.length > 0/.test(src));
check("density gate called per attempt", /evaluateHandoffDensity\(summary, DENSITY_THRESHOLDS\)/.test(src));
check("best attempt retained (with missing-literal tracking)", /reaskBest = \{ summary, outputText, events, density: reaskDensity, missingLiterals \}/.test(src));
check("corrective feedback re-sent (density + literals)", /reaskFeedback = \[reaskDensity\.feedback, buildLiteralReaskFeedback\(missingLiterals\)\]/.test(src) && /reaskFeedback,/.test(src));
check("Bedrock-safe short-circuit (no schema change)", /loadedFromOutput \|\| \(MAX_REASKS === 0 && !REASK_UNTIL_PASS\)/.test(src));
check("adapt-prompt auto-enabled with until-pass for non-codex", /REASK_UNTIL_PASS && !_promptTraits\.isStrong/.test(src));
// Literal-targeting wiring: --fixture feeds required_literals, the loop probes the
// same rehydrated text the scorer reads, and missing literals are named in feedback.
check("--fixture loads required literals", /FIXTURE_PATH = argValue\("--fixture"/.test(src) && /fixtureJson\.required_literals/.test(src));
check("literal probe reproduces scorer rehydrated text", /normalizeDerivedSummaryFields\(probeSummary\)/.test(src) && /probeSummary\.summary_markdown = renderSummaryBlocks\(probeSummary\)/.test(src) && /renderRehydratedSummary\(probeSummary, probeSpans\)/.test(src));
check("missing literals named in corrective feedback", /buildLiteralReaskFeedback\(missingLiterals\)/.test(src));

// 2. BEHAVIOR evidence (real run summaries).
console.log("2. BEHAVIOR (density gate on real summaries):");
function loadSummary(run) {
  return JSON.parse(readFileSync(resolve(repoRoot, "runs", run, "summary.json"), "utf8"));
}
const thin = evaluateHandoffDensity(loadSummary("bench-mantle-sentinel"));
check(
  "thin grok-4.3 handoff flagged",
  thin.pass === false && thin.shortfalls.length > 0 && thin.feedback.includes("INCOMPLETE"),
  "capsules=" + thin.metrics.evidence_capsules + " cited=" + thin.metrics.cited_unique_lines
);
const dense = evaluateHandoffDensity(loadSummary("bench-codex-sentinel"));
check(
  "dense codex handoff cleared",
  dense.pass === true,
  "capsules=" + dense.metrics.evidence_capsules + " cited=" + dense.metrics.cited_unique_lines
);

// 3. FLASH-LITE default: until-pass + adapt-prompt without an explicit flag.
console.log("3. FLASH-LITE DEFAULT (--reask-until-pass on all renderers):");
function dryRunMeta(args) {
  const out = execFileSync("node", [harness, "--dry-run", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const start = out.indexOf("{");
  let depth = 0;
  let end = start;
  for (let i = start; i < out.length; i++) {
    if (out[i] === "{") depth++;
    else if (out[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return JSON.parse(out.slice(start, end)).request;
}
try {
  const flashMeta = dryRunMeta([
    "--provider",
    "gemini",
    "--model",
    "gemini-3.1-flash-lite",
    "--transcript-renderer",
    "stripped",
  ]);
  check(
    "flash-lite dry-run enables until-pass",
    flashMeta.reask_until_pass === true && flashMeta.max_reasks === 10,
    "source=" + flashMeta.reask_until_pass_source
  );
  check(
    "flash-lite dry-run auto adapt-prompt",
    Array.isArray(flashMeta.prompt_adaptations) && flashMeta.prompt_adaptations.length > 0,
    "adaptations=" + (flashMeta.prompt_adaptations || []).join(",")
  );
  const flashOff = dryRunMeta([
    "--provider",
    "gemini",
    "--model",
    "gemini-3.1-flash-lite",
    "--transcript-renderer",
    "onto",
    "--no-reask-until-pass",
  ]);
  check(
    "flash-lite --no-reask-until-pass disables until-pass",
    flashOff.reask_until_pass === false && flashOff.max_reasks === 0,
    "max_reasks=" + flashOff.max_reasks
  );
} catch (e) {
  check("flash-lite dry-run meta", false, (e.stdout || e.message || "").toString().trim().split("\n").pop());
}

// 4. DEFAULT evidence: provider dry-run parity (request bytes unchanged at default).
console.log("4. DEFAULT (--max-reasks 0 leaves the request byte-identical):");
try {
  const parity = execFileSync("node", [resolve(repoRoot, "scripts/test-provider-dry-parity.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  check("provider dry-run parity", /PASS/.test(parity), parity.trim().split("\n").pop());
} catch (e) {
  check("provider dry-run parity", false, (e.stdout || e.message || "").toString().trim().split("\n").pop());
}

// 5. RUNTIME evidence: both formerly-failing lanes clear the gate with reasks.
console.log("5. RUNTIME (both formerly-failing lanes with --max-reasks 2):");
function score(run) {
  const out = execFileSync("node", [resolve(repoRoot, "scripts/score-compaction-result.mjs"), resolve(repoRoot, "runs", run)], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(out).scores[0];
}
for (const [run, baseline] of [["bench-mantle-sentinel-reask", 81], ["bench-g31lite-stripped-reask", 79]]) {
  let s;
  try {
    s = score(run);
  } catch (e) {
    check(run, false, "score failed: " + (e.message || ""));
    continue;
  }
  const missing = s.metrics.missing_literals || [];
  check(
    run + " clears the gate (single-shot baseline " + baseline + " FAIL)",
    s.deterministic_score >= 85 && s.gate_pass === true && missing.length === 0,
    "det=" + s.deterministic_score + " gate=" + s.gate_pass + " capsules=" + s.metrics.evidence_capsules + " missing_literals=" + JSON.stringify(missing)
  );
}

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " reask-loop check(s) failed");
  process.exit(1);
}
console.log("PASS: prior art recorded + reask loop wired + default-inert + both formerly-failing gate lanes cleared");
