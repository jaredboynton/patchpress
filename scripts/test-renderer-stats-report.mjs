#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tmp = await mkdtemp(join(tmpdir(), "patchpress-renderer-stats-"));
try {
  const reportPath = join(tmp, "renderer-stats-report.md");
  const stdout = execFileSync(
    process.execPath,
    [
      compactScript,
      "--renderer-stats-report",
      reportPath,
      "--renderer-stats-renderers",
      "stripped,sentinel,jsonl",
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const result = JSON.parse(stdout);
  assert(result.ok === true, "renderer stats command did not report ok");
  assert(result.renderer_stats_report === reportPath, "renderer stats report path mismatch");
  const markdown = await readFile(reportPath, "utf8");
  assert(markdown.includes("# Renderer Stats Report"), "missing title");
  assert(markdown.includes("## Renderer Comparison"), "missing renderer comparison");
  assert(markdown.includes("## Record Types"), "missing record types");
  assert(markdown.includes("## Content Block Types"), "missing block types");
  assert(markdown.includes("| sentinel | 1,066 | 451,925 | 112,401 | 11 | 137,749 | 34,438 |"), "missing sentinel totals");
  assert(markdown.includes("| thinking | 108 | 108 | 378,148 | 0 |"), "thinking blocks should be raw-only");
  assert(markdown.includes("| tool_result | 264 | 264 | 198,377 | 166,372 |"), "missing tool_result block stats");
  assert(markdown.includes("This report is generated locally and does not call any model provider."), "missing no-provider note");
  console.log("renderer stats report test passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
