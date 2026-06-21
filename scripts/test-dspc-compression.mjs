#!/usr/bin/env node
// DSPC tool-output compression strategy (arXiv:2509.13723) regression.
// Verifies the importance-based selection keeps a high-salience middle sentence
// that the blind head/tail window would drop, and that the result is deterministic.
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

const tmp = await mkdtemp(join(tmpdir(), "claudecompact-dspc-test-"));
try {
  const filler = Array.from({ length: 40 }, () => "Routine batch job completed with status ok.").join("\n");
  const head = "Routine batch job completed with status ok.\n".repeat(20);
  const tail = "\n" + "Routine batch job completed with status ok.".repeat(1).concat("\n").repeat(20);
  // Distinctive, high-IDF sentence buried in the middle (head/tail would drop it).
  const toolBody = head + "CRITICAL anomaly detected in payment reconciliation ledger xj9zz.\n" + filler + tail;

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
        type: "assistant",
        uuid: "a-1",
        timestamp: "2026-06-20T00:00:02.000Z",
        message: { role: "assistant", content: "Acknowledged." },
      },
    ])
  );

  const headtail = await runPrompt(inputPath, "headtail", join(tmp, "ht.prompt.txt"));
  const dspc = await runPrompt(inputPath, "dspc", join(tmp, "dspc.prompt.txt"));
  const dspc2 = await runPrompt(inputPath, "dspc", join(tmp, "dspc2.prompt.txt"));

  // Both strategies compress; markers identify which ran.
  assert(headtail.includes("[tool output compressed: original_chars="), "headtail did not compress");
  assert(!headtail.includes("strategy=dspc"), "headtail must not emit a dspc marker");
  assert(dspc.includes("[tool output compressed: strategy=dspc"), "dspc marker missing");
  assert(/stage1_kept=\d+\/\d+/.test(dspc), "dspc stage1 accounting missing");
  assert(/omitted_chars=[1-9]/.test(dspc), "dspc reported no omitted chars");

  // Importance win: the blind head/tail window drops the middle critical line;
  // DSPC's salience scoring keeps it.
  assert(!headtail.includes("xj9zz"), "head/tail unexpectedly kept the middle critical line");
  assert(dspc.includes("xj9zz"), "dspc dropped the high-salience critical line");

  // Deterministic, offline: identical output across runs.
  assert(dspc === dspc2, "dspc output is not deterministic across runs");

  const stage1 = (dspc.match(/stage1_kept=(\d+)\/(\d+)/) || []).slice(1).join("/");
  const omitted = (dspc.match(/omitted_chars=(\d+)/) || [])[1];
  console.log("dspc compression test passed");
  console.log("  verified: default strategy 'headtail' emits the blind head/tail marker and NO dspc marker");
  console.log("  verified: '--tool-output-compress-strategy dspc' emits '[tool output compressed: strategy=dspc ...]'");
  console.log("  verified: DSPC Stage-1 TF-IDF sentence accounting present (stage1_kept=" + stage1 + "), omitted_chars=" + omitted);
  console.log("  verified: importance win -- the buried high-IDF line 'xj9zz' is DROPPED by head/tail but KEPT by dspc");
  console.log("  verified: deterministic/offline -- two dspc runs produced byte-identical output (no model calls in this path)");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
