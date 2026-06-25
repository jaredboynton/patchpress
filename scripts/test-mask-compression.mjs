#!/usr/bin/env node
// Observation-masking tool-output strategy (arXiv:2508.21433) regression.
// Verifies the "mask" strategy drops the entire old tool-output body to a single
// metadata placeholder (unlike headtail/dspc, which retain partial content), that
// the body stays recoverable via body_sha256, and that the result is deterministic.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function runPrompt(inputPath, strategy, promptPath) {
  execFileSync(
    process.execPath,
    [
      compactScript,
      "--input",
      inputPath,
      "--dry-run",
      "--provider",
      "codex",
      "--transcript-renderer",
      "sentinel",
      "--tool-output-compress-strategy",
      strategy,
      "--sentinel-tool-output-keep-recent",
      "1",
      "--sentinel-old-tool-output-collapse-at",
      "200",
      "--sentinel-old-tool-output-head-chars",
      "80",
      "--sentinel-old-tool-output-tail-chars",
      "40",
      "--dump-prompt",
      promptPath,
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  return readFile(promptPath, "utf8");
}

const tmp = await mkdtemp(join(tmpdir(), "patchpress-mask-test-"));
try {
  const filler = Array.from({ length: 40 }, () => "Routine batch job completed with status ok.").join("\n");
  const head = "HEADMARKER_zzz first line of the tool output.\n".repeat(20);
  const tail = "\nTAILMARKER_zzz last line of the tool output.\n".repeat(20);
  const middle = "MIDDLEMARKER critical anomaly in payment ledger xj9zz.\n";
  const toolBody = head + middle + filler + tail;

  const inputPath = join(tmp, "fixture.jsonl");
  await writeFile(
    inputPath,
    jsonl([
      {
        type: "user",
        uuid: "u-1",
        timestamp: "2026-06-20T00:00:00.000Z",
        message: { role: "user", content: "Investigate the payment reconciliation anomaly." },
      },
      {
        type: "user",
        uuid: "tool-old",
        timestamp: "2026-06-20T00:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_old", content: toolBody }],
        },
      },
      {
        type: "user",
        uuid: "tool-small",
        timestamp: "2026-06-20T00:00:01.500Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_small", content: "SMALLMARKER tiny output, left intact." }],
        },
      },
      {
        type: "assistant",
        uuid: "a-1",
        timestamp: "2026-06-20T00:00:02.000Z",
        message: { role: "assistant", content: "Acknowledged." },
      },
    ])
  );

  const headtail = await runPrompt(inputPath, "headtail", join(tmp, "ht.prompt.txt"));
  const mask = await runPrompt(inputPath, "mask", join(tmp, "mask.prompt.txt"));
  const mask2 = await runPrompt(inputPath, "mask", join(tmp, "mask2.prompt.txt"));

  // headtail (the default) keeps partial content: head + tail survive.
  assert(headtail.includes("[tool output compressed: original_chars="), "headtail did not compress");
  assert(headtail.includes("HEADMARKER_zzz"), "headtail unexpectedly dropped the head");

  // mask emits its own marker and accounts every original char as omitted.
  assert(mask.includes("[tool output masked: strategy=mask"), "mask marker missing");
  assert(/original_lines=\d+/.test(mask), "mask original_lines accounting missing");
  const m = mask.match(/strategy=mask original_chars=(\d+) original_lines=\d+ omitted_chars=(\d+)/);
  assert(m, "mask marker fields malformed");
  assert(m[1] === m[2], "mask omitted_chars must equal original_chars (full-body drop)");

  // Full-body masking: NONE of the original body content survives.
  assert(!mask.includes("HEADMARKER_zzz"), "mask leaked head content");
  assert(!mask.includes("MIDDLEMARKER"), "mask leaked middle content");
  assert(!mask.includes("TAILMARKER_zzz"), "mask leaked tail content");
  assert(!mask.includes("xj9zz"), "mask leaked buried content");

  // Recoverability preserved (same as headtail/dspc).
  assert(/body_sha256=[0-9a-f]{64}/.test(mask), "mask dropped body_sha256 recoverability marker");

  // Small tool outputs (under the collapse threshold) are left untouched.
  assert(mask.includes("SMALLMARKER tiny output, left intact."), "mask wrongly collapsed a small tool output");

  // Deterministic, offline: identical output across runs.
  assert(mask === mask2, "mask output is not deterministic across runs");

  const omitted = (mask.match(/omitted_chars=(\d+)/) || [])[1];
  console.log("mask compression test passed");
  console.log("  verified: '--tool-output-compress-strategy mask' emits '[tool output masked: strategy=mask ...]'");
  console.log("  verified: full-body drop -- head/middle/tail/buried content all ABSENT (omitted_chars=" + omitted + " == original_chars)");
  console.log("  verified: headtail (default) still RETAINS partial content (head survives), confirming mask is distinct");
  console.log("  verified: body_sha256 recoverability marker preserved");
  console.log("  verified: small tool outputs under the collapse threshold are left intact");
  console.log("  verified: deterministic/offline -- two mask runs produced byte-identical output (no model calls in this path)");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
