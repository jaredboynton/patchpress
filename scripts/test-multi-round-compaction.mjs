#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const compactScript = join(repoRoot, "scripts", "compact-full-transcript.mjs");
const defaultInput = "transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl";
const defaultBaseOutput = "runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json";
const exactLiterals = [
  "/Users/jaredboynton/__devlocal/devin-decompile/docs/03-endpoints.md",
  "uv run",
  "unicorn",
  "HTTPS_PROXY",
  "application/proto",
];

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function intArg(name, fallback) {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Expected " + name + " to be non-negative");
  return parsed;
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

function parseJsonl(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function cloneWithSpan(value, sourceSpan) {
  if (Array.isArray(value)) return value.map((item) => cloneWithSpan(item, sourceSpan));
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "source_spans") {
      copy.source_spans = [sourceSpan];
    } else {
      copy[key] = cloneWithSpan(nested, sourceSpan);
    }
  }
  return copy;
}

function summaryLine(records) {
  const idx = records.findIndex((record) => record?.isCompactSummary);
  return idx === -1 ? Math.min(records.length, 1) : idx + 1;
}

async function syntheticOutputFromState({ inputPath, statePath, outputPath }) {
  const inputText = await readFile(inputPath, "utf8");
  const records = parseJsonl(inputText);
  const state = await readJson(statePath);
  const line = summaryLine(records);
  const sourceSpan = { start_line: line, end_line: line };
  const output = {
    summary_blocks: cloneWithSpan(state.summary_blocks || [], sourceSpan),
    rules_and_invariants: cloneWithSpan(state.rules_and_invariants || [], sourceSpan),
    plans_and_task_state: cloneWithSpan(state.plans_and_task_state || [], sourceSpan),
    promises_made: cloneWithSpan(state.promises_made || [], sourceSpan),
    current_work: state.active_state?.current_objective || state.current_work || "",
    optional_next_step: state.active_state?.next_step || state.optional_next_step || "",
    source_integrity: {
      transcript_sha256: sha256Text(inputText),
      transcript_lines_seen: records.length,
      verbatim_span_grounded: true,
      limitations: "Synthetic no-API multi-round summary generated from canonical handoff state.",
    },
  };
  if (!output.summary_blocks.length) {
    output.summary_blocks.push({
      section: "Current State",
      format: "paragraph",
      body: output.current_work || "Continuation state preserved from canonical handoff.",
      source_spans: [sourceSpan],
    });
  }
  if (!output.current_work) output.current_work = output.summary_blocks[0].body;
  if (!output.optional_next_step) output.optional_next_step = "Continue from canonical handoff state.";
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
}

async function verifyManifest(dir) {
  const manifest = await readJson(join(dir, "handoff-manifest.json"));
  const bad = [];
  for (const artifact of manifest.artifacts || []) {
    const path = join(dir, artifact.path);
    const actual = sha256Text(await readFile(path, "utf8"));
    if (actual !== artifact.sha256) bad.push(artifact.path);
  }
  return { count: manifest.artifacts?.length || 0, bad };
}

async function roundMetrics(dir, baseline) {
  const result = await readJson(join(dir, "result.json"));
  const state = await readJson(join(dir, "handoff-state.json"));
  const rehydrated = await readFile(join(dir, "summary.rehydrated.md"), "utf8");
  const manifest = await verifyManifest(dir);
  const highIntentHashes = (state.user_intent_events || [])
    .filter((event) => event.priority === "must_keep" || event.priority === "high")
    .map((event) => event.text_sha256)
    .sort();
  const literalsMissing = exactLiterals.filter((literal) => !rehydrated.includes(literal));
  const currentObjectiveHash = sha256Text(state.active_state?.current_objective || "");
  const nextStepHash = sha256Text(state.active_state?.next_step || "");
  return {
    dir,
    ok: result.ok === true,
    after_estimated_tokens: result.after_estimated_tokens,
    after_bytes: result.after_bytes,
    after_records: result.after_records,
    selected_user_messages: state.user_intent_events?.length || 0,
    high_intent_hashes: highIntentHashes,
    current_objective_hash: currentObjectiveHash,
    next_step_hash: nextStepHash,
    evidence_capsules: state.evidence_capsules?.length || 0,
    manifest_artifacts: manifest.count,
    bad_manifest_hashes: manifest.bad.length,
    integrity_echo_matches: result.integrity_echo_matches === true,
    exact_literals_missing: literalsMissing,
    gates: {
      high_intents_preserved: baseline
        ? baseline.high_intent_hashes.every((hash) => highIntentHashes.includes(hash))
        : true,
      objective_preserved: baseline ? baseline.current_objective_hash === currentObjectiveHash : true,
      next_step_preserved: baseline ? baseline.next_step_hash === nextStepHash : true,
      exact_literals_preserved: literalsMissing.length === 0,
      manifest_valid: manifest.bad.length === 0,
      integrity_valid: result.integrity_echo_matches === true,
      token_growth_ok: baseline
        ? result.after_estimated_tokens <= Math.ceil(baseline.after_estimated_tokens * 1.1)
        : true,
    },
  };
}

