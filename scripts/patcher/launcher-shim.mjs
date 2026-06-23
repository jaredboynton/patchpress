#!/usr/bin/env node
import { readdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { execSync, spawn } from "child_process";
import { homedir } from "os";
import { fileURLToPath } from "url";

// Find latest version in ~/.local/share/claude/versions
const versionsDir = join(homedir(), ".local/share/claude/versions");
let activeBinary = null;

try {
  if (existsSync(versionsDir)) {
    const files = readdirSync(versionsDir).filter(f => /^\d+\.\d+\.\d+$/.test(f));
    if (files.length > 0) {
      // Sort semver-style (descending, so files[0] is the highest/latest version)
      files.sort((a, b) => {
        const partsA = a.split(".").map(Number);
        const partsB = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if (partsA[i] !== partsB[i]) return partsB[i] - partsA[i];
        }
        return 0;
      });
      activeBinary = join(versionsDir, files[0]);
    }
  }
} catch (e) {
  console.error("Warning: Failed to scan versions directory: " + e.message);
}

// No version resolved: fall back to the Claude-managed symlink, which the
// updater keeps pointing at the newest installed version. (Never assume a
// hardcoded version number; those go stale on every Claude Code release.)
if (!activeBinary) {
  activeBinary = join(homedir(), ".local/bin/claude");
}

// Check if patched
let needsPatch = true;
try {
  if (existsSync(activeBinary)) {
    const fd = readFileSync(activeBinary);
    if (fd.includes("CLAUDE_COMPACT_PATCH_v1")) {
      needsPatch = false;
    }
  }
} catch (e) {
  console.error("Warning: Failed to check patch status: " + e.message);
}

if (needsPatch && existsSync(activeBinary)) {
  try {
    // Prefer the globally-installed patchpress (the published source of truth),
    // falling back to the patcher sibling for dev/git-pull use.
    let patcherPath = null;
    try {
      const g = execSync("npm root -g", { encoding: "utf8" }).trim();
      const cand = join(g, "patchpress", "scripts", "patcher", "patch-claude.mjs");
      if (existsSync(cand)) patcherPath = cand;
    } catch (_) {}
    if (!patcherPath) {
      const sibling = join(dirname(fileURLToPath(import.meta.url)), "patch-claude.mjs");
      if (existsSync(sibling)) patcherPath = sibling;
    }
    if (patcherPath) {
      execSync("node " + JSON.stringify(patcherPath) + " " + JSON.stringify(activeBinary), { stdio: "ignore" });
    }
  } catch (err) {
    console.error("Warning: Failed to apply compaction patch, running unpatched binary: " + err.message);
  }
}

// Spawn active binary
const child = spawn(activeBinary, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => {
  process.exit(code || 0);
});
child.on("error", (err) => {
  console.error("Failed to start Claude binary: " + err.message);
  process.exit(1);
});
