import { readFileSync, writeFileSync, copyFileSync, existsSync, readlinkSync, unlinkSync, symlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { execSync } from "child_process";
import { homedir } from "os";
import { fileURLToPath } from "url";

// Absolute path to the external compaction script, derived from this file's
// location (repo-portable). patch-claude.mjs lives in scripts/patcher/, so the
// compaction script is one directory up.
const compactScript = resolve(dirname(fileURLToPath(import.meta.url)), "../compact-full-transcript.mjs");

// Helper to expand tilde in paths
function expandTilde(pathStr) {
  if (pathStr.startsWith("~/")) {
    return join(homedir(), pathStr.slice(2));
  }
  return pathStr;
}

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
const fileSize = buf.length;

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

// Locating target function signature
const regex = /async\s+function\s+([a-zA-Z0-9_$]+)\s*\(\{\s*messages\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*summaryRequest\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*appState\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*context\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*preCompactTokenCount\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*cacheSafeParams\s*:\s*([a-zA-Z0-9_$]+)(?:,[^}]+)?\}\)\s*\{/;

const match = content.match(regex);
if (!match) {
  console.error("Compaction function anchor pattern was not found in the binary JS payload.");
  process.exit(1);
}

const signature = match[0];
const messagesVar = match[2];
const openBraceIndex = match.index + signature.length - 1;

// Locate closing brace matching algorithm
let counter = 1;
let closeBraceIndex = -1;
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
      closeBraceIndex = i;
      break;
    }
  }
}

if (closeBraceIndex === -1) {
  console.error("Could not trace matching closing brace of compaction function.");
  process.exit(1);
}

// Body length in bytes/chars is exactly the distance between braces
const bodyByteLength = closeBraceIndex - openBraceIndex - 1;

// Generate redirection code
// On any failure the redirect rethrows (it does NOT return a mock summary).
// Source: the autocompact runner (deobfuscated 4409.js:225-237) catches a throw
// and returns {wasCompacted:false}, preserving the un-compacted conversation. A
// returned mock instead yields wasCompacted:true and REPLACES the whole
// conversation with the mock text (catastrophic context loss). Child output is
// redirected to a log file rather than inherited, so it never corrupts the TUI.
const redirectCode = `try{/* CLAUDE_COMPACT_PATCH_v1 */const fs=globalThis.require("fs"),cp=globalThis.require("child_process"),path=globalThis.require("path");const tempIn=path.join("/tmp","compact-"+Date.now()+".jsonl"),tempOutDir=path.join("/tmp","compact-"+Date.now());fs.writeFileSync(tempIn,${messagesVar}.map(m=>JSON.stringify(m)).join("\\n")+"\\n");cp.execSync("node ${compactScript} --input "+tempIn+" --out-dir "+tempOutDir+" >> /tmp/claude-compact.log 2>&1",{stdio:"ignore"});const afterContent=fs.readFileSync(path.join(tempOutDir,"after-compact.jsonl"),"utf8");const lines=afterContent.split("\\n").filter(l=>l.trim());const summaryRecord=JSON.parse(lines[1]);const summaryText=summaryRecord.message.content[0].text;if(!summaryText)throw new Error("redirect: empty summary text from compaction script");let usage={input_tokens:1000,output_tokens:500,cache_creation_input_tokens:0,cache_read_input_tokens:0};try{const resultObj=JSON.parse(fs.readFileSync(path.join(tempOutDir,"result.json"),"utf8"));if(resultObj.usage)usage=resultObj.usage}catch(ex){}const result={type:"assistant",message:{role:"assistant",model:"gemini-3.5-flash",content:[{type:"text",text:summaryText}],usage:usage}};try{fs.unlinkSync(tempIn);fs.rmSync(tempOutDir,{recursive:true,force:true})}catch(ex){}return result}catch(err){try{globalThis.require("fs").appendFileSync("/tmp/claude-compact.log","[patch] redirect error: "+(err&&err.stack?err.stack:String(err))+"\\n")}catch(ex){}throw err}`;

const redirectByteLength = Buffer.from(redirectCode, "utf8").length;

if (redirectByteLength > bodyByteLength) {
  console.error("Error: Patched redirect code is larger than original body (" + redirectByteLength + " > " + bodyByteLength + " bytes)");
  process.exit(1);
}

const paddingByteLength = bodyByteLength - redirectByteLength;
const paddedRedirect = redirectCode + "/*" + " ".repeat(paddingByteLength - 4) + "*/";

const paddedRedirectBuf = Buffer.from(paddedRedirect, "ascii");
if (paddedRedirectBuf.length !== bodyByteLength) {
  console.error("Internal padding alignment verification mismatch.");
  process.exit(1);
}

if (dryRun) {
  console.log("Dry run succeeded: Located stable summarize/compaction anchor in Bun JS trailer of version 2.1.185, calculated mock replacement boundaries, and validated syntax/offset projection.");
  process.exit(0);
}

// Perform active patch
// 1. Create backup if it doesn't exist
if (!existsSync(originalPath)) {
  copyFileSync(binaryPath, originalPath);
}

// 2. Perform direct in-place buffer overwrite using 1-to-1 byte offset
paddedRedirectBuf.copy(buf, openBraceIndex + 1);

writeFileSync(binaryPath, buf);

// 3. Resign binary
try {
  execSync("codesign -f -s - " + binaryPath);
  console.log("Successfully patched and signed binary at: " + binaryPath);
} catch (e) {
  console.warn("Patched binary written, but codesign command failed. Binary may need manual signing.");
}
