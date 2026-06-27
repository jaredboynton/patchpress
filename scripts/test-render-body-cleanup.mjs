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

function transcriptFromPrompt(prompt) {
  const match = prompt.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/);
  if (!match) throw new Error("missing transcript region");
  return match[1];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function render(inputPath, promptPath) {
  const stdout = execFileSync(
    process.execPath,
    [
      compactScript,
      "--input",
      inputPath,
      "--dry-run",
      "--provider",
      "codex",
      "--dump-prompt",
      promptPath,
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const meta = parseFirstJson(stdout);
  const prompt = await readFile(promptPath, "utf8");
  return { meta, transcript: transcriptFromPrompt(prompt) };
}

const noisyBody = [
  "╭─────────────────────────────────────────────────────╮",
  "-----------------------------------------------------",
  "=====================================================",
  "│                                                     │",
  "│ important text survives inside a bordered line      │",
  "╰─────────────────────────────────────────────────────╯",
  "What is ReOxide?",
  "",
  " \u00a0 ",
  "\u200b",
  "",
  "        match v8 {",
  "            Err(_) => {",
  "                sub_454c90(&v8);",
  "            },",
  "            Ok(v7) => {",
  "                sub_454c70(sub_4560d0(&v7, v15, v14));",
  "            },",
  "        }",
  "",
  "        def keep_indent():",
  "            if value:",
  "                return value",
  "",
  "tail fragment 1);",
  "                    match v9 {",
  "                        Err(_) => {",
  "                            sub_455300(&v9);",
  "                        },",
  "                    }",
].join("\n");

const tmp = await mkdtemp(join(tmpdir(), "patchpress-render-body-cleanup-"));
try {
  const inputPath = join(tmp, "fixture.jsonl");
  await writeFile(
    inputPath,
    jsonl([
      {
        type: "user",
        uuid: "u-cleanup",
        timestamp: "2026-06-20T00:00:00.000Z",
        message: { role: "user", content: noisyBody },
      },
    ])
  );

  const cleaned = await render(inputPath, join(tmp, "cleaned.prompt.txt"));
  assert(!("render_body_cleanup_strategy" in cleaned.meta.request), "cleanup strategy option leaked into metadata");
  assert(cleaned.meta.request.render_body_cleanup_removed_chars > 0, "cleanup did not report removed chars");
  assert(cleaned.meta.request.render_body_cleanup_removed_lines >= 5, "cleanup did not report removed lines");
  assert(cleaned.meta.request.render_body_cleanup_dedented_blocks >= 3, "cleanup did not report dedented blocks");
  assert(!cleaned.transcript.includes("╭────────────────"), "cleanup kept top border");
  assert(!cleaned.transcript.includes("╰────────────────"), "cleanup kept bottom border");
  assert(!cleaned.transcript.includes("-----------------------------------------------------"), "cleanup kept ASCII dash rule");
  assert(!cleaned.transcript.includes("====================================================="), "cleanup kept ASCII equals rule");
  assert(cleaned.transcript.includes("│ important text survives inside a bordered line"), "cleanup dropped bordered content");
  assert(!/\n\n\n\n/.test(cleaned.transcript), "cleanup left a blank run longer than two lines");
  assert(cleaned.transcript.includes("\nmatch v8 {\n"), "cleanup did not dedent Rust-like code");
  assert(!cleaned.transcript.includes("        match v8 {"), "cleanup left the Rust-like block over-indented");
  assert(cleaned.transcript.includes("\ndef keep_indent():"), "cleanup did not apply common-indent dedent");
  assert(cleaned.transcript.includes("\nmatch v9 {\n"), "cleanup did not dedent over-indented code run");
  assert(!cleaned.transcript.includes("                    match v9 {"), "cleanup left the code sub-run over-indented");

  console.log("render body cleanup test passed");
  console.log("  verified: default cleanup strips pure TUI/ASCII borders and blank runs");
  console.log("  verified: default cleanup preserves bordered content");
  console.log("  verified: default cleanup dedents common-margin and over-indented code runs");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
