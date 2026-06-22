#!/usr/bin/env node
// Regenerate ranked compaction benchmark tables from run artifacts.
//
// Usage:
//   node scripts/render-benchmark-table.mjs [--suite single-shot|until-pass|all]
//   node scripts/render-benchmark-table.mjs --update-docs
//   node scripts/render-benchmark-table.mjs --json
//
// Reads runs/bench-* artifacts, rescoring deterministic metrics live via
// score-compaction-result.mjs. Judge scores come from semantic-judge-result.json
// when present. Combined rank uses bench-combined.v1 (see docs/benchmark.md).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lanesForSuite } from "./benchmark-lanes.mjs";
import { combinedIndex, qualityIndex, rankRows, RANKING_V1, speedIndex } from "./benchmark-ranking.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scoreScript = join(repoRoot, "scripts", "score-compaction-result.mjs");
const benchmarkDoc = join(repoRoot, "docs", "benchmark.md");

const suite = argValue("--suite", "single-shot");
const updateDocs = process.argv.includes("--update-docs");
const jsonOut = process.argv.includes("--json");

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function inputTokens(result) {
  const usage = result.usage || {};
  return usage.input_tokens ?? usage.promptTokenCount ?? usage.prompt_tokens ?? null;
}

function wallSeconds(result) {
  if (Number.isFinite(result.run?.durationMs)) return result.run.durationMs / 1000;
  if (Number.isFinite(result.wall_seconds)) return result.wall_seconds;
  return null;
}

function formatWall(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  return seconds.toFixed(1) + "s";
}

function formatInt(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function formatDet(score, gatePass) {
  if (!Number.isFinite(score)) return "—";
  const label = gatePass ? "pass" : "**fail**";
  return score + " " + label;
}

function formatJudge(score, overallPass) {
  if (!Number.isFinite(score)) return "—";
  const label = overallPass === false ? "**fail**" : "pass";
  return score + " " + label;
}

function loadLaneRow(lane, runsRoot) {
  const runPath = join(runsRoot, lane.runDir);
  const resultPath = join(runPath, "result.json");
  const row = {
    laneId: lane.laneId,
    runDir: lane.runDir,
    modelLabel: lane.modelLabel,
    renderer: lane.renderer,
    missing: false,
  };
  if (!existsSync(resultPath)) {
    row.missing = true;
    return row;
  }

  const result = readJson(resultPath);
  const scoreOut = execFileSync("node", [scoreScript, runPath], { encoding: "utf8" });
  const scored = JSON.parse(scoreOut).scores[0];
  const judgePath = join(runPath, "semantic-judge", "semantic-judge-result.json");
  const judge = existsSync(judgePath) ? readJson(judgePath) : null;

  row.wallSeconds = wallSeconds(result);
  row.deterministicScore = scored.deterministic_score;
  row.gatePass = scored.gate_pass;
  row.judgeScore = judge?.total_level_score ?? null;
  row.judgePass = judge?.overall_pass ?? null;
  row.inputTokens = inputTokens(result);
  row.summaryTokens = result.summary_estimated_tokens ?? null;
  row.afterTokens = result.after_estimated_tokens ?? null;
  row.rules = result.current_rules_and_invariants_count ?? null;
  row.plans = result.plans_and_task_state_count ?? null;
  row.promises = result.promises_made_count ?? null;
  row.capsules = scored.metrics.evidence_capsules;
  row.citedLines = scored.metrics.cited_unique_lines;

  row.quality = qualityIndex({
    deterministicScore: row.deterministicScore,
    judgeScore: row.judgeScore,
    gatePass: row.gatePass,
  });
  row.speed = speedIndex(row.wallSeconds);
  row.combined = combinedIndex(row.quality, row.speed);
  return row;
}

function markdownTable(rows) {
  const ordered = [...rows].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return String(a.laneId).localeCompare(String(b.laneId));
  });
  const lines = [
    "| Rank | Combined /100 | Model | Renderer | Wall | Quality /100 | Speed /100 | Deterministic /100 | Judge /10 | Input tok | Summary tok | After tok | Rules/Plans/Promises | Capsules | Cited lines |",
    "|---:|---:|---|---|---:|---:|---:|---|---|---:|---:|---:|---|---:|---:|",
  ];
  for (const row of ordered) {
    if (row.missing) {
      lines.push(
        "| — | — | " +
          row.modelLabel +
          " | " +
          row.renderer +
          " | — | — | — | — | — | — | — | — | — | — | — |",
      );
      continue;
    }
    lines.push(
      "| #" +
        row.rank +
        " | " +
        row.combined.toFixed(1) +
        " | " +
        row.modelLabel +
        " | " +
        row.renderer +
        " | " +
        formatWall(row.wallSeconds) +
        " | " +
        row.quality.toFixed(1) +
        " | " +
        row.speed.toFixed(1) +
        " | " +
        formatDet(row.deterministicScore, row.gatePass) +
        " | " +
        formatJudge(row.judgeScore, row.judgePass) +
        " | " +
        formatInt(row.inputTokens) +
        " | " +
        formatInt(row.summaryTokens) +
        " | " +
        formatInt(row.afterTokens) +
        " | " +
        row.rules +
        " / " +
        row.plans +
        " / " +
        row.promises +
        " | " +
        row.capsules +
        " | " +
        row.citedLines +
        " |",
    );
  }
  return lines.join("\n");
}

function markerBlock(content, startMarker, endMarker, doc) {
  const start = doc.indexOf(startMarker);
  const end = doc.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Missing markers " + startMarker + " / " + endMarker + " in docs/benchmark.md");
  }
  return doc.slice(0, start + startMarker.length) + "\n\n" + content + "\n\n" + doc.slice(end);
}

function suiteMarkers(suiteName) {
  if (suiteName === "single-shot") {
    return ["<!-- BENCH_TABLE_SINGLE_SHOT_START -->", "<!-- BENCH_TABLE_SINGLE_SHOT_END -->"];
  }
  if (suiteName === "until-pass") {
    return ["<!-- BENCH_TABLE_UNTIL_PASS_START -->", "<!-- BENCH_TABLE_UNTIL_PASS_END -->"];
  }
  throw new Error("--update-docs supports --suite single-shot or until-pass only");
}

function main() {
  const lanes = lanesForSuite(suite);
  const runsRoot = join(repoRoot, "runs");
  const rows = lanes.map((lane) => loadLaneRow(lane, runsRoot));
  rankRows(rows);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          schema: RANKING_V1.schema,
          suite,
          generatedAt: new Date().toISOString(),
          rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  const table = markdownTable(rows);
  if (updateDocs) {
    const [startMarker, endMarker] = suiteMarkers(suite);
    const doc = readFileSync(benchmarkDoc, "utf8");
    writeFileSync(benchmarkDoc, markerBlock(table, startMarker, endMarker, doc));
    console.error("Updated " + benchmarkDoc + " (" + suite + ", " + rows.filter((r) => !r.missing).length + " lanes)");
  }
  console.log(table);
}

main();
