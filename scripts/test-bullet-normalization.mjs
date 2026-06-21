#!/usr/bin/env node
// Regression test for the fresh-provider-path bullet relaxation.
//
// A strict provider JSON schema enforces structure, not string content, so the
// model can legitimately return a "bullet" block whose body has an embedded
// newline. Before the fix, the fresh path ran normalizeDerivedSummaryFields and
// then validateSummary with no relaxation in between, so that one block aborted
// the whole run with `summary_blocks[i].body must be a single bullet item`.
//
// This test exercises the exact fresh-path sequence
// (normalizeDerivedSummaryFields -> validateSummary, compact-full-transcript.mjs
// :4094-4096) on a real run's summary, reproduces the abort, then asserts the
// always-run normalization now coerces the block to a paragraph so the run
// validates. It fails against the unfixed script and passes against the fixed
// one.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateSummary,
  normalizeDerivedSummaryFields,
} from "./compact-full-transcript.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const runDir = resolve(repoRoot, "runs/bench-mantle-reff-medium-sentinel");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL: " + message);
    process.exit(1);
  }
}

const summary = JSON.parse(readFileSync(resolve(runDir, "summary.json"), "utf8"));
// validateSummary checks every source span against the line-hash count, so the
// stub just needs the same length as the run's line-hashes.tsv.
const lineCount = readFileSync(resolve(runDir, "line-hashes.tsv"), "utf8")
  .split("\n")
  .filter(Boolean).length;
const lineHashArtifacts = { entries: new Array(lineCount) };

// 1. Baseline: derive compatibility fields (the real fresh-path step), validate.
normalizeDerivedSummaryFields(summary);
let error = validateSummary(summary, lineHashArtifacts);
assert(error === null, "baseline real summary should validate, got: " + error);
console.log("baseline real summary validates: OK (maxLine=" + lineCount + ")");

// 2. Inject a multi-line bullet -- a shape strict schema cannot forbid.
const blockIndex = summary.summary_blocks.length - 1;
summary.summary_blocks[blockIndex].format = "bullet";
summary.summary_blocks[blockIndex].body =
  "first line of the bullet\nsecond line that makes it multi-line";

// 3. Reproduce the abort: validateSummary with no relaxation in between.
error = validateSummary(summary, lineHashArtifacts);
assert(
  error === "summary_blocks[" + blockIndex + "].body must be a single bullet item",
  "expected the single-bullet hard-fail before relaxation, got: " + error
);
console.log(
  "injected multi-line bullet -> validateSummary error: " +
    JSON.stringify(error) +
    " (bug reproduced)"
);

// 4. The fix: the always-run normalization coerces the block to a paragraph.
normalizeDerivedSummaryFields(summary);
error = validateSummary(summary, lineHashArtifacts);
assert(error === null, "expected summary to validate after relaxation, got: " + error);
assert(
  summary.summary_blocks[blockIndex].format === "paragraph",
  "expected the block coerced to paragraph, got: " + summary.summary_blocks[blockIndex].format
);
console.log(
  "after normalizeDerivedSummaryFields -> validateSummary: null, block[" +
    blockIndex +
    "].format: paragraph (fixed)"
);

console.log(
  "PASS: a fresh-path multi-line bullet is relaxed to a paragraph instead of aborting the run"
);
