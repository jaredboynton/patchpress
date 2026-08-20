#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

function positionalDirs() {
  const dirs = [];
  for (let idx = 2; idx < process.argv.length; idx += 1) {
    const value = process.argv[idx];
    if (value.startsWith("--")) {
      const next = process.argv[idx + 1];
      if (next && !next.startsWith("--")) idx += 1;
      continue;
    }
    dirs.push(value);
  }
  return dirs.length ? dirs : ["."];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readText(path) {
  return readFile(path, "utf8");
}

function clampScore(value, max) {
  return Math.max(0, Math.min(max, value));
}

function addCheck(checks, label, passed, points, detail = "") {
  checks.push({
    label,
    passed: Boolean(passed),
    points: passed ? points : 0,
    max_points: points,
    detail,
  });
}

function commandLike(text) {
  return /(?:^|\s)(?:npm|pnpm|yarn|bun|node|python3?|pytest|cargo|go|just|make|bash|sh|git|npx|uv|ruff|biome|tsc|vitest|jest|wrangler|patchpress|claude)\s+/.test(
    String(text || "")
  ) || /(?:^|\s)(?:\.{0,2}\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_./:@%+-]+\.(?:sh|mjs|js|ts|py|rb|go|rs)\b/.test(String(text || ""));
}

function actionImpliesCommand(text) {
  const value = String(text || "").toLowerCase();
  return /\b(run|execute|rerun|re-run|launch|invoke|call)\b/.test(value) || commandLike(text);
}

function hasMeaningfulList(value) {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0);
}

function latestTailText(state) {
  return (state.latest_transcript_tail?.records || []).map((record) => record.text || "").join("\n");
}

function resolveArtifactPath(dir, artifactPath) {
  if (!artifactPath) return null;
  return isAbsolute(artifactPath) ? artifactPath : resolve(process.cwd(), artifactPath);
}

async function sourceMetadata(dir, state) {
  const artifactPath = resolveArtifactPath(dir, state.source_transcripts?.[0]?.artifact_path);
  if (!artifactPath) return {};
  try {
    const text = await readText(artifactPath);
    for (const line of text.split(/\n/)) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      return {
        cwd: typeof record.cwd === "string" ? record.cwd : "",
        gitBranch: typeof record.gitBranch === "string" ? record.gitBranch : "",
      };
    }
  } catch {}
  return {};
}

