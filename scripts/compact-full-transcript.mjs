#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function normalizeProvider(value) {
  const provider = String(value || "codex").toLowerCase();
  if (provider === "codex" || provider === "gemini") return provider;
  throw new Error("Unsupported provider: " + value + " (expected codex or gemini)");
}

const PROVIDER = normalizeProvider(
  argValue("--provider", process.env.COMPACT_PROVIDER || process.env.COMPACT_MODEL_PROVIDER || "codex")
);
const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL || "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = process.env.CODEX_AUTH_JSON || join(homedir(), ".codex", "auth.json");
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_INPUT = "transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl";
const MODEL =
  argValue("--model") ||
  process.env.COMPACT_MODEL ||
  (PROVIDER === "gemini"
    ? process.env.GEMINI_COMPACT_MODEL || "gemini-3.5-flash"
    : process.env.CODEX_COMPACT_MODEL || "gpt-5.4");
const SERVICE_TIER = process.env.CODEX_COMPACT_SERVICE_TIER || "priority";
const REASONING_EFFORT = process.env.CODEX_COMPACT_REASONING_EFFORT || "low";
const GEMINI_THINKING_LEVEL = process.env.GEMINI_COMPACT_THINKING_LEVEL || "low";
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

const inputPath = resolve(argValue("--input", DEFAULT_INPUT));
const preserveTailCount = intArg("--preserve-tail", 16);
const dryRun = process.argv.includes("--dry-run");
const liveOutput = !process.argv.includes("--no-live-output");
const customSummaryInstructions = argValue("--summary-instructions", "");
const compactAndPrompt = argValue("--compact-and", "");
const fromOutputPath = argValue("--from-output", "");
const userMessageCollapseAt = intArg("--user-message-collapse-at", 2400);
const userMessageHeadChars = intArg("--user-message-head-chars", 900);
const userMessageTailChars = intArg("--user-message-tail-chars", 900);
const startedAt = new Date();
const defaultOutDir = join(
  "runs",
  "compact-" + startedAt.toISOString().replace(/[:.]/g, "-")
);
const outDir = resolve(argValue("--out-dir", defaultOutDir));

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

