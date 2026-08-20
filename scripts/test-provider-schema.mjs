#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

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
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
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

const tmp = await mkdtemp(join(tmpdir(), "patchpress-schema-test-"));
try {
  const records = [
    {
      type: "user",
      uuid: "u-1",
      timestamp: "2026-06-20T00:00:00.000Z",
      message: { role: "user", content: "Need preserve alpha." },
    },
    {
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-06-20T00:00:01.000Z",
      message: { role: "assistant", content: "Acknowledged." },
    },
  ];
  const inputPath = join(tmp, "fixture.jsonl");
  const transcript = jsonl(records);
  await writeFile(inputPath, transcript);

  function providerDryRun(provider) {
    return execFileSync(
      process.execPath,
      [compactScript, "--input", inputPath, "--dry-run", "--provider", provider],
      { cwd: repoRoot, encoding: "utf8" }
    );
  }

  const dryRun = providerDryRun("codex");
  const [, redactedRequest] = parseConcatenatedJson(dryRun);
  const schema = redactedRequest.body.text.format.schema;
	  const required = schema.required || [];
	  assert(required.includes("summary_blocks"), "provider schema dropped anchored summary_blocks");
	  assert(required.includes("pickup_state"), "provider schema dropped pickup_state");
	  assert(!required.includes("primary_request_and_intent"), "provider schema requires legacy intent array");
  assert(!required.includes("key_technical_concepts"), "provider schema requires legacy concepts array");
  assert(!required.includes("source_lines_used"), "provider schema requires derived source_lines_used");
  assert(!schema.properties.primary_request_and_intent, "provider schema still exposes legacy intent array");
  assert(!schema.properties.source_lines_used, "provider schema still exposes derived source_lines_used");
  assert(
    schema.properties.rules_and_invariants.description.includes("Live instructions or constraints") &&
      schema.properties.rules_and_invariants.description.includes("govern future work"),
    "rules_and_invariants description does not distinguish live constraints from task history"
  );
  assert(
    schema.properties.plans_and_task_state.description.includes("Task ledger") &&
      schema.properties.plans_and_task_state.description.includes("active, pending, blocked"),
    "plans_and_task_state description does not distinguish task state from rules"
  );
  assert(
    schema.properties.promises_made.description.includes("Unresolved assistant commitments") &&
      schema.properties.promises_made.description.includes("completed commitments whose proof"),
    "promises_made description does not distinguish commitments from requests or plans"
  );

  const [, mantleRequest] = parseConcatenatedJson(providerDryRun("mantle"));
  const mantleJsonSchema = mantleRequest.body.response_format.json_schema;
  const mantleSchema = mantleJsonSchema.schema;
  assert(mantleRequest.body.response_format.type === "json_schema", "Mantle is not using json_schema");
  assert(mantleJsonSchema.strict === true, "Mantle json_schema is not strict");
  assert(
    typeof mantleJsonSchema.description === "string" && mantleJsonSchema.description.trim(),
    "Mantle json_schema is missing a description"
  );
  // Bedrock accepts numeric minimum/maximum under strict json_schema (verified by
  // direct probe: the full bounded schema returns HTTP 200), so Mantle uses the
  // same line-bounded schema as every provider.
  const mantleStartLine =
    mantleSchema.properties.summary_blocks.items.properties.source_spans.items.properties.start_line;
  assert(mantleStartLine.minimum === 1, "Mantle provider schema dropped the start_line minimum bound");
  assert(typeof mantleStartLine.maximum === "number", "Mantle provider schema dropped the start_line maximum bound");

  const outputPath = join(tmp, "minimal-output.json");
  await writeFile(
    outputPath,
    JSON.stringify({
      summary_blocks: [
        {
          section: "Current State",
          format: "paragraph",
          body: "Need preserve alpha.",
          source_spans: [{ start_line: 1, end_line: 1 }],
        },
      ],
      rules_and_invariants: [],
      plans_and_task_state: [],
      promises_made: [],
      current_work: "Need preserve alpha.",
      optional_next_step: "Continue.",
      source_integrity: {
        transcript_sha256: sha256(transcript),
        transcript_lines_seen: records.length,
        verbatim_span_grounded: true,
        limitations: "Synthetic schema split fixture.",
      },
    })
  );
  const outDir = join(tmp, "run");
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
      "--no-live-output",
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
  const summary = JSON.parse(await readFile(join(outDir, "summary.json"), "utf8"));
  assert(Array.isArray(summary.primary_request_and_intent), "legacy intent array was not defaulted");
	  assert(Array.isArray(summary.key_technical_concepts), "legacy concepts array was not defaulted");
	  assert(Array.isArray(summary.source_lines_used), "source_lines_used was not derived");
	  assert(summary.source_lines_used.length === 1 && summary.source_lines_used[0] === 1, "bad derived source lines");
	  assert(summary.pickup_state?.current_task === "Need preserve alpha.", "pickup current_task was not defaulted");
	  assert(summary.pickup_state?.next_action === "Continue.", "pickup next_action was not defaulted");

	  console.log("provider schema split test passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
