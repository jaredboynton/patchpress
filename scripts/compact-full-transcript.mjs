#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function normalizeProvider(value) {
  const provider = String(value || "codex").toLowerCase();
  if (provider === "codex" || provider === "gemini" || provider === "xai" || provider === "mantle") {
    return provider;
  }
  throw new Error("Unsupported provider: " + value + " (expected codex, gemini, xai, or mantle)");
}

const PROVIDER = normalizeProvider(
  argValue("--provider", process.env.COMPACT_PROVIDER || process.env.COMPACT_MODEL_PROVIDER || "codex")
);
const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL || "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = process.env.CODEX_AUTH_JSON || join(homedir(), ".codex", "auth.json");
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CODEX_INSTALLATION_ID_PATH =
  process.env.CODEX_INSTALLATION_ID_PATH || join(CODEX_HOME, "installation_id");
const CODEX_ORIGINATOR = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || "codex_cli_rs";
const CODEX_CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION || resolveCodexClientVersion();
const CODEX_USER_AGENT = process.env.CODEX_USER_AGENT || buildCodexUserAgent();
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_API_BASE_URL = process.env.XAI_API_BASE_URL || "https://api.x.ai/v1";
const MANTLE_API_KEY = process.env.MANTLE_API_KEY || process.env.BEDROCK_MANTLE_API_KEY || "";
const MANTLE_CHAT_COMPLETIONS_URL =
  process.env.MANTLE_CHAT_COMPLETIONS_URL ||
  "https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions";
const DEFAULT_INPUT = "transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl";
const MODEL =
  argValue("--model") ||
  process.env.COMPACT_MODEL ||
  (PROVIDER === "gemini"
    ? process.env.GEMINI_COMPACT_MODEL || "gemini-3.5-flash"
    : PROVIDER === "xai"
      ? process.env.XAI_COMPACT_MODEL || "grok-4.20-0309-non-reasoning"
      : PROVIDER === "mantle"
        ? process.env.MANTLE_COMPACT_MODEL || "xai.grok-4.3"
        : process.env.CODEX_COMPACT_MODEL || "gpt-5.4");
const SERVICE_TIER = process.env.CODEX_COMPACT_SERVICE_TIER || "priority";
const REASONING_EFFORT = process.env.CODEX_COMPACT_REASONING_EFFORT || "low";
const GEMINI_THINKING_LEVEL = process.env.GEMINI_COMPACT_THINKING_LEVEL || "none";
const GEMINI_MAX_OUTPUT_TOKENS = Number.parseInt(
  process.env.GEMINI_COMPACT_MAX_OUTPUT_TOKENS || "65536",
  10
);

function intArg(name, fallback) {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Expected " + name + " to be a non-negative integer");
  }
  return parsed;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function resolveCodexInstallationId() {
  try {
    const existing = readFileSync(CODEX_INSTALLATION_ID_PATH, "utf8").trim();
    if (isUuid(existing)) return existing.toLowerCase();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const installationId = randomUUID();
  mkdirSync(dirname(CODEX_INSTALLATION_ID_PATH), { recursive: true });
  writeFileSync(CODEX_INSTALLATION_ID_PATH, installationId, { mode: 0o644 });
  return installationId;
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function parseVersion(value) {
  return String(value || "").match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] || "";
}

function resolveCodexClientVersion() {
  const cliVersion = parseVersion(commandOutput("codex", ["--version"]));
  if (cliVersion) return cliVersion;
  try {
    const cached = JSON.parse(readFileSync(join(CODEX_HOME, "version.json"), "utf8"));
    const cachedVersion = parseVersion(cached.latest_version);
    if (cachedVersion) return cachedVersion;
  } catch {
    // Fall through to a syntactically valid development version.
  }
  return "0.0.0";
}

function codexArchitecture() {
  const value = arch();
  if (value === "x64") return "x86_64";
  return value || "unknown";
}

function codexOsDescription() {
  if (platform() === "darwin") {
    const macVersion = commandOutput("sw_vers", ["-productVersion"]);
    return "Mac OS " + (macVersion || release());
  }
  return platform() + " " + release();
}

function buildCodexUserAgent() {
  const reqwestVersion = process.env.CODEX_REQWEST_VERSION || "0.12.28";
  return (
    CODEX_ORIGINATOR +
    "/" +
    CODEX_CLIENT_VERSION +
    " (" +
    codexOsDescription() +
    "; " +
    codexArchitecture() +
    ") reqwest/" +
    reqwestVersion
  );
}

const inputPath = resolve(argValue("--input", DEFAULT_INPUT));
const preserveTailCount = intArg("--preserve-tail", 16);
const dryRun = process.argv.includes("--dry-run");
const liveOutput = !process.argv.includes("--no-live-output");
const dumpPromptPath = argValue("--dump-prompt", "");
const temperatureRaw = argValue("--temperature", process.env.COMPACT_TEMPERATURE || "");
const TEMPERATURE = temperatureRaw === "" ? null : Number.parseFloat(temperatureRaw);
if (temperatureRaw !== "" && !Number.isFinite(TEMPERATURE)) {
  throw new Error("Expected --temperature to be a finite number");
}
const customSummaryInstructions = argValue("--summary-instructions", "");
const compactAndPrompt = argValue("--compact-and", "");
const fromOutputPath = argValue("--from-output", "");
const userMessageCollapseAt = intArg("--user-message-collapse-at", 2400);
const userMessageHeadChars = intArg("--user-message-head-chars", 900);
const userMessageTailChars = intArg("--user-message-tail-chars", 900);
const handoffUserMessageLimit = intArg("--handoff-user-message-limit", 64);
const handoffUserMessageTokenBudget = intArg("--handoff-user-message-token-budget", 8000);
const handoffUserMessageLineLimit = intArg("--handoff-user-message-line-limit", 300);
const transcriptRenderer = argValue(
  "--transcript-renderer",
  process.env.COMPACT_TRANSCRIPT_RENDERER || "stripped"
);
if (transcriptRenderer !== "stripped" && transcriptRenderer !== "jsonl") {
  throw new Error("Expected --transcript-renderer to be stripped or jsonl");
}
const startedAt = new Date();
const defaultOutDir = join(
  "runs",
  "compact-" + startedAt.toISOString().replace(/[:.]/g, "-")
);
const outDir = resolve(argValue("--out-dir", defaultOutDir));
const HANDOFF_USER_MESSAGE_LEDGER_VERSION = "1";
const HANDOFF_STATE_SCHEMA = "handoff-state.v1";
const HANDOFF_MANIFEST_SCHEMA = "handoff-manifest.v1";
const HANDOFF_POINTER_SCHEMA = "handoff-pointer.v1";

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function loadChatgptAuth() {
  const raw = await readFile(AUTH_PATH, "utf8");
  const auth = JSON.parse(raw);
  if (auth.auth_mode !== "chatgpt") {
    throw new Error("Expected ChatGPT auth in " + AUTH_PATH + "; got auth_mode=" + auth.auth_mode);
  }
  const tokens = auth.tokens;
  const accessToken = tokens?.access_token;
  const accountId = tokens?.account_id || tokens?.id_token?.chatgpt_account_id;
  if (!accessToken) throw new Error("Missing tokens.access_token in " + AUTH_PATH);
  if (!accountId) throw new Error("Missing ChatGPT account id in " + AUTH_PATH);
  return { accessToken, accountId };
}

function parseJsonl(raw) {
  const records = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error("Invalid JSONL at logical record " + (records.length + 1) + ": " + error.message);
    }
  }
  return records;
}