function buildRecordArtifacts(transcript) {
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
      parentUuid: record.parentUuid || null,
      timestamp: record.timestamp || null,
      sha256: createHash("sha256").update(text).digest("hex"),
      record_sha256: lineHash(lineHashArtifacts, line) || null,
      char_count: text.length,
      text,
    });
  });
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
  for (const [key, value] of Object.entries(metadata)) {
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

function createSummarySchema(recordCount = 0) {
  const stringArray = {
    type: "array",
    items: { type: "string" },
  };
  const lineNumber = {
    type: "integer",
    minimum: 1,
    maximum: recordCount || 1000000000,
    description: "One-based logical JSONL record number from the <record line=...> wrapper.",
  };
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
      "source_lines_used",
      "source_integrity",
    ],
    properties: {
      summary_blocks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "format", "language", "body", "source_spans"],
          properties: {
            section: { type: "string" },
            format: {
              type: "string",
              enum: ["paragraph", "bullet", "code_block"],
            },
            language: {
              type: "string",
              description: "Optional code fence language for code_block items. Empty string is allowed.",
            },
            body: {
              type: "string",
              description:
                "Rendered summary content for this block. For code_block items, this is an exact-display fallback only; the harness prefers verbatim rehydration from source_spans instead of trusting body.",
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
          "Active plans, task state, benchmark state, open artifacts, and concrete next actions that should remain visible after compaction.",
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
      source_lines_used: {
        type: "array",
        items: lineNumber,
      },
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
    "Optimize for the very next follow-up prompt, as if the user will continue immediately after this summary.",
    "Treat this as a continuation handoff, not a retrospective summary.",
    "Assume long conversations may have already been partially summarized upstream; preserve the active working set and compress older material aggressively.",
    "",
    "Critical shape requirement:",
    "- You will receive the full JSONL transcript in one piece.",
    "- Do not ask for chunks.",
    "- Do not omit late-session state.",
    "- Treat later user messages as more important than earlier abandoned plans.",
    "- If older context and late-session state conflict, prefer the corrected late-session state and explain only the delta that still matters.",
    "",
    "Return strict JSON only. The JSON must match the provided schema.",
    ...customInstructionsBlock,
    ...compactAndBlock,
    "",
    "Evidence span format:",
    "- The transcript is wrapped as <record line=\"000001\">JSONL</record>.",
    "- Use one-based logical JSONL record numbers from those wrappers for every source span.",
    "- Do not emit hashes, placeholders, or fake citation markers in the summary.",
    "- summary_blocks is the primary structured output. It must be ordered exactly as the continuation summary should read.",
    "- Every summary_blocks item must include one or more source_spans pointing to the exact supporting record ranges.",
    "- The authoritative source record is the cited source_spans plus harness rehydration, not long verbatim body text.",
    "- Do not copy large verbatim transcript excerpts into the JSON response. The harness will extract exact record content itself from the selected source spans.",
    "- For code_block items, treat source_spans as the source of truth. Use code_block only when the selected span is the exact contiguous content that should be shown verbatim, or as close as the record boundaries allow.",
    "- For code_block items, prefer a single narrow contiguous source span whenever practical.",
    "- For code_block items, body is an exact-display fallback field, not a summarization field. Do not paraphrase, normalize, rewrite, or synthesize code, config, commands, or error text in body.",
    "- For code_block items, leave body empty or use only a very short label unless fallback text is unavoidable.",
    "- If you cannot point to the exact contiguous source text for a code_block, do not fake it. Emit a paragraph or bullet summary instead.",
    "- Hashes are integrity metadata for the harness only. Never surface them as user-facing prose.",
    "- If exact code, commands, hooks, config, or error text matter, keep body empty or extremely terse and rely on narrow source_spans for lossless recovery.",
    "- source_lines_used is a derived field. You may leave it empty, but if you populate it, it must include every distinct start_line/end_line referenced anywhere in source_spans.",
    "- source_integrity.verbatim_span_grounded must be true.",
    "",
    "Compaction requirements:",
    "- The harness will render the final markdown summary from summary_blocks and separately emit a rehydrated evidence view from source_spans.",
    "- Prioritize continuation utility over historical exhaustiveness.",
    "- Think in two bands: active context and archived context. Active context is what the next agent needs immediately; archived context is only the minimum older material still needed to avoid repeating mistakes or losing commitments.",
    "- Keep abandoned branches brief unless they still constrain current work, explain a bug, or explain why a later correction matters.",
    "- Prefer durable state over chronology: capture decisions, invariants, open tasks, exact artifacts, and unresolved blockers before narrating what happened.",
    "- Prefer block-style handoff sections over a play-by-play timeline.",
    "- Prefer a summary a strong coding agent could continue from immediately without reopening the whole transcript.",
    "- Preserve explicit user instructions, constraints, file paths, commands, errors, pending work, and security-relevant instructions.",
    "- Put durable user/system/project rules in rules_and_invariants. Do not bury them only in generic prose.",
    "- If a later user message removes or supersedes an earlier rule, mark that rule status as removed or superseded. Do not present removed or superseded rules as live instructions.",
    "- Put active plans, benchmark status, open artifacts, and concrete next actions in plans_and_task_state. Do not make the next agent infer them from chronology.",
    "- Preserve exact symbols, command names, endpoint paths, file names, hook names, setting names, and error text when they matter.",
    "- Use code_block items only for exact code, commands, config, or error text that the next turn is likely to need directly. Prefer fewer, higher-value code blocks over broad transcript copying.",
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
    "- approximate char_div_4 tokens: " + stats.approxTokens,
    "- observed user record count estimate: " + stats.userRecords,
    "",
    "<transcript_jsonl>",
    wrappedTranscript,
    "</transcript_jsonl>",
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
  const installationId = randomUUID();
  return {
    ids: { sessionId, threadId, installationId },
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
      reasoning: { effort: REASONING_EFFORT, summary: "auto" },
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
        codex_harness: "claudecompact-patcher",
        request_kind: "full_transcript_compaction",
        transcript_sha256: stats.sha256,
        transcript_records: String(stats.records),
      },
    },
  };
}

