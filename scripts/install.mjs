#!/usr/bin/env node
// patchpress install — set up the stable indirection shim + config + durable hook.
//
//   patchpress install [binary]
//
// Steps (all idempotent):
//   1. Copy run-compact.mjs to ~/.local/share/patchpress/run-compact.mjs (stable path).
//   2. Write config.json with the default winning lane (preserve existing user edits
//      unless --reset-config).
//   3. Install/refresh the managed ~/bin/claude launcher (a delimited block that
//      always launches the newest Claude binary and patches it on launch). Pass
//      --no-wrapper to skip. User env above the block is preserved.
//   4. Patch the target binary (default: latest installed Claude) via patch-claude.mjs
//      and point ~/.local/bin/claude at it.
//   5. Print a summary.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, lstatSync, readlinkSync, unlinkSync, symlinkSync } from "node:fs";
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
// This package's own compaction script. Recorded as config.scriptPath so a fresh
// npm install resolves it directly (the shim cannot resolve the patchpress package
// from ~/.local/share/patchpress/, which is outside any node_modules tree).
const SCRIPT_SRC = join(__dirname, "compact-full-transcript.mjs");

const VERSIONS_DIR = join(homedir(), ".local/share/claude/versions");
const ACTIVE_SYMLINK = join(homedir(), ".local/bin/claude");
const WRAPPER_PATH = join(homedir(), "bin", "claude");
const WRAP_BEGIN = "# >>> patchpress managed block >>>";
const WRAP_END = "# <<< patchpress managed block <<<";

const DEFAULT_LANE = "--provider gemini --model gemini-3.1-flash-lite --transcript-renderer onto --no-reask-until-pass --adapt-prompt";

