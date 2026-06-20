#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL || "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = process.env.CODEX_AUTH_JSON || join(homedir(), ".codex", "auth.json");

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

const dryRun = process.argv.includes("--dry-run");
const prompt =
  argValue(
    "--prompt",
    "Return a JSON object with ok=true, answer='codex backend smoke ok', and a short note.",
  ) || "";

async function loadChatgptAuth() {
  const raw = await readFile(AUTH_PATH, "utf8");
  const auth = JSON.parse(raw);
  if (auth.auth_mode !== "chatgpt") {
    throw new Error(`Expected ChatGPT auth in ${AUTH_PATH}; got auth_mode=${auth.auth_mode}`);
  }
  const tokens = auth.tokens;
  const accessToken = tokens?.access_token;
  const accountId = tokens?.account_id || tokens?.id_token?.chatgpt_account_id;
  if (!accessToken) throw new Error(`Missing tokens.access_token in ${AUTH_PATH}`);
  if (!accountId) throw new Error(`Missing ChatGPT account id in ${AUTH_PATH}`);
  return { accessToken, accountId };
}

function buildRequestBody(promptText) {
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const installationId = randomUUID();
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "answer", "note"],
    properties: {
      ok: { type: "boolean" },
      answer: { type: "string" },
      note: { type: "string" },
    },
  };
  return {
    ids: { sessionId, threadId, installationId },
    body: {
      model: "gpt-5.4",
      instructions: "You are a strict JSON smoke-test responder. Output only data matching the schema.",
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
      reasoning: { effort: "low", summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      service_tier: "priority",
      prompt_cache_key: `codexcompact-smoke-${sessionId}`,
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "codex_backend_smoke",
          schema,
        },
      },
      client_metadata: {
        codex_harness: "claudecompact-patcher",
        request_kind: "smoke",
      },
    },
  };
}

function redactRequestForLog(request) {
  return {
    url: CODEX_RESPONSES_URL,
    method: "POST",
    headers: {
      Authorization: "Bearer <redacted>",
      "ChatGPT-Account-Id": "<redacted>",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: request.body,
  };
}

function parseSse(raw) {
  const events = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      events.push({ type: "unparsed", data });
    }
  }
  return events;
}

function collectOutputText(events) {
  let deltaText = "";
  let doneText = "";
  for (const event of events) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltaText += event.delta;
    }
    if (event.type === "response.output_item.done") {
      const item = event.item;
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" && typeof part.text === "string") doneText += part.text;
        }
      }
    }
  }
  return (deltaText || doneText).trim();
}

function validateSmoke(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "result is not an object";
  if (value.ok !== true) return "ok is not true";
  if (typeof value.answer !== "string" || value.answer.length === 0) return "answer missing";
  if (typeof value.note !== "string" || value.note.length === 0) return "note missing";
  return null;
}

async function main() {
  const auth = await loadChatgptAuth();
  const request = buildRequestBody(prompt);
  if (dryRun) {
    console.log(JSON.stringify(redactRequestForLog(request), null, 2));
    return;
  }

  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "ChatGPT-Account-Id": auth.accountId,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "session-id": request.ids.sessionId,
      "thread-id": request.ids.threadId,
      "x-client-request-id": request.ids.threadId,
      "x-codex-installation-id": request.ids.installationId,
    },
    body: JSON.stringify(request.body),
  });

  const raw = await response.text();
  if (!response.ok) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          requestId: response.headers.get("x-request-id"),
          cfRay: response.headers.get("cf-ray"),
          bodyPreview: raw.slice(0, 1000),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const events = parseSse(raw);
  const outputText = collectOutputText(events);
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    console.error(JSON.stringify({ ok: false, error: "output was not JSON", outputText }, null, 2));
    process.exit(1);
  }
  const validationError = validateSmoke(parsed);
  if (validationError) {
    console.error(JSON.stringify({ ok: false, error: validationError, parsed }, null, 2));
    process.exit(1);
  }

  const completed = events.find((event) => event.type === "response.completed");
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: CODEX_RESPONSES_URL,
        model: request.body.model,
        service_tier: request.body.service_tier,
        reasoning: request.body.reasoning,
        event_count: events.length,
        response_id: completed?.response?.id ?? null,
        output_sha256: createHash("sha256").update(outputText).digest("hex"),
        parsed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