function buildGeminiRequestBody(promptText, stats) {
  const generationConfig = {
    responseMimeType: "application/json",
    responseJsonSchema: createSummarySchema(stats.records),
    thinkingConfig: {
      thinkingLevel: GEMINI_THINKING_LEVEL,
    },
  };
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

function buildRequestBody(promptText, stats) {
  if (PROVIDER === "gemini") return buildGeminiRequestBody(promptText, stats);
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
  return CODEX_RESPONSES_URL;
}

function redactCodexRequestForLog(request, stats) {
  return {
    url: CODEX_RESPONSES_URL,
    method: "POST",
    headers: {
      Authorization: "Bearer <redacted>",
      "ChatGPT-Account-Id": "<redacted>",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
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

function redactRequestForLog(request, stats) {
  if (PROVIDER === "gemini") return redactGeminiRequestForLog(request, stats);
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
    if (!["paragraph", "bullet", "code_block"].includes(item.format)) {
      return "summary_blocks[" + idx + "].format invalid";
    }
    if (typeof item.body !== "string") {
      return "summary_blocks[" + idx + "].body missing";
    }
    if (item.format !== "code_block" && item.body.trim().length === 0) {
      return "summary_blocks[" + idx + "].body missing";
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
  for (const line of value.source_lines_used) {
    if (!Number.isInteger(line)) return "source_lines_used contains non-integer line: " + line;
    if (line < 1 || line > maxLine) return "source_lines_used contains out-of-range line: " + line;
  }
  return null;
}

function normalizeLegacySummary(summary) {
  let ruleStatusDefaulted = 0;
  for (const item of summary.rules_and_invariants || []) {
    if (typeof item.status !== "string") {
      item.status = "current";
      ruleStatusDefaulted += 1;
    }
  }
  return { ruleStatusDefaulted };
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
        start_line: span.start_line,
        end_line: span.end_line,
        start_hash: lineHash(lineHashArtifacts, span.start_line),
        end_hash: lineHash(lineHashArtifacts, span.end_line),
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

function anchorStart(item) {
  let min = Infinity;
  for (const span of item.source_spans || []) {
    if (Number.isInteger(span.start_line)) min = Math.min(min, span.start_line);
  }
  return Number.isFinite(min) ? min : 1000000000;
}

function renderTimelineModelItem(item, rehydratedSpansByBlock) {
  if (item.kind === "rule") return "- [" + item.status + "] " + item.rule.trim();
  if (item.kind === "plan") return "- [" + item.status + "] " + item.item.trim();
  if (item.format === "bullet") return "- " + item.body.trim();
  if (item.format === "code_block") {
    const language = typeof item.language === "string" ? item.language.trim() : "";
    const verbatim = (rehydratedSpansByBlock.get(item.summary_block_index) || []).join("\n\n").trim();
    return ["```" + language, (verbatim || item.body).replace(/\n$/, ""), "```"].join("\n");
  }
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

function renderTimelineSummary(summary, userMessages, rehydratedSpans = []) {
  const rehydratedSpansByBlock = new Map();
  for (const span of rehydratedSpans) {
    if (span.format !== "code_block") continue;
    if (typeof span.block_index !== "number") continue;
    const list = rehydratedSpansByBlock.get(span.block_index) || [];
    if (typeof span.extracted_text === "string" && span.extracted_text.trim().length > 0) {
      list.push(span.extracted_text.replace(/\n$/, ""));
    }
    rehydratedSpansByBlock.set(span.block_index, list);
  }
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
    lines.push(renderTimelineModelItem(unit.item, rehydratedSpansByBlock));
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function renderSummaryBlocks(summary, rehydratedSpans = []) {
  const verbatimByBlock = new Map();
  for (const span of rehydratedSpans) {
    if (span.format !== "code_block") continue;
    if (typeof span.block_index !== "number") continue;
    const existing = verbatimByBlock.get(span.block_index) || [];
    if (typeof span.extracted_text === "string" && span.extracted_text.trim().length > 0) {
      existing.push(span.extracted_text.replace(/\n$/, ""));
    }
    verbatimByBlock.set(span.block_index, existing);
  }
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
    if (item.format === "code_block") {
      const language = typeof item.language === "string" ? item.language.trim() : "";
      const verbatim = (verbatimByBlock.get(blockIndex) || []).join("\n\n").trim();
      lines.push("```" + language);
      lines.push((verbatim || item.body).replace(/\n$/, ""));
      lines.push("```");
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

function buildCompactedTranscript({ records, summary, stats, run, beforePath }) {
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
      provider: PROVIDER,
      customSummaryInstructions: customSummaryInstructions.trim() || null,
      compactAndPrompt: compactAndPrompt.trim() || null,
      model: MODEL,
      serviceTier: PROVIDER === "codex" ? SERVICE_TIER : null,
      thinkingLevel: PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
      sourceTranscriptSha256: stats.sha256,
    },
  };

  const summaryText = [
    "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
    "",
    "Summary:",
    summary.summary_markdown,
    "",
    "Full source transcript artifact:",
    beforePath,
    "",
    ...(compactAndPrompt.trim()
      ? ["Queued follow-up prompt after compaction:", compactAndPrompt.trim(), ""]
      : []),
    "Continue from the current work and optional next step captured in the summary. Treat the preserved tail records after this summary as extra local context only.",
  ].join("\n");

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
    uuid: summaryUuid,
    timestamp: run.finishedAt,
  };

  const tailSource = records.filter(shouldPreserveTailRecord).slice(-preserveTailCount);
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
  };
  const promptText = buildFullTranscriptPrompt({
    wrappedTranscript: lineHashArtifacts.wrappedTranscript,
    stats,
  });
  const request = buildRequestBody(promptText, stats);
  const bodyText = JSON.stringify(request.body);
  const endpoint = providerEndpoint();
  const requestMeta = {
    provider: PROVIDER,
    endpoint,
    model: MODEL,
    service_tier: PROVIDER === "codex" ? SERVICE_TIER : null,
    reasoning_effort: PROVIDER === "codex" ? REASONING_EFFORT : null,
    thinking_level: PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
    max_output_tokens:
      PROVIDER === "gemini" && Number.isFinite(GEMINI_MAX_OUTPUT_TOKENS)
        ? GEMINI_MAX_OUTPUT_TOKENS
        : null,
    inputPath,
    outDir,
    transcript_sha256: sha256,
    transcript_bytes: stats.bytes,
    transcript_records: stats.records,
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
        : await (async () => {
            const auth = await loadChatgptAuth();
            return fetch(endpoint, {
              method: "POST",
              headers: {
                Authorization: "Bearer " + auth.accessToken,
                "ChatGPT-Account-Id": auth.accountId,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "session-id": request.ids.sessionId,
                "thread-id": request.ids.threadId,
                "x-client-request-id": request.ids.threadId,
                "x-codex-installation-id": request.ids.installationId,
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
    : { ruleStatusDefaulted: 0 };

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
  summary.summary_markdown = renderSummaryBlocks(summary, rehydratedSpans);
  const timelineMarkdown = renderTimelineSummary(summary, userMessages, rehydratedSpans);
  await writeFile(summaryJsonPath, JSON.stringify(summary, null, 2) + "\n");
  await writeFile(summaryMdPath, summary.summary_markdown.trim() + "\n");
  await writeFile(timelineMdPath, timelineMarkdown);
  await writeFile(
    userMessagesPath,
    JSON.stringify(
      {
        metadata: {
          source_transcript: inputPath,
          transcript_sha256: sha256,
          transcript_records: records.length,
          message_count: userMessages.length,
          collapse_at: userMessageCollapseAt,
          head_chars: userMessageHeadChars,
          tail_chars: userMessageTailChars,
        },
        messages: userMessages,
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(rehydratedSpansPath, JSON.stringify(rehydratedSpans, null, 2) + "\n");
  await writeFile(rehydratedSummaryPath, renderRehydratedSummary(summary, rehydratedSpans));
  await writeFile(
    snapshotPath,
    JSON.stringify({ status: "validated", summary, userMessages, rehydratedSpans }, null, 2) + "\n"
  );
  await writeFile(livePath, renderRehydratedSummary(summary, rehydratedSpans));

  const finishedAt = new Date();
  const run = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
  const afterTranscript = buildCompactedTranscript({
    records,
    summary,
    stats,
    run,
    beforePath,
  });
  await writeFile(afterPath, afterTranscript);

  const afterRecords = parseJsonl(afterTranscript);
  const adapter = streamAdapter();
  const result = {
    ok: true,
    provider: PROVIDER,
    endpoint,
    model: MODEL,
    service_tier: PROVIDER === "codex" ? SERVICE_TIER : null,
    reasoning: PROVIDER === "codex" ? request.body.reasoning : null,
    thinking_level: PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
    request: requestMeta,
    response_id: adapter.responseId(events),
    usage: adapter.usage(events),
    loaded_from_output: loadedFromOutput,
    event_count: events.length,
    output_sha256: createHash("sha256").update(outputText).digest("hex"),
    legacy_model_user_messages_discarded: legacyModelUserMessagesDiscarded,
    legacy_rule_status_defaulted: legacySummaryNormalization.ruleStatusDefaulted,
    summary_chars: summary.summary_markdown.length,
    summary_estimated_tokens: Math.ceil(summary.summary_markdown.length / 4),
    summary_block_count: summary.summary_blocks.length,
    rules_and_invariants_count: summary.rules_and_invariants.length,
    current_rules_and_invariants_count: summary.rules_and_invariants.filter(
      (item) => item.status === "current"
    ).length,
    plans_and_task_state_count: summary.plans_and_task_state.length,
    user_message_count: userMessages.length,
    user_message_total_chars: userMessages.reduce((total, message) => total + message.char_count, 0),
    user_message_collapsed_count: userMessages.filter(
      (message) => message.char_count > userMessageCollapseAt
    ).length,
    user_message_max_chars: userMessages.reduce(
      (max, message) => Math.max(max, message.char_count),
      0
    ),
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
