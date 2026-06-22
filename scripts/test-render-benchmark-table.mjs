#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const renderScript = resolve(repoRoot, "scripts/render-benchmark-table.mjs");

let failures = 0;
function check(label, ok, detail = "") {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? " -- " + detail : ""));
  if (!ok) failures++;
}

const json = JSON.parse(
  execFileSync("node", [renderScript, "--json"], { cwd: repoRoot, encoding: "utf8" }),
);
check("render JSON schema", json.schema === "bench-combined.v1");
check("single-shot has 18 lanes", json.rows.length === 18);

const ranked = json.rows.filter((row) => row.rank != null).sort((a, b) => a.rank - b.rank);
check("all lanes ranked", ranked.length === 18);
check("#1 is grok stripped", ranked[0].laneId === "xai-stripped", ranked[0].combined);
check("#1 combined > #2", ranked[0].combined > ranked[1].combined);
check("gpt-5.4 below top 5", ranked.find((row) => row.laneId === "codex-onto").rank > 5);

console.log("");
if (failures > 0) {
  console.error("FAIL: " + failures + " render-benchmark-table check(s) failed");
  process.exit(1);
}
console.log("PASS: render-benchmark-table single-shot ranking");
