#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");
const judgeScript = join(repoRoot, "scripts", "judge-compaction-result.mjs");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runNode(args, options = {}) {
  return execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

const tmp = await mkdtemp(join(tmpdir(), "patchpress-future-work-test-"));
try {
  const largeToolOutput =
    "TOOL_OUTPUT_BEGIN\n" +
    "alpha ".repeat(1000) +
    "\nSHOULD_BE_COMPRESSED_MIDDLE\n" +
    "omega ".repeat(1000) +
    "\nTOOL_OUTPUT_END";
  const records = [
    {
      type: "user",
      uuid: "u-1",
      timestamp: "2026-06-20T00:00:00.000Z",
      message: { role: "user", content: "Preserve future-work fixture." },
    },
    {
      type: "user",
      uuid: "tool-1",
      timestamp: "2026-06-20T00:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-use-1", content: largeToolOutput }],
      },
    },
    {
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-06-20T00:00:02.000Z",
      message: { role: "assistant", content: "Acknowledged future-work fixture." },
    },
  ];
  const transcript = jsonl(records);
  const inputPath = join(tmp, "fixture.jsonl");
  const promptPath = join(tmp, "sentinel-prompt.txt");
  await writeFile(inputPath, transcript);

  runNode([
    compactScript,
    "--input",
    inputPath,
    "--dry-run",
    "--dump-prompt",
    promptPath,
    "--transcript-renderer",
    "sentinel",
    "--tool-output-compress-after",
    "1",
    "--tool-output-compress-min-chars",
    "1000",
  ]);
  const prompt = await readFile(promptPath, "utf8");
  assert(prompt.includes("@@RECORD line=000002"), "sentinel renderer did not emit record header");
  assert(prompt.includes("[tool output compressed"), "old tool output was not compressed");
  assert(!prompt.includes("SHOULD_BE_COMPRESSED_MIDDLE"), "compressed tool output leaked middle body");

  const outputPath = join(tmp, "output.json");
  await writeFile(
    outputPath,
    JSON.stringify({
      summary_blocks: [
        {
          section: "Current State",
          format: "paragraph",
          body: "Future-work fixture preserved.",
          source_spans: [{ start_line: 1, end_line: 3 }],
        },
      ],
      rules_and_invariants: [],
      plans_and_task_state: [],
      promises_made: [],
      current_work: "Future-work fixture preserved.",
      optional_next_step: "Run future-work gates.",
      source_integrity: {
        transcript_sha256: sha256(transcript),
        transcript_lines_seen: records.length,
        verbatim_span_grounded: true,
        limitations: "Future work fixture.",
      },
    })
  );
  const outDir = join(tmp, "run");
  runNode([
    compactScript,
    "--input",
    inputPath,
    "--from-output",
    outputPath,
    "--out-dir",
    outDir,
    "--preserve-tail",
    "0",
    "--no-live-output",
    "--transcript-renderer",
    "sentinel",
    "--tool-output-compress-after",
    "1",
    "--tool-output-compress-min-chars",
    "1000",
  ]);
  const manifest = await readJson(join(outDir, "handoff-manifest.json"));
  const handoff = await readFile(join(outDir, "handoff.md"), "utf8");
  assert(manifest.artifact_policy?.schema === "artifact-retention-policy.v1", "manifest policy missing");
  assert(
    manifest.artifacts.every((artifact) => artifact.retention && artifact.exposure && artifact.redaction),
    "artifact policy fields missing"
  );
  assert(
    manifest.provider?.renderer_policy?.transcript_renderer === "sentinel",
    "renderer policy missing from manifest"
  );
  assert(!handoff.includes("## Current Work"), "handoff has redundant current-work wrapper");
  assert(handoff.indexOf("## Current State") < handoff.indexOf("## User Messages"), "handoff summary is not first");

  const judgeOut = join(tmp, "judge");
  const judgeStdout = runNode([
    judgeScript,
    outDir,
    "--out-dir",
    judgeOut,
    "--dry-run",
  ]);
  const judgeResult = JSON.parse(judgeStdout);
  assert(judgeResult.ok === true && judgeResult.dry_run === true, "judge dry run failed");
  const judgeRequest = await readJson(join(judgeOut, "semantic-judge-request.json"));
  assert(judgeRequest.schema === "semantic-compaction-judge-request.v2", "judge request schema missing");
  assert(judgeRequest.rubric.gates_remain_deterministic === true, "judge deterministic-gate constraint missing");
  assert(
    judgeRequest.response_schema.properties.total_level_score.type === "integer",
    "judge total-level score field missing"
  );
  assert(
    judgeRequest.response_schema.properties.dimensions.items.properties.criterion.enum.includes("next_step_actionability"),
    "next-step-actionability rubric missing"
  );
  const evidenceRef = judgeRequest.evidence_refs[0]?.id;
  assert(evidenceRef, "judge request has no evidence refs");
  const judgeCriteria = judgeRequest.response_schema.properties.dimensions.items.properties.criterion.enum;
  const judgeOutput = {
    schema: "semantic-compaction-judge-output.v3",
    rubric_version: judgeRequest.rubric.version,
    candidate_hashes: judgeRequest.candidate_hashes,
    total_level_score: judgeCriteria.length * 2,
    overall_pass: true,
    dimensions: judgeCriteria.map((criterion) => ({
      criterion,
      evidence_quote: "Supported by the fixture evidence.",
      reason: "Supported by the fixture evidence.",
      level: "clear",
      evidence_refs: [evidenceRef],
    })),
    unknowns: [],
    evidence_refs: [evidenceRef],
  };
  const judgeOutputPath = join(tmp, "judge-output-valid.json");
  await writeFile(judgeOutputPath, JSON.stringify(judgeOutput, null, 2) + "\n");
  const judgeValidateOut = join(tmp, "judge-validate");
  const judgeValidateStdout = runNode([
    judgeScript,
    outDir,
    "--out-dir",
    judgeValidateOut,
    "--from-output",
    judgeOutputPath,
  ]);
  const judgeValidateResult = JSON.parse(judgeValidateStdout);
  assert(judgeValidateResult.total_level_score === judgeCriteria.length * 2, "valid judge score was not recorded");
  assert(judgeValidateResult.dimension_count === judgeCriteria.length, "valid judge dimensions were not recorded");

  const badJudgeOutputPath = join(tmp, "judge-output-bad-score.json");
  await writeFile(
    badJudgeOutputPath,
    JSON.stringify({ ...judgeOutput, total_level_score: judgeCriteria.length * 2 - 1 }, null, 2) + "\n"
  );
  let rejectedBadScore = false;
  try {
    runNode([
      judgeScript,
      outDir,
      "--out-dir",
      join(tmp, "judge-bad-score"),
      "--from-output",
      badJudgeOutputPath,
    ]);
  } catch (error) {
    rejectedBadScore = true;
    assert(error.status === 1, "bad score validation failed with unexpected status");
    const rejectedResult = JSON.parse(error.stdout);
    assert(
      rejectedResult.validation_error === "total_level_score does not match dimension levels",
      "bad score validation error was not specific"
    );
  }
  assert(rejectedBadScore, "judge accepted mismatched total_level_score");

  console.log("future work test passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
