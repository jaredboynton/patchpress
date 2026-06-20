#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function summaryFor(transcriptText, lineCount, label) {
  return {
    summary_blocks: [
      {
        section: "Current State",
        format: "paragraph",
        body: "Synthetic compaction summary for " + label + ".",
        source_spans: [{ start_line: 1, end_line: 1 }],
      },
    ],
    rules_and_invariants: [],
    plans_and_task_state: [],
    primary_request_and_intent: ["Preserve user-authored messages deterministically."],
    key_technical_concepts: ["compaction", "handoff"],
    files_and_code_sections: [],
    errors_and_fixes: [],
    problem_solving: [],
    pending_tasks: [],
    current_work: "Testing deterministic handoff user-message preservation.",
    optional_next_step: "Run the second compaction.",
    promises_made: [],
    source_integrity: {
      transcript_sha256: sha256(transcriptText),
      transcript_lines_seen: lineCount,
      verbatim_span_grounded: true,
      limitations: "Synthetic test fixture.",
    },
  };
}

function runCompact({ inputPath, outputPath, outDir }) {
  execFileSync(
    process.execPath,
    [
      compactScript,
      "--input",
      inputPath,
      "--from-output",
      outputPath,
      "--out-dir",
      outDir,
      "--preserve-tail",
      "0",
      "--user-message-collapse-at",
      "80",
      "--user-message-head-chars",
      "28",
      "--user-message-tail-chars",
      "28",
      "--handoff-user-message-limit",
      "10",
      "--handoff-user-message-token-budget",
      "4000",
      "--handoff-user-message-line-limit",
      "120",
      "--no-live-output",
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
}

function getSummaryText(afterTranscript) {
  const records = afterTranscript
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const summaryRecord = records.find((record) => record.isCompactSummary);
  const text = summaryRecord?.message?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("missing compact summary text");
  return text;
}

function assertAfterRecordCount(afterTranscript, expected, label) {
  const count = afterTranscript.trim().split(/\n/).filter(Boolean).length;
  if (count !== expected) throw new Error(label + " expected " + expected + " records, got " + count);
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(label + " missing expected text: " + needle);
  }
}

const tmp = await mkdtemp(join(tmpdir(), "claudecompact-handoff-test-"));
try {
  const firstRecords = [
    {
      type: "user",
      uuid: "u-1",
      timestamp: "2026-06-20T00:00:00.000Z",
      message: { role: "user", content: "First instruction: preserve alpha." },
    },
    {
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-06-20T00:00:01.000Z",
      message: { role: "assistant", content: "Acknowledged." },
    },
    {
      type: "user",
      uuid: "u-2",
      timestamp: "2026-06-20T00:00:02.000Z",
      message: {
        role: "user",
        content:
          "Second instruction begins: preserve beta. " +
          "This middle section is intentionally long so the handoff renderer must collapse it without losing the head or tail. " +
          "Second instruction tail: preserve gamma.",
      },
    },
    {
      type: "assistant",
      uuid: "a-2",
      timestamp: "2026-06-20T00:00:03.000Z",
      message: { role: "assistant", content: "Working on it." },
    },
  ];
  const firstInput = join(tmp, "first.jsonl");
  const firstTranscript = jsonl(firstRecords);
  await writeFile(firstInput, firstTranscript);
  const firstOutput = join(tmp, "first-output.json");
  await writeFile(firstOutput, JSON.stringify(summaryFor(firstTranscript, firstRecords.length, "first")));
  const firstOutDir = join(tmp, "first-run");
  runCompact({ inputPath: firstInput, outputPath: firstOutput, outDir: firstOutDir });
  const firstAfter = await readFile(join(firstOutDir, "after-compact.jsonl"), "utf8");
  assertAfterRecordCount(firstAfter, 2, "first handoff");
  const firstSummaryText = getSummaryText(firstAfter);

  assertIncludes(firstSummaryText, "## User Messages", "first handoff");
  assertIncludes(firstSummaryText, "First instruction: preserve alpha.", "first handoff");
  assertIncludes(firstSummaryText, "Second instruction begins", "first handoff");
  assertIncludes(firstSummaryText, "preserve gamma.", "first handoff");
  assertIncludes(firstSummaryText, "[... omitted ", "first handoff");

  const secondRecordsText =
    firstAfter +
    jsonl([
      {
        type: "user",
        uuid: "u-3",
        timestamp: "2026-06-20T00:00:04.000Z",
        message: { role: "user", content: "Third instruction: preserve delta after compaction." },
      },
      {
        type: "assistant",
        uuid: "a-3",
        timestamp: "2026-06-20T00:00:05.000Z",
        message: { role: "assistant", content: "Continuing after compaction." },
      },
    ]);
  const secondInput = join(tmp, "second.jsonl");
  await writeFile(secondInput, secondRecordsText);
  const secondRecords = secondRecordsText.trim().split(/\n/).length;
  const secondOutput = join(tmp, "second-output.json");
  await writeFile(secondOutput, JSON.stringify(summaryFor(secondRecordsText, secondRecords, "second")));
  const secondOutDir = join(tmp, "second-run");
  runCompact({ inputPath: secondInput, outputPath: secondOutput, outDir: secondOutDir });
  const secondAfter = await readFile(join(secondOutDir, "after-compact.jsonl"), "utf8");
  assertAfterRecordCount(secondAfter, 2, "second handoff");
  const secondSummaryText = getSummaryText(secondAfter);

  assertIncludes(secondSummaryText, "First instruction: preserve alpha.", "second handoff");
  assertIncludes(secondSummaryText, "preserve gamma.", "second handoff");
  assertIncludes(secondSummaryText, "Third instruction: preserve delta after compaction.", "second handoff");

  const userMessageTags = secondSummaryText.match(/<user-message\s/g) || [];
  if (userMessageTags.length !== 3) {
    throw new Error("expected 3 carried/current user messages, got " + userMessageTags.length);
  }
  console.log("handoff user-message preservation test passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