function logicalJsonlLines(raw) {
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function previewRecord(line) {
  try {
    const record = JSON.parse(line);
    const pieces = [];
    if (record.type) pieces.push("type=" + record.type);
    if (record.uuid) pieces.push("uuid=" + record.uuid);
    if (record.message?.role) pieces.push("role=" + record.message.role);
    const text =
      typeof record.content === "string"
        ? record.content
        : typeof record.message?.content === "string"
          ? record.message.content
          : Array.isArray(record.message?.content)
            ? record.message.content
                .map((part) => (typeof part?.text === "string" ? part.text : ""))
                .join(" ")
            : "";
    if (text) pieces.push("text=" + text.replace(/\s+/g, " ").slice(0, 160));
    return pieces.join(" | ");
  } catch {
    return line.replace(/\s+/g, " ").slice(0, 160);
  }
}

function renderPartForPrompt(part) {
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (part.type === "tool_use") {
    const name = part.name || "unknown";
    const input =
      part.input && typeof part.input === "object" ? JSON.stringify(part.input) : String(part.input || "");
    return "[tool_use name=" + name + "]\n" + input;
  }
  if (part.type === "tool_result") {
    const content = Array.isArray(part.content)
      ? part.content
          .map((item) =>
            typeof item === "string"
              ? item
              : typeof item?.text === "string"
                ? item.text
                : typeof item?.content === "string"
                  ? item.content
                  : ""
          )
          .filter(Boolean)
          .join("\n")
      : typeof part.content === "string"
        ? part.content
        : "";
    return "[tool_result]\n" + content;
  }
  return "";
}

function recordTextForPrompt(record) {
  const content = record?.message?.content ?? record?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(renderPartForPrompt).filter(Boolean).join("\n\n");
}

function renderStrippedRecord(entry) {
  let record;
  try {
    record = JSON.parse(entry.raw);
  } catch {
    return (
      '<record line="' +
      String(entry.lineNumber).padStart(6, "0") +
      '" kind="unparsed">\n' +
      entry.raw +
      "\n</record>"
    );
  }
  const attrs = [
    'line="' + String(entry.lineNumber).padStart(6, "0") + '"',
    'type="' + String(record.type || "unknown").replace(/"/g, "'") + '"',
  ];
  if (record.message?.role) attrs.push('role="' + String(record.message.role).replace(/"/g, "'") + '"');
  if (record.timestamp) attrs.push('timestamp="' + String(record.timestamp).replace(/"/g, "'") + '"');
  const text = recordTextForPrompt(record).trim();
  const body = text || entry.preview || "[no textual content extracted]";
  return "<record " + attrs.join(" ") + ">\n" + body + "\n</record>";
}

function buildRecordArtifacts(transcript, renderer = transcriptRenderer) {
  const lines = logicalJsonlLines(transcript);
  const entries = lines.map((line, idx) => {
    let searchableText = line;
    try {
      const record = JSON.parse(line);
      const parts = [];
      if (typeof record.content === "string") parts.push(record.content);
      if (typeof record.message?.content === "string") parts.push(record.message.content);
      if (Array.isArray(record.message?.content)) {
        for (const part of record.message.content) {
          if (typeof part?.text === "string") parts.push(part.text);
          if (typeof part?.content === "string") parts.push(part.content);
        }
      }
      if (parts.length > 0) searchableText = parts.join("\n");
    } catch {}
    return {
      lineNumber: idx + 1,
      raw: line,
      hash: createHash("sha256").update(line).digest("hex"),
      preview: previewRecord(line),
      searchableText,
    };
  });
  const wrappedTranscript =
    entries
      .map((entry) => {
        const line = String(entry.lineNumber).padStart(6, "0");
        if (renderer === "stripped") return renderStrippedRecord(entry);
        return '<record line="' + line + '">' + entry.raw + "</record>";
      })
      .join("\n") + "\n";
  const tsv =
    "line\thash\tpreview\n" +
    entries
      .map((entry) => {
        return [
          String(entry.lineNumber),
          entry.hash,
          entry.preview.replace(/[\t\r\n]/g, " "),
        ].join("\t");
      })
      .join("\n") +
    "\n";
  return { entries, wrappedTranscript, tsv };
}

function countUserMessages(records) {
  let count = 0;
  for (const record of records) {
    if (isRealUserMessageRecord(record)) count += 1;
  }
  return count;
}

function isRealUserMessageRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (record.isMeta || record.isCompactSummary || record.isVisibleInTranscriptOnly) return false;
  if (record.toolUseResult || record.sourceToolAssistantUUID) return false;
  if (record.type !== "user" && record.message?.role !== "user") return false;
  const content = record.message?.content;
  if (Array.isArray(content)) {
    if (content.some((part) => part?.type === "tool_result" || part?.tool_use_id)) return false;
  }
  return extractUserMessageText(record).trim().length > 0;
}

function extractUserMessageText(record) {
  const content = record?.message?.content ?? record?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "tool_result" || part.tool_use_id) continue;
    if (typeof part.text === "string") parts.push(part.text);
    else if (typeof part.content === "string" && part.type !== "tool_result") parts.push(part.content);
  }
  return parts.join("\n");
}

function extractUserMessages(records, lineHashArtifacts) {
  const messages = [];
  records.forEach((record, idx) => {
    if (!isRealUserMessageRecord(record)) return;
    const text = extractUserMessageText(record);
    const line = idx + 1;
    messages.push({
      line,
      uuid: record.uuid || null,
      originalUuid: record.originalUuid || null,
      parentUuid: record.parentUuid || null,
      timestamp: record.timestamp || null,
      source: "current",
      sha256: createHash("sha256").update(text).digest("hex"),
      record_sha256: lineHash(lineHashArtifacts, line) || null,
      char_count: text.length,
      text,
    });
  });
  return messages;
}

function recordTextContent(record) {
  const content = record?.message?.content ?? record?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function nullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function unescapeXmlAttr(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttrs(rawAttrs) {
  const attrs = {};
  const attrRe = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(rawAttrs))) {
    attrs[match[1]] = unescapeXmlAttr(match[2]);
  }
  return attrs;
}

function carriedMessageFromUserIntentEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const text = typeof event.text === "string" ? event.text : "";
  if (!text.trim()) return null;
  const source = event.source && typeof event.source === "object" ? event.source : {};
  const line = nullableInt(source.line) ?? nullableInt(source.original_line) ?? 1;
  return {
    source: "carried",
    line,
    original_line: nullableInt(source.original_line) ?? line,
    uuid: source.uuid || null,
    originalUuid: source.original_uuid || null,
    parentUuid: null,
    timestamp: source.timestamp || null,
    sha256: event.text_sha256 || event.message_sha256 || sha256Text(text),
    record_sha256: source.record_sha256 || null,
    source_transcript_sha256: source.source_transcript_sha256 || null,
    char_count: nullableInt(event.char_count) ?? text.length,
    text,
    rendered_text: typeof event.rendered_text === "string" ? event.rendered_text : null,
    user_intent_event_id: event.id || null,
  };
}

function readCarriedHandoffState(record) {
  const path = record?.handoff?.state_path;
  if (typeof path !== "string" || path.trim().length === 0) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return state && typeof state === "object" && !Array.isArray(state) ? state : null;
  } catch {
    return null;
  }
}

function extractTypedCarriedHandoffUserMessages(record) {
  if (!record?.isCompactSummary) return null;
  const embeddedEvents = record.handoff?.user_intent_events;
  const events = Array.isArray(embeddedEvents)
    ? embeddedEvents
    : readCarriedHandoffState(record)?.user_intent_events;
  if (!Array.isArray(events)) return null;
  return events.map(carriedMessageFromUserIntentEvent).filter(Boolean);
}

function extractLegacyCarriedHandoffUserMessages(record, recordIndex) {
  const messages = [];
  const text = recordTextContent(record);
  if (!text.includes("<user-message-ledger")) return messages;
  const ledgerRe = /<user-message-ledger\b[^>]*>([\s\S]*?)<\/user-message-ledger>/g;
  let ledgerMatch;
  while ((ledgerMatch = ledgerRe.exec(text))) {
    const ledgerBody = ledgerMatch[1];
    const messageRe = /<user-message\b([^>]*)>\n?([\s\S]*?)\n?<\/user-message>/g;
    let messageMatch;
    while ((messageMatch = messageRe.exec(ledgerBody))) {
      const attrs = parseXmlAttrs(messageMatch[1]);
      const renderedText = messageMatch[2].trim();
      const line = nullableInt(attrs.line) ?? nullableInt(attrs.original_line) ?? recordIndex + 1;
      messages.push({
        source: "carried",
        line,
        original_line: nullableInt(attrs.original_line) ?? line,
        uuid: attrs.uuid || null,
        originalUuid: attrs.original_uuid || null,
        parentUuid: null,
        timestamp: attrs.timestamp || null,
        sha256:
          attrs.sha256 ||
          attrs.text_sha256 ||
          createHash("sha256").update(renderedText).digest("hex"),
        record_sha256: attrs.record_sha256 || null,
        source_transcript_sha256: attrs.source_transcript_sha256 || null,
        char_count: nullableInt(attrs.chars) ?? renderedText.length,
        text: renderedText,
        rendered_text: renderedText,
      });
    }
  }
  return messages;
}

function extractCarriedHandoffUserMessages(records) {
  const messages = [];
  for (const [recordIndex, record] of records.entries()) {
    const typedMessages = extractTypedCarriedHandoffUserMessages(record);
    if (typedMessages) {
      messages.push(...typedMessages);
      continue;
    }
    if (!record?.isCompactSummary) continue;
    messages.push(...extractLegacyCarriedHandoffUserMessages(record, recordIndex));
  }
  return messages;
}

function pickBaseMetadata(records) {
  const first = records.find((record) => record && typeof record === "object") || {};
  return {
    userType: first.userType,
    cwd: first.cwd,
    sessionId: first.sessionId,
    version: first.version,
    gitBranch: first.gitBranch,
    entrypoint: first.entrypoint,
    slug: first.slug,
  };
}

function compactBaseMetadata(metadata) {
  const base = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

function extractLastUserUuid(records) {
  for (let idx = records.length - 1; idx >= 0; idx -= 1) {
    const record = records[idx];
    if (record?.type === "user" && typeof record.uuid === "string") return record.uuid;
  }
  return null;
}

function safeUuid() {
  return randomUUID();
}

function createSummarySchema(recordCount = 0, options = {}) {
  const includeLineBounds = options.includeLineBounds !== false;
  const stringArray = {
    type: "array",
    items: { type: "string" },
  };
  const lineNumber = {
    type: "integer",
    description: "One-based logical JSONL record number from the <record line=...> wrapper.",
  };
  if (includeLineBounds) {
    lineNumber.minimum = 1;
    lineNumber.maximum = recordCount || 1000000000;
  }
  const sourceSpan = {
    type: "object",
    additionalProperties: false,
    required: ["start_line", "end_line"],
    properties: {
      start_line: lineNumber,
      end_line: lineNumber,
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "summary_blocks",
      "rules_and_invariants",
      "plans_and_task_state",
      "primary_request_and_intent",
      "key_technical_concepts",
      "files_and_code_sections",
      "errors_and_fixes",
      "problem_solving",
      "pending_tasks",
      "current_work",
      "optional_next_step",
      "promises_made",
      "source_integrity",
    ],
    properties: {
      summary_blocks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "format", "body", "source_spans"],
          properties: {
            section: { type: "string" },
            format: {
              type: "string",
              enum: ["paragraph", "bullet"],
            },
            body: {
              type: "string",
              description:
                "Rendered summary content for this block. Bullet bodies must be a single item without a leading bullet marker.",
            },
            source_spans: {
              type: "array",
              minItems: 1,
              items: sourceSpan,
            },
          },
        },
      },
      rules_and_invariants: {
        type: "array",
        description:
          "Durable user, system, project, safety, and validation rules that must survive compaction distinctly from generic narrative.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rule", "status", "source_spans"],
          properties: {
            rule: { type: "string" },
            status: {
              type: "string",
              enum: ["current", "superseded", "removed"],
              description:
                "Only current rules should be treated as live instructions after compaction. Use superseded or removed when later transcript state invalidates the rule.",
            },
            source_spans: {
              type: "array",
              minItems: 1,
              items: sourceSpan,
            },
          },
        },
      },
      plans_and_task_state: {
        type: "array",
        description:
          "Active plans, task state, benchmark state, open artifacts, open questions, blockers, and concrete next actions that should remain visible after compaction. Order active and pending work by priority.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "status", "source_spans"],
          properties: {
            item: { type: "string" },
            status: {
              type: "string",
              enum: ["done", "active", "pending", "blocked", "superseded"],
            },
            source_spans: {
              type: "array",
              minItems: 1,
              items: sourceSpan,
            },
          },
        },
      },
      promises_made: {
        type: "array",
        description:
          "Explicit commitments or promises made to the user that should survive compaction, including whether they are done, active, pending, blocked, superseded, or removed.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["promise", "status", "source_spans"],
          properties: {
            promise: { type: "string" },
            status: {
              type: "string",
              enum: ["done", "active", "pending", "blocked", "superseded", "removed"],
            },
            source_spans: {
              type: "array",
              minItems: 1,
              items: sourceSpan,
            },
          },
        },
      },
      primary_request_and_intent: stringArray,
      key_technical_concepts: stringArray,
      files_and_code_sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "why_it_matters", "details"],
          properties: {
            path: { type: "string" },
            why_it_matters: { type: "string" },
            details: { type: "string" },
          },
        },
      },
      errors_and_fixes: stringArray,
      problem_solving: stringArray,
      pending_tasks: stringArray,
      current_work: { type: "string" },
      optional_next_step: { type: "string" },
      source_integrity: {
        type: "object",
        additionalProperties: false,
        required: [
          "transcript_sha256",
          "transcript_lines_seen",
          "verbatim_span_grounded",
          "limitations",
        ],
        properties: {
          transcript_sha256: { type: "string" },
          transcript_lines_seen: { type: "integer" },
          verbatim_span_grounded: { type: "boolean" },
          limitations: { type: "string" },
        },
      },
    },
  };
}

function buildFullTranscriptPrompt({ wrappedTranscript, stats }) {
  const customInstructionsBlock = customSummaryInstructions.trim()
    ? [
        "",
        "Custom summarization instructions:",
        customSummaryInstructions.trim(),
      ]
    : [];
  const compactAndBlock = compactAndPrompt.trim()
    ? [
        "",
        "Queued follow-up prompt after compaction:",
        compactAndPrompt.trim(),
        "Optimize the summary so that this queued follow-up can run immediately after compaction without reopening the full transcript.",
      ]
    : [];
  return [
    "You are a compaction model for Claude Code session transcripts.",
    "Your job is to produce a fresh summarized starting point for continued work after compaction.",
    "Optimize for the very next follow-up prompt, including any queued follow-up supplied with this request.",
    "Treat this as a continuation handoff, not a retrospective summary.",
    "Preserve the active working set and compress older material aggressively.",
    "",
    "Critical shape requirement:",
    "- Do not omit late-session state.",
    "- Treat later user messages as more important than earlier abandoned plans.",
    "- If older context and late-session state conflict, prefer the corrected late-session state and explain only the delta that still matters.",
    "",
    "Return strict JSON only. The JSON must match the provided schema.",
    ...customInstructionsBlock,
    ...compactAndBlock,
    "",
    "Evidence span format:",
    "- The transcript is wrapped as <record line=\"000001\">...</record>.",
    "- Use one-based logical JSONL record numbers from those wrappers for every source span.",
    "- summary_blocks is the primary structured output. It must be ordered exactly as the continuation summary should read.",
    "- Every summary_blocks item must include one or more source_spans pointing to the exact supporting record ranges.",
    "- The authoritative source record is the cited source_spans plus harness rehydration, not long verbatim body text.",
    "- Do not copy large verbatim transcript excerpts into the JSON response. The harness will extract exact record content itself from the selected source spans.",
    "- Do not emit verbatim code/config/command blocks in summary_blocks. Summarize them and cite the exact source spans; the harness preserves verbatim evidence separately.",
    "- Bullet bodies must be a single item and must not include a leading bullet marker.",
    "- source_integrity.verbatim_span_grounded must be true.",
    "",
    "Compaction requirements:",
    "- The harness will render the final markdown summary from summary_blocks and separately emit a rehydrated evidence view from source_spans.",
    "- Prioritize continuation utility over historical exhaustiveness.",
    "- Organize content around: task overview, current state, important discoveries, next steps, and context to preserve.",
    "- Think in two bands: active context and archived context. Active context is what the next agent needs immediately; archived context is only older material needed to avoid repeated mistakes or lost commitments.",
    "- Keep abandoned branches brief unless they still constrain current work, explain a bug, or explain why a later correction matters.",
    "- Preserve failed approaches only when they prevent repeated work or explain a current constraint.",
    "- Prefer durable state over chronology: capture decisions, invariants, open tasks, exact artifacts, open questions, and unresolved blockers before narrating what happened.",
    "- Prefer block-style handoff sections over a play-by-play timeline.",
    "- A fresh agent should know the current objective, active artifacts, user preferences, domain-specific context, constraints, blockers, and next command or check.",
    "- Preserve explicit user instructions, constraints, file paths, commands, errors, pending work, and security-relevant instructions. Preserve security-relevant user constraints verbatim.",
    "- Put durable user/system/project rules in rules_and_invariants. Do not bury them only in generic prose.",
    "- If a later user message removes or supersedes an earlier rule, mark that rule status as removed or superseded. Do not present removed or superseded rules as live instructions.",
    "- Put active plans, benchmark status, open artifacts, open questions, blockers, and concrete next actions in plans_and_task_state, ordered by priority.",
    "- Put explicit commitments or promises made to the user in promises_made, with status.",
    "- Preserve exact symbols, command names, endpoint paths, file names, hook names, setting names, and error text when they matter.",
    "- Do not pin irrelevant literal wording or incidental implementation details unless they are part of a contract or a current task.",
    "- Do not output a user-message inventory. The harness extracts user-authored messages deterministically from the transcript.",
    "- current_work and optional_next_step must reflect the end of the transcript, not an earlier branch of work.",
    "- If the transcript includes an assistant mistake later corrected by the user, summarize the corrected state and mention the correction if it changes what should happen next.",
    "- The first summary_blocks items should establish, in order: current state, current user intent/constraints, active files/artifacts, unresolved work/next step. Put older background later.",
    "- When there is too much material, drop redundant intermediate exploration before dropping the final task state.",
    "- Echo the transcript sha256 exactly in source_integrity.transcript_sha256.",
    "- Echo the logical JSONL record count in source_integrity.transcript_lines_seen.",
    "",
    "Transcript metadata:",
    "- path: " + stats.inputPath,
    "- sha256: " + stats.sha256,
    "- bytes: " + stats.bytes,
    "- logical JSONL records: " + stats.records,
    "- prompt transcript renderer: " + stats.transcriptRenderer,
    "- approximate char_div_4 tokens: " + stats.approxTokens,
    "- observed user record count estimate: " + stats.userRecords,
    "",
    "<transcript>",
    wrappedTranscript,
    "</transcript>",
  ].join("\n");
}

