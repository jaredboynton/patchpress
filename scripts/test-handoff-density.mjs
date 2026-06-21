#!/usr/bin/env node
// Verifies the handoff density gate (scripts/handoff-density.mjs) on real run
// summaries: the thin grok-4.3 handoff must FAIL the gate with corrective
// feedback, the dense codex handoff must PASS, and the capsule proxy must track
// the count the deterministic scorer reads from handoff-state.json.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateHandoffDensity,
  countEvidenceCapsules,
} from "./handoff-density.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL: " + message);
    process.exit(1);
  }
}

function load(run) {
  const dir = resolve(repoRoot, "runs", run);
  const summary = JSON.parse(readFileSync(resolve(dir, "summary.json"), "utf8"));
  let scorerCapsules = null;
  const statePath = resolve(dir, "handoff-state.json");
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    scorerCapsules = Array.isArray(state.evidence_capsules)
      ? state.evidence_capsules.length
      : null;
  }
  return { summary, scorerCapsules };
}

// 1. Thin handoff (grok-4.3 mantle sentinel: 9 capsules) must FAIL the gate.
const thin = load("bench-mantle-sentinel");
const thinResult = evaluateHandoffDensity(thin.summary);
console.log(
  "grok-4.3 sentinel: capsules(proxy)=" +
    thinResult.metrics.evidence_capsules +
    " scorer=" +
    thin.scorerCapsules +
    " cited=" +
    thinResult.metrics.cited_unique_lines +
    " promises=" +
    thinResult.metrics.promises +
    " -> pass=" +
    thinResult.pass
);
assert(thinResult.pass === false, "thin grok-4.3 handoff should FAIL the density gate");
assert(thinResult.shortfalls.length > 0, "thin handoff should report shortfalls");
assert(thinResult.feedback.includes("INCOMPLETE"), "thin handoff should produce corrective feedback");
assert(
  thin.scorerCapsules === null || thinResult.metrics.evidence_capsules === thin.scorerCapsules,
  "capsule proxy (" + thinResult.metrics.evidence_capsules + ") must match scorer (" + thin.scorerCapsules + ")"
);
console.log("  feedback preview: " + thinResult.feedback.split("\n")[0]);

// 2. Dense handoff (codex sentinel: ~55 capsules) must PASS the gate.
const dense = load("bench-codex-sentinel");
const denseResult = evaluateHandoffDensity(dense.summary);
console.log(
  "codex sentinel:   capsules(proxy)=" +
    denseResult.metrics.evidence_capsules +
    " scorer=" +
    dense.scorerCapsules +
    " cited=" +
    denseResult.metrics.cited_unique_lines +
    " -> pass=" +
    denseResult.pass
);
assert(denseResult.pass === true, "dense codex handoff should PASS the density gate");
assert(
  dense.scorerCapsules === null || denseResult.metrics.evidence_capsules === dense.scorerCapsules,
  "capsule proxy (" + denseResult.metrics.evidence_capsules + ") must match scorer (" + dense.scorerCapsules + ")"
);

console.log("PASS: density gate flags the thin handoff, clears the dense one, and the capsule proxy matches the scorer");
