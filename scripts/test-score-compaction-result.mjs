#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const scoreScript = join(repoRoot, "scripts", "score-compaction-result.mjs");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

function evidenceCapsules(count) {
  return Array.from({ length: count }, (_, idx) => {
    const text = "verified evidence segment " + (idx + 1);
    const digest = sha256(text);
    return {
      id: "ev-" + String(idx + 1).padStart(4, "0"),
      span_id: "span-" + String(idx + 1).padStart(4, "0"),
      authority: "raw-source",
      source_kind: "jsonl_record",
      record_range: [idx + 1, idx + 1],
      text_segments: [
        {
          line: idx + 1,
          char_range: [0, text.length],
          char_count: text.length,
          extracted_text_sha256: digest,
        },
      ],
      raw_slice_sha256: digest,
      extracted_text_sha256: digest,
      validation: "verified",
    };
  });
}

async function makeRun(root, name, capsuleCount) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const result = {
    ok: true,
    after_estimated_tokens: 1234,
    after_bytes: 5678,
    integrity_echo_matches: true,
  };
  const state = {
    user_intent_events: Array.from({ length: 8 }, (_, idx) => ({ id: "intent-" + idx })),
    rules_and_invariants: [
      { id: "rule-1", text: "Keep exact literals.", source_spans: [{ start_line: 1, end_line: 1 }] },
    ],
    plans_and_task_state: [
      { id: "plan-1", text: "Run deterministic scoring.", source_spans: [{ start_line: 2, end_line: 2 }] },
    ],
    promises_made: [
      { id: "promise-1", text: "Report current-state results.", source_spans: [{ start_line: 3, end_line: 3 }] },
    ],
    active_state: {
      current_objective: "Validate deterministic scoring.",
      next_step: "Compare graduated evidence scores.",
    },
    source_transcripts: [{ path: "fixture.jsonl", bytes: 1_000_000 }],
    evidence_capsules: evidenceCapsules(capsuleCount),
  };
  const summary = "literal-alpha\nliteral-beta\n";
  const manifest = {
    artifacts: [
      { path: "result.json", sha256: sha256(JSON.stringify(result, null, 2) + "\n") },
      { path: "handoff-state.json", sha256: sha256(JSON.stringify(state, null, 2) + "\n") },
      { path: "summary.rehydrated.md", sha256: sha256(summary) },
    ],
    validation: {
      schema: "passed",
      artifact_hashes: "passed",
      source_integrity: "passed",
      timeline_order: "passed",
      user_intent_events: "passed",
      evidence_capsules: "passed",
    },
  };
  await writeJson(join(dir, "result.json"), result);
  await writeJson(join(dir, "handoff-state.json"), state);
  await writeFile(join(dir, "summary.rehydrated.md"), summary);
  await writeJson(join(dir, "handoff-manifest.json"), manifest);
  return dir;
}

const tmp = await mkdtemp(join(tmpdir(), "patchpress-score-test-"));
try {
  const fixturePath = join(tmp, "fixture.json");
  await writeJson(fixturePath, {
    required_literals: ["literal-alpha", "literal-beta"],
    required_state: {
      min_user_intent_events: 8,
      min_evidence_capsules: 50,
    },
  });
  const strongRun = await makeRun(tmp, "strong", 50);
  const weakRun = await makeRun(tmp, "weak", 5);

  const strongPayload = JSON.parse(
    execFileSync(process.execPath, [scoreScript, strongRun, "--fixture", fixturePath], {
      cwd: repoRoot,
      encoding: "utf8",
    })
  );
  assert(strongPayload.schema === "deterministic-compaction-score.v2", "score schema was not v2");
  assert(strongPayload.scores[0].deterministic_score === 100, "strong fixture should score 100");

  const weak = spawnSync(process.execPath, [scoreScript, weakRun, "--fixture", fixturePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert(weak.status === 0, "weak fixture should still be machine-parseable");
  const weakPayload = JSON.parse(weak.stdout);
  assert(weakPayload.scores[0].deterministic_score < 100, "weak fixture should lose graduated points");
  assert(
    weakPayload.scores[0].categories.state_retention < strongPayload.scores[0].categories.state_retention,
    "state retention should differentiate capsule counts"
  );

  console.log("scorecard test passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