function gatePassed(metrics) {
  return metrics.ok && Object.values(metrics.gates).every(Boolean);
}

function renderMarkdown({ rounds, checkpoints, passed }) {
  const lines = [
    "# EXP-06 Multi-Round Degradation",
    "",
    passed ? "Result: pass." : "Result: fail.",
    "",
    "| Round | Tokens | Bytes | Records | Evidence | User Events | Bad Hashes | Missing Literals | Gate |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const round of rounds) {
    lines.push(
      "| " +
        round.round +
        " | " +
        round.after_estimated_tokens +
        " | " +
        round.after_bytes +
        " | " +
        round.after_records +
        " | " +
        round.evidence_capsules +
        " | " +
        round.selected_user_messages +
        " | " +
        round.bad_manifest_hashes +
        " | " +
        round.exact_literals_missing.length +
        " | " +
        (gatePassed(round) ? "pass" : "fail") +
        " |"
    );
  }
  lines.push("", "Checkpoints: " + checkpoints.join(", "), "");
  return lines.join("\n");
}

const rounds = argValue("--rounds", "5,10,20")
  .split(",")
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isFinite(value) && value > 0)
  .sort((a, b) => a - b);
const maxRound = rounds.at(-1) || 1;
const inputPath = resolve(argValue("--input", defaultInput));
const baseOutput = resolve(argValue("--base-output", defaultBaseOutput));
const outDir = resolve(argValue("--out-dir", "runs/exp06-multi-round-degradation-noapi"));
const preserveTail = String(intArg("--preserve-tail", 0));

await mkdir(outDir, { recursive: true });
let currentInput = inputPath;
let currentOutput = baseOutput;
let baseline = null;
const metrics = [];

for (let round = 1; round <= maxRound; round += 1) {
  const roundDir = join(outDir, "round-" + String(round).padStart(3, "0"));
  execFileSync(
    process.execPath,
    [
      compactScript,
      "--input",
      currentInput,
      "--from-output",
      currentOutput,
      "--out-dir",
      roundDir,
      "--preserve-tail",
      preserveTail,
      "--no-live-output",
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
  const roundMetric = await roundMetrics(roundDir, baseline);
  roundMetric.round = round;
  metrics.push(roundMetric);
  if (round === 1) baseline = roundMetric;

  currentInput = join(roundDir, "after-compact.jsonl");
  currentOutput = join(outDir, "generated-output-round-" + String(round + 1).padStart(3, "0") + ".json");
  if (round < maxRound) {
    await syntheticOutputFromState({
      inputPath: currentInput,
      statePath: join(roundDir, "handoff-state.json"),
      outputPath: currentOutput,
    });
  }
}

const checkpoints = new Set(rounds);
checkpoints.add(1);
const selected = metrics.filter((metric) => checkpoints.has(metric.round));
const passed = selected.every(gatePassed);
const summary = {
  ok: passed,
  input: inputPath,
  base_output: baseOutput,
  preserve_tail: Number(preserveTail),
  max_round: maxRound,
  checkpoints: [...checkpoints].sort((a, b) => a - b),
  exact_literals: exactLiterals,
  rounds: selected,
};
await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
await writeFile(join(outDir, "benchmark-results.md"), renderMarkdown({ rounds: selected, checkpoints: summary.checkpoints, passed }));
console.log(JSON.stringify(summary, null, 2));
if (!passed) process.exit(1);
