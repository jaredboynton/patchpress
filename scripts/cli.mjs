#!/usr/bin/env node
// patchpress CLI dispatcher.
//
//   patchpress install              install/upgrade the stable shim + config + durable launcher hook
//   patchpress patch [binary]       apply the compaction patch (defaults to latest installed Claude)
//   patchpress patch --dry-run      locate both anchors, check byte budgets, write nothing
//   patchpress restore [binary]     revert the patch from the .original backup
//   patchpress compact <input>      run the harness standalone on a transcript jsonl
//   patchpress --version            print package version
//
// All subcommands delegate to the existing scripts so there is a single source
// of truth per capability. The dispatcher exists so `npx patchpress <cmd>` and
// the globally-installed `patchpress` binary both route to the right place.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

function readPkgVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch (_) {
    return "unknown";
  }
}

function runScript(scriptPath, extraArgs) {
  const child = spawn(process.execPath, [scriptPath, ...extraArgs], { stdio: "inherit" });
  child.on("error", (err) => { console.error(String(err)); process.exit(1); });
  child.on("exit", (code) => { process.exit(code || 0); });
}

function usage() {
  console.log(`patchpress v${readPkgVersion()}

Usage:
  patchpress install [binary]       install/upgrade shim + config + launcher hook
  patchpress patch [binary]         apply compaction patch (default: latest Claude)
  patchpress patch --dry-run        locate anchors, check budgets, write nothing
  patchpress restore [binary]       revert patch from .original backup
  patchpress compact <input.jsonl>  run harness standalone on a transcript
  patchpress --version              print version
  patchpress --help                 this message

The default lane (provider/model/renderer) is read from
~/.local/share/patchpress/config.json at /compact time; edit it to swap lanes
without re-patching. Run \`patchpress install\` to refresh the default config.`);
}

const arg = (v) => !v || v.startsWith("-");
const cmd = process.argv[2];
const rest = process.argv.slice(3);

switch (cmd) {
  case undefined:
  case "--help":
  case "-h":
  case "help":
    usage();
    break;
  case "--version":
  case "-v":
    console.log(readPkgVersion());
    break;
  case "install":
    runScript(join(__dirname, "install.mjs"), rest);
    break;
  case "patch":
    runScript(join(__dirname, "patcher", "patch-claude.mjs"), rest);
    break;
  case "restore":
    runScript(join(__dirname, "patcher", "patch-claude.mjs"), ["--restore", ...rest]);
    break;
  case "compact": {
    if (!rest.length || arg(rest[0])) {
      console.error("patchpress compact: <input.jsonl> required");
      process.exit(2);
    }
    const input = rest[0];
    const script = join(__dirname, "compact-full-transcript.mjs");
    if (!existsSync(script)) {
      console.error("patchpress compact: harness script not found at " + script);
      process.exit(1);
    }
    // Forward remaining args; default the out-dir to ./runs/cli-<timestamp> if absent.
    const hasOutDir = rest.includes("--out-dir");
    const fwd = hasOutDir ? rest.slice(1) : ["--out-dir", join(process.cwd(), "runs", "cli-" + Date.now()), ...rest.slice(1)];
    runScript(script, fwd);
    break;
  }
  default:
    console.error("Unknown command: " + cmd);
    usage();
    process.exit(2);
}
