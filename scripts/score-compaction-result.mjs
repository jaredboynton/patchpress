#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function positionalDirs() {
  const dirs = [];
  for (let idx = 2; idx < process.argv.length; idx += 1) {
    const value = process.argv[idx];
    if (value.startsWith("--")) {
      const next = process.argv[idx + 1];
      if (next && !next.startsWith("--")) idx += 1;
      continue;
    }
    dirs.push(value);
  }
  return dirs;
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function verifyManifest(dir) {
  const manifest = await readJson(join(dir, "handoff-manifest.json"));
  const bad = [];
  for (const artifact of manifest.artifacts || []) {
    const actual = sha256Text(await readFile(join(dir, artifact.path), "utf8"));
    if (actual !== artifact.sha256) bad.push(artifact.path);
  }
  return { count: manifest.artifacts?.length || 0, bad };
}

function scoreBoolean(value, points) {
  return value ? points : 0;
}

async function scoreRun(dir, fixture) {
  const result = await readJson(join(dir, "result.json"));
  const state = await readJson(join(dir, "handoff-state.json"));
  const rehydrated = await readFile(join(dir, "summary.rehydrated.md"), "utf8");
  const manifest = await verifyManifest(dir);
  const required = fixture.required_state || {};
  const missingLiterals = (fixture.required_literals || []).filter((literal) => !rehydrated.includes(literal));
  const unsupportedHighRiskLiterals = [];
  const stateText = JSON.stringify(state);
  for (const literal of fixture.required_literals || []) {
    if (stateText.includes(literal) && !rehydrated.includes(literal)) unsupportedHighRiskLiterals.push(literal);
  }

  const artifactIntegrity = scoreBoolean(result.ok === true, 10) + scoreBoolean(manifest.bad.length === 0, 20);
  const stateRetention =
    scoreBoolean((state.user_intent_events?.length || 0) >= (required.min_user_intent_events || 0), 10) +
    scoreBoolean((state.evidence_capsules?.length || 0) >= (required.min_evidence_capsules || 0), 10) +
    scoreBoolean(Boolean(state.active_state?.current_objective), 5) +
    scoreBoolean(Boolean(state.active_state?.next_step), 5);
  const exactLiteralRecovery =
    fixture.required_literals?.length > 0
      ? Math.round(((fixture.required_literals.length - missingLiterals.length) / fixture.required_literals.length) * 20)
      : 20;
  const unsupportedClaims = unsupportedHighRiskLiterals.length === 0 ? 10 : 0;
  const footprint = result.after_estimated_tokens > 0 ? 10 : 0;
  const total = artifactIntegrity + stateRetention + exactLiteralRecovery + unsupportedClaims + footprint;
  return {
    dir,
    total,
    max_score: 100,
    passed: total >= 90 && missingLiterals.length === 0 && manifest.bad.length === 0,
    categories: {
      artifact_integrity: artifactIntegrity,
      state_retention: stateRetention,
      exact_literal_recovery: exactLiteralRecovery,
      unsupported_claims: unsupportedClaims,
      footprint,
    },
    metrics: {
      after_estimated_tokens: result.after_estimated_tokens,
      after_bytes: result.after_bytes,
      user_intent_events: state.user_intent_events?.length || 0,
      evidence_capsules: state.evidence_capsules?.length || 0,
      manifest_artifacts: manifest.count,
      bad_manifest_hashes: manifest.bad.length,
      missing_literals: missingLiterals,
      unsupported_high_risk_literals: unsupportedHighRiskLiterals,
      integrity_echo_matches: result.integrity_echo_matches === true,
    },
  };
}

function renderMarkdown(scores) {
  const lines = [
    "# EXP-07 Compaction Scorecard",
    "",
    "| Run | Score | Pass | Tokens | Evidence | User Events | Missing Literals | Bad Hashes |",
    "|---|---:|---|---:|---:|---:|---:|---:|",
  ];
  for (const score of scores) {
    lines.push(
      "| " +
        score.dir +
        " | " +
        score.total +
        "/" +
        score.max_score +
        " | " +
        (score.passed ? "pass" : "fail") +
        " | " +
        score.metrics.after_estimated_tokens +
        " | " +
        score.metrics.evidence_capsules +
        " | " +
        score.metrics.user_intent_events +
        " | " +
        score.metrics.missing_literals.length +
        " | " +
        score.metrics.bad_manifest_hashes +
        " |"
    );
  }
  lines.push("");
  return lines.join("\n");
}

const fixturePath = resolve(argValue("--fixture", "docs/experiments/fixtures/devin-reverse-engineering.v1.json"));
const outPath = argValue("--out", "");
const markdownPath = argValue("--markdown", "");
const dirs = positionalDirs().map((dir) => resolve(dir));
if (dirs.length === 0) throw new Error("Usage: score-compaction-result.mjs <run-dir> [<run-dir>...]");
const fixture = await readJson(fixturePath);
const scores = [];
for (const dir of dirs) scores.push(await scoreRun(dir, fixture));
const payload = { schema: "compaction-scorecard.v1", fixture: fixturePath, scores };
if (outPath) await writeFile(resolve(outPath), JSON.stringify(payload, null, 2) + "\n");
if (markdownPath) await writeFile(resolve(markdownPath), renderMarkdown(scores));
console.log(JSON.stringify(payload, null, 2));
if (!scores.every((score) => score.passed)) process.exit(1);
