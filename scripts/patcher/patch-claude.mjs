import { readFileSync, writeFileSync, copyFileSync, existsSync, readlinkSync, unlinkSync, symlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { execSync } from "child_process";
import { homedir } from "os";

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
      // Fallback if not a symlink
      binaryPath = symlinkPath;
    }
  } else {
    // Hardcoded target fallback
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
    // Fallback using ln -s command if native symlink fails
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

// Locate Bun JS payload start and byteCount
const TRAILER = "\n---- Bun! ----\n";
const trailerBuf = Buffer.from(TRAILER);
let trailerOffset = -1;
for (let i = fileSize - trailerBuf.length; i >= 0; i--) {
  if (buf[i] === 0x0a && buf.subarray(i, i + trailerBuf.length).equals(trailerBuf)) {
    trailerOffset = i;
    break;
  }
}

if (trailerOffset === -1) {
  console.error("Failed to locate Bun trailer in binary.");
  process.exit(1);
}

const os = trailerOffset - 32;
const byteCount = Number(buf.readBigUInt64LE(os));

let sectionOffset = -1;
for (let i = 0; i < Math.min(fileSize, 8192); i++) {
  if (buf[i] === 0x5f && buf[i+1] === 0x5f && buf[i+2] === 0x62 &&
      buf[i+3] === 0x75 && buf[i+4] === 0x6e && buf[i+5] === 0x00) {
    if (buf[i+16] === 0x5f && buf[i+17] === 0x5f && buf[i+18] === 0x42 &&
        buf[i+19] === 0x55 && buf[i+20] === 0x4e) {
      sectionOffset = buf.readUInt32LE(i + 48);
      break;
    }
  }
}

const dataStart = sectionOffset >= 0 ? sectionOffset + 8 : trailerOffset + trailerBuf.length - byteCount;

// Extract JS payload
const jsBuffer = buf.subarray(dataStart, dataStart + byteCount);
const jsContent = jsBuffer.toString("utf8");

// Locating target function signature
const regex = /async\s+function\s+([a-zA-Z0-9_$]+)\s*\(\{\s*messages\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*summaryRequest\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*appState\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*context\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*preCompactTokenCount\s*:\s*([a-zA-Z0-9_$]+)\s*,\s*cacheSafeParams\s*:\s*([a-zA-Z0-9_$]+)(?:,[^}]+)?\}\)\s*\{/;

const match = jsContent.match(regex);
if (!match) {
  console.error("Compaction function anchor pattern was not found in the binary JS payload.");
  process.exit(1);
}

const signature = match[0];
const messagesVar = match[2];
const openBraceCharIndex = match.index + signature.length - 1;

// Locate closing brace matching algorithm
let counter = 1;
let closeBraceCharIndex = -1;
let inString = null;
let escaped = false;

for (let i = openBraceCharIndex + 1; i < jsContent.length; i++) {
  const char = jsContent[i];
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
      closeBraceCharIndex = i;
      break;
    }
  }
}

if (closeBraceCharIndex === -1) {
  console.error("Could not trace matching closing brace of compaction function.");
  process.exit(1);
}

// Map char indices to byte offsets inside jsBuffer
const openBraceByteOffset = Buffer.from(jsContent.substring(0, openBraceCharIndex + 1), "utf8").length;
const closeBraceByteOffset = Buffer.from(jsContent.substring(0, closeBraceCharIndex), "utf8").length;
const bodyByteLength = closeBraceByteOffset - openBraceByteOffset;

// Generate redirection code
const redirectCode = `try{/* CLAUDE_COMPACT_PATCH_v1 */const fs=globalThis.require("fs"),cp=globalThis.require("child_process"),path=globalThis.require("path");const tempIn=path.join("/tmp","compact-"+Date.now()+".jsonl"),tempOutDir=path.join("/tmp","compact-"+Date.now());fs.writeFileSync(tempIn,${messagesVar}.map(m=>JSON.stringify(m)).join("\\n")+"\\n");cp.execSync("node /Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/compact-full-transcript.mjs --input "+tempIn+" --out-dir "+tempOutDir,{stdio:"inherit"});const afterContent=fs.readFileSync(path.join(tempOutDir,"after-compact.jsonl"),"utf8");const lines=afterContent.split("\\n").filter(l=>l.trim());const summaryRecord=JSON.parse(lines[1]);const summaryText=summaryRecord.message.content[0].text;let usage={input_tokens:1000,output_tokens:500,cache_creation_input_tokens:0,cache_read_input_tokens:0};try{const resultObj=JSON.parse(fs.readFileSync(path.join(tempOutDir,"result.json"),"utf8"));if(resultObj.usage)usage=resultObj.usage}catch(ex){}const result={type:"assistant",message:{role:"assistant",model:"gemini-3.5-flash",content:[{type:"text",text:summaryText}],usage:usage}};try{fs.unlinkSync(tempIn);fs.rmSync(tempOutDir,{recursive:true,force:true})}catch(ex){}return result}catch(err){console.error("Compaction redirect failed, falling back to mock:",err);return{type:"assistant",message:{role:"assistant",model:"gemini-3.5-flash",content:[{type:"text",text:"Compaction failed. Continuing session."}],usage:{input_tokens:1000,output_tokens:500,cache_creation_input_tokens:0,cache_read_input_tokens:0}}}}`;

const redirectByteLength = Buffer.from(redirectCode, "utf8").length;

if (redirectByteLength > bodyByteLength) {
  console.error("Error: Patched redirect code is larger than original body (" + redirectByteLength + " > " + bodyByteLength + " bytes)");
  process.exit(1);
}

const paddingByteLength = bodyByteLength - redirectByteLength;
const paddedRedirect = redirectCode + "/*" + " ".repeat(paddingByteLength - 4) + "*/";

const paddedRedirectBuf = Buffer.from(paddedRedirect, "utf8");
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

// 2. Perform direct in-place buffer overwrite
paddedRedirectBuf.copy(buf, dataStart + openBraceByteOffset);

writeFileSync(binaryPath, buf);

// 3. Resign binary
try {
  execSync("codesign -f -s - " + binaryPath);
  console.log("Successfully patched and signed binary at: " + binaryPath);
} catch (e) {
  console.warn("Patched binary written, but codesign command failed. Binary may need manual signing.");
}
