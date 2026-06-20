#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function positionalDir() {
  for (let idx = 2; idx < process.argv.length; idx += 1) {
    const value = process.argv[idx];
    if (value.startsWith("--")) {
      const next = process.argv[idx + 1];
      if (next && !next.startsWith("--")) idx += 1;
      continue;
    }
    return value;
  }
  throw new Error("Usage: judge-compaction-result.mjs <run-dir> [--dry-run] [--from-output judge.json]");
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function judgeOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schema", "rubric_version", "candidate_hashes", "overall_pass", "verdicts", "unknowns", "evidence_refs"],
    properties: {
      schema: { type: "string", enum: ["semantic-compaction-judge-output.v1"] },
      rubric_version: { type: "string" },
      candidate_hashes: {
        type: "object",
        additionalProperties: false,
        required: ["handoff_md_sha256", "rehydrated_md_sha256", "state_sha256"],
        properties: {
          handoff_md_sha256: { type: "string" },
          rehydrated_md_sha256: { type: "string" },
          state_sha256: { type: "string" },
        },
      },
      overall_pass: { type: "boolean" },
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "verdict", "reason", "evidence_refs"],
          properties: {
            criterion: {
              type: "string",
              enum: ["groundedness", "completeness", "continuation_utility", "conciseness"],
            },
            verdict: { type: "string", enum: ["pass", "fail", "unknown"] },
            reason: { type: "string" },
            evidence_refs: { type: "array", items: { type: "string" } },
          },
        },
      },
      unknowns: { type: "array", items: { type: "string" } },
      evidence_refs: { type: "array", items: { type: "string" } },
    },
  };
}

function validateJudgeOutput(value, allowedEvidenceRefs) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "judge output is not an object";
  if (value.schema !== "semantic-compaction-judge-output.v1") return "schema invalid";
  if (typeof value.rubric_version !== "string" || !value.rubric_version) return "rubric_version missing";
  if (typeof value.overall_pass !== "boolean") return "overall_pass missing";
  if (!value.candidate_hashes || typeof value.candidate_hashes !== "object") return "candidate_hashes missing";
  for (const key of ["handoff_md_sha256", "rehydrated_md_sha256", "state_sha256"]) {
    if (typeof value.candidate_hashes[key] !== "string" || !value.candidate_hashes[key]) {
      return "candidate_hashes." + key + " missing";
    }
  }
  if (!Array.isArray(value.verdicts)) return "verdicts missing";
  for (const [idx, verdict] of value.verdicts.entries()) {
    if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return "verdicts[" + idx + "] invalid";
    if (!["groundedness", "completeness", "continuation_utility", "conciseness"].includes(verdict.criterion)) {
      return "verdicts[" + idx + "].criterion invalid";
    }
    if (!["pass", "fail", "unknown"].includes(verdict.verdict)) return "verdicts[" + idx + "].verdict invalid";
    if (typeof verdict.reason !== "string" || !verdict.reason.trim()) return "verdicts[" + idx + "].reason missing";
    if (!Array.isArray(verdict.evidence_refs) || verdict.evidence_refs.length === 0) {
      return "verdicts[" + idx + "].evidence_refs missing";
    }
    for (const ref of verdict.evidence_refs) {
      if (!allowedEvidenceRefs.has(ref)) return "verdicts[" + idx + "] unknown evidence ref: " + ref;
    }
  }
  if (!Array.isArray(value.unknowns)) return "unknowns missing";
  if (!Array.isArray(value.evidence_refs)) return "evidence_refs missing";
  for (const ref of value.evidence_refs) {
    if (!allowedEvidenceRefs.has(ref)) return "unknown top-level evidence ref: " + ref;
  }
  return null;
}

function truncate(text, chars) {
  const value = String(text || "");
  if (value.length <= chars) return value;
  const head = Math.floor(chars * 0.55);
  const tail = chars - head;
  return value.slice(0, head) + "\n\n[... omitted " + (value.length - chars) + " chars ...]\n\n" + value.slice(-tail);
}

function evidenceRefsFromState(state) {
  const capsuleRefs = (state.evidence_capsules || []).slice(0, 80).map((capsule) => ({
    id: capsule.id,
    span_id: capsule.span_id,
    record_range: capsule.record_range,
    extracted_text_sha256: capsule.extracted_text_sha256,
    section: capsule.section,
  }));
  const userRefs = (state.user_intent_events || [])
    .filter((event) => event.priority === "must_keep" || event.priority === "high")
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      priority: event.priority,
      text_sha256: event.text_sha256,
      source: event.source,
    }));
  return [...capsuleRefs, ...userRefs];
}