function scorePickup({ state, handoff, result, metadata }) {
  const checks = [];
  const pickup = state.pickup_state || {};
  const active = state.active_state || {};
  const tailRecords = state.latest_transcript_tail?.records || [];
  const tailText = latestTailText(state);
  const currentAndNext = [pickup.current_task, pickup.next_action, active.current_objective, active.next_step].join("\n");
  const hasCompletedNotice = /completed \(exit code 0\)|<status>completed<\/status>|"status"\s*:\s*"completed"/i.test(
    handoff
  );
  const possibleStaleRunInstruction = hasCompletedNotice && /\b(run|execute|rerun|re-run)\b/i.test(currentAndNext);

  addCheck(checks, "pickup.current_task", typeof pickup.current_task === "string" && pickup.current_task.trim(), 0.7);
  addCheck(checks, "pickup.next_action", typeof pickup.next_action === "string" && pickup.next_action.trim(), 0.7);
  addCheck(
    checks,
    "pickup cwd",
    metadata.cwd ? pickup.cwd === metadata.cwd : typeof pickup.cwd === "string",
    0.3,
    metadata.cwd ? "expected " + metadata.cwd : "source metadata did not require cwd"
  );
  addCheck(
    checks,
    "pickup git branch",
    metadata.gitBranch ? pickup.git_branch === metadata.gitBranch : typeof pickup.git_branch === "string",
    0.2,
    metadata.gitBranch ? "expected " + metadata.gitBranch : "source metadata did not require branch"
  );
  addCheck(checks, "pickup section rendered", handoff.includes("## Pickup State"), 0.4);

  if (actionImpliesCommand(pickup.next_action)) {
    addCheck(checks, "next command extracted", commandLike(pickup.next_command), 0.8);
    addCheck(checks, "next command rendered", pickup.next_command && handoff.includes(pickup.next_command), 0.4);
  } else {
    addCheck(checks, "next action is concrete", String(pickup.next_action || "").trim().length >= 12, 1.2);
  }

  addCheck(checks, "active files/artifacts", hasMeaningfulList(pickup.active_files), 0.7);
  const mentionsVerification = /\b(test|tests|tested|verify|verified|lint|check|pass|passed)\b/i.test(handoff);
  addCheck(
    checks,
    "tests or verification state",
    hasMeaningfulList(pickup.tests_run) || !mentionsVerification,
    0.7,
    mentionsVerification ? "handoff mentions verification" : "no verification language detected"
  );
  addCheck(
    checks,
    "caveats/conflicts arrays present",
    Array.isArray(pickup.known_caveats) && Array.isArray(pickup.status_conflicts),
    0.3
  );

  addCheck(checks, "latest tail rendered", handoff.includes("## Latest Transcript Tail"), 0.5);
  addCheck(checks, "latest tail record count", tailRecords.length >= Math.min(8, Number(state.source_integrity?.transcript_lines_seen || 8)), 0.5);
  addCheck(checks, "latest tail has final text", tailRecords.length > 0 && String(tailRecords.at(-1)?.text || "").trim(), 0.3);
  addCheck(checks, "latest tail conflict policy", typeof state.latest_transcript_tail?.conflict_policy === "string" && state.latest_transcript_tail.conflict_policy.trim(), 0.2);

  addCheck(checks, "evidence capsules", Array.isArray(state.evidence_capsules) && state.evidence_capsules.length > 0, 0.5);
  addCheck(checks, "summary blocks", Array.isArray(state.summary_blocks) && state.summary_blocks.length > 0, 0.3);
  addCheck(checks, "active state mirror", active.current_objective && active.next_step, 0.2);

  if (possibleStaleRunInstruction) {
    addCheck(
      checks,
      "stale completed-vs-run conflict resolved",
      hasMeaningfulList(pickup.known_caveats) || (pickup.status_conflicts || []).length > 0 || /completed \(exit code 0\)/i.test(tailText),
      1.0,
      "completed notification and run instruction both appear"
    );
  } else {
    addCheck(checks, "no obvious stale completed-vs-run conflict", true, 1.0);
  }

  const pickupIndex = handoff.indexOf("## Pickup State");
  const usersIndex = handoff.indexOf("## User Messages");
  const tailIndex = handoff.indexOf("## Latest Transcript Tail");
  addCheck(checks, "pickup appears before historical user messages", pickupIndex >= 0 && (usersIndex < 0 || pickupIndex < usersIndex), 0.4);
  addCheck(checks, "latest tail appears before historical user messages", tailIndex >= 0 && (usersIndex < 0 || tailIndex < usersIndex), 0.4);
  addCheck(checks, "result ok", result?.ok === true, 0.2);

  const score = clampScore(
    checks.reduce((sum, check) => sum + check.points, 0),
    10
  );
  return {
    score: Number(score.toFixed(1)),
    max_score: 10,
    checks,
    metrics: {
      active_files: pickup.active_files?.length || 0,
      tests_run: pickup.tests_run?.length || 0,
      known_caveats: pickup.known_caveats?.length || 0,
      status_conflicts: pickup.status_conflicts?.length || 0,
	      latest_tail_records: tailRecords.length,
	      evidence_capsules: state.evidence_capsules?.length || 0,
	      output_tokens: result?.usage?.output_tokens ?? result?.usage?.candidatesTokenCount ?? result?.output_tokens ?? null,
	      input_tokens: result?.usage?.input_tokens ?? result?.usage?.promptTokenCount ?? result?.prompt_tokens ?? null,
	    },
	  };
}

async function gradeRun(dirArg) {
  const dir = resolve(dirArg);
  const state = await readJson(join(dir, "handoff-state.json"));
  const handoff = await readText(join(dir, "handoff.md"));
  let result = {};
  try {
    result = await readJson(join(dir, "result.json"));
  } catch {}
  const metadata = await sourceMetadata(dir, state);
  return {
    dir,
    ...(scorePickup({ state, handoff, result, metadata })),
  };
}

const scores = [];
for (const dir of positionalDirs()) {
  scores.push(await gradeRun(dir));
}
console.log(JSON.stringify(scores.length === 1 ? scores[0] : scores, null, 2));
