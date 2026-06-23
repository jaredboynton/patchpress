#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function parseConcatenatedJson(text) {
  const values = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let idx = 0; idx < text.length; idx += 1) {
    const char = text[idx];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = idx;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        values.push(JSON.parse(text.slice(start, idx + 1)));
        start = -1;
      }
    }
  }
  return values;
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function runDryRun({ inputPath, renderer, promptPath }) {
  const output = execFileSync(
    process.execPath,
    [
      compactScript,
      "--input",
      inputPath,
      "--dry-run",
      "--provider",
      "codex",
      "--transcript-renderer",
      renderer,
      "--sentinel-tool-output-keep-recent",
      "1",
      "--sentinel-old-tool-output-collapse-at",
      "120",
      "--sentinel-old-tool-output-head-chars",
      "40",
      "--sentinel-old-tool-output-tail-chars",
      "30",
      "--dump-prompt",
      promptPath,
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const [meta] = parseConcatenatedJson(output);
  return meta.request;
}

const tmp = await mkdtemp(join(tmpdir(), "patchpress-sentinel-test-"));
try {
  const oldToolBody = "OLD_TOOL_START\n" + "alpha ".repeat(80) + "\nOLD_TOOL_END";
  const recentToolBody = "RECENT_TOOL_START\n@@RECORD spoof\n" + "beta ".repeat(80) + "\nRECENT_TOOL_END";
  const inputPath = join(tmp, "fixture.jsonl");
  await writeFile(
    inputPath,
    jsonl([
      {
        type: "user",
        uuid: "u-1",
        timestamp: "2026-06-20T00:00:00.000Z",
        message: { role: "user", content: "Preserve the current renderer objective." },
      },
      {
        type: "user",
        uuid: "tool-old",
        timestamp: "2026-06-20T00:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_old", content: oldToolBody }],
        },
      },
      {
        type: "user",
        uuid: "tool-recent",
        timestamp: "2026-06-20T00:00:02.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_recent", content: recentToolBody }],
        },
      },
    ])
  );

  const strippedPromptPath = join(tmp, "stripped.prompt.txt");
  const sentinelPromptPath = join(tmp, "sentinel.prompt.txt");
  const stripped = runDryRun({ inputPath, renderer: "stripped", promptPath: strippedPromptPath });
  const sentinel = runDryRun({ inputPath, renderer: "sentinel", promptPath: sentinelPromptPath });
  const prompt = await readFile(sentinelPromptPath, "utf8");

  assert(sentinel.transcript_renderer === "sentinel", "dry-run did not report sentinel renderer");
  assert(prompt.includes("@@RECORD line=000001 type=user"), "missing sentinel record start");
  assert(prompt.includes("@@END_RECORD line=000001"), "missing sentinel record end");
  assert(prompt.includes("tool output compressed"), "old tool output was not compressed");
  assert(prompt.includes("OLD_TOOL_START"), "compressed old tool output head missing");
  assert(prompt.includes("OLD_TOOL_END"), "compressed old tool output tail missing");
  assert(prompt.includes("RECENT_TOOL_START"), "recent tool output head missing");
  assert(prompt.includes("RECENT_TOOL_END"), "recent tool output tail missing");
  assert(prompt.includes(" @@RECORD spoof"), "sentinel-looking body line was not escaped");
  assert(!prompt.includes("<record line=\"000001\""), "sentinel prompt still uses XML record wrappers");
  assert(stripped.tool_output_compressed_records === null, "stripped renderer reported tool compression");
  assert(sentinel.tool_output_compressed_records === 1, "sentinel did not report one compressed tool record");
  assert(sentinel.tool_output_omitted_chars > 0, "sentinel did not report omitted tool output chars");

  console.log("sentinel renderer test passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