async function buildJudgeRequest(runDir) {
  const [result, state, manifest, handoff, rehydrated] = await Promise.all([
    readJson(join(runDir, "result.json")),
    readJson(join(runDir, "handoff-state.json")),
    readJson(join(runDir, "handoff-manifest.json")),
    readFile(join(runDir, "handoff.md"), "utf8"),
    readFile(join(runDir, "summary.rehydrated.md"), "utf8"),
  ]);
  const candidateHashes = {
    handoff_md_sha256: sha256Text(handoff),
    rehydrated_md_sha256: sha256Text(rehydrated),
    state_sha256: sha256Text(JSON.stringify(state)),
  };
  return {
    schema: "semantic-compaction-judge-request.v1",
    run_dir: runDir,
    candidate_hashes: candidateHashes,
    rubric: {
      version: "semantic-compaction-rubric.v1",
      gates_remain_deterministic: true,
      judge_is_advisory: true,
      instruction:
        "Judge continuation quality only after deterministic artifact/hash/literal gates pass. Do not override deterministic failures. Use source evidence only; external knowledge is not allowed. Use pass/fail/unknown verdicts.",
      dimensions: {
        groundedness: "Each material claim in handoff.md must be supported by handoff-state.json or summary.rehydrated.md evidence.",
        completeness: "The handoff must preserve current objective, constraints, important artifacts, open work, and exact literals needed to continue.",
        continuation_utility: "A fresh agent should know the next action and have enough context to proceed without reopening the full transcript.",
        conciseness: "The handoff should avoid stale chronology and redundant tool output while preserving recoverable evidence.",
      },
    },
    deterministic_metrics: {
      ok: result.ok,
      after_estimated_tokens: result.after_estimated_tokens,
      user_intent_events: state.user_intent_events?.length || 0,
      evidence_capsules: state.evidence_capsules?.length || 0,
      manifest_artifacts: manifest.artifacts?.length || 0,
      manifest_validation: manifest.validation || {},
    },
    evidence_refs: evidenceRefsFromState(state),
    response_schema: judgeOutputSchema(),
    judge_prompt: [
      "You are an evidence-grounded compaction quality judge.",
      "Return strict JSON matching response_schema.",
      "Do not use external knowledge. Each verdict must cite one or more IDs from evidence_refs.",
      "Deterministic gates remain authoritative; your job is advisory semantic review of continuation quality.",
      "Use pass/fail/unknown. Mark unknown when the provided evidence is insufficient.",
      "",
      "## Handoff",
      truncate(handoff, 16000),
      "",
      "## Canonical State",
      truncate(JSON.stringify(state, null, 2), 16000),
      "",
      "## Rehydrated Evidence",
      truncate(rehydrated, 16000),
    ].join("\n"),
  };
}

async function main() {
  const runDir = resolve(positionalDir());
  const outDir = resolve(argValue("--out-dir", join(runDir, "semantic-judge")));
  const dryRun = process.argv.includes("--dry-run") || !argValue("--from-output");
  const outputPath = argValue("--from-output", "");
  await mkdir(outDir, { recursive: true });
  const request = await buildJudgeRequest(runDir);
  await writeFile(join(outDir, "semantic-judge-request.json"), JSON.stringify(request, null, 2) + "\n");
  if (dryRun) {
    const result = {
      ok: true,
      dry_run: true,
      run_dir: runDir,
      request_artifact: join(outDir, "semantic-judge-request.json"),
      schema: request.schema,
      evidence_ref_count: request.evidence_refs.length,
    };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const judgeOutput = JSON.parse(await readFile(resolve(outputPath), "utf8"));
  const allowedRefs = new Set((request.evidence_refs || []).map((ref) => ref.id));
  const validationError = validateJudgeOutput(judgeOutput, allowedRefs);
  const result = {
    ok: !validationError,
    dry_run: false,
    run_dir: runDir,
    judge_output: basename(resolve(outputPath)),
    validation_error: validationError,
    overall_pass: judgeOutput.overall_pass ?? null,
    verdict_count: Array.isArray(judgeOutput.verdicts) ? judgeOutput.verdicts.length : 0,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (validationError) process.exit(1);
}

await main();
