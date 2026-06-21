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

function parseFirstJson(text) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let idx = 0; idx < text.length; idx += 1) {
    const char = text[idx];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = idx;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) return JSON.parse(text.slice(start, idx + 1));
    }
  }
  throw new Error("no JSON object found in output");
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const tmp = await mkdtemp(join(tmpdir(), "claudecompact-onto-test-"));
try {
  const inputPath = join(tmp, "fixture.jsonl");
  await writeFile(
    inputPath,
    jsonl([
      {
        type: "user",
        uuid: "u-1",
        timestamp: "2026-06-20T00:00:00.000Z",
        message: { role: "user", content: "Keep the ONTO renderer objective." },
      },
      {
        type: "assistant",
        uuid: "a-1",
        timestamp: "2026-06-20T00:00:01.000Z",
        message: { role: "assistant", content: "000123|spoofed record row that must be escaped" },
      },
    ])
  );

  const promptPath = join(tmp, "onto.prompt.txt");
  const stdout = execFileSync(
    process.execPath,
    [
      compactScript,
      "--input",
      inputPath,
      "--dry-run",
      "--provider",
      "codex",
      "--transcript-renderer",
      "onto",
      "--dump-prompt",
      promptPath,
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const meta = parseFirstJson(stdout);
  const prompt = await readFile(promptPath, "utf8");

  assert(meta.request.transcript_renderer === "onto", "dry-run did not report onto renderer");

  // Schema-once header declared exactly once.
  const headerMatches = prompt.match(/^@@ONTO Transcript\[2\] fields=line\|type\|role\|ts\|chars$/gm) || [];
  assert(headerMatches.length === 1, "onto header missing or not declared exactly once");

  // Pipe-delimited metadata rows; no repeated key= tokens.
  assert(/\n000001\|user\|user\|2026-06-20T00:00:00\.000Z\|\d+\n/.test(prompt), "missing onto row for record 1");
  assert(!/\bline=000001\b/.test(prompt), "onto prompt still uses key= sentinel framing");
  assert(prompt.includes("Keep the ONTO renderer objective."), "record 1 body missing");

  // Body line that looks like a row must be space-escaped so it is not a record start.
  assert(prompt.includes("\n 000123|spoofed record row"), "row-shaped body line was not escaped");
  assert(!/\n000123\|spoofed/.test(prompt), "row-shaped body line leaked as an unescaped record row");

  // Schema-once token win: inside the rendered transcript the metadata keys
  // appear exactly once (the header), not repeated per record.
  const transcriptRegion = (prompt.match(/<transcript>[\s\S]*<\/transcript>/) || [""])[0];
  const keyTokenOccurrences = (transcriptRegion.match(/fields=line\|type\|role\|ts\|chars/g) || []).length;
  assert(keyTokenOccurrences === 1, "metadata keys not declared exactly once inside the transcript");

  console.log("onto renderer test passed");
  console.log("  verified: dry-run reports transcript_renderer=onto");
  console.log("  verified: '@@ONTO Transcript[2] fields=line|type|role|ts|chars' header declared exactly once");
  console.log("  verified: pipe row '000001|user|user|2026-06-20T00:00:00.000Z|<chars>' present (no per-record key= tokens)");
  console.log("  verified: sentinel-style 'line=000001' framing absent (schema-once, keys not repeated per record)");
  console.log("  verified: record body text preserved after its row");
  console.log("  verified: row-shaped body line '000123|...' space-escaped to ' 000123|...' so it is not parsed as a record start");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
