import { readFileSync, writeFileSync, copyFileSync, existsSync, readlinkSync, unlinkSync, symlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { execSync } from "child_process";
import { homedir } from "os";
import { fileURLToPath } from "url";

// Absolute path to the external compaction script, derived from this file's
// location (repo-portable). patch-claude.mjs lives in scripts/patcher/, so the
// compaction script is one directory up.
const compactScript = resolve(dirname(fileURLToPath(import.meta.url)), "../compact-full-transcript.mjs");

// The compaction pipeline both redirects invoke. This is the flash-lite config
// that benchmarked best (gemini-3.1-flash-lite + onto renderer). The gemini
// credential (GEMINI_API_KEY/GOOGLE_API_KEY) is auto-loaded from the repo .env
// by the compaction script, so behavior does not depend on its default provider.
//
// `--adapt-prompt` keeps the model-specific density steering that flash-lite
// needs; `--no-reask-until-pass --max-reasks 10` keeps the reask-to-improve loop
// (it breaks early once the density gate passes) but EMITS the best attempt
// instead of hard-failing when the gate can't be met. That matters for a manual
// /compact run on a conversation too small to hit the density floor: it would
// otherwise loop and exit non-zero, surfacing an error and compacting nothing.
// Best-effort emit produces a real (if thin) summary -- never a mock. (See the
// harness gate at compact-full-transcript.mjs:4564.)
const PIPELINE_ARGS = "--provider gemini --model gemini-3.1-flash-lite --transcript-renderer onto --no-reask-until-pass --adapt-prompt --max-reasks 10";

// Helper to expand tilde in paths
function expandTilde(pathStr) {
  if (pathStr.startsWith("~/")) {
    return join(homedir(), pathStr.slice(2));
  }
  return pathStr;
}

// String-aware brace matcher: given the index of an opening "{", returns the
// index of its matching "}" (or -1). Skips braces inside string/template
// literals and handles escapes.
function findCloseBrace(content, openBraceIndex) {
  let counter = 1;
  let inString = null;
  let escaped = false;
  for (let i = openBraceIndex + 1; i < content.length; i++) {
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
    if (char === "{") {
      counter++;
    } else if (char === "}") {
      counter--;
      if (counter === 0) {
        return i;
      }
    }
  }
  return -1;
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
  return `const _gm=(m)=>{try{if(process.getBuiltinModule)return process.getBuiltinModule(m)}catch(e){}return require(m)};try{/* CLAUDE_COMPACT_PATCH_v1 */const fs=_gm("node:fs"),cp=_gm("node:child_process"),path=_gm("node:path");const tempIn=path.join("/tmp","compact-"+Date.now()+".jsonl"),tempOutDir=path.join("/tmp","compact-"+Date.now());fs.writeFileSync(tempIn,${messagesVar}.map(m=>JSON.stringify(m)).join("\\n")+"\\n");await new Promise((res,rej)=>{const ch=cp.spawn("/bin/sh",["-c","node ${compactScript} ${PIPELINE_ARGS} --input "+tempIn+" --out-dir "+tempOutDir+" >> /tmp/claude-compact.log 2>&1"],{stdio:"ignore"});ch.on("error",rej);ch.on("exit",c=>c===0?res():rej(new Error("compaction script exit "+c)))});const afterContent=fs.readFileSync(path.join(tempOutDir,"after-compact.jsonl"),"utf8");const lines=afterContent.split("\\n").filter(l=>l.trim());const summaryRecord=JSON.parse(lines[1]);const summaryText=summaryRecord.message.content[0].text;if(!summaryText)throw new Error("redirect: empty summary text from compaction script");let usage={input_tokens:1000,output_tokens:500,cache_creation_input_tokens:0,cache_read_input_tokens:0},model="compact";try{const resultObj=JSON.parse(fs.readFileSync(path.join(tempOutDir,"result.json"),"utf8"));if(resultObj.usage)usage=resultObj.usage;if(resultObj.model)model=resultObj.model}catch(ex){}const result={type:"assistant",message:{role:"assistant",model:model,content:[{type:"text",text:summaryText}],usage:usage}};try{fs.unlinkSync(tempIn);fs.rmSync(tempOutDir,{recursive:true,force:true})}catch(ex){}return result}catch(err){try{_gm("node:fs").appendFileSync("/tmp/claude-compact.log","[patch Sel] redirect error: "+(err&&err.stack?err.stack:String(err))+"\\n")}catch(ex){}throw err}`;
}

// REACTIVE path (manual /compact): the reactive-compact summarizer `_kd`. Unlike
// Sel, its callers (deobfuscated 2774.js DRn :233-263) switch on a RETURNED
// result object: success is {ok:true, summaryText, forkAssistantMessageCount,
// totalUsage, messages:[...]} and every failure path returns {ok:false, reason,
// ...}. So this redirect RETURNS objects and never throws. On error it returns
// {ok:false,reason:"error"}, which DRn's "error" case surfaces to the user while
// preserving the un-compacted conversation (the correct non-destructive failure).
//
// The success return reproduces _kd's EXACT native contract using its own
// in-scope helpers (verified verbatim in the binary's JS trailer): the native
// epilogue is `wrap({content:preamble(l,!0,live(),void 0,replchk()&&replnote(...))})`,
// which prepends the continuation preamble, the live transcript path (live()),
// and the REPL-cleared note, then wraps it into the isCompactSummary user
// message. We feed `preamble` the RAW handoff.md (= native `l`), NOT the
// harness's after-compact.jsonl line[1] (which is already preamble-wrapped --
// feeding that back through preamble would double-wrap). forkAssistantMessageCount
// is a safe literal 1 (the caller forwards it for telemetry only). ctxVar is
// _kd's 2nd param (carries toolUseContext); messagesVar is its 1st (the messages
// array). `helpers` carries the 5 minified helper names resolved dynamically
// from this version's epilogue (resolveKdHelpers) -- they drift every release
// (e.g. qf->Lm, ox->hw, MPt->zLt, UOt->XMt across 2.1.185->2.1.186), so they
// MUST NOT be hardcoded.
function buildKdRedirect(messagesVar, ctxVar, helpers) {
  const { wrap, preamble, live, replchk, replnote } = helpers;
  return `const _gm=(m)=>{try{if(process.getBuiltinModule)return process.getBuiltinModule(m)}catch(e){}return require(m)};try{/* CLAUDE_COMPACT_PATCH_v1 */const fs=_gm("node:fs"),cp=_gm("node:child_process"),path=_gm("node:path");const tempIn=path.join("/tmp","compact-"+Date.now()+".jsonl"),tempOutDir=path.join("/tmp","compact-"+Date.now());fs.writeFileSync(tempIn,${messagesVar}.map(m=>JSON.stringify(m)).join("\\n")+"\\n");await new Promise((res,rej)=>{const ch=cp.spawn("/bin/sh",["-c","node ${compactScript} ${PIPELINE_ARGS} --input "+tempIn+" --out-dir "+tempOutDir+" >> /tmp/claude-compact.log 2>&1"],{stdio:"ignore"});ch.on("error",rej);ch.on("exit",c=>c===0?res():rej(new Error("compaction script exit "+c)))});const rawHandoff=fs.readFileSync(path.join(tempOutDir,"handoff.md"),"utf8");if(!rawHandoff||!rawHandoff.trim())throw new Error("redirect: empty handoff from compaction script");let usage={input_tokens:1000,output_tokens:500};try{const resultObj=JSON.parse(fs.readFileSync(path.join(tempOutDir,"result.json"),"utf8"));if(resultObj.usage)usage=resultObj.usage}catch(ex){}try{fs.unlinkSync(tempIn);fs.rmSync(tempOutDir,{recursive:true,force:true})}catch(ex){}const c=${live}(),u=${replchk}()&&${replnote}(${ctxVar}.toolUseContext.getReplContexts(),${ctxVar}.toolUseContext.agentId);return{ok:!0,summaryText:rawHandoff,forkAssistantMessageCount:1,totalUsage:usage,messages:[${wrap}({content:${preamble}(rawHandoff,!0,c,void 0,u),isCompactSummary:!0,isVisibleInTranscriptOnly:!0})]}}catch(err){try{_gm("node:fs").appendFileSync("/tmp/claude-compact.log","[patch _kd] redirect error: "+(err&&err.stack?err.stack:String(err))+"\\n")}catch(ex){}return{ok:!1,reason:"error",detail:String(err)}}`;
}

// Resolve the 5 minified in-scope helper names from `_kd`'s native success-return
// epilogue. The epilogue STRUCTURE is stable across versions; only the names drift.
// Two regexes pin all 5 by their surrounding literal syntax:
//   messages:[WRAP({content:PREAMBLE(summaryVar,!0,cVar,void 0,uVar)
//   cVar=LIVE(),uVar=REPLCHK()&&REPLNOTE(CTX.toolUseContext.getReplContexts(),CTX.toolUseContext.agentId)
// Throws (labeled) if either fails, so the whole patch aborts fail-closed rather
// than re-injecting stale names. Returns {wrap,preamble,live,replchk,replnote}.
function resolveKdHelpers(body) {
  const wrapRe = /messages:\[([A-Za-z0-9_$]+)\(\{content:([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+,!0,[A-Za-z0-9_$]+,void 0,[A-Za-z0-9_$]+\)/;
  const replRe = /=([A-Za-z0-9_$]+)\(\),[A-Za-z0-9_$]+=([A-Za-z0-9_$]+)\(\)&&([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\.toolUseContext\.getReplContexts\(\),\4\.toolUseContext\.agentId\)/;
  const wm = body.match(wrapRe);
  if (!wm) {
    throw new Error("[_kd] could not resolve native message-wrap/preamble helpers from the success-return epilogue (minified layout changed)");
  }
  const rm = body.match(replRe);
  if (!rm) {
    throw new Error("[_kd] could not resolve native live/repl helpers from the success-return epilogue (minified layout changed)");
  }
  return { wrap: wm[1], preamble: wm[2], live: rm[1], replchk: rm[2], replnote: rm[3] };
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
    const helpers = resolveKdHelpers(body);
    return {
      label: "_kd",
      name: h[1],
      openBraceIndex,
      bodyByteLength: closeBraceIndex - openBraceIndex - 1,
      redirectCode: buildKdRedirect(h[2], h[3], helpers),
      helpers,
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
        `    resolved helpers: wrap=${a.helpers.wrap} preamble=${a.helpers.preamble} live=${a.helpers.live} replchk=${a.helpers.replchk} replnote=${a.helpers.replnote}`,
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
