#!/usr/bin/env node
// patchpress install — set up the stable indirection shim + config + durable hook.
//
//   patchpress install [binary]
//
// Steps (all idempotent):
//   1. Copy run-compact.mjs to ~/.local/share/patchpress/run-compact.mjs (stable path).
//   2. Write config.json with the default winning lane (preserve existing user edits
//      unless --reset-config).
//   3. Patch the target binary (default: latest installed Claude) via patch-claude.mjs.
//   4. Print a summary + the durable ~/bin/claude hook note.
//
// The durable hook (~/bin/claude) is NOT rewritten here — it lives in the user's
// PATH and is owned by the user. We print the recommended invocation. The
// launcher-shim.mjs is available for ~/.local/bin/claude if the user wants
// auto-patch-on-launch.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM_DIR = join(homedir(), ".local/share/patchpress");
const SHIM_DEST = join(SHIM_DIR, "run-compact.mjs");
const CONFIG_DEST = join(SHIM_DIR, "config.json");
const SHIM_SRC = join(__dirname, "patcher", "run-compact.mjs");
const PATCHER = join(__dirname, "patcher", "patch-claude.mjs");

const DEFAULT_LANE = "--provider gemini --model gemini-3.1-flash-lite --transcript-renderer onto --no-reask-until-pass --adapt-prompt --max-reasks 10";

function latestClaudeBinary(versionsDir) {
  const dir = versionsDir || join(homedir(), ".local/share/claude/versions");
  if (!existsSync(dir)) return null;
  const { readdirSync } = require0("node:fs");
  const versions = readdirSync(dir).filter((f) => /^\d+\.\d+\.\d+$/.test(f));
  if (!versions.length) return null;
  versions.sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pb[i] - pa[i]; }
    return 0;
  });
  return join(dir, versions[0]);
}

function require0(mod) {
  try { return createRequire0()(mod); } catch (_) { return import.meta.resolve(mod); }
}
// Minimal createRequire shim — avoids a dependency on module/createRequire.
function createRequire0() {
  // eslint-disable-next-line no-eval
  const m = eval("require");
  return m;
}

function writeConfig(reset) {
  let existing = null;
  if (!reset) {
    try { existing = JSON.parse(readFileSync(CONFIG_DEST, "utf8")); } catch (_) {}
  }
  const cfg = Object.assign({ lane: DEFAULT_LANE }, existing || {});
  writeFileSync(CONFIG_DEST, JSON.stringify(cfg, null, 2) + "\n");
  return cfg;
}

function runScript(scriptPath, extraArgs) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [scriptPath, ...extraArgs], { stdio: "inherit" });
    child.on("error", () => res(1));
    child.on("exit", (code) => res(code || 0));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const resetConfig = argv.includes("--reset-config");
  const positional = argv.filter((a) => !a.startsWith("-"));

  mkdirSync(SHIM_DIR, { recursive: true });

  console.log("patchpress install");
  console.log("  shim dir: " + SHIM_DIR);

  if (!existsSync(SHIM_SRC)) {
    console.error("  ERROR: shim source not found at " + SHIM_SRC);
    process.exit(1);
  }
  copyFileSync(SHIM_SRC, SHIM_DEST);
  console.log("  copied run-compact.mjs -> " + SHIM_DEST);

  const cfg = writeConfig(resetConfig);
  console.log("  config: " + CONFIG_DEST + (resetConfig ? " (reset)" : " (preserved)"));
  console.log("    lane: " + cfg.lane);

  const binaryPath = positional[0] || latestClaudeBinary();
  if (!binaryPath || !existsSync(binaryPath)) {
    console.log("  no Claude binary found; skipping patch. Run `patchpress patch <binary>` once Claude Code is installed.");
    printHookNote();
    process.exit(0);
  }

  console.log("  patching: " + binaryPath);
  const code = await runScript(PATCHER, [binaryPath]);
  if (code !== 0) {
    console.error("  patch failed (exit " + code + ")");
    process.exit(code);
  }

  printHookNote();
  console.log("\nDone. /compact in a patched Claude Code session now runs through the stable shim.");
}

function printHookNote() {
  console.log("\nDurable hook (optional): to re-patch automatically after Claude Code updates,");
  console.log("add this to ~/bin/claude (or your launcher shim):");
  console.log('  node "' + PATCHER + '" "$LATEST_CLAUDE_BIN" >> /tmp/claude-compact.log 2>&1 || true');
  console.log("See scripts/patcher/launcher-shim.mjs for a ready-to-use launcher.");
}

main();
