#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { dirname, join } from "node:path";

const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL || "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = process.env.CODEX_AUTH_JSON || join(homedir(), ".codex", "auth.json");
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CODEX_INSTALLATION_ID_PATH =
  process.env.CODEX_INSTALLATION_ID_PATH || join(CODEX_HOME, "installation_id");
const CODEX_ORIGINATOR = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || "codex_cli_rs";
const CODEX_CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION || resolveCodexClientVersion();
const CODEX_USER_AGENT = process.env.CODEX_USER_AGENT || buildCodexUserAgent();

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
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

function buildRequestBody(promptText) {
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const windowId = `${threadId}:0`;
  const installationId = resolveCodexInstallationId();
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
    ids: { sessionId, threadId, windowId, installationId },
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
      reasoning: { effort: "low" },
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
        "x-codex-installation-id": installationId,
        "x-codex-window-id": windowId,
        session_id: sessionId,
        thread_id: threadId,
        codex_harness: "patchpress",
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
