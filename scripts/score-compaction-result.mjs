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
  return { manifest, count: manifest.artifacts?.length || 0, bad };
}

function ratioScore(actual, required, points) {
  if (!required || required <= 0) return points;
  return Math.round(Math.min(1, Math.max(0, actual / required)) * points);
}

function boolScore(value, points) {
  return value ? points : 0;
}

function collectSourceSpans(value, spans = []) {
  if (!value || typeof value !== "object") return spans;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceSpans(item, spans);
    return spans;
  }
  if (Array.isArray(value.source_spans)) {
    for (const span of value.source_spans) {
      if (Number.isInteger(span?.start_line) && Number.isInteger(span?.end_line)) spans.push(span);
    }
  }
  for (const child of Object.values(value)) collectSourceSpans(child, spans);
  return spans;
}

function spanMetrics(state) {
  const spans = collectSourceSpans({
    summary_blocks: state.summary_blocks,
    rules_and_invariants: state.rules_and_invariants,
    plans_and_task_state: state.plans_and_task_state,
    promises_made: state.promises_made,
  });
  const uniqueLines = new Set();
  const invalid = [];
  const lineCount = Number(state.source_integrity?.transcript_lines_seen || 0);
  for (const [idx, span] of spans.entries()) {
    if (span.start_line < 1 || span.end_line < span.start_line || (lineCount > 0 && span.end_line > lineCount)) {
      invalid.push("span-" + idx + ":" + span.start_line + "-" + span.end_line);
      continue;
    }
    for (let line = span.start_line; line <= span.end_line; line += 1) uniqueLines.add(line);
  }
  return { spans: spans.length, invalid, unique_lines: uniqueLines.size };
}

function evidenceMetrics(state) {
  const bad = [];
  let emptyTextSegments = 0;
  let textSegmentChars = 0;
  let codeCapsules = 0;
  for (const capsule of state.evidence_capsules || []) {
    if (capsule.validation !== "verified") bad.push(capsule.id || "<missing-id>");
    if (!Array.isArray(capsule.text_segments) || capsule.text_segments.length === 0) {
      emptyTextSegments += 1;
      bad.push((capsule.id || "<missing-id>") + ":empty-text-segments");
    } else {
      for (const segment of capsule.text_segments) {
        const chars = Number(segment.char_count || 0);
        if (chars <= 0) bad.push((capsule.id || "<missing-id>") + ":empty-segment");
        textSegmentChars += Math.max(0, chars);
      }
    }
    codeCapsules += Array.isArray(capsule.code_capsules) ? capsule.code_capsules.length : 0;
    if (!capsule.raw_slice_sha256 && capsule.source_kind === "jsonl_record") {
      bad.push((capsule.id || "<missing-id>") + ":missing-raw-hash");
    }
    if (!capsule.extracted_text_sha256) bad.push((capsule.id || "<missing-id>") + ":missing-text-hash");
  }
  return {
    bad,
    empty_text_segments: emptyTextSegments,
    text_segment_chars: textSegmentChars,
    code_capsules: codeCapsules,
  };
}