function buildSharedPromptMarkdown() {
  const prompt = buildFullTranscriptPrompt({
    wrappedTranscript: "{{WRAPPED_TRANSCRIPT_JSONL}}",
    stats: {
      inputPath: "{{INPUT_PATH}}",
      sha256: "{{TRANSCRIPT_SHA256}}",
      bytes: "{{TRANSCRIPT_BYTES}}",
      records: "{{TRANSCRIPT_RECORDS}}",
      transcriptRenderer: "{{TRANSCRIPT_RENDERER}}",
      approxTokens: "{{APPROX_CHAR_DIV_4_TOKENS}}",
      userRecords: "{{USER_RECORD_COUNT}}",
    },
  });
  return [
    "# Shared Compaction Prompt",
    "",
    "This file is generated from `buildFullTranscriptPrompt()` in `scripts/compact-full-transcript.mjs`.",
    "Run `node scripts/compact-full-transcript.mjs --print-shared-prompt-markdown` to regenerate it.",
    "",
    "Placeholders represent per-run transcript metadata or the wrapped JSONL transcript payload.",
    "",
    "```text",
    prompt,
    "```",
    "",
  ].join("\n");
}

function buildCodexRequestBody(promptText, stats) {
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const windowId = `${threadId}:0`;
  const installationId = resolveCodexInstallationId();
  const request = {
    ids: { sessionId, threadId, windowId, installationId },
    body: {
      model: MODEL,
      instructions:
        "You are a transcript compaction engine. Output only strict JSON matching the requested schema.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: promptText }],
        },
      ],
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: REASONING_EFFORT },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      service_tier: SERVICE_TIER,
      prompt_cache_key: "claudecompact-full-" + stats.sha256.slice(0, 32),
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "claude_full_transcript_compaction",
          schema: createSummarySchema(stats.records),
        },
      },
      client_metadata: {
        "x-codex-installation-id": installationId,
        "x-codex-window-id": windowId,
        session_id: sessionId,
        thread_id: threadId,
        codex_harness: "claudecompact-patcher",
        request_kind: "full_transcript_compaction",
        transcript_sha256: stats.sha256,
        transcript_records: String(stats.records),
      },
    },
  };
  return request;
}

function geminiThinkingConfig(model, requestedLevel) {
  const requested = String(requestedLevel || "none").trim().toLowerCase();
  const normalizedModel = String(model || "").toLowerCase();
  const isOff = requested === "none" || requested === "off" || requested === "disabled";
  if (!isOff) return { thinkingLevel: requested };

  // Gemini 3.x Flash/Flash-Lite use thinkingLevel and only support "minimal"
  // as the closest setting to off.
  if (
    normalizedModel.includes("3.") ||
    normalizedModel === "gemini-flash-latest" ||
    normalizedModel === "gemini-flash-lite-latest"
  ) {
    return { thinkingLevel: "minimal" };
  }

  // Older non-thinking Flash lines do not need a thinkingConfig.
  return null;
}

function buildGeminiRequestBody(promptText, stats) {
  const generationConfig = {
    responseMimeType: "application/json",
    responseJsonSchema: createSummarySchema(stats.records),
  };
  const thinkingConfig = geminiThinkingConfig(MODEL, GEMINI_THINKING_LEVEL);
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  if (TEMPERATURE !== null) generationConfig.temperature = TEMPERATURE;
  if (Number.isFinite(GEMINI_MAX_OUTPUT_TOKENS) && GEMINI_MAX_OUTPUT_TOKENS > 0) {
    generationConfig.maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS;
  }
  return {
    body: {
      systemInstruction: {
        parts: [
          {
            text: "You are a transcript compaction engine. Output only strict JSON matching the requested schema.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: promptText }],
        },
      ],
      generationConfig,
    },
  };
}

function buildChatCompletionsRequestBody(promptText, stats) {
  const schema = createSummarySchema(stats.records, {
    // Amazon Bedrock structured outputs reject numerical constraints such as
    // minimum/maximum. Keep line bounds as local validation only for Mantle.
    includeLineBounds: PROVIDER !== "mantle",
  });
  const request = {
    body: {
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a transcript compaction engine. Output only strict JSON matching the requested schema.",
        },
        {
          role: "user",
          content: promptText,
        },
      ],
      stream: true,
      stream_options: {
        include_usage: true,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "claude_full_transcript_compaction",
          strict: true,
          schema,
        },
      },
      metadata: {
        codex_harness: "claudecompact-patcher",
        request_kind: "full_transcript_compaction",
        transcript_sha256: stats.sha256,
        transcript_records: String(stats.records),
      },
    },
  };
  if (TEMPERATURE !== null) {
    request.body.temperature = TEMPERATURE;
  }
  return request;
}

function buildRequestBody(promptText, stats) {
  if (PROVIDER === "gemini") return buildGeminiRequestBody(promptText, stats);
  if (PROVIDER === "xai" || PROVIDER === "mantle") return buildChatCompletionsRequestBody(promptText, stats);
  return buildCodexRequestBody(promptText, stats);
}

function providerEndpoint() {
  if (PROVIDER === "gemini") {
    return (
      GEMINI_API_BASE_URL.replace(/\/$/, "") +
      "/models/" +
      encodeURIComponent(MODEL) +
      ":streamGenerateContent?alt=sse"
    );
  }
  if (PROVIDER === "xai") return XAI_API_BASE_URL.replace(/\/$/, "") + "/chat/completions";
  if (PROVIDER === "mantle") return MANTLE_CHAT_COMPLETIONS_URL;
  return CODEX_RESPONSES_URL;
}

function redactCodexRequestForLog(request, stats) {
  return {
    url: CODEX_RESPONSES_URL,
    method: "POST",
    headers: {
      Authorization: "Bearer <redacted>",
      "ChatGPT-Account-Id": "<redacted>",
      originator: CODEX_ORIGINATOR,
      "User-Agent": CODEX_USER_AGENT,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "session-id": request.ids.sessionId,
      "thread-id": request.ids.threadId,
      "x-client-request-id": request.ids.threadId,
      "x-codex-installation-id": request.ids.installationId,
      "x-codex-window-id": request.ids.windowId,
    },
    body: {
      ...request.body,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "<full transcript omitted from redacted request; see before transcript artifact> " +
                JSON.stringify({
                  inputPath: stats.inputPath,
                  sha256: stats.sha256,
                  bytes: stats.bytes,
                  records: stats.records,
                  approxTokens: stats.approxTokens,
                }),
            },
          ],
        },
      ],
    },
  };
}

function redactGeminiRequestForLog(request, stats) {
  return {
    url: providerEndpoint(),
    method: "POST",
    headers: {
      "x-goog-api-key": "<redacted>",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: {
      ...request.body,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "<full transcript omitted from redacted request; see before transcript artifact> " +
                JSON.stringify({
                  inputPath: stats.inputPath,
                  sha256: stats.sha256,
                  bytes: stats.bytes,
                  records: stats.records,
                  approxTokens: stats.approxTokens,
                }),
            },
          ],
        },
      ],
    },
  };
}

function redactChatCompletionsRequestForLog(request, stats) {
  return {
    url: providerEndpoint(),
    method: "POST",
    headers: {
      Authorization: "Bearer <redacted>",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: {
      ...request.body,
      messages: request.body.messages.map((message) =>
        message.role === "user"
          ? {
              ...message,
              content:
                "<full transcript omitted from redacted request; see before transcript artifact> " +
                JSON.stringify({
                  inputPath: stats.inputPath,
                  sha256: stats.sha256,
                  bytes: stats.bytes,
                  records: stats.records,
                  approxTokens: stats.approxTokens,
                }),
            }
          : message
      ),
    },
  };
}

function redactRequestForLog(request, stats) {
  if (PROVIDER === "gemini") return redactGeminiRequestForLog(request, stats);
  if (PROVIDER === "xai" || PROVIDER === "mantle") {
    return redactChatCompletionsRequestForLog(request, stats);
  }
  return redactCodexRequestForLog(request, stats);
}

function parseSse(raw) {
  const events = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    let eventName = null;
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      events.push({ type: "done_sentinel", event: eventName });
      continue;
    }
    try {
      const parsed = JSON.parse(data);
      if (eventName && parsed && typeof parsed === "object" && !parsed.event) parsed.event = eventName;
      events.push(parsed);
    } catch {
      events.push({ type: "unparsed", event: eventName, data });
    }
  }
  return events;
}

function collectOutputText(events) {
  let deltaText = "";
  let doneText = "";
  let completedText = "";
  for (const event of events) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltaText += event.delta;
    }
    if (event.type === "response.output_text.done" && typeof event.text === "string") {
      doneText += event.text;
    }
    if (event.type === "response.output_item.done") {
      const item = event.item;
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" && typeof part.text === "string") doneText += part.text;
        }
      }
    }
    if (event.type === "response.completed") {
      const output = event.response?.output;
      if (Array.isArray(output)) {
        for (const item of output) {
          if (item?.type !== "message" || !Array.isArray(item.content)) continue;
          for (const part of item.content) {
            if (part.type === "output_text" && typeof part.text === "string") {
              completedText += part.text;
            }
          }
        }
      }
    }
  }
  return (deltaText || doneText || completedText).trim();
}

function collectGeminiOutputText(events) {
  let text = "";
  for (const event of events) {
    text += geminiDeltaText(event);
  }
  return text.trim();
}

function geminiDeltaText(event) {
  if (!event || typeof event !== "object") return "";
  let text = "";
  for (const candidate of event.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string") text += part.text;
    }
  }
  return text;
}

function codexDeltaText(event) {
  return event?.type === "response.output_text.delta" && typeof event.delta === "string"
    ? event.delta
    : "";
}

function chatCompletionsDeltaText(event) {
  let text = "";
  for (const choice of event?.choices || []) {
    const delta = choice.delta?.content;
    if (typeof delta === "string") text += delta;
    else if (Array.isArray(delta)) {
      for (const part of delta) {
        if (typeof part?.text === "string") text += part.text;
      }
    }
  }
  return text;
}

function collectChatCompletionsOutputText(events) {
  let text = "";
  for (const event of events) text += chatCompletionsDeltaText(event);
  return text.trim();
}

function streamAdapter() {
  if (PROVIDER === "gemini") {
    return {
      deltaText: geminiDeltaText,
      collectOutputText: collectGeminiOutputText,
      isCompleted: (event) =>
        (event?.candidates || []).some((candidate) => typeof candidate.finishReason === "string"),
      isFailure: (event) => Boolean(event?.error),
      failureError: (event) => event?.error || event,
      usage: (events) => [...events].reverse().find((event) => event?.usageMetadata)?.usageMetadata ?? null,
      responseId: () => null,
    };
  }
  if (PROVIDER === "xai" || PROVIDER === "mantle") {
    return {
      deltaText: chatCompletionsDeltaText,
      collectOutputText: collectChatCompletionsOutputText,
      isCompleted: (event) =>
        event?.type === "done_sentinel" ||
        (event?.choices || []).some((choice) => typeof choice.finish_reason === "string"),
      isFailure: (event) => Boolean(event?.error),
      failureError: (event) => event?.error || event,
      usage: (events) => [...events].reverse().find((event) => event?.usage)?.usage ?? null,
      responseId: (events) => events.find((event) => typeof event?.id === "string")?.id ?? null,
    };
  }
  return {
    deltaText: codexDeltaText,
    collectOutputText: collectOutputText,
    isCompleted: (event) => event?.type === "response.completed",
    isFailure: (event) => event?.type === "response.failed" || event?.type === "error",
    failureError: (event) => event?.response?.error || event?.error || event,
    usage: (events) =>
      events.find((event) => event.type === "response.completed")?.response?.usage ?? null,
    responseId: (events) =>
      events.find((event) => event.type === "response.completed")?.response?.id ?? null,
  };
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let eventName = null;
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return { type: "done_sentinel", event: eventName };
  try {
    const parsed = JSON.parse(data);
    if (eventName && parsed && typeof parsed === "object" && !parsed.event) parsed.event = eventName;
    return parsed;
  } catch {
    return { type: "unparsed", event: eventName, data };
  }
}