function latestClaudeBinary(versionsDir) {
  const dir = versionsDir || VERSIONS_DIR;
  if (!existsSync(dir)) return null;
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

function writeConfig(reset) {
  let existing = null;
  if (!reset) {
    try { existing = JSON.parse(readFileSync(CONFIG_DEST, "utf8")); } catch (_) {}
  }
  // Default scriptPath to this package's own compaction script so a fresh npm
  // install works standalone; an existing config (e.g. a dev/git-pull override)
  // wins via the merge order below.
  const cfg = Object.assign({ lane: DEFAULT_LANE, scriptPath: SCRIPT_SRC }, existing || {});
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

// The patchpress-managed block injected into ~/bin/claude. It is fully
// self-contained and fail-open: on every launch it resolves the NEWEST
// installed Claude binary, patches it on launch via the globally-installed
// patchpress (npm root -g), keeps patchpress itself current via a throttled
// dist-tags check, then execs the newest patched binary directly (never the
// possibly-stale ~/.local/bin/claude symlink). User env/flags live ABOVE this
// block and are preserved across `patchpress install`.
function managedBlock() {
  return [
    WRAP_BEGIN,
    "# Managed by `patchpress install` (https://npmjs.com/package/patchpress).",
    "# Do not edit between these markers; it is regenerated on each install.",
    "# Keeps the NEWEST installed Claude Code binary patched on every launch and",
    "# execs it directly. Put custom env above this block; export",
    '# PATCHPRESS_CLAUDE_FLAGS="--flag ..." to pass extra flags to Claude Code.',
    'PATCHPRESS_CLAUDE_BIN=""',
    'CLAUDE_VERSIONS_DIR="${CLAUDE_VERSIONS_DIR:-$HOME/.local/share/claude/versions}"',
    'PP_STATE="${PATCHPRESS_STATE_DIR:-$HOME/.local/share/patchpress}"',
    'PP_TTL="${PATCHPRESS_CHECK_TTL:-21600}"   # dist-tags re-check throttle (s; 6h)',
    'if [ -d "$CLAUDE_VERSIONS_DIR" ]; then',
    '  mkdir -p "$PP_STATE" 2>/dev/null || true',
    `  CV="$(ls "$CLAUDE_VERSIONS_DIR" 2>/dev/null | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | sort -V | tail -1 || true)"`,
    '  if [ -n "$CV" ]; then',
    '    BIN="$CLAUDE_VERSIONS_DIR/$CV"',
    '    PATCHPRESS_CLAUDE_BIN="$BIN"',
    '    PP="$(cat "$PP_STATE/.pp-version" 2>/dev/null || true)"',
    '    STAMP="$(cat "$PP_STATE/.patched" 2>/dev/null || true)"',
    '    pp_cli() { local g; g="$(npm root -g 2>/dev/null || true)/patchpress/scripts/cli.mjs"; [ -f "$g" ] || g="${CLAUDE_COMPACT_PATCHER:-}"; printf "%s" "$g"; }',
    '    pp_patch() { local g; g="$(pp_cli)"; [ -f "$g" ] && node "$g" patch "$BIN" >> /tmp/claude-compact.log 2>&1; }',
    '    pp_update() { npm install -g "patchpress@$1" >> /tmp/claude-compact.log 2>&1 || return 1; local g; g="$(pp_cli)"; { [ -f "$g" ] && node "$g" install "$BIN" >> /tmp/claude-compact.log 2>&1; } || return 1; printf "%s\\n" "$1" > "$PP_STATE/.pp-version" 2>/dev/null || true; printf "%s %s\\n" "$CV" "$1" > "$PP_STATE/.patched" 2>/dev/null || true; }',
    '    NOW="$(date +%s 2>/dev/null || echo 0)"',
    '    # Portable mtime: BSD stat (macOS) uses -f %m; GNU stat (Linux) uses -c %Y.',
    '    # Probe once which works on this platform to avoid garbage in $LAST.',
    '    if [ -z "${PP_MTIME:-}" ]; then',
    '      if stat -f %m "$PP_STATE/.lastcheck" >/dev/null 2>&1; then PP_MTIME="stat -f %m";',
    '      elif stat -c %Y "$PP_STATE/.lastcheck" >/dev/null 2>&1; then PP_MTIME="stat -c %Y";',
    '      else PP_MTIME="echo 0"; fi; fi',
    '    LAST="$($PP_MTIME "$PP_STATE/.lastcheck" 2>/dev/null || echo 0)"',
    '    PPL="$PP"',
    '    if [ "$((NOW - LAST))" -ge "$PP_TTL" ]; then',
    '      V="$(curl -fsS --max-time 1 https://registry.npmjs.org/-/package/patchpress/dist-tags 2>/dev/null | sed -n \'s/.*"latest":"\\([^"]*\\)".*/\\1/p\' || true)"',
    '      [ -n "$V" ] && PPL="$V"',
    '      : > "$PP_STATE/.lastcheck" 2>/dev/null || true',
    '    fi',
    '    if [ "$STAMP" != "$CV $PP" ]; then',
    '      # New Claude binary (or never patched): patch synchronously so /compact',
    '      # works in this first session.',
    '      if [ -n "$PPL" ] && [ "$PPL" != "$PP" ]; then pp_update "$PPL" || pp_patch || true; else pp_patch || true; fi',
    '      [ -f "$PP_STATE/.patched" ] || printf "%s %s\\n" "$CV" "${PP:-?}" > "$PP_STATE/.patched" 2>/dev/null || true',
    '    elif [ -n "$PPL" ] && [ "$PPL" != "$PP" ]; then',
    '      # Newer patchpress, binary already patched: refresh in the background.',
    '      ( pp_update "$PPL" ) >> /tmp/claude-compact.log 2>&1 &',
    '    fi',
    '  fi',
    'fi',
    'exec "${PATCHPRESS_CLAUDE_BIN:-$HOME/.local/bin/claude}" ${PATCHPRESS_CLAUDE_FLAGS:-} "$@"',
    WRAP_END,
    "",
  ].join("\n");
}

function freshWrapper() {
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "# patchpress launcher for Claude Code -- https://npmjs.com/package/patchpress",
    "#",
    "# Add your own environment tweaks ABOVE the managed block below. To pass",
    "# extra flags to Claude Code on every launch, export PATCHPRESS_CLAUDE_FLAGS,",
    '# e.g.: export PATCHPRESS_CLAUDE_FLAGS="--dangerously-skip-permissions"',
    "",
    managedBlock(),
  ].join("\n");
}

// Maintain ~/bin/claude. Idempotent:
//   - markers present  -> replace the managed block in place (preserve user env)
//   - file w/o markers -> back up, regenerate fresh (user re-adds custom env)
//   - file absent      -> write a fresh wrapper
function ensureWrapper() {
  const block = managedBlock();
  let content;
  if (existsSync(WRAPPER_PATH)) {
    const cur = readFileSync(WRAPPER_PATH, "utf8");
    const bi = cur.indexOf(WRAP_BEGIN);
    const ei = cur.indexOf(WRAP_END);
    if (bi !== -1 && ei !== -1 && ei > bi) {
      content = cur.slice(0, bi) + block + cur.slice(ei + WRAP_END.length).replace(/^\n/, "");
      console.log("  wrapper: refreshed managed block in " + WRAPPER_PATH + " (preserved your env)");
    } else {
      const bak = WRAPPER_PATH + ".bak-" + Date.now();
      copyFileSync(WRAPPER_PATH, bak);
      content = freshWrapper();
      console.log("  wrapper: backed up existing -> " + bak);
      console.log("  wrapper: regenerated " + WRAPPER_PATH + " (re-add any custom env ABOVE the managed block)");
    }
  } else {
    content = freshWrapper();
    console.log("  wrapper: created " + WRAPPER_PATH);
  }
  mkdirSync(dirname(WRAPPER_PATH), { recursive: true });
  writeFileSync(WRAPPER_PATH, content);
  chmodSync(WRAPPER_PATH, 0o755);
}

// Point ~/.local/bin/claude at the freshly-patched newest binary so the
// Claude-managed entry point also runs patched (it is patched in place). Only
// touches the path when it is absent or a stale symlink; never clobbers a real
// file the user may have placed there.
function repointActiveSymlink(binaryPath) {
  try {
    if (existsSync(ACTIVE_SYMLINK)) {
      const st = lstatSync(ACTIVE_SYMLINK);
      if (!st.isSymbolicLink()) return;
      if (resolve(dirname(ACTIVE_SYMLINK), readlinkSync(ACTIVE_SYMLINK)) === resolve(binaryPath)) return;
      unlinkSync(ACTIVE_SYMLINK);
    }
    mkdirSync(dirname(ACTIVE_SYMLINK), { recursive: true });
    symlinkSync(binaryPath, ACTIVE_SYMLINK);
    console.log("  symlink: " + ACTIVE_SYMLINK + " -> " + binaryPath);
  } catch (_) {}
}

async function main() {
  const argv = process.argv.slice(2);
  const resetConfig = argv.includes("--reset-config");
  const noWrapper = argv.includes("--no-wrapper");
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

  if (!noWrapper) ensureWrapper();

  const binaryPath = positional[0] || latestClaudeBinary();
  if (!binaryPath || !existsSync(binaryPath)) {
    console.log("  no Claude binary found; skipping patch. Run `patchpress patch <binary>` once Claude Code is installed.");
    printHookNote(noWrapper);
    process.exit(0);
  }

  console.log("  patching: " + binaryPath);
  const code = await runScript(PATCHER, [binaryPath]);
  if (code !== 0) {
    console.error("  patch failed (exit " + code + ")");
    process.exit(code);
  }

  if (!noWrapper) repointActiveSymlink(binaryPath);

  printHookNote(noWrapper);
  console.log("\nDone. /compact in a patched Claude Code session now runs through the stable shim.");
}

function printHookNote(noWrapper) {
  if (noWrapper) {
    console.log("\nDurable hook: ~/bin/claude was NOT modified (--no-wrapper). To re-patch");
    console.log("automatically after Claude Code updates, run `patchpress install` (without");
    console.log("--no-wrapper) to install the managed launcher, or re-run `patchpress patch`.");
    return;
  }
  console.log("\nDurable hook: ~/bin/claude is managed by patchpress. It always launches the");
  console.log("NEWEST installed Claude Code binary and patches it on launch, so the patch");
  console.log("survives Claude Code auto-updates. Ensure ~/bin is ahead of ~/.local/bin in PATH.");
}

main();
