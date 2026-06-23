#!/usr/bin/env node
// Regression test for the binary patch anchors. For every clean `.original`
// backup present under ~/.local/share/claude/versions/, assert that BOTH
// compaction anchors resolve, that the _kd redirect uses the helper names
// resolved DYNAMICALLY from that version's epilogue (no stale literals), and
// that both redirects fit their byte budgets. Skips gracefully (exit 0) when no
// backups exist so it is CI-safe.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { locateSel, locateKd, padRedirect } from "./patcher/patch-claude.mjs";

function assert(cond, label) {
  if (!cond) throw new Error("FAIL: " + label);
}

const versionsDir = join(homedir(), ".local/share/claude/versions");
if (!existsSync(versionsDir)) {
  console.log("No versions dir; skipping patcher-anchor test (CI-safe).");
  process.exit(0);
}

const backups = readdirSync(versionsDir).filter((f) => f.endsWith(".original"));
if (backups.length === 0) {
  console.log("No .original backups found; skipping patcher-anchor test (CI-safe).");
  process.exit(0);
}

// Stale literal helper names that MUST NOT appear hardcoded in any redirect.
const staleTokens = ["qf(", "ox(", "MPt(", "UOt(", "XMt(", "Lm(", "hw(", "zLt("];

let total = 0;
for (const backup of backups) {
  const content = readFileSync(join(versionsDir, backup)).toString("latin1");

  const sel = locateSel(content);
  assert(sel && sel.openBraceIndex > 0, `${backup}: Sel anchor resolved`);
  const selPad = padRedirect(sel.redirectCode, sel.bodyByteLength, sel.label);
  assert(selPad.paddedBuf.length === sel.bodyByteLength, `${backup}: Sel redirect fits byte budget`);

  const kd = locateKd(content);
  assert(kd && kd.helpers, `${backup}: _kd anchor + helpers resolved`);
  const { wrap, preamble, live, replchk, replnote } = kd.helpers;
  for (const [k, v] of Object.entries(kd.helpers)) {
    assert(typeof v === "string" && v.length > 0, `${backup}: _kd helper ${k} is non-empty`);
  }

  // The redirect must reference the dynamically resolved names...
  assert(kd.redirectCode.includes(`${live}()`), `${backup}: redirect calls resolved live() ${live}`);
  assert(kd.redirectCode.includes(`${replchk}()`), `${backup}: redirect calls resolved replchk() ${replchk}`);
  assert(kd.redirectCode.includes(`${replnote}(`), `${backup}: redirect calls resolved replnote() ${replnote}`);
  assert(kd.redirectCode.includes(`${wrap}({content:${preamble}(`), `${backup}: redirect uses resolved wrap/preamble ${wrap}/${preamble}`);

  // ...and must NOT contain any stale helper literal that this version did not resolve.
  const resolved = new Set([wrap, preamble, live, replchk, replnote]);
  for (const tok of staleTokens) {
    const name = tok.slice(0, -1);
    if (resolved.has(name)) continue;
    assert(!kd.redirectCode.includes(tok), `${backup}: redirect contains stale helper literal ${tok}`);
  }

  const kdPad = padRedirect(kd.redirectCode, kd.bodyByteLength, kd.label);
  assert(kdPad.paddedBuf.length === kd.bodyByteLength, `${backup}: _kd redirect fits byte budget`);

  console.log(
    `OK ${backup}: Sel=${sel.name} _kd=${kd.name} helpers={wrap:${wrap},preamble:${preamble},live:${live},replchk:${replchk},replnote:${replnote}}`,
  );
  total += 1;
}

console.log(`\npatcher-anchor test passed for ${total} backup(s).`);