function writeAndClose(stream) {
  return new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", reject);
  });
}

async function streamResponseBody(response, paths, adapter = streamAdapter()) {
  if (!response.body) {
    const raw = await response.text();
    await writeFile(paths.rawResponsePath, raw);
    const events = parseSse(raw);
    const outputText = adapter.collectOutputText(events);
    await writeFile(paths.eventsPath, stringifyEventsJsonl(events));
    await writeFile(paths.modelOutputPath, outputText + "\n");
    return { raw, events, outputText };
  }

  const rawStream = createWriteStream(paths.rawResponsePath);
  const eventsStream = createWriteStream(paths.eventsPath);
  const outputStream = createWriteStream(paths.modelOutputPath);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let raw = "";
  let buffer = "";
  let outputText = "";
  let deltaEvents = 0;
  let lastProgressAt = Date.now();
  let lastLiveWriteAt = 0;
  let liveWritePromise = Promise.resolve();

  function writeLiveSnapshot(status, force = false) {
    if (!paths.snapshotPath || !paths.livePath) return;
    const now = Date.now();
    if (!force && now - lastLiveWriteAt < 1000) return;
    lastLiveWriteAt = now;
    const snapshot = {
      status,
      events: events.length,
      delta_events: deltaEvents,
      output_chars: outputText.length,
      output_tail: outputText.slice(-4000),
      updated_at: new Date().toISOString(),
    };
    const live = [
      "# Compaction Stream",
      "",
      "- status: " + snapshot.status,
      "- events: " + snapshot.events,
      "- delta events: " + snapshot.delta_events,
      "- output chars: " + snapshot.output_chars,
      "",
      "## Partial JSON Tail",
      "",
      "```json",
      snapshot.output_tail,
      "```",
      "",
    ].join("\n");
    liveWritePromise = Promise.all([
      writeFile(paths.snapshotPath, JSON.stringify(snapshot, null, 2) + "\n"),
      writeFile(paths.livePath, live),
    ]).catch(() => {});
  }

  function consumeBlock(block) {
    const event = parseSseBlock(block);
    if (!event) return;
    events.push(event);
    eventsStream.write(JSON.stringify(event) + "\n");
    const delta = adapter.deltaText(event);
    if (delta) {
      deltaEvents += 1;
      outputText += delta;
      outputStream.write(delta);
      if (liveOutput) process.stderr.write(delta);
      writeLiveSnapshot("streaming");
    }
    if (adapter.isCompleted(event)) {
      process.stderr.write(
        "\n[compact-stream] response.completed events=" +
          events.length +
          " delta_events=" +
          deltaEvents +
          "\n"
      );
      writeLiveSnapshot("completed", true);
    }
    const now = Date.now();
    if (now - lastProgressAt > 15000) {
      lastProgressAt = now;
      process.stderr.write(
        "\n[compact-stream] events=" +
          events.length +
          " delta_events=" +
          deltaEvents +
          " output_chars=" +
          outputText.length +
          "\n"
      );
      writeLiveSnapshot("streaming", true);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    rawStream.write(chunk);
    buffer += chunk;

    while (true) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match || match.index === undefined) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      consumeBlock(block);
    }
  }

  const tail = decoder.decode();
  if (tail) {
    raw += tail;
    rawStream.write(tail);
    buffer += tail;
  }
  if (buffer.trim().length > 0) consumeBlock(buffer);

  await Promise.all([writeAndClose(rawStream), writeAndClose(eventsStream), writeAndClose(outputStream)]);
  writeLiveSnapshot("done", true);
  await liveWritePromise;
  if (liveOutput && outputText.length > 0) process.stderr.write("\n");
  return { raw, events, outputText: outputText.trim() };
}

function validateSummary(value, lineHashArtifacts) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "result is not an object";
  const requiredStrings = ["current_work", "optional_next_step"];
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0) return key + " missing";
  }
  const requiredArrays = [
    "summary_blocks",
    "rules_and_invariants",
    "plans_and_task_state",
    "primary_request_and_intent",
    "key_technical_concepts",
    "files_and_code_sections",
    "errors_and_fixes",
    "problem_solving",
    "pending_tasks",
    "promises_made",
    "source_lines_used",
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(value[key])) return key + " is not an array";
  }
  if (!value.source_integrity || typeof value.source_integrity !== "object") {
    return "source_integrity missing";
  }
  if (typeof value.source_integrity.transcript_sha256 !== "string") {
    return "source_integrity.transcript_sha256 missing";
  }
  if (typeof value.source_integrity.transcript_lines_seen !== "number") {
    return "source_integrity.transcript_lines_seen missing";
  }
  if (value.source_integrity.verbatim_span_grounded !== true) {
    return "source_integrity.verbatim_span_grounded is not true";
  }
  if (typeof value.source_integrity.limitations !== "string") {
    return "source_integrity.limitations missing";
  }
  if (value.summary_blocks.length === 0) return "summary_blocks is empty";
  const maxLine = lineHashArtifacts.entries.length;
  const validateSourceSpans = (label, sourceSpans) => {
    if (!Array.isArray(sourceSpans) || sourceSpans.length === 0) {
      return label + ".source_spans missing";
    }
    for (const [spanIdx, span] of sourceSpans.entries()) {
      if (!span || typeof span !== "object" || Array.isArray(span)) {
        return label + ".source_spans[" + spanIdx + "] is not an object";
      }
      for (const key of ["start_line", "end_line"]) {
        const line = span[key];
        if (!Number.isInteger(line)) {
          return label + ".source_spans[" + spanIdx + "]." + key + " is not an integer";
        }
        if (line < 1 || line > maxLine) {
          return label + ".source_spans[" + spanIdx + "]." + key + " out of range: " + line;
        }
      }
      if (span.start_line > span.end_line) {
        return label + ".source_spans[" + spanIdx + "] start_line is after end_line";
      }
    }
    return null;
  };
  for (const [idx, item] of value.summary_blocks.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "summary_blocks[" + idx + "] is not an object";
    }
    if (typeof item.section !== "string" || item.section.trim().length === 0) {
      return "summary_blocks[" + idx + "].section missing";
    }
    if (!["paragraph", "bullet"].includes(item.format)) {
      return "summary_blocks[" + idx + "].format invalid";
    }
    if (typeof item.body !== "string") {
      return "summary_blocks[" + idx + "].body missing";
    }
    if (item.body.trim().length === 0) {
      return "summary_blocks[" + idx + "].body missing";
    }
    if (item.format === "bullet") {
      if (/^\s*[-*]\s+/.test(item.body)) {
        return "summary_blocks[" + idx + "].body must not include a leading bullet marker";
      }
      if (item.body.includes("\n")) {
        return "summary_blocks[" + idx + "].body must be a single bullet item";
      }
    }
    const sourceSpanError = validateSourceSpans("summary_blocks[" + idx + "]", item.source_spans);
    if (sourceSpanError) return sourceSpanError;
  }
  for (const [idx, item] of value.rules_and_invariants.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "rules_and_invariants[" + idx + "] is not an object";
    }
    if (typeof item.rule !== "string" || item.rule.trim().length === 0) {
      return "rules_and_invariants[" + idx + "].rule missing";
    }
    if (!["current", "superseded", "removed"].includes(item.status)) {
      return "rules_and_invariants[" + idx + "].status invalid";
    }
    const sourceSpanError = validateSourceSpans("rules_and_invariants[" + idx + "]", item.source_spans);
    if (sourceSpanError) return sourceSpanError;
  }
  for (const [idx, item] of value.plans_and_task_state.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "plans_and_task_state[" + idx + "] is not an object";
    }
    if (typeof item.item !== "string" || item.item.trim().length === 0) {
      return "plans_and_task_state[" + idx + "].item missing";
    }
    if (!["done", "active", "pending", "blocked", "superseded"].includes(item.status)) {
      return "plans_and_task_state[" + idx + "].status invalid";
    }
    const sourceSpanError = validateSourceSpans("plans_and_task_state[" + idx + "]", item.source_spans);
    if (sourceSpanError) return sourceSpanError;
  }
  for (const [idx, item] of value.promises_made.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "promises_made[" + idx + "] is not an object";
    }
    if (typeof item.promise !== "string" || item.promise.trim().length === 0) {
      return "promises_made[" + idx + "].promise missing";
    }
    if (!["done", "active", "pending", "blocked", "superseded", "removed"].includes(item.status)) {
      return "promises_made[" + idx + "].status invalid";
    }
    const sourceSpanError = validateSourceSpans("promises_made[" + idx + "]", item.source_spans);
    if (sourceSpanError) return sourceSpanError;
  }
  for (const line of value.source_lines_used) {
    if (!Number.isInteger(line)) return "source_lines_used contains non-integer line: " + line;
    if (line < 1 || line > maxLine) return "source_lines_used contains out-of-range line: " + line;
  }
  return null;
}

function normalizeLegacySummary(summary) {
  let ruleStatusDefaulted = 0;
  let promisesMadeDefaulted = 0;
  let bulletFormatRelaxed = 0;
  let codeBlockDowngraded = 0;
  for (const item of summary.rules_and_invariants || []) {
    if (typeof item.status !== "string") {
      item.status = "current";
      ruleStatusDefaulted += 1;
    }
  }
  for (const item of summary.summary_blocks || []) {
    if (item?.format === "code_block") {
      item.format = "paragraph";
      if (typeof item.body !== "string" || item.body.trim().length === 0) {
        item.body = "Verbatim source material is preserved in the cited source spans.";
      }
      delete item.language;
      codeBlockDowngraded += 1;
    }
    if (item?.format !== "bullet" || typeof item.body !== "string") continue;
    if (/^\s*[-*]\s+/.test(item.body) || item.body.includes("\n")) {
      item.format = "paragraph";
      bulletFormatRelaxed += 1;
    }
  }
  if (!Array.isArray(summary.promises_made)) {
    summary.promises_made = [];
    promisesMadeDefaulted = 1;
  }
  return { ruleStatusDefaulted, promisesMadeDefaulted, bulletFormatRelaxed, codeBlockDowngraded };
}

