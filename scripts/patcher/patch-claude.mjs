import { readFileSync, writeFileSync, copyFileSync, existsSync, readlinkSync, unlinkSync, symlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { execSync } from "child_process";
import { homedir } from "os";
import { fileURLToPath } from "url";

// STABLE INDIRECTION SHIM path. This is the ONE path baked into the patched
// binary. The shim (~/.local/share/patchpress/run-compact.mjs) reads the lane
// (provider/model/renderer/flags) from config.json and execs the LATEST
// compaction script from the globally-installed patchpress npm package. This
// decouples the binary patch (rare, version-locked) from the compaction script
// + lane args (volatile): script body edits, model swaps, and renderer changes
// all flow through the shim with ZERO re-patches.
//
// The shim + config.json are installed by `patchpress install`
// (scripts/install.mjs). Override this path at patch time with the
// CLAUDE_COMPACT_SHIM env var (for testing or non-standard layouts).
const compactShim = process.env.CLAUDE_COMPACT_SHIM || join(homedir(), ".local/share/patchpress/run-compact.mjs");

// Lane args are NO LONGER baked into the redirect — the shim reads them from
// config.json at /compact time. The default lane lives in the shim as a fallback
// and is written to config.json by `patchpress install`. See AGENTS.md.

// Helper to expand tilde in paths
function expandTilde(pathStr) {
  if (pathStr.startsWith("~/")) {
    return join(homedir(), pathStr.slice(2));
  }
  return pathStr;
}

// String-aware delimiter matcher: given the index of an opening "{", "(", or
// "[", returns the index of its matching closer (or -1). Skips delimiters
// inside string/template literals and handles escapes. Only the paired
// delimiter is counted, so `foo({x:bar()})` paren-matches correctly.
const DELIM_PAIRS = { "{": "}", "(": ")", "[": "]" };
function findCloseDelim(content, openIndex) {
  const closeChar = DELIM_PAIRS[content[openIndex]];
  if (!closeChar) return -1;
  const openChar = content[openIndex];
  let counter = 1;
  let inString = null;
  let escaped = false;
  for (let i = openIndex + 1; i < content.length; i++) {
    const char = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (char === inString) {
        inString = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }
    if (char === openChar) {
      counter++;
    } else if (char === closeChar) {
      counter--;
      if (counter === 0) {
        return i;
      }
    }
  }
  return -1;
}

function findCloseBrace(content, openBraceIndex) {
  return findCloseDelim(content, openBraceIndex);
}

// Pad a redirect to occupy EXACTLY bodyByteLength bytes so the patch is
// byte-aligned (the binary's offsets are preserved). Throws (with the anchor
// label) if the redirect does not fit.
export function padRedirect(redirectCode, bodyByteLength, label) {
  const redirectByteLength = Buffer.from(redirectCode, "utf8").length;
  if (redirectByteLength > bodyByteLength) {
    throw new Error(
      `[${label}] redirect code is larger than original body (${redirectByteLength} > ${bodyByteLength} bytes)`,
    );
  }
  const padding = bodyByteLength - redirectByteLength;
  let padded;
  if (padding === 0) {
    padded = redirectCode;
  } else if (padding < 4) {
    // Too small for a /* */ comment; trailing whitespace is valid here.
    padded = redirectCode + " ".repeat(padding);
  } else {
    padded = redirectCode + "/*" + " ".repeat(padding - 4) + "*/";
  }
  const paddedBuf = Buffer.from(padded, "ascii");
  if (paddedBuf.length !== bodyByteLength) {
    throw new Error(`[${label}] internal padding alignment verification mismatch`);
  }
  return { paddedBuf, redirectByteLength };
}

// --- Redirect builders ----------------------------------------------------
//
// Both redirects spawn the external compaction child asynchronously and await
// it inside an async function, so the Bun event loop keeps rendering the TUI
// during the run instead of freezing on a synchronous execSync. Child
// stdout/stderr go to /tmp/claude-compact.log, never the TUI.

// PRIMARY path (autocompact): the shared summarizer `Sel`. On failure it
// RETHROWS (it does NOT return a mock summary). Source: the autocompact runner
// (deobfuscated 4409.js:225-237) catches a throw and returns {wasCompacted:false},
// preserving the un-compacted conversation. A returned mock instead yields
// wasCompacted:true and REPLACES the whole conversation with the mock text
// (catastrophic context loss).
function buildSelRedirect(messagesVar) {
  return `const _gm=(m)=>{try{if(process.getBuiltinModule)return process.getBuiltinModule(m)}catch(e){}return require(m)};try{/* CLAUDE_COMPACT_PATCH_v1 */const fs=_gm("node:fs"),cp=_gm("node:child_process"),path=_gm("node:path");const tempIn=path.join("/tmp","compact-"+Date.now()+".jsonl"),tempOutDir=path.join("/tmp","compact-"+Date.now());fs.writeFileSync(tempIn,${messagesVar}.map(m=>JSON.stringify(m)).join("\\n")+"\\n");await new Promise((res,rej)=>{const ch=cp.spawn("/bin/sh",["-c","node ${compactShim} --input "+tempIn+" --out-dir "+tempOutDir+" >> /tmp/claude-compact.log 2>&1"],{stdio:"ignore"});ch.on("error",rej);ch.on("exit",c=>c===0?res():rej(new Error("compaction script exit "+c)))});const afterContent=fs.readFileSync(path.join(tempOutDir,"after-compact.jsonl"),"utf8");const lines=afterContent.split("\\n").filter(l=>l.trim());const summaryRecord=JSON.parse(lines[1]);const summaryText=summaryRecord.message.content[0].text;if(!summaryText)throw new Error("redirect: empty summary text from compaction script");let usage={input_tokens:1000,output_tokens:500,cache_creation_input_tokens:0,cache_read_input_tokens:0},model="compact";try{const resultObj=JSON.parse(fs.readFileSync(path.join(tempOutDir,"result.json"),"utf8"));if(resultObj.usage)usage=resultObj.usage;if(resultObj.model)model=resultObj.model}catch(ex){}const result={type:"assistant",message:{role:"assistant",model:model,content:[{type:"text",text:summaryText}],usage:usage}};try{fs.unlinkSync(tempIn);fs.rmSync(tempOutDir,{recursive:true,force:true})}catch(ex){}return result}catch(err){try{_gm("node:fs").appendFileSync("/tmp/claude-compact.log","[patch Sel] redirect error: "+(err&&err.stack?err.stack:String(err))+"\\n")}catch(ex){}throw err}`;
}

// REACTIVE path (manual /compact): the reactive-compact summarizer `_kd`. Unlike
// Sel, its callers (deobfuscated 2774.js DRn :233-263) switch on a RETURNED
// result object: success is {ok:true, summaryText, forkAssistantMessageCount,
// totalUsage, messages:[...]} and every failure path returns {ok:false, reason,
// ...}. So this redirect RETURNS objects and never throws. On error it returns
// {ok:false,reason:"error"}, which DRn's "error" case surfaces to the user while
// preserving the un-compacted conversation (the correct non-destructive failure).
//
// The success return MUST reproduce _kd's native contract. Helper names AND
// signatures drift every release (qf->Lm, positional preamble -> options
// object, getReplContexts() -> toolState, extra wrap/preamble fields).
// Reconstructing the call from extracted names is what broke /compact on
// 2.1.224+ (published 0.9.0 still emits preamble(rawHandoff,!0,c,void 0,u)
// + getReplContexts()). Instead we splice the native success tail:
//   let c=LIVE(),u=REPLCHK()&&REPLNOTE(...);  // prelude, verbatim
//   return{ok:!0,summaryText:rawHandoff,...,messages:[WRAP({content:PREAMBLE(rawHandoff,...)})]}
// Only the summary variable is rewritten to rawHandoff (the RAW handoff.md;
// after-compact.jsonl is already preamble-wrapped and would double-wrap).
// forkAssistantMessageCount is a safe literal 1 (telemetry only).
// extractKdEpilogue fails closed if the success-return shape is gone.
function buildKdRedirect(messagesVar, epilogue) {
  const patchedWrap = splicePreambleSummary(epilogue.wrapCall, epilogue.preamble, epilogue.summaryVar);
  return `const _gm=(m)=>{try{if(process.getBuiltinModule)return process.getBuiltinModule(m)}catch(e){}return require(m)};try{/* CLAUDE_COMPACT_PATCH_v1 */const fs=_gm("node:fs"),cp=_gm("node:child_process"),path=_gm("node:path");const tempIn=path.join("/tmp","compact-"+Date.now()+".jsonl"),tempOutDir=path.join("/tmp","compact-"+Date.now());fs.writeFileSync(tempIn,${messagesVar}.map(m=>JSON.stringify(m)).join("\\n")+"\\n");await new Promise((res,rej)=>{const ch=cp.spawn("/bin/sh",["-c","node ${compactShim} --input "+tempIn+" --out-dir "+tempOutDir+" >> /tmp/claude-compact.log 2>&1"],{stdio:"ignore"});ch.on("error",rej);ch.on("exit",c=>c===0?res():rej(new Error("compaction script exit "+c)))});try{fs.appendFileSync("/tmp/claude-compact.log","[patch _kd] invoked"+String.fromCharCode(10))}catch(ex){}const rawHandoff=fs.readFileSync(path.join(tempOutDir,"handoff.md"),"utf8");if(!rawHandoff||!rawHandoff.trim())throw new Error("redirect: empty handoff from compaction script");let usage={input_tokens:1000,output_tokens:500};try{const resultObj=JSON.parse(fs.readFileSync(path.join(tempOutDir,"result.json"),"utf8"));if(resultObj.usage)usage=resultObj.usage}catch(ex){}try{fs.unlinkSync(tempIn);fs.rmSync(tempOutDir,{recursive:true,force:true})}catch(ex){}${epilogue.prelude};return{ok:!0,summaryText:rawHandoff,forkAssistantMessageCount:1,totalUsage:usage,messages:[${patchedWrap}]}}catch(err){try{_gm("node:fs").appendFileSync("/tmp/claude-compact.log","[patch _kd] redirect error: "+(err&&err.stack?err.stack:String(err))+"\\n")}catch(ex){}return{ok:!1,reason:"error",detail:String(err)}}`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splicePreambleSummary(wrapCall, preamble, summaryVar) {
  const re = new RegExp(`(content\\s*:\\s*${escapeRe(preamble)}\\s*\\(\\s*)${escapeRe(summaryVar)}\\b`);
  if (!re.test(wrapCall)) {
    throw new Error("[_kd] could not splice rawHandoff into native wrap/preamble call");
  }
  return wrapCall.replace(re, "$1rawHandoff");
}

// Pull the native success-return tail out of `_kd`. Structural (brace/paren
// matched), not a reconstructed signature: extra preamble keys, wrap fields,
// replnote args, and prelude bindings are preserved verbatim. Helper names are
// best-effort metadata for dry-run/tests; a failed name parse does not abort
// the patch if the tail itself extracted. Throws (labeled) if the success
// return is missing, so the whole patch aborts fail-closed.
export function extractKdEpilogue(body) {
  const retRe = /return\s*\{\s*ok\s*:\s*(?:!0|true)\s*,\s*summaryText\s*:\s*([A-Za-z0-9_$]+)/g;
  let m;
  let last = null;
  while ((m = retRe.exec(body)) !== null) last = m;
  if (!last) {
    throw new Error("[_kd] success-return {ok:true,summaryText} epilogue not found");
  }
  const summaryVar = last[1];
  const braceOpen = body.indexOf("{", last.index);
  const braceClose = findCloseDelim(body, braceOpen);
  if (braceClose === -1) {
    throw new Error("[_kd] could not brace-match success-return object");
  }
  const retObj = body.slice(braceOpen, braceClose + 1);

  const mkMatch = /messages\s*:\s*\[/.exec(retObj);
  if (!mkMatch) {
    throw new Error("[_kd] success-return missing messages:[...]");
  }
  const exprStartInObj = mkMatch.index + mkMatch[0].length;
  const wrapMatch = retObj.slice(exprStartInObj).match(/^([A-Za-z0-9_$]+)\s*\(/);
  if (!wrapMatch) {
    throw new Error("[_kd] messages:[...] is not a helper call");
  }
  const wrap = wrapMatch[1];
  const wrapParenOpen = braceOpen + exprStartInObj + wrapMatch[0].length - 1;
  const wrapParenClose = findCloseDelim(body, wrapParenOpen);
  if (wrapParenClose === -1) {
    throw new Error("[_kd] could not paren-match messages wrap call");
  }
  const wrapCall = body.slice(braceOpen + exprStartInObj, wrapParenClose + 1);

  const contentRe = /content\s*:\s*([A-Za-z0-9_$]+)\s*\(\s*([A-Za-z0-9_$]+)/;
  const cm = wrapCall.match(contentRe);
  if (!cm) {
    throw new Error("[_kd] wrap call missing content:preamble(summary)");
  }
  if (cm[2] !== summaryVar) {
    throw new Error("[_kd] preamble first arg does not match summaryText variable");
  }
  const preamble = cm[1];

  const before = body.slice(0, last.index);
  // Only the trailing let/const statement(s) immediately before return.
  // A greedy `.+` from the first `let` in the function would swallow the
  // whole body and blow the byte budget.
  const preludeMatch = before.match(/((?:(?:let|const)\s+[A-Za-z0-9_$]+=[^;]*;\s*)+)$/);
  if (!preludeMatch) {
    throw new Error("[_kd] missing let/const prelude immediately before success return");
  }
  const prelude = preludeMatch[1].replace(/;\s*$/, "");
  const names = parseKdHelperNames(prelude);

  return {
    wrap,
    preamble,
    summaryVar,
    prelude,
    wrapCall,
    isObjectPreamble: /content\s*:\s*[A-Za-z0-9_$]+\s*\(\s*[A-Za-z0-9_$]+\s*,\s*\{/.test(wrapCall),
    live: names.live,
    replchk: names.replchk,
    replnote: names.replnote,
    replArg: names.replArg,
  };
}

function parseKdHelperNames(prelude) {
  const liveRe = /(?:let|const)\s+[A-Za-z0-9_$]+=([A-Za-z0-9_$]+)\([^)]*\),([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\)&&([A-Za-z0-9_$]+)\(/;
  const lm = prelude.match(liveRe);
  if (!lm) {
    return { live: "", replchk: "", replnote: "", replArg: "" };
  }
  const argRe = /\.toolUseContext\.([A-Za-z0-9_$]+(?:\(\))?)/;
  const am = prelude.match(argRe);
  return {
    live: lm[1],
    replchk: lm[3],
    replnote: lm[4],
    replArg: am ? am[1] : "",
  };
}

// --- Anchor locators ------------------------------------------------------
// Each returns { label, openBraceIndex, bodyByteLength, redirectCode } against
// the clean source `content`, or throws a labeled Error.

// PRIMARY: `Sel` — anchored on its destructured signature. The property names
// (messages, summaryRequest, ...) are stable across versions; the local var
// names are captured dynamically.
export function locateSel(content) {
  const regex = /async\s+function\s+([a-zA-Z0-9_$]+)\s*\(\{\s*messages\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*summaryRequest\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*appState\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*context\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*preCompactTokenCount\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*cacheSafeParams\s*:\s*([a-zA-Z0-9_$]+)(?:,[^}]+)?\}\)\s*\{/;
  const match = content.match(regex);
  if (!match) {
    throw new Error("[Sel] compaction function anchor pattern was not found in the binary JS payload");
  }
  const openBraceIndex = match.index + match[0].length - 1;
  const closeBraceIndex = findCloseBrace(content, openBraceIndex);
  if (closeBraceIndex === -1) {
    throw new Error("[Sel] could not trace matching closing brace of compaction function");
  }
  return {
    label: "Sel",
    name: match[1],
    openBraceIndex,
    bodyByteLength: closeBraceIndex - openBraceIndex - 1,
    redirectCode: buildSelRedirect(match[2]),
  };
}

// REACTIVE: `_kd` — its minified name and 4-arg signature are generic, so anchor
// on the unique content marker `forkLabel:"reactive-compact"` (count 1 in the JS
// trailer; the bare string also lives in the bytecode string-pool, so the full
// key:value pairing is what disambiguates), then walk back to the enclosing
// `async function NAME(a,b,c,d){` header and validate the body encloses the
// marker and contains querySource:"compact".
export function locateKd(content) {
  const marker = 'forkLabel:"reactive-compact"';
  const markerIdx = content.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error('[_kd] anchor marker forkLabel:"reactive-compact" not found in the binary JS payload');
  }
  if (content.indexOf(marker, markerIdx + 1) !== -1) {
    throw new Error('[_kd] anchor marker forkLabel:"reactive-compact" is not unique');
  }
  const headerRe = /async\s+function\s+([a-zA-Z0-9_$]+)\s*\(\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)\s*\)\s*\{/g;
  const before = content.slice(0, markerIdx);
  const headers = [];
  let m;
  while ((m = headerRe.exec(before)) !== null) {
    headers.push(m);
  }
  // Walk backward from the closest header; pick the first whose brace-matched
  // body actually encloses the marker (handles any sibling/nested function).
  for (let k = headers.length - 1; k >= 0; k--) {
    const h = headers[k];
    const openBraceIndex = h.index + h[0].length - 1;
    const closeBraceIndex = findCloseBrace(content, openBraceIndex);
    if (closeBraceIndex === -1) continue;
    if (!(openBraceIndex < markerIdx && markerIdx < closeBraceIndex)) continue;
    const body = content.slice(openBraceIndex, closeBraceIndex);
    if (!/querySource\s*:\s*["']compact["']/.test(body)) continue;
    const epilogue = extractKdEpilogue(body);
    return {
      label: "_kd",
      name: h[1],
      openBraceIndex,
      bodyByteLength: closeBraceIndex - openBraceIndex - 1,
      redirectCode: buildKdRedirect(h[2], epilogue),
      helpers: epilogue,
    };
  }
  throw new Error("[_kd] could not resolve the enclosing reactive-compact function body");
}

// --- Main -----------------------------------------------------------------

// Run the CLI only when invoked directly (node patch-claude.mjs ...), not when
// imported by a test/module. process.argv[1] is the entrypoint script path.
const isRunDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isRunDirectly) {

// Argument parsing
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const restore = args.includes("--restore");

// Determine binary path
let binaryPath = args.find(arg => !arg.startsWith("-"));
if (binaryPath) {
  binaryPath = expandTilde(binaryPath);
} else {
  // Try to resolve active version from symlink
  const symlinkPath = join(homedir(), ".local/bin/claude");
  if (existsSync(symlinkPath)) {
    try {
      const target = readlinkSync(symlinkPath);
      binaryPath = resolve(dirname(symlinkPath), target);
    } catch (e) {
      binaryPath = symlinkPath;
    }
  } else {
    binaryPath = join(homedir(), ".local/share/claude/versions/2.1.185");
  }
}

if (!existsSync(binaryPath)) {
  console.error("Target binary does not exist at path: " + binaryPath);
  process.exit(1);
}

const originalPath = binaryPath + ".original";
const symlinkPath = join(homedir(), ".local/bin/claude");

if (restore) {
  if (!existsSync(originalPath)) {
    console.log("No original backup found to restore.");
    process.exit(0);
  }
  if (dryRun) {
    console.log("Dry run: Would restore backup from " + originalPath + " to " + binaryPath);
    console.log("Dry run: Would recreate symlink " + symlinkPath + " pointing to " + binaryPath);
    process.exit(0);
  }

  // Restore binary
  copyFileSync(originalPath, binaryPath);
  try {
    unlinkSync(originalPath);
  } catch (e) {}

  // Recreate symlink
  try {
    unlinkSync(symlinkPath);
  } catch (e) {}
  try {
    symlinkSync(binaryPath, symlinkPath);
  } catch (e) {
    try {
      execSync("ln -sf " + binaryPath + " " + symlinkPath);
    } catch (err) {}
  }

  console.log("Restored original binary and recreated active symlink successfully.");
  process.exit(0);
}

// Read target binary (read backup if it exists to ensure clean source)
const sourcePath = existsSync(originalPath) ? originalPath : binaryPath;
const buf = readFileSync(sourcePath);

// Idempotency check on original binary
const isPatched = buf.includes(Buffer.from("CLAUDE_COMPACT_PATCH_v1"));
if (isPatched && !existsSync(originalPath)) {
  console.log("Binary is already patched and no original backup was found. Bailing to prevent state loss.");
  process.exit(0);
} else if (isPatched && existsSync(originalPath) && !dryRun) {
  console.log("Binary is already patched. Re-applying patch from original backup.");
}

// Decode using latin1 for binary-safe 1-to-1 character-to-byte mapping
const content = buf.toString("latin1");

// Locate BOTH anchors against the clean source and build their padded redirects
// up front. If EITHER fails (not found / not unique / brace / byte budget), we
// abort having written nothing -- the binary is never left half-patched.
let anchors;
try {
  anchors = [locateSel(content), locateKd(content)].map((a) => ({
    ...a,
    ...padRedirect(a.redirectCode, a.bodyByteLength, a.label),
  }));
} catch (e) {
  console.error("Patch aborted: " + e.message);
  process.exit(1);
}

if (dryRun) {
  console.log("Dry run succeeded: located both compaction anchors in the Bun JS trailer.");
  for (const a of anchors) {
    console.log(
      `  ${a.label} (${a.name}): body=${a.bodyByteLength}B redirect=${a.redirectByteLength}B pad=${a.bodyByteLength - a.redirectByteLength}B -> fits`,
    );
    if (a.helpers) {
      console.log(
        `    resolved helpers: wrap=${a.helpers.wrap} preamble=${a.helpers.preamble} live=${a.helpers.live} replchk=${a.helpers.replchk} replnote=${a.helpers.replnote} replArg=${a.helpers.replArg} objectPreamble=${!!a.helpers.isObjectPreamble}`,
      );
    }
  }
  process.exit(0);
}

// Perform active patch
// 1. Create backup if it doesn't exist
if (!existsSync(originalPath)) {
  copyFileSync(binaryPath, originalPath);
}

// 2. Overwrite each anchor body in place (disjoint, length-preserving regions,
//    so offsets computed from the clean buffer remain valid regardless of order)
for (const a of anchors) {
  a.paddedBuf.copy(buf, a.openBraceIndex + 1);
}

writeFileSync(binaryPath, buf);

// 3. Resign binary
try {
  execSync("codesign -f -s - " + binaryPath);
  console.log("Successfully patched and signed binary at: " + binaryPath);
  for (const a of anchors) {
    console.log(`  patched ${a.label} (${a.name})`);
  }
} catch (e) {
  console.warn("Patched binary written, but codesign command failed. Binary may need manual signing.");
}

}
