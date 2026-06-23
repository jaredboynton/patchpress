#!/usr/bin/env node
// STABLE INDIRECTION SHIM — the ONE path baked into the patched binary.
//
// The patched Claude Code binary spawns this script on every /compact (both the
// Sel autocompact path and the _kd reactive /compact path). This shim reads the
// current lane from config.json and execs the LATEST compaction script from the
// globally-installed patchpress npm package (with a fallback to a config-defined
// scriptPath for dev / git-pull use).
//
// This decouples the binary patch (rare, version-locked) from the compaction
// script + lane args (volatile, frequent). Script body edits, model swaps, and
// renderer changes all flow through here with ZERO re-patches: update the npm
// package or edit config.json and the next /compact picks it up.
//
// CLI contract (what the redirect calls):
//   node run-compact.mjs --input <tempIn.jsonl> --out-dir <tempOutDir>
//
// The lane args (provider/model/renderer/flags) come from config.json, NOT the
// command line, so the redirect string stays stable across lane changes.

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHIM_DIR = join(homedir(), ".local/share/patchpress");
const CONFIG_PATH = join(SHIM_DIR, "config.json");
const LOG_PATH = "/tmp/claude-compact.log";

// Default winning lane (kept in sync with AGENTS.md). Used when config.json is
// missing or doesn't override. A package update can ship a new default by
// re-running `patchpress install` (which regenerates config.json idempotently).
const DEFAULT_LANE = "--provider gemini --model gemini-3.1-flash-lite --transcript-renderer onto --no-reask-until-pass --adapt-prompt";

function logErr(msg) {
  try { appendFileSync(LOG_PATH, msg + "\n"); } catch (_) {}
}

function readConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    logErr("[shim] failed to read config.json: " + (e && e.message ? e.message : String(e)));
  }
  return {};
}

// Resolve the compaction script path. Resolution order:
//   1. config.scriptPath (explicit override; dev / git-pull workflow)
//   2. global npm package: patchpress/scripts/compact-full-transcript.mjs
//   3. sibling of this shim (bundled install fallback)
function resolveScript() {
  const cfg = readConfig();
  if (cfg.scriptPath && existsSync(cfg.scriptPath)) {
    return cfg.scriptPath;
  }
  try {
    const resolved = import.meta.resolve("patchpress/scripts/compact-full-transcript.mjs", import.meta.url);
    const fsPath = fileURLToPath(resolved);
    if (existsSync(fsPath)) return fsPath;
  } catch (_) {}
  const sibling = join(dirname(fileURLToPath(import.meta.url)), "..", "compact-full-transcript.mjs");
  if (existsSync(sibling)) return sibling;
  if (cfg.fallbackScriptPath && existsSync(cfg.fallbackScriptPath)) {
    return cfg.fallbackScriptPath;
  }
  throw new Error(
    "run-compact shim: could not resolve compact-full-transcript.mjs " +
    "(checked config.scriptPath, patchpress npm package, sibling fallback). " +
    "Run `patchpress install` or set scriptPath in " + CONFIG_PATH
  );
}

function readLane() {
  const cfg = readConfig();
  if (typeof cfg.lane === "string" && cfg.lane.trim()) return cfg.lane;
  if (Array.isArray(cfg.laneArgs) && cfg.laneArgs.length) return cfg.laneArgs.join(" ");
  return DEFAULT_LANE;
}

function parseArgs(argv) {
  const out = { input: null, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") out.input = argv[++i];
    else if (argv[i] === "--out-dir") out.outDir = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.outDir) {
    console.error("run-compact shim: --input and --out-dir are required");
    process.exit(2);
  }
  const script = resolveScript();
  const lane = readLane();
  const shellCmd = "node " + JSON.stringify(script) + " " + lane +
    " --input " + JSON.stringify(args.input) +
    " --out-dir " + JSON.stringify(args.outDir) +
    " >> " + LOG_PATH + " 2>&1";
  const child = spawn("/bin/sh", ["-c", shellCmd], { stdio: "ignore" });
  child.on("error", (err) => {
    console.error("run-compact shim spawn error: " + err.message);
    process.exit(1);
  });
  child.on("exit", (code) => { process.exit(code || 0); });
}

main();