function collectSourceLines(summary) {
  const lines = new Set();
  for (const item of allAnchoredItems(summary)) {
    for (const span of item.source_spans || []) {
      lines.add(span.start_line);
      lines.add(span.end_line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

function lineHash(lineHashArtifacts, lineNumber) {
  return lineHashArtifacts.entries[lineNumber - 1]?.hash;
}

function extractRecordText(record) {
  if (!record || typeof record !== "object") return "";
  if (typeof record.content === "string") return record.content;
  if (typeof record.message?.content === "string") return record.message.content;
  if (Array.isArray(record.message?.content)) {
    const texts = [];
    for (const part of record.message.content) {
      if (typeof part?.text === "string") texts.push(part.text);
    }
    if (texts.length > 0) return texts.join("\n");
  }
  if (record.attachment) return JSON.stringify(record.attachment, null, 2);
  return "";
}

function deriveRehydrationSpans(summary, records, lineHashArtifacts) {
  const spans = [];
  let spanId = 1;
  for (const [anchoredIndex, block] of allAnchoredItems(summary).entries()) {
    for (const [spanIndex, span] of (block.source_spans || []).entries()) {
      const slice = records.slice(span.start_line - 1, span.end_line);
      const extractedText = slice
        .map((record) => extractRecordText(record))
        .filter((text) => text.length > 0)
        .join("\n\n");
      spans.push({
        span_id: "span-" + String(spanId).padStart(4, "0"),
        block_index: block.summary_block_index ?? anchoredIndex,
        anchored_index: anchoredIndex,
        span_index: spanIndex,
        section: block.section,
        format: block.format,
        authority: "raw-source",
        source_kind: "jsonl_record",
        record_range: [span.start_line, span.end_line],
        start_line: span.start_line,
        end_line: span.end_line,
        start_hash: lineHash(lineHashArtifacts, span.start_line),
        end_hash: lineHash(lineHashArtifacts, span.end_line),
        raw_slice_sha256: createHash("sha256")
          .update(slice.map((record) => JSON.stringify(record)).join("\n"))
          .digest("hex"),
        extracted_text_sha256: createHash("sha256").update(extractedText).digest("hex"),
        validation: "verified",
        extracted_text: extractedText,
        raw_jsonl: slice.map((record) => JSON.stringify(record)).join("\n"),
      });
      spanId += 1;
    }
  }
  return spans;
}

function renderRehydratedSummary(summary, spans) {
  const lines = [summary.summary_markdown.trim(), "", "## Rehydration Spans"];
  for (const span of spans) {
    lines.push(
      "- " +
        span.span_id +
        " | " +
        span.section +
        " | lines " +
        span.start_line +
        "-" +
        span.end_line
    );
    lines.push("```");
    lines.push(span.extracted_text.replace(/\n$/, ""));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderCollapsedUserMessage(message) {
  const text = message.text || "";
  const shouldCollapse = text.length > userMessageCollapseAt;
  const head = shouldCollapse ? text.slice(0, userMessageHeadChars) : text;
  const tail = shouldCollapse ? text.slice(Math.max(text.length - userMessageTailChars, userMessageHeadChars)) : "";
  const omitted = shouldCollapse ? Math.max(text.length - head.length - tail.length, 0) : 0;
  const lines = [
    '<user-message line="' +
      message.line +
      '" chars="' +
      message.char_count +
      '" sha256="' +
      escapeXmlAttr(message.sha256) +
      '">',
    head.replace(/\n$/, ""),
  ];
  if (shouldCollapse) {
    lines.push("");
    lines.push(
      "[... omitted " +
        omitted +
        " chars; full text in user-messages.json line " +
        message.line +
        " ...]"
    );
    lines.push("");
    lines.push(tail.replace(/^\n/, "").replace(/\n$/, ""));
  }
  lines.push("</user-message>");
  return {
    rendered: lines.join("\n"),
    collapsed: shouldCollapse,
    omitted_chars: omitted,
    rendered_chars: lines.join("\n").length,
  };
}

function handoffUserMessageIdentity(message) {
  if (message.uuid) return "uuid:" + message.uuid;
  if (message.originalUuid) return "uuid:" + message.originalUuid;
  return [
    "sha",
    message.sha256 || "",
    String(message.char_count || 0),
    message.timestamp || "",
  ].join(":");
}

function mergeHandoffUserMessages(carriedMessages, currentMessages) {
  const byKey = new Map();
  for (const message of carriedMessages) {
    byKey.set(handoffUserMessageIdentity(message), message);
  }
  for (const message of currentMessages) {
    const keys = [
      message.uuid ? "uuid:" + message.uuid : null,
      message.originalUuid ? "uuid:" + message.originalUuid : null,
      handoffUserMessageIdentity(message),
    ].filter(Boolean);
    for (const key of keys) byKey.delete(key);
    byKey.set(handoffUserMessageIdentity(message), message);
  }
  return [...byKey.values()];
}

function handoffUserMessageBody(message) {
  if (typeof message.rendered_text === "string" && message.rendered_text.trim()) {
    return message.rendered_text.trim();
  }
  const text = message.text || "";
  if (text.length <= userMessageCollapseAt) return text.trim();
  const head = text.slice(0, userMessageHeadChars).replace(/\n$/, "");
  const tail = text
    .slice(Math.max(text.length - userMessageTailChars, userMessageHeadChars))
    .replace(/^\n/, "")
    .replace(/\n$/, "");
  const omitted = Math.max(text.length - head.length - tail.length, 0);
  return [head, "", "[... omitted " + omitted + " chars ...]", "", tail].join("\n").trim();
}

function renderHandoffUserMessage(message) {
  const attrs = {
    source: message.source || "current",
    line: message.line,
    original_line: message.original_line || message.line,
    chars: message.char_count || 0,
    sha256: message.sha256 || "",
    record_sha256: message.record_sha256 || "",
    source_transcript_sha256: message.source_transcript_sha256 || "",
    uuid: message.uuid || "",
    original_uuid: message.originalUuid || "",
    timestamp: message.timestamp || "",
  };
  const attrText = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && String(value) !== "")
    .map(([key, value]) => key + '="' + escapeXmlAttr(value) + '"')
    .join(" ");
  return "<user-message " + attrText + ">\n" + handoffUserMessageBody(message) + "\n</user-message>";
}

function selectHandoffUserMessages(messages) {
  const selected = [];
  let tokenEstimate = 0;
  let lineCount = 0;
  let omittedOlder = 0;
  const maxMessages = handoffUserMessageLimit;
  const maxTokens = handoffUserMessageTokenBudget;
  const maxLines = handoffUserMessageLineLimit;

  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    if (maxMessages === 0) {
      omittedOlder = idx + 1;
      break;
    }
    if (selected.length >= maxMessages) {
      omittedOlder = idx + 1;
      break;
    }
    const rendered = renderHandoffUserMessage(messages[idx]);
    const renderedTokens = Math.ceil(rendered.length / 4);
    const renderedLines = rendered.split(/\r?\n/).length;
    const wouldExceedTokens = maxTokens > 0 && tokenEstimate + renderedTokens > maxTokens;
    const wouldExceedLines = maxLines > 0 && lineCount + renderedLines > maxLines;
    if (selected.length > 0 && (wouldExceedTokens || wouldExceedLines)) {
      omittedOlder = idx + 1;
      break;
    }
    selected.push({
      ...messages[idx],
      rendered,
      rendered_tokens: renderedTokens,
      rendered_lines: renderedLines,
    });
    tokenEstimate += renderedTokens;
    lineCount += renderedLines;
  }

  selected.reverse();
  return {
    selected,
    total: messages.length,
    omitted_older: omittedOlder,
    token_estimate: tokenEstimate,
    line_count: lineCount,
    limits: {
      count: maxMessages,
      token_budget: maxTokens,
      line_limit: maxLines,
    },
  };
}

function renderHandoffUserMessagesSection(selection) {
  if (!selection.selected.length) return "";
  const lines = [
    "## User Messages",
    "",
    "Harness-extracted user-authored messages. These are not model summaries. They are carried forward across compactions and bounded by count, token, and line limits.",
    "",
    '<user-message-ledger version="' +
      HANDOFF_USER_MESSAGE_LEDGER_VERSION +
      '" total="' +
      selection.total +
      '" selected="' +
      selection.selected.length +
      '" omitted_older="' +
      selection.omitted_older +
      '" token_estimate="' +
      selection.token_estimate +
      '" line_count="' +
      selection.line_count +
      '" count_limit="' +
      selection.limits.count +
      '" token_budget="' +
      selection.limits.token_budget +
      '" line_limit="' +
      selection.limits.line_limit +
      '">',
  ];
  for (const message of selection.selected) lines.push(message.rendered);
  lines.push("</user-message-ledger>");
  return lines.join("\n");
}

function inferUserIntentKind(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\b(do not|don't|never|must|always|required|require|preserve|keep|avoid|only)\b/.test(normalized)) {
    return "constraint";
  }
  if (/\b(secret|credential|token|key|password|safety|security|private)\b/.test(normalized)) {
    return "safety";
  }
  if (/\b(actually|correction|instead|scratch that|not that|supersede)\b/.test(normalized)) {
    return "correction";
  }
  if (/\b(prefer|preference|style|tone|format)\b/.test(normalized)) {
    return "preference";
  }
  return "request";
}

function inferUserIntentPriority(kind, text) {
  const normalized = String(text || "").toLowerCase();
  if (kind === "safety") return "must_keep";
  if (/\b(do not|don't|never|must|required|preserve|keep)\b/.test(normalized)) return "high";
  if (kind === "correction" || kind === "constraint") return "high";
  if (kind === "preference") return "normal";
  return "normal";
}

function buildUserIntentEvents(selection) {
  return selection.selected.map((message, idx) => {
    const text = message.text || "";
    const kind = inferUserIntentKind(text);
    return {
      id: "intent-" + String(idx + 1).padStart(4, "0"),
      kind,
      status: "current",
      priority: inferUserIntentPriority(kind, text),
      supersedes: [],
      source: {
        line: message.line,
        original_line: message.original_line || message.line,
        uuid: message.uuid || null,
        original_uuid: message.originalUuid || null,
        timestamp: message.timestamp || null,
        record_sha256: message.record_sha256 || null,
        source_transcript_sha256: message.source_transcript_sha256 || null,
        source: message.source || "current",
      },
      text_sha256: message.sha256 || sha256Text(text),
      message_sha256: message.sha256 || sha256Text(text),
      char_count: message.char_count || text.length,
      rendered_text: handoffUserMessageBody(message),
      text,
    };
  });
}

function buildEvidenceCapsules(rehydratedSpans) {
  return rehydratedSpans.map((span) => ({
    id: "ev-" + span.span_id.replace(/^span-/, ""),
    span_id: span.span_id,
    authority: span.authority || "raw-source",
    source_kind: span.source_kind || "jsonl_record",
    record_range: span.record_range || [span.start_line, span.end_line],
    start_line: span.start_line,
    end_line: span.end_line,
    start_hash: span.start_hash,
    end_hash: span.end_hash,
    raw_slice_sha256: span.raw_slice_sha256,
    extracted_text_sha256: span.extracted_text_sha256,
    validation: span.validation || "verified",
    section: span.section,
    format: span.format,
    block_index: span.block_index,
    span_index: span.span_index,
  }));
}

function buildHandoffState({
  summary,
  stats,
  run,
  beforePath,
  rehydratedSpans,
  handoffUserMessageSelection,
}) {
  const evidenceCapsules = buildEvidenceCapsules(rehydratedSpans);
  return {
    schema: HANDOFF_STATE_SCHEMA,
    version: 1,
    checkpoint_id: "compact-" + stats.sha256.slice(0, 16) + "-" + run.finishedAt.replace(/[:.]/g, "-"),
    created_at: run.finishedAt,
    source_transcripts: [
      {
        original_path: stats.inputPath,
        artifact_path: beforePath,
        transcript_sha256: stats.sha256,
        records: stats.records,
        bytes: stats.bytes,
        renderer: stats.transcriptRenderer,
      },
    ],
    native_compaction_items: [],
    active_state: {
      current_objective: summary.current_work,
      next_step: summary.optional_next_step,
      open_questions: [],
      blockers: (summary.plans_and_task_state || [])
        .filter((item) => item.status === "blocked")
        .map((item) => item.item),
    },
    summary_markdown: summary.summary_markdown,
    summary_blocks: summary.summary_blocks,
    rules_and_invariants: summary.rules_and_invariants,
    plans_and_task_state: summary.plans_and_task_state,
    promises_made: summary.promises_made,
    primary_request_and_intent: summary.primary_request_and_intent,
    key_technical_concepts: summary.key_technical_concepts,
    files_and_code_sections: summary.files_and_code_sections,
    errors_and_fixes: summary.errors_and_fixes,
    problem_solving: summary.problem_solving,
    pending_tasks: summary.pending_tasks,
    user_intent_events: buildUserIntentEvents(handoffUserMessageSelection),
    evidence_capsules: evidenceCapsules,
    source_integrity: summary.source_integrity,
    artifact_manifest: "handoff-manifest.json",
    rendered_handoff: "handoff.md",
  };
}

function validateHandoffState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "handoff state is not an object";
  if (state.schema !== HANDOFF_STATE_SCHEMA) return "handoff state schema invalid";
  if (!Array.isArray(state.user_intent_events)) return "handoff state user_intent_events missing";
  if (!Array.isArray(state.evidence_capsules)) return "handoff state evidence_capsules missing";
  for (const [idx, event] of state.user_intent_events.entries()) {
    const label = "handoff state user_intent_events[" + idx + "]";
    if (typeof event.id !== "string" || !event.id) return label + ".id missing";
    if (!["request", "correction", "safety", "preference", "constraint"].includes(event.kind)) {
      return label + ".kind invalid";
    }
    if (!["current", "superseded", "removed"].includes(event.status)) return label + ".status invalid";
    if (!["must_keep", "high", "normal", "low"].includes(event.priority)) {
      return label + ".priority invalid";
    }
    if (!Array.isArray(event.supersedes)) return label + ".supersedes missing";
    if (!event.source || typeof event.source !== "object") return label + ".source missing";
    if (!Number.isInteger(event.source.line) || event.source.line < 1) return label + ".source.line invalid";
    if (typeof event.source.record_sha256 !== "string" || !event.source.record_sha256) {
      return label + ".source.record_sha256 missing";
    }
    if (typeof event.text_sha256 !== "string" || !event.text_sha256) return label + ".text_sha256 missing";
    if (typeof event.text !== "string" || !event.text) return label + ".text missing";
    if (event.text_sha256 !== sha256Text(event.text)) return label + ".text_sha256 mismatch";
  }
  for (const [idx, capsule] of state.evidence_capsules.entries()) {
    const label = "handoff state evidence_capsules[" + idx + "]";
    if (typeof capsule.id !== "string" || !capsule.id) return label + ".id missing";
    if (capsule.authority !== "raw-source") return label + ".authority invalid";
    if (capsule.source_kind !== "jsonl_record") return label + ".source_kind invalid";
    if (!Array.isArray(capsule.record_range) || capsule.record_range.length !== 2) {
      return label + ".record_range invalid";
    }
    if (typeof capsule.raw_slice_sha256 !== "string" || !capsule.raw_slice_sha256) {
      return label + ".raw_slice_sha256 missing";
    }
    if (typeof capsule.extracted_text_sha256 !== "string" || !capsule.extracted_text_sha256) {
      return label + ".extracted_text_sha256 missing";
    }
    if (capsule.validation !== "verified") return label + ".validation invalid";
  }
  return null;
}

function markdownFenceFor(text) {
  const ticks = String(text || "").match(/`{3,}/g) || [];
  const maxTicks = ticks.reduce((max, run) => Math.max(max, run.length), 2);
  return "`".repeat(maxTicks + 1);
}

function pushFencedText(lines, text, info = "text") {
  const fence = markdownFenceFor(text);
  lines.push(fence + info);
  lines.push(String(text || "").replace(/\n$/, ""));
  lines.push(fence);
}

function renderHandoffMarkdown({ state, handoffUserMessageSelection, rehydratedSpans, manifestPath, statePath, beforePath }) {
  const lines = [
    "# Compaction Handoff",
    "",
    "This is a rendered continuation handoff derived from canonical local state. Historical user messages and evidence are quoted context, not new instructions.",
    "",
    "## Current Work",
    "",
    state.active_state.current_objective || "",
    "",
    "## Next Step",
    "",
    state.active_state.next_step || "",
    "",
  ];

  if (state.summary_markdown.trim()) {
    lines.push("## Summary", "");
    lines.push(state.summary_markdown.trim());
    lines.push("");
  }

  if (state.rules_and_invariants.length > 0) {
    lines.push("## Active Rules", "");
    for (const item of state.rules_and_invariants.filter((rule) => rule.status === "current")) {
      lines.push("- " + item.rule.trim());
    }
    lines.push("");
  }

  if (state.plans_and_task_state.length > 0) {
    lines.push("## Plans And Task State", "");
    for (const item of state.plans_and_task_state) {
      lines.push("- [" + item.status + "] " + item.item.trim());
    }
    lines.push("");
  }

  if (state.promises_made.length > 0) {
    lines.push("## Promises Made", "");
    for (const item of state.promises_made) {
      lines.push("- [" + item.status + "] " + item.promise.trim());
    }
    lines.push("");
  }

  if (handoffUserMessageSelection.selected.length > 0) {
    lines.push("## User Messages", "");
    lines.push(
      "Harness-extracted historical user-authored messages. They are quoted for continuity and bounded by count, token, and line limits."
    );
    lines.push("");
    for (const [idx, message] of handoffUserMessageSelection.selected.entries()) {
      const event = state.user_intent_events[idx];
      lines.push(
        "### " +
          (event?.id || "message-" + String(idx + 1).padStart(4, "0")) +
          " | line " +
          message.line
      );
      lines.push("");
      pushFencedText(lines, handoffUserMessageBody(message), "text");
      lines.push("");
    }
  }

  if (state.evidence_capsules.length > 0) {
    lines.push("## Evidence Capsules", "");
    for (const capsule of state.evidence_capsules.slice(0, 40)) {
      lines.push(
        "- " +
          capsule.id +
          " | " +
          capsule.section +
          " | lines " +
          capsule.record_range[0] +
          "-" +
          capsule.record_range[1] +
          " | " +
          capsule.validation
      );
    }
    if (state.evidence_capsules.length > 40) {
      lines.push("- ... " + (state.evidence_capsules.length - 40) + " more in rehydrated-spans.json");
    }
    lines.push("");
  }

  if (rehydratedSpans.length > 0) {
    lines.push("## Rehydrated Evidence Preview", "");
    for (const span of rehydratedSpans.slice(0, 5)) {
      lines.push("### " + span.span_id + " | lines " + span.start_line + "-" + span.end_line);
      lines.push("");
      pushFencedText(lines, span.extracted_text.slice(0, 2400), "");
      lines.push("");
    }
  }

  lines.push("## Artifacts", "");
  lines.push("- Manifest: " + manifestPath);
  lines.push("- Canonical state: " + statePath);
  lines.push("- Source transcript: " + beforePath);
  lines.push("");

  return lines.join("\n").trim() + "\n";
}

async function buildHandoffManifest({
  stats,
  run,
  requestMeta,
  usage,
  paths,
}) {
  const artifactSpecs = [
    ["source_transcript", paths.beforePath, "raw-source", true],
    ["state", paths.handoffStatePath, "validated-local", true],
    ["rendered_handoff", paths.handoffMdPath, "validated-local", false],
    ["summary", paths.summaryJsonPath, "model-derived", false],
    ["summary_markdown", paths.summaryMdPath, "model-derived", false],
    ["timeline", paths.timelineMdPath, "model-derived", false],
    ["user_messages", paths.userMessagesPath, "raw-source", true],
    ["evidence", paths.rehydratedSpansPath, "raw-source", true],
    ["rehydrated_summary", paths.rehydratedSummaryPath, "raw-source", false],
    ["line_hashes", paths.lineHashesPath, "raw-source", false],
    ["request_log", paths.requestLogPath, "local-log", true],
    ["events", paths.eventsPath, "provider-output", true],
    ["model_output", paths.modelOutputPath, "provider-output", true],
  ];
  const artifacts = [];
  for (const [kind, path, authority, sensitive] of artifactSpecs) {
    artifacts.push({
      kind,
      path: basename(path),
      absolute_path: path,
      sha256: await sha256File(path),
      authority,
      sensitive,
    });
  }
  return {
    schema: HANDOFF_MANIFEST_SCHEMA,
    version: 1,
    checkpoint_id: "compact-" + stats.sha256.slice(0, 16) + "-" + run.finishedAt.replace(/[:.]/g, "-"),
    created_at: run.finishedAt,
    source: {
      transcript_path: paths.beforePath,
      original_input_path: stats.inputPath,
      transcript_sha256: stats.sha256,
      records: stats.records,
      bytes: stats.bytes,
      renderer: stats.transcriptRenderer,
    },
    provider: {
      provider: PROVIDER,
      model: MODEL,
      endpoint: requestMeta.endpoint,
      schema_fingerprint: sha256Text(JSON.stringify(createSummarySchema(stats.records))),
      native_compaction_artifact: null,
      usage: usage || null,
    },
    artifacts,
    validation: {
      schema: "passed",
      artifact_hashes: "passed",
      source_integrity: "passed",
      timeline_order: "passed",
      user_intent_events: "passed",
      evidence_capsules: "passed",
    },
  };
}

function anchorStart(item) {
  let min = Infinity;
  for (const span of item.source_spans || []) {
    if (Number.isInteger(span.start_line)) min = Math.min(min, span.start_line);
  }
  return Number.isFinite(min) ? min : 1000000000;
}

function renderTimelineModelItem(item) {
  if (item.kind === "rule") return "- [" + item.status + "] " + item.rule.trim();
  if (item.kind === "plan") return "- [" + item.status + "] " + item.item.trim();
  if (item.kind === "promise") return "- [" + item.status + "] " + item.promise.trim();
  if (item.format === "bullet") return "- " + item.body.trim();
  return item.body.trim();
}

function buildTimelineUnits(summary, userMessages) {
  const units = [];
  for (const message of userMessages) {
    units.push({ kind: "user_message", line: message.line, priority: 0, message });
  }
  for (const item of timelineAnchoredItems(summary)) {
    units.push({
      kind: "model_item",
      line: anchorStart(item),
      priority: 1,
      item,
    });
  }
  units.sort((a, b) => a.line - b.line || a.priority - b.priority);
  return units;
}

function validateTimelineUnits(summary, userMessages) {
  const units = buildTimelineUnits(summary, userMessages);
  let previousLine = 0;
  for (const [idx, unit] of units.entries()) {
    if (!Number.isInteger(unit.line) || unit.line < 1) {
      return "timeline unit " + idx + " has invalid line";
    }
    if (unit.line < previousLine) {
      return "timeline units are not monotonic at index " + idx;
    }
    previousLine = unit.line;
  }
  return null;
}

function renderTimelineSummary(summary, userMessages) {
  const units = buildTimelineUnits(summary, userMessages);

  const lines = ["# Compaction Timeline", ""];
  for (const unit of units) {
    if (unit.kind === "user_message") {
      const collapsed = renderCollapsedUserMessage(unit.message);
      lines.push("## line " + String(unit.line).padStart(6, "0") + " | user");
      lines.push("");
      lines.push(collapsed.rendered);
      lines.push("");
      continue;
    }
    lines.push(
      "## line " +
        String(unit.line).padStart(6, "0") +
        " | " +
        unit.item.section
    );
    lines.push("");
    lines.push(renderTimelineModelItem(unit.item));
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function renderSummaryBlocks(summary) {
  const lines = [];
  const currentRules = (summary.rules_and_invariants || []).filter((item) => item.status === "current");
  if (currentRules.length > 0) {
    lines.push("## Rules And Invariants");
    for (const item of currentRules) {
      lines.push("- " + item.rule.trim());
    }
    lines.push("");
  }
  if (Array.isArray(summary.plans_and_task_state) && summary.plans_and_task_state.length > 0) {
    lines.push("## Plans And Task State");
    for (const item of summary.plans_and_task_state) {
      lines.push("- [" + item.status + "] " + item.item.trim());
    }
    lines.push("");
  }
  if (Array.isArray(summary.promises_made) && summary.promises_made.length > 0) {
    lines.push("## Promises Made");
    for (const item of summary.promises_made) {
      lines.push("- [" + item.status + "] " + item.promise.trim());
    }
    lines.push("");
  }
  let currentSection = null;
  for (const [blockIndex, item] of summary.summary_blocks.entries()) {
    const section = item.section.trim();
    if (section !== currentSection) {
      if (lines.length > 0) lines.push("");
      lines.push("## " + section);
      currentSection = section;
    }
    if (item.format === "bullet") {
      lines.push("- " + item.body.trim());
      continue;
    }
    lines.push(item.body.trim());
  }
  return lines.join("\n");
}

function collectSourceHashes(summary, lineHashArtifacts) {
  const hashes = new Set();
  for (const item of allAnchoredItems(summary)) {
    for (const span of item.source_spans || []) {
      hashes.add(lineHash(lineHashArtifacts, span.start_line));
      hashes.add(lineHash(lineHashArtifacts, span.end_line));
    }
  }
  return [...hashes].filter(Boolean);
}

function allAnchoredItems(summary) {
  const items = [];
  for (const item of summary.rules_and_invariants || []) {
    items.push({
      section: "Rules And Invariants",
      format: "bullet",
      source_spans: item.source_spans,
    });
  }
  for (const item of summary.plans_and_task_state || []) {
    items.push({
      section: "Plans And Task State",
      format: "bullet",
      source_spans: item.source_spans,
    });
  }
  for (const item of summary.promises_made || []) {
    items.push({
      section: "Promises Made",
      format: "bullet",
      source_spans: item.source_spans,
    });
  }
  for (const [idx, item] of (summary.summary_blocks || []).entries()) {
    items.push({ ...item, summary_block_index: idx });
  }
  return items;
}

function timelineAnchoredItems(summary) {
  const items = [];
  for (const item of summary.rules_and_invariants || []) {
    items.push({
      kind: "rule",
      section: "Rules And Invariants",
      format: "bullet",
      rule: item.rule,
      status: item.status,
      source_spans: item.source_spans,
    });
  }
  for (const item of summary.plans_and_task_state || []) {
    items.push({
      kind: "plan",
      section: "Plans And Task State",
      format: "bullet",
      item: item.item,
      status: item.status,
      source_spans: item.source_spans,
    });
  }
  for (const item of summary.promises_made || []) {
    items.push({
      kind: "promise",
      section: "Promises Made",
      format: "bullet",
      promise: item.promise,
      status: item.status,
      source_spans: item.source_spans,
    });
  }
  for (const [idx, item] of (summary.summary_blocks || []).entries()) {
    items.push({
      kind: "summary_block",
      ...item,
      summary_block_index: idx,
    });
  }
  return items;
}

function validateUserMessageArtifacts(userMessages) {
  let previousLine = 0;
  for (const [idx, message] of userMessages.entries()) {
    if (!Number.isInteger(message.line) || message.line <= 0) {
      return "userMessages[" + idx + "].line invalid";
    }
    if (message.line <= previousLine) {
      return "userMessages line order is not strictly increasing at index " + idx;
    }
    previousLine = message.line;
    if (typeof message.text !== "string" || message.text.length === 0) {
      return "userMessages[" + idx + "].text missing";
    }
    const textHash = createHash("sha256").update(message.text).digest("hex");
    if (message.sha256 !== textHash) {
      return "userMessages[" + idx + "].sha256 does not match text";
    }
    if (message.char_count !== message.text.length) {
      return "userMessages[" + idx + "].char_count does not match text length";
    }
    const collapsed = renderCollapsedUserMessage(message);
    if (message.text.length > userMessageCollapseAt && !collapsed.collapsed) {
      return "userMessages[" + idx + "] should be collapsed";
    }
    const maxCollapsedChars = userMessageHeadChars + userMessageTailChars + 600;
    if (collapsed.collapsed && collapsed.rendered_chars > maxCollapsedChars) {
      return "userMessages[" + idx + "] collapsed render exceeds max expected size";
    }
  }
  return null;
}

function validateNoRawUserMessageDumps(summary, userMessages) {
  const modelText = JSON.stringify(summary);
  for (const message of userMessages) {
    if (message.text.length <= userMessageCollapseAt) continue;
    const probe = message.text.slice(0, Math.min(userMessageHeadChars, 700)).trim();
    if (probe.length < 200) continue;
    if (modelText.includes(probe)) {
      return "model output contains raw long user-message prefix from line " + message.line;
    }
  }
  return null;
}

function cloneForTail(record) {
  return JSON.parse(JSON.stringify(record));
}

function shouldPreserveTailRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (record.isCompactSummary) return false;
  return record.type === "user" || record.type === "assistant" || record.type === "system" || record.type === "attachment";
}

function buildCompactedTranscript({
  records,
  summary,
  stats,
  run,
  beforePath,
  handoffUserMessageSelection,
  handoffState,
  handoffMarkdown,
  handoffManifestPath,
  handoffStatePath,
  handoffMdPath,
}) {
  const baseMetadata = compactBaseMetadata(pickBaseMetadata(records));
  const boundaryUuid = safeUuid();
  const summaryUuid = safeUuid();
  const originalTailParent = extractLastUserUuid(records);

  const boundary = {
    parentUuid: originalTailParent,
    isSidechain: false,
    userType: baseMetadata.userType,
    cwd: baseMetadata.cwd,
    sessionId: baseMetadata.sessionId,
    version: baseMetadata.version,
    gitBranch: baseMetadata.gitBranch,
    type: "system",
    content: "Conversation compacted",
    uuid: boundaryUuid,
    timestamp: run.finishedAt,
    compactMetadata: {
      trigger: "manual",
      preTokens: stats.approxTokens,
      durationMs: run.durationMs,
      preservedSegment: "tail",
      preservedMessages: {
        requested: preserveTailCount,
        emitted: 0,
      },
      postTokens: Math.ceil(summary.summary_markdown.length / 4),
      externalCompact: true,
      compactProfile: "warp-guided-span-rehydration",
      wasSummarized: true,
      handoff: {
        schema: HANDOFF_POINTER_SCHEMA,
        manifestPath: handoffManifestPath,
        statePath: handoffStatePath,
        markdownPath: handoffMdPath,
      },
      userMessages: handoffUserMessageSelection
        ? {
            selected: handoffUserMessageSelection.selected.length,
            total: handoffUserMessageSelection.total,
            omittedOlder: handoffUserMessageSelection.omitted_older,
            tokenEstimate: handoffUserMessageSelection.token_estimate,
            lineCount: handoffUserMessageSelection.line_count,
            limits: handoffUserMessageSelection.limits,
          }
        : null,
      provider: PROVIDER,
      customSummaryInstructions: customSummaryInstructions.trim() || null,
      compactAndPrompt: compactAndPrompt.trim() || null,
      model: MODEL,
      transcriptRenderer,
      temperature: TEMPERATURE,
      serviceTier: PROVIDER === "codex" ? SERVICE_TIER : null,
      thinkingLevel: PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
      thinkingConfig:
        PROVIDER === "gemini" ? geminiThinkingConfig(MODEL, GEMINI_THINKING_LEVEL) : null,
      sourceTranscriptSha256: stats.sha256,
    },
  };

  const summaryText = [
    "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
    "",
    "Summary:",
    handoffMarkdown.trim(),
    "",
    "Canonical handoff artifacts:",
    "- Manifest: " + handoffManifestPath,
    "- State: " + handoffStatePath,
    "- Rendered Markdown: " + handoffMdPath,
    "",
    "Full source transcript artifact:",
    beforePath,
    "",
    ...(compactAndPrompt.trim()
      ? ["Queued follow-up prompt after compaction:", compactAndPrompt.trim(), ""]
      : []),
    "Continue from the current work and optional next step captured in the summary. Treat the preserved tail records after this summary as extra local context only.",
  ].join("\n");
  boundary.compactMetadata.postTokens = Math.ceil(summaryText.length / 4);

  const summaryRecord = {
    parentUuid: boundaryUuid,
    isSidechain: false,
    userType: baseMetadata.userType,
    cwd: baseMetadata.cwd,
    sessionId: baseMetadata.sessionId,
    version: baseMetadata.version,
    gitBranch: baseMetadata.gitBranch,
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: summaryText }],
    },
    isMeta: true,
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    handoff: {
      schema: HANDOFF_POINTER_SCHEMA,
      manifest_path: handoffManifestPath,
      state_path: handoffStatePath,
      markdown_path: handoffMdPath,
      user_intent_events: (handoffState?.user_intent_events || []).map((event) => ({
        id: event.id,
        kind: event.kind,
        status: event.status,
        priority: event.priority,
        supersedes: event.supersedes,
        source: event.source,
        text_sha256: event.text_sha256,
        message_sha256: event.message_sha256,
        char_count: event.char_count,
        rendered_text: event.rendered_text,
        text: event.text,
      })),
    },
    uuid: summaryUuid,
    timestamp: run.finishedAt,
  };

  const tailSource =
    preserveTailCount === 0 ? [] : records.filter(shouldPreserveTailRecord).slice(-preserveTailCount);
  const tail = [];
  let parentUuid = summaryUuid;
  for (const source of tailSource) {
    const copy = cloneForTail(source);
    copy.parentUuid = parentUuid;
    copy.uuid = safeUuid();
    copy.isExternalCompactPreservedTail = true;
    copy.originalUuid = source.uuid || null;
    copy.originalParentUuid = source.parentUuid || null;
    parentUuid = copy.uuid;
    tail.push(copy);
  }
  boundary.compactMetadata.preservedMessages.emitted = tail.length;
  return [boundary, summaryRecord, ...tail].map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function stringifyEventsJsonl(events) {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

async function main() {
  if (process.argv.includes("--print-shared-prompt-markdown")) {
    console.log(buildSharedPromptMarkdown());
    return;
  }

  const transcript = await readFile(inputPath, "utf8");
  const records = parseJsonl(transcript);
  const lineHashArtifacts = buildRecordArtifacts(transcript);
  const sha256 = createHash("sha256").update(transcript).digest("hex");
  const stats = {
    inputPath,
    sha256,
    bytes: Buffer.byteLength(transcript),
    records: records.length,
    approxTokens: Math.ceil(transcript.length / 4),
    userRecords: countUserMessages(records),
    transcriptRenderer,
  };
  const promptText = buildFullTranscriptPrompt({
    wrappedTranscript: lineHashArtifacts.wrappedTranscript,
    stats,
  });
  if (dumpPromptPath) await writeFile(resolve(dumpPromptPath), promptText);
  const request = buildRequestBody(promptText, stats);
  const bodyText = JSON.stringify(request.body);
  const endpoint = providerEndpoint();
  const requestMeta = {
    provider: PROVIDER,
    endpoint,
    model: MODEL,
    service_tier: PROVIDER === "codex" ? SERVICE_TIER : null,
    reasoning_effort: PROVIDER === "codex" ? REASONING_EFFORT : null,
    temperature: TEMPERATURE,
    thinking_level: PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
    thinking_config:
      PROVIDER === "gemini" ? request.body.generationConfig?.thinkingConfig || null : null,
    max_output_tokens:
      PROVIDER === "gemini" && Number.isFinite(GEMINI_MAX_OUTPUT_TOKENS)
        ? GEMINI_MAX_OUTPUT_TOKENS
        : null,
    inputPath,
    outDir,
    transcript_sha256: sha256,
    transcript_bytes: stats.bytes,
    transcript_records: stats.records,
    transcript_renderer: transcriptRenderer,
    estimated_char_div_4_tokens: stats.approxTokens,
    request_body_bytes: Buffer.byteLength(bodyText),
    live_output: liveOutput,
    preserve_tail: preserveTailCount,
    custom_summary_instructions: customSummaryInstructions.trim() || null,
    compact_and_prompt: compactAndPrompt.trim() || null,
    from_output: fromOutputPath ? resolve(fromOutputPath) : null,
    user_message_collapse_at: userMessageCollapseAt,
    user_message_head_chars: userMessageHeadChars,
    user_message_tail_chars: userMessageTailChars,
    handoff_user_message_limit: handoffUserMessageLimit,
    handoff_user_message_token_budget: handoffUserMessageTokenBudget,
    handoff_user_message_line_limit: handoffUserMessageLineLimit,
  };

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, request: requestMeta }, null, 2));
    console.log(JSON.stringify(redactRequestForLog(request, stats), null, 2));
    return;
  }

  await mkdir(outDir, { recursive: true });
  const beforePath = join(outDir, "before-" + basename(inputPath));
  const requestLogPath = join(outDir, "request.redacted.json");
  const lineHashesPath = join(outDir, "line-hashes.tsv");
  const rawResponsePath = join(outDir, "response.sse");
  const eventsPath = join(outDir, "events.jsonl");
  const modelOutputPath = join(outDir, "model-output.json");
  const snapshotPath = join(outDir, "snapshot.json");
  const livePath = join(outDir, "live.md");
  const summaryJsonPath = join(outDir, "summary.json");
  const summaryMdPath = join(outDir, "summary.md");
  const timelineMdPath = join(outDir, "summary.timeline.md");
  const userMessagesPath = join(outDir, "user-messages.json");
  const rehydratedSpansPath = join(outDir, "rehydrated-spans.json");
  const rehydratedSummaryPath = join(outDir, "summary.rehydrated.md");
  const handoffStatePath = join(outDir, "handoff-state.json");
  const handoffManifestPath = join(outDir, "handoff-manifest.json");
  const handoffMdPath = join(outDir, "handoff.md");
  const afterPath = join(outDir, "after-compact.jsonl");
  const resultPath = join(outDir, "result.json");

  await copyFile(inputPath, beforePath);
  await writeFile(lineHashesPath, lineHashArtifacts.tsv);
  await writeFile(requestLogPath, JSON.stringify(redactRequestForLog(request, stats), null, 2) + "\n");

  let events = [];
  let outputText = "";
  let loadedFromOutput = false;
  if (fromOutputPath) {
    loadedFromOutput = true;
    const sourceOutputPath = resolve(fromOutputPath);
    outputText = (await readFile(sourceOutputPath, "utf8")).trim();
    await writeFile(rawResponsePath, "");
    await writeFile(eventsPath, "");
    await writeFile(modelOutputPath, outputText + "\n");
    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          status: "loaded_from_output",
          sourceOutputPath,
          output_chars: outputText.length,
          updated_at: new Date().toISOString(),
        },
        null,
        2
      ) + "\n"
    );
    await writeFile(
      livePath,
      [
        "# Compaction Stream",
        "",
        "- status: loaded_from_output",
        "- source output: " + sourceOutputPath,
        "- output chars: " + outputText.length,
        "",
      ].join("\n")
    );
  } else {
    if (PROVIDER === "gemini" && !GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY for --provider gemini");
    }
    if (PROVIDER === "xai" && !XAI_API_KEY) {
      throw new Error("Missing XAI_API_KEY for --provider xai");
    }
    if (PROVIDER === "mantle" && !MANTLE_API_KEY) {
      throw new Error("Missing MANTLE_API_KEY or BEDROCK_MANTLE_API_KEY for --provider mantle");
    }
    process.stderr.write("sending full transcript request: " + JSON.stringify(requestMeta) + "\n");

    const response =
      PROVIDER === "gemini"
        ? await fetch(endpoint, {
            method: "POST",
            headers: {
              "x-goog-api-key": GEMINI_API_KEY,
              Accept: "text/event-stream",
              "Content-Type": "application/json",
            },
            body: bodyText,
          })
        : PROVIDER === "xai" || PROVIDER === "mantle"
          ? await fetch(endpoint, {
              method: "POST",
              headers: {
                Authorization: "Bearer " + (PROVIDER === "xai" ? XAI_API_KEY : MANTLE_API_KEY),
                Accept: "text/event-stream",
                "Content-Type": "application/json",
              },
              body: bodyText,
            })
        : await (async () => {
            const auth = await loadChatgptAuth();
            return fetch(endpoint, {
              method: "POST",
              headers: {
                Authorization: "Bearer " + auth.accessToken,
                "ChatGPT-Account-Id": auth.accountId,
                originator: CODEX_ORIGINATOR,
                "User-Agent": CODEX_USER_AGENT,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "session-id": request.ids.sessionId,
                "thread-id": request.ids.threadId,
                "x-client-request-id": request.ids.threadId,
                "x-codex-installation-id": request.ids.installationId,
                "x-codex-window-id": request.ids.windowId,
              },
              body: bodyText,
            });
          })();

    const streamed = await streamResponseBody(response, {
      rawResponsePath,
      eventsPath,
      modelOutputPath,
      snapshotPath,
      livePath,
    });
    const raw = streamed.raw;

    if (!response.ok) {
      const failure = {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        requestId: response.headers.get("x-request-id") || response.headers.get("x-goog-request-id"),
        cfRay: response.headers.get("cf-ray"),
        bodyPreview: raw.slice(0, 4000),
        request: requestMeta,
        artifacts: {
          beforePath,
          lineHashesPath,
          requestLogPath,
          rawResponsePath,
        },
      };
      await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
      console.error(JSON.stringify(failure, null, 2));
      process.exit(1);
    }

    events = streamed.events;
    const adapter = streamAdapter();
    outputText = streamed.outputText || adapter.collectOutputText(events);
    const failedEvent = events.find((event) => adapter.isFailure(event));
    if (failedEvent) {
      const failure = {
        ok: false,
        error: adapter.failureError(failedEvent),
        request: requestMeta,
        artifacts: {
          beforePath,
          lineHashesPath,
          requestLogPath,
          rawResponsePath,
          eventsPath,
          modelOutputPath,
          snapshotPath,
          livePath,
        },
      };
      await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
      console.error(JSON.stringify(failure, null, 2));
      process.exit(1);
    }
  }

  let summary;
  try {
    summary = JSON.parse(outputText);
  } catch (error) {
    const failure = {
      ok: false,
      error: "output was not JSON: " + error.message,
      outputPreview: outputText.slice(0, 4000),
      request: requestMeta,
      artifacts: {
        beforePath,
        lineHashesPath,
        requestLogPath,
        rawResponsePath,
        eventsPath,
        modelOutputPath,
        snapshotPath,
        livePath,
      },
    };
    await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
  const legacyModelUserMessagesDiscarded = Object.prototype.hasOwnProperty.call(
    summary,
    "all_user_messages"
  )
    ? Array.isArray(summary.all_user_messages)
      ? summary.all_user_messages.length
      : true
    : 0;
  delete summary.all_user_messages;
  const legacySummaryNormalization = loadedFromOutput
    ? normalizeLegacySummary(summary)
    : { ruleStatusDefaulted: 0, promisesMadeDefaulted: 0, bulletFormatRelaxed: 0, codeBlockDowngraded: 0 };

  // Canonicalize derived citation fields before validation so minor model
  // omissions do not fail an otherwise grounded summary.
  summary.source_lines_used = collectSourceLines(summary);

  const validationError = validateSummary(summary, lineHashArtifacts);
  if (validationError) {
    const failure = {
      ok: false,
      error: validationError,
      request: requestMeta,
      artifacts: {
        beforePath,
        lineHashesPath,
        requestLogPath,
        rawResponsePath,
        eventsPath,
        modelOutputPath,
        snapshotPath,
        livePath,
      },
      parsedPreview: summary,
    };
    await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  }

  const rehydratedSpans = deriveRehydrationSpans(summary, records, lineHashArtifacts);
  const userMessages = extractUserMessages(records, lineHashArtifacts);
  const carriedUserMessages = extractCarriedHandoffUserMessages(records);
  const handoffUserMessages = mergeHandoffUserMessages(carriedUserMessages, userMessages);
  const handoffUserMessageSelection = selectHandoffUserMessages(handoffUserMessages);
  const userMessageValidationError = validateUserMessageArtifacts(userMessages);
  if (userMessageValidationError) {
    const failure = {
      ok: false,
      error: userMessageValidationError,
      request: requestMeta,
      artifacts: {
        beforePath,
        lineHashesPath,
        requestLogPath,
        rawResponsePath,
        eventsPath,
        modelOutputPath,
        snapshotPath,
        livePath,
      },
    };
    await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
  const rawUserDumpValidationError = validateNoRawUserMessageDumps(summary, userMessages);
  if (rawUserDumpValidationError) {
    const failure = {
      ok: false,
      error: rawUserDumpValidationError,
      request: requestMeta,
      artifacts: {
        beforePath,
        lineHashesPath,
        requestLogPath,
        rawResponsePath,
        eventsPath,
        modelOutputPath,
        snapshotPath,
        livePath,
      },
    };
    await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
  const timelineValidationError = validateTimelineUnits(summary, userMessages);
  if (timelineValidationError) {
    const failure = {
      ok: false,
      error: timelineValidationError,
      request: requestMeta,
      artifacts: {
        beforePath,
        lineHashesPath,
        requestLogPath,
        rawResponsePath,
        eventsPath,
        modelOutputPath,
        snapshotPath,
        livePath,
      },
    };
    await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
  summary.source_hashes_used = collectSourceHashes(summary, lineHashArtifacts);
  summary.summary_markdown = renderSummaryBlocks(summary);
  const timelineMarkdown = renderTimelineSummary(summary, userMessages);
  const finishedAt = new Date();
  const run = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
  const userMessagesPayload = {
    metadata: {
      source_transcript: inputPath,
      transcript_sha256: sha256,
      transcript_records: records.length,
      current_message_count: userMessages.length,
      carried_message_count: carriedUserMessages.length,
      selected_message_count: handoffUserMessageSelection.selected.length,
      omitted_older_count: handoffUserMessageSelection.omitted_older,
      handoff_token_estimate: handoffUserMessageSelection.token_estimate,
      handoff_line_count: handoffUserMessageSelection.line_count,
      handoff_limits: handoffUserMessageSelection.limits,
      collapse_at: userMessageCollapseAt,
      head_chars: userMessageHeadChars,
      tail_chars: userMessageTailChars,
    },
    messages: handoffUserMessageSelection.selected,
    current_messages: userMessages,
    carried_messages: carriedUserMessages,
  };
  await writeFile(summaryJsonPath, JSON.stringify(summary, null, 2) + "\n");
  await writeFile(summaryMdPath, summary.summary_markdown.trim() + "\n");
  await writeFile(timelineMdPath, timelineMarkdown);
  await writeFile(userMessagesPath, JSON.stringify(userMessagesPayload, null, 2) + "\n");
  await writeFile(rehydratedSpansPath, JSON.stringify(rehydratedSpans, null, 2) + "\n");
  await writeFile(rehydratedSummaryPath, renderRehydratedSummary(summary, rehydratedSpans));

  const handoffState = buildHandoffState({
    summary,
    stats,
    run,
    beforePath,
    rehydratedSpans,
    handoffUserMessageSelection,
  });
  const handoffStateValidationError = validateHandoffState(handoffState);
  if (handoffStateValidationError) {
    const failure = {
      ok: false,
      error: handoffStateValidationError,
      request: requestMeta,
      artifacts: {
        beforePath,
        lineHashesPath,
        requestLogPath,
        rawResponsePath,
        eventsPath,
        modelOutputPath,
        snapshotPath,
        livePath,
      },
    };
    await writeFile(join(outDir, "failure.json"), JSON.stringify(failure, null, 2) + "\n");
    console.error(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
  await writeFile(handoffStatePath, JSON.stringify(handoffState, null, 2) + "\n");

  const handoffMarkdown = renderHandoffMarkdown({
    state: handoffState,
    handoffUserMessageSelection,
    rehydratedSpans,
    manifestPath: handoffManifestPath,
    statePath: handoffStatePath,
    beforePath,
  });
  await writeFile(handoffMdPath, handoffMarkdown);

  const adapter = streamAdapter();
  const handoffManifest = await buildHandoffManifest({
    stats,
    run,
    requestMeta,
    usage: adapter.usage(events),
    paths: {
      beforePath,
      handoffStatePath,
      handoffMdPath,
      summaryJsonPath,
      summaryMdPath,
      timelineMdPath,
      userMessagesPath,
      rehydratedSpansPath,
      rehydratedSummaryPath,
      lineHashesPath,
      requestLogPath,
      eventsPath,
      modelOutputPath,
    },
  });
  await writeFile(handoffManifestPath, JSON.stringify(handoffManifest, null, 2) + "\n");

  await writeFile(
    snapshotPath,
    JSON.stringify(
      {
        status: "validated",
        summary,
        userMessages,
        carriedUserMessages,
        handoffUserMessages: handoffUserMessageSelection,
        handoffState,
        handoffManifest,
        rehydratedSpans,
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(livePath, handoffMarkdown);
  const afterTranscript = buildCompactedTranscript({
    records,
    summary,
    stats,
    run,
    beforePath,
    handoffUserMessageSelection,
    handoffState,
    handoffMarkdown,
    handoffManifestPath,
    handoffStatePath,
    handoffMdPath,
  });
  await writeFile(afterPath, afterTranscript);

  const afterRecords = parseJsonl(afterTranscript);
  const result = {
    ok: true,
    provider: PROVIDER,
    endpoint,
    model: MODEL,
    service_tier: PROVIDER === "codex" ? SERVICE_TIER : null,
    reasoning: PROVIDER === "codex" ? request.body.reasoning : null,
    temperature: TEMPERATURE,
    thinking_level: PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
    thinking_config:
      PROVIDER === "gemini" ? request.body.generationConfig?.thinkingConfig || null : null,
    request: requestMeta,
    response_id: adapter.responseId(events),
    usage: adapter.usage(events),
    loaded_from_output: loadedFromOutput,
    event_count: events.length,
    output_sha256: createHash("sha256").update(outputText).digest("hex"),
    legacy_model_user_messages_discarded: legacyModelUserMessagesDiscarded,
    legacy_rule_status_defaulted: legacySummaryNormalization.ruleStatusDefaulted,
    legacy_promises_made_defaulted: legacySummaryNormalization.promisesMadeDefaulted,
    legacy_bullet_format_relaxed: legacySummaryNormalization.bulletFormatRelaxed,
    legacy_code_block_downgraded: legacySummaryNormalization.codeBlockDowngraded,
    summary_chars: summary.summary_markdown.length,
    summary_estimated_tokens: Math.ceil(summary.summary_markdown.length / 4),
    summary_block_count: summary.summary_blocks.length,
    rules_and_invariants_count: summary.rules_and_invariants.length,
    current_rules_and_invariants_count: summary.rules_and_invariants.filter(
      (item) => item.status === "current"
    ).length,
    plans_and_task_state_count: summary.plans_and_task_state.length,
    promises_made_count: summary.promises_made.length,
    user_message_count: userMessages.length,
    user_message_total_chars: userMessages.reduce((total, message) => total + message.char_count, 0),
    user_message_collapsed_count: userMessages.filter(
      (message) => message.char_count > userMessageCollapseAt
    ).length,
    user_message_max_chars: userMessages.reduce(
      (max, message) => Math.max(max, message.char_count),
      0
    ),
    carried_user_message_count: carriedUserMessages.length,
    handoff_user_message_total_count: handoffUserMessages.length,
    handoff_user_message_selected_count: handoffUserMessageSelection.selected.length,
    handoff_user_message_omitted_older_count: handoffUserMessageSelection.omitted_older,
    handoff_user_message_token_estimate: handoffUserMessageSelection.token_estimate,
    handoff_user_message_line_count: handoffUserMessageSelection.line_count,
    handoff_user_message_limits: handoffUserMessageSelection.limits,
    rehydrated_span_count: rehydratedSpans.length,
    source_line_count: summary.source_lines_used.length,
    before_estimated_tokens: stats.approxTokens,
    after_bytes: Buffer.byteLength(afterTranscript),
    after_estimated_tokens: Math.ceil(afterTranscript.length / 4),
    context_window_usage_estimate: {
      before_char_div_4_tokens: stats.approxTokens,
      after_char_div_4_tokens: Math.ceil(afterTranscript.length / 4),
      reduction_ratio:
        stats.approxTokens > 0 ? Math.ceil(afterTranscript.length / 4) / stats.approxTokens : null,
    },
    compact_profile: "warp-guided-span-rehydration",
    was_summarized: true,
    custom_summary_instructions: customSummaryInstructions.trim() || null,
    compact_and_prompt: compactAndPrompt.trim() || null,
    transcript_renderer: transcriptRenderer,
    integrity_echo_matches:
      summary.source_integrity.transcript_sha256 === sha256 &&
      summary.source_integrity.transcript_lines_seen === records.length,
    before_records: records.length,
    after_records: afterRecords.length,
    artifacts: {
      beforePath,
      afterPath,
      summaryJsonPath,
      summaryMdPath,
      timelineMdPath,
      userMessagesPath,
      rehydratedSpansPath,
      rehydratedSummaryPath,
      handoffStatePath,
      handoffManifestPath,
      handoffMdPath,
      snapshotPath,
      livePath,
      lineHashesPath,
      requestLogPath,
      rawResponsePath,
      eventsPath,
      modelOutputPath,
      resultPath,
    },
    run,
  };
  await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, "failure.json"),
      JSON.stringify({ ok: false, error: error.stack || error.message }, null, 2) + "\n"
    );
  } catch {
    // Ignore secondary failure while reporting the primary error.
  }
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