async function scoreRun(dir, fixture) {
  const result = await readJson(join(dir, "result.json"));
  const state = await readJson(join(dir, "handoff-state.json"));
  const rehydrated = await readFile(join(dir, "summary.rehydrated.md"), "utf8");
  const { manifest, count: manifestArtifactCount, bad: badManifestHashes } = await verifyManifest(dir);
  const required = fixture.required_state || {};

  const missingLiterals = (fixture.required_literals || []).filter((literal) => !rehydrated.includes(literal));
  const stateText = JSON.stringify(state);
  const unsupportedHighRiskLiterals = (fixture.required_literals || []).filter(
    (literal) => stateText.includes(literal) && !rehydrated.includes(literal),
  );

  const evidence = evidenceMetrics(state);
  const spans = spanMetrics(state);
  const userIntentEvents = state.user_intent_events?.length || 0;
  const evidenceCapsules = state.evidence_capsules?.length || 0;
  const requiredEvidenceCapsules = required.min_evidence_capsules || 0;
  const requiredUserIntentEvents = required.min_user_intent_events || 0;
  const citedLineTarget = required.min_cited_lines || 0;
  const ruleCount = state.rules_and_invariants?.length || 0;
  const planItemCount = state.plans_and_task_state?.length || 0;
  const promiseCount = state.promises_made?.length || 0;
  const maxAfterTokens = required.max_after_estimated_tokens || 6000;

  const artifactIntegrity =
    boolScore(result.ok === true, 8) +
    boolScore(badManifestHashes.length === 0, 9) +
    boolScore(manifest.validation?.artifact_hashes === "passed" || badManifestHashes.length === 0, 4) +
    boolScore(evidence.bad.length === 0, 4);
  const evidenceGrounding =
    ratioScore(evidenceCapsules, requiredEvidenceCapsules, 8) +
    ratioScore(spans.unique_lines, citedLineTarget, 3) +
    boolScore(evidence.empty_text_segments === 0, 2) +
    boolScore(evidence.bad.length === 0 && spans.invalid.length === 0, 2);
  const continuityState =
    ratioScore(userIntentEvents, requiredUserIntentEvents, 6) +
    boolScore(Boolean(state.active_state?.current_objective), 4) +
    boolScore(Boolean(state.active_state?.next_step), 4) +
    boolScore(ruleCount > 0, 2) +
    boolScore(planItemCount > 0, 2) +
    boolScore(promiseCount > 0, 2);
  const exactLiteralRecovery =
    fixture.required_literals?.length > 0
      ? ratioScore(fixture.required_literals.length - missingLiterals.length, fixture.required_literals.length, 20)
      : 20;
  const unsupportedClaims = unsupportedHighRiskLiterals.length === 0 ? 10 : 0;
  const footprint =
    boolScore(result.after_estimated_tokens > 0 && result.after_bytes > 0, 4) +
    boolScore(result.after_estimated_tokens > 0 && result.after_estimated_tokens <= maxAfterTokens, 6);
  const deterministicScore =
    artifactIntegrity + evidenceGrounding + continuityState + exactLiteralRecovery + unsupportedClaims + footprint;
  const gatePass =
    result.ok === true &&
    badManifestHashes.length === 0 &&
    evidence.bad.length === 0 &&
    spans.invalid.length === 0 &&
    missingLiterals.length === 0 &&
    Boolean(state.active_state?.current_objective) &&
    Boolean(state.active_state?.next_step) &&
    (!required.require_integrity_echo || result.integrity_echo_matches === true) &&
    deterministicScore >= (required.min_deterministic_score || 85);

  return {
    dir,
    deterministic_score: deterministicScore,
    max_score: 100,
    gate_pass: gatePass,
    categories: {
      artifact_integrity: artifactIntegrity,
      state_retention: evidenceGrounding + continuityState,
      evidence_grounding: evidenceGrounding,
      continuity_state: continuityState,
      exact_literal_recovery: exactLiteralRecovery,
      unsupported_claims: unsupportedClaims,
      footprint,
    },
    metrics: {
      after_estimated_tokens: result.after_estimated_tokens,
      after_bytes: result.after_bytes,
      user_intent_events: userIntentEvents,
      evidence_capsules: evidenceCapsules,
      source_spans: spans.spans,
      invalid_source_spans: spans.invalid,
      cited_unique_lines: spans.unique_lines,
      empty_text_segments: evidence.empty_text_segments,
      bad_evidence_capsules: evidence.bad,
      evidence_text_segment_chars: evidence.text_segment_chars,
      code_capsules: evidence.code_capsules,
      rules: ruleCount,
      plan_items: planItemCount,
      promises: promiseCount,
      manifest_artifacts: manifestArtifactCount,
      bad_manifest_hashes: badManifestHashes.length,
      missing_literals: missingLiterals,
      unsupported_high_risk_literals: unsupportedHighRiskLiterals,
      integrity_echo_matches: result.integrity_echo_matches === true,
    },
  };
}

function renderMarkdown(scores) {
  const lines = [
    "# Deterministic Compaction Score",
    "",
    "| Run | Score | Gate | Tokens | Evidence | Cited Lines | User Events | Rules | Plans | Promises | Missing Literals | Bad Hashes |",
    "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const score of scores) {
    lines.push(
      "| " +
        score.dir +
        " | " +
        score.deterministic_score +
        "/" +
        score.max_score +
        " | " +
        (score.gate_pass ? "pass" : "fail") +
        " | " +
        score.metrics.after_estimated_tokens +
        " | " +
        score.metrics.evidence_capsules +
        " | " +
        score.metrics.cited_unique_lines +
        " | " +
        score.metrics.user_intent_events +
        " | " +
        score.metrics.rules +
        " | " +
        score.metrics.plan_items +
        " | " +
        score.metrics.promises +
        " | " +
        score.metrics.missing_literals.length +
        " | " +
        score.metrics.bad_manifest_hashes +
        " |",
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
const payload = { schema: "deterministic-compaction-score.v2", fixture: fixturePath, scores };
if (outPath) await writeFile(resolve(outPath), JSON.stringify(payload, null, 2) + "\n");
if (markdownPath) await writeFile(resolve(markdownPath), renderMarkdown(scores));
console.log(JSON.stringify(payload, null, 2));
