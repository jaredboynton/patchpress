#!/usr/bin/env node
import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";
import { homedir } from "os";

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

if (!activeBinary) {
  activeBinary = join(homedir(), ".local/share/claude/versions/2.1.185");
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
    const patcherPath = "/Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/patcher/patch-claude.mjs";
    if (existsSync(patcherPath)) {
      execSync("node " + patcherPath + " " + activeBinary, { stdio: "ignore" });
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
