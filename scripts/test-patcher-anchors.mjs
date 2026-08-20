#!/usr/bin/env node
// Regression test for the binary patch anchors. For every clean version or `.original`
// backup present under ~/.local/share/claude/versions/, assert that BOTH
// compaction anchors resolve, that the _kd redirect uses the helper names
// resolved DYNAMICALLY from that version's epilogue (no stale literals), and
// that both redirects fit their byte budgets. Skips gracefully (exit 0) when no
// version binaries exist so it is CI-safe.
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

// Find all unique versions available (from .original backups or unpatched version binaries)
const entries = readdirSync(versionsDir);
const versionSet = new Set();
for (const e of entries) {
  if (e.endsWith(".original")) {
    versionSet.add(e.replace(/\.original$/, ""));
  } else if (/^\d+\.\d+\.\d+$/.test(e)) {
    versionSet.add(e);
  }
}

if (versionSet.size === 0) {
  console.log("No Claude versions or .original backups found; skipping patcher-anchor test (CI-safe).");
  process.exit(0);
}

// Stale literal helper names that MUST NOT appear hardcoded in any redirect.
const staleTokens = ["qf(", "ox(", "MPt(", "UOt(", "XMt(", "Lm(", "hw(", "zLt("];

let total = 0;
for (const ver of Array.from(versionSet).sort()) {
  const origPath = join(versionsDir, ver + ".original");
  const binPath = join(versionsDir, ver);
  const targetPath = existsSync(origPath) ? origPath : binPath;
  if (!existsSync(targetPath)) continue;

  const buf = readFileSync(targetPath);
  // If reading binary directly, verify it is clean unpatched source or skip if patched without backup
  if (buf.includes(Buffer.from("CLAUDE_COMPACT_PATCH_v1")) && !existsSync(origPath)) {
    console.log(`Skipping ${ver}: already patched and no .original backup.`);
    continue;
  }

  const content = buf.toString("latin1");

  const sel = locateSel(content);
  assert(sel && sel.openBraceIndex > 0, `${ver}: Sel anchor resolved`);
  const selPad = padRedirect(sel.redirectCode, sel.bodyByteLength, sel.label);
  assert(selPad.paddedBuf.length === sel.bodyByteLength, `${ver}: Sel redirect fits byte budget`);
  // Sel (autocompact) hardening -- mirrors the _kd dynamic-helper checks below.
  // The redirect must source its summary from the stable handoff.md artifact (not
  // a positional after-compact.jsonl read, which silently no-ops autocompact if
  // the harness output layout shifts) and emit a positive [patch Sel] invocation
  // marker so firing is provable from the log (the trigger is otherwise silent).
  assert(sel.redirectCode.includes('"handoff.md"'), `${ver}: Sel redirect reads handoff.md`);
  assert(!sel.redirectCode.includes("after-compact.jsonl"), `${ver}: Sel redirect has no positional after-compact.jsonl read`);
  assert(sel.redirectCode.includes("[patch Sel] invoked"), `${ver}: Sel redirect emits invocation marker`);
  assert(sel.redirectCode.includes('type:"assistant"') && sel.redirectCode.includes('content:[{type:"text"'), `${ver}: Sel redirect keeps native assistant-message return contract`);

  const kd = locateKd(content);
  assert(kd && kd.helpers, `${ver}: _kd anchor + helpers resolved`);
  const { wrap, preamble, live, replchk, replnote, prelude, wrapCall, summaryVar } = kd.helpers;
  const skipKeys = new Set(["isObjectPreamble", "prelude", "wrapCall", "summaryVar"]);
  for (const [k, v] of Object.entries(kd.helpers)) {
    if (skipKeys.has(k) || v === "") continue;
    assert(typeof v === "string" && v.length > 0, `${ver}: _kd helper ${k} is non-empty`);
  }

  // The redirect must splice the native success tail (prelude + wrap call),
  // rewriting only the summary variable to rawHandoff.
  assert(typeof prelude === "string" && prelude.length > 0, `${ver}: native prelude extracted`);
  assert(typeof wrapCall === "string" && wrapCall.includes(`content:${preamble}(`), `${ver}: native wrap call extracted`);
  assert(kd.redirectCode.includes(prelude), `${ver}: redirect splices native prelude`);
  assert(kd.redirectCode.includes(`content:${preamble}(rawHandoff`), `${ver}: redirect feeds rawHandoff to ${preamble}`);
  assert(!kd.redirectCode.includes(`content:${preamble}(${summaryVar}`), `${ver}: native summary var was replaced`);
  if (live) assert(kd.redirectCode.includes(`${live}(`), `${ver}: redirect calls resolved live() ${live}`);
  if (replchk) assert(kd.redirectCode.includes(`${replchk}()`), `${ver}: redirect calls resolved replchk() ${replchk}`);
  if (replnote) assert(kd.redirectCode.includes(`${replnote}(`), `${ver}: redirect calls resolved replnote() ${replnote}`);
  assert(kd.redirectCode.includes(`${wrap}({content:${preamble}(`), `${ver}: redirect uses resolved wrap/preamble ${wrap}/${preamble}`);

  // ...and must NOT contain any stale helper literal that this version did not resolve.
  const resolved = new Set([wrap, preamble, live, replchk, replnote]);
  for (const tok of staleTokens) {
    const name = tok.slice(0, -1);
    if (resolved.has(name)) continue;
    assert(!kd.redirectCode.includes(tok), `${ver}: redirect contains stale helper literal ${tok}`);
  }

  const kdPad = padRedirect(kd.redirectCode, kd.bodyByteLength, kd.label);
  assert(kdPad.paddedBuf.length === kd.bodyByteLength, `${ver}: _kd redirect fits byte budget`);

  console.log(
    `OK ${ver}: Sel=${sel.name} _kd=${kd.name} helpers={wrap:${wrap},preamble:${preamble},live:${live},replchk:${replchk},replnote:${replnote},replArg:${kd.helpers.replArg}}`,
  );
  total += 1;
}

console.log(`\npatcher-anchor test passed for ${total} version(s).`);
