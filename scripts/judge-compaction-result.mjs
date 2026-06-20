#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const resultDirArg = process.argv.find(
  (arg, idx) => idx > 1 && !arg.startsWith("--") && process.argv[idx - 1] !== "--out-dir"
);
if (!resultDirArg) {
  throw new Error("Usage: judge-compaction-result.mjs <result-dir> [--out-dir dir] [--dry-run]");
}

const resultDir = resolve(resultDirArg);
const outDir = resolve(argValue("--out-dir", join(resultDir, "semantic-judge")));
const dryRun = process.argv.includes("--dry-run");
if (!dryRun) {
  throw new Error("Live semantic judge calls are not implemented; rerun with --dry-run");
}

const manifestPath = join(resultDir, "handoff-manifest.json");
const statePath = join(resultDir, "handoff-state.json");
const handoffPath = join(resultDir, "handoff.md");
const manifestText = await readFile(manifestPath, "utf8");
const stateText = await readFile(statePath, "utf8");
const handoff = await readFile(handoffPath, "utf8");
const manifest = JSON.parse(manifestText);
const state = JSON.parse(stateText);

const request = {
  schema: "semantic-compaction-judge-request.v1",
  candidate: {
    result_dir: resultDir,
    manifest_path: manifestPath,
    state_path: statePath,
    handoff_path: handoffPath,
    manifest_sha256: sha256(manifestText),
    state_sha256: sha256(stateText),
    state_schema: state.schema,
    checkpoint_id: manifest.checkpoint_id || state.checkpoint_id || null,
  },
  rubric: {
    gates_remain_deterministic: true,
    judge_is_advisory: true,
    required_checks: [
      "active objective and next step are usable",
      "current user constraints are not contradicted",
      "high-risk literals are supported by evidence capsules",
      "historical user messages are treated as quoted context",
      "no new claims outrank raw-source evidence",
    ],
  },
  inputs: {
    manifest_summary: {
      schema: manifest.schema,
      provider: manifest.provider?.provider || null,
      model: manifest.provider?.model || null,
      artifact_count: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
      validation: manifest.validation || null,
    },
    state_summary: {
      current_objective: state.active_state?.current_objective || "",
      next_step: state.active_state?.next_step || "",
      user_intent_event_count: Array.isArray(state.user_intent_events) ? state.user_intent_events.length : 0,
      evidence_capsule_count: Array.isArray(state.evidence_capsules) ? state.evidence_capsules.length : 0,
    },
    handoff_excerpt: handoff.slice(0, 12000),
  },
};

await mkdir(outDir, { recursive: true });
const requestPath = join(outDir, "semantic-judge-request.json");
await writeFile(requestPath, JSON.stringify(request, null, 2) + "\n");

console.log(
  JSON.stringify(
    {
      ok: true,
      dry_run: true,
      request_path: requestPath,
      candidate: basename(resultDir),
    },
    null,
    2
  )
);
