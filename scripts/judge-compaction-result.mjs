#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL || "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = process.env.CODEX_AUTH_JSON || join(homedir(), ".codex", "auth.json");
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CODEX_INSTALLATION_ID_PATH =
  process.env.CODEX_INSTALLATION_ID_PATH || join(CODEX_HOME, "installation_id");
const CODEX_ORIGINATOR = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || "codex_cli_rs";
const CODEX_CLIENT_VERSION = process.env.CODEX_CLIENT_VERSION || resolveCodexClientVersion();
const CODEX_USER_AGENT = process.env.CODEX_USER_AGENT || buildCodexUserAgent();
const JUDGE_MODEL = argValue("--model", process.env.CODEX_JUDGE_MODEL || "gpt-5.5");
const JUDGE_REASONING_EFFORT = argValue(
  "--reasoning-effort",
  process.env.CODEX_JUDGE_REASONING_EFFORT || "medium",
);
const JUDGE_SERVICE_TIER = argValue(
  "--service-tier",
  process.env.CODEX_JUDGE_SERVICE_TIER || "priority",
);

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function positionalDir() {
  for (let idx = 2; idx < process.argv.length; idx += 1) {
    const value = process.argv[idx];
    if (value.startsWith("--")) {
      const next = process.argv[idx + 1];
      if (next && !next.startsWith("--")) idx += 1;
      continue;
    }
    return value;
  }
  throw new Error(
    "Usage: judge-compaction-result.mjs <run-dir> [--dry-run] [--from-output judge.json] [--model gpt-5.5] [--reasoning-effort medium]",
  );
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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

function exactStringSchema(value) {
  if (!value) return { type: "string" };
  return { type: "string", enum: [value] };
}

function judgeOutputSchema(expectedHashes = {}, rubricVersion = "") {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schema", "rubric_version", "candidate_hashes", "overall_pass", "verdicts", "unknowns", "evidence_refs"],
    properties: {
      schema: { type: "string", enum: ["semantic-compaction-judge-output.v1"] },
      rubric_version: exactStringSchema(rubricVersion),
      candidate_hashes: {
        type: "object",
        additionalProperties: false,
        required: ["handoff_md_sha256", "rehydrated_md_sha256", "state_sha256"],
        properties: {
          handoff_md_sha256: exactStringSchema(expectedHashes.handoff_md_sha256),
          rehydrated_md_sha256: exactStringSchema(expectedHashes.rehydrated_md_sha256),
          state_sha256: exactStringSchema(expectedHashes.state_sha256),
        },
      },
      overall_pass: { type: "boolean" },
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "verdict", "reason", "evidence_refs"],
          properties: {
            criterion: {
              type: "string",
              enum: ["groundedness", "completeness", "continuation_utility", "conciseness"],
            },
            verdict: { type: "string", enum: ["pass", "fail", "unknown"] },
            reason: { type: "string" },
            evidence_refs: { type: "array", items: { type: "string" } },
          },
        },
      },
      unknowns: { type: "array", items: { type: "string" } },
      evidence_refs: { type: "array", items: { type: "string" } },
    },
  };
}

function validateJudgeOutput(value, allowedEvidenceRefs, expectedHashes, expectedRubricVersion) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "judge output is not an object";
  if (value.schema !== "semantic-compaction-judge-output.v1") return "schema invalid";
  if (typeof value.rubric_version !== "string" || !value.rubric_version) return "rubric_version missing";
  if (expectedRubricVersion && value.rubric_version !== expectedRubricVersion) {
    return "rubric_version mismatch: " + value.rubric_version;
  }
  if (typeof value.overall_pass !== "boolean") return "overall_pass missing";
  if (!value.candidate_hashes || typeof value.candidate_hashes !== "object") return "candidate_hashes missing";
  for (const key of ["handoff_md_sha256", "rehydrated_md_sha256", "state_sha256"]) {
    if (typeof value.candidate_hashes[key] !== "string" || !value.candidate_hashes[key]) {
      return "candidate_hashes." + key + " missing";
    }
    if (expectedHashes && value.candidate_hashes[key] !== expectedHashes[key]) {
      return "candidate_hashes." + key + " mismatch";
    }
  }
  if (!Array.isArray(value.verdicts)) return "verdicts missing";
  const requiredCriteria = new Set(["groundedness", "completeness", "continuation_utility", "conciseness"]);
  for (const [idx, verdict] of value.verdicts.entries()) {
    if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return "verdicts[" + idx + "] invalid";
    if (!["groundedness", "completeness", "continuation_utility", "conciseness"].includes(verdict.criterion)) {
      return "verdicts[" + idx + "].criterion invalid";
    }
    requiredCriteria.delete(verdict.criterion);
    if (!["pass", "fail", "unknown"].includes(verdict.verdict)) return "verdicts[" + idx + "].verdict invalid";
    if (typeof verdict.reason !== "string" || !verdict.reason.trim()) return "verdicts[" + idx + "].reason missing";
    if (!Array.isArray(verdict.evidence_refs) || verdict.evidence_refs.length === 0) {
      return "verdicts[" + idx + "].evidence_refs missing";
    }
    for (const ref of verdict.evidence_refs) {
      if (!allowedEvidenceRefs.has(ref)) return "verdicts[" + idx + "] unknown evidence ref: " + ref;
    }
  }
  if (requiredCriteria.size > 0) {
    return "missing verdict criteria: " + Array.from(requiredCriteria).join(", ");
  }
  if (!Array.isArray(value.unknowns)) return "unknowns missing";
  if (!Array.isArray(value.evidence_refs)) return "evidence_refs missing";
  for (const ref of value.evidence_refs) {
    if (!allowedEvidenceRefs.has(ref)) return "unknown top-level evidence ref: " + ref;
  }
  return null;
}

function truncate(text, chars) {
  const value = String(text || "");
  if (value.length <= chars) return value;
  const head = Math.floor(chars * 0.55);
  const tail = chars - head;
  return value.slice(0, head) + "\n\n[... omitted " + (value.length - chars) + " chars ...]\n\n" + value.slice(-tail);
}

function evidenceRefsFromState(state) {
  const capsuleRefs = (state.evidence_capsules || []).slice(0, 80).map((capsule) => ({
    id: capsule.id,
    span_id: capsule.span_id,
    record_range: capsule.record_range,
    extracted_text_sha256: capsule.extracted_text_sha256,
    section: capsule.section,
  }));
  const userRefs = (state.user_intent_events || [])
    .filter((event) => event.priority === "must_keep" || event.priority === "high")
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      priority: event.priority,
      text_sha256: event.text_sha256,
      source: event.source,
    }));
  return [...capsuleRefs, ...userRefs];
}

async function buildJudgeRequest(runDir) {
  const [result, state, manifest, handoff, rehydrated] = await Promise.all([
    readJson(join(runDir, "result.json")),
    readJson(join(runDir, "handoff-state.json")),
    readJson(join(runDir, "handoff-manifest.json")),
    readFile(join(runDir, "handoff.md"), "utf8"),
    readFile(join(runDir, "summary.rehydrated.md"), "utf8"),
  ]);
  const candidateHashes = {
    handoff_md_sha256: sha256Text(handoff),
    rehydrated_md_sha256: sha256Text(rehydrated),
    state_sha256: sha256Text(JSON.stringify(state)),
  };
  const rubricVersion = "semantic-compaction-rubric.v1";
  return {
    schema: "semantic-compaction-judge-request.v1",
    run_dir: runDir,
    candidate_hashes: candidateHashes,
    rubric: {
      version: rubricVersion,
      gates_remain_deterministic: true,
      judge_is_advisory: true,
      instruction:
        "Judge continuation quality only after deterministic artifact/hash/literal gates pass. Do not override deterministic failures. Use source evidence only; external knowledge is not allowed. Use pass/fail/unknown verdicts.",
      dimensions: {
        groundedness: "Each material claim in handoff.md must be supported by handoff-state.json or summary.rehydrated.md evidence.",
        completeness: "The handoff must preserve current objective, constraints, important artifacts, open work, and exact literals needed to continue.",
        continuation_utility: "A fresh agent should know the next action and have enough context to proceed without reopening the full transcript.",
        conciseness: "The handoff should avoid stale chronology and redundant tool output while preserving recoverable evidence.",
      },
    },
    deterministic_metrics: {
      ok: result.ok,
      after_estimated_tokens: result.after_estimated_tokens,
      user_intent_events: state.user_intent_events?.length || 0,
      evidence_capsules: state.evidence_capsules?.length || 0,
      manifest_artifacts: manifest.artifacts?.length || 0,
      manifest_validation: manifest.validation || {},
    },
    evidence_refs: evidenceRefsFromState(state),
    response_schema: judgeOutputSchema(candidateHashes, rubricVersion),
    judge_prompt: [
      "You are an evidence-grounded compaction quality judge.",
      "Return strict JSON matching response_schema.",
      "Set rubric_version exactly to " + rubricVersion + ".",
      "Copy candidate_hashes exactly from the Candidate Hashes section.",
      "Do not use external knowledge. Each verdict must cite one or more IDs from evidence_refs.",
      "Deterministic gates remain authoritative; your job is advisory semantic review of continuation quality.",
      "Use pass/fail/unknown. Mark unknown when the provided evidence is insufficient.",
      "",
      "## Handoff",
      truncate(handoff, 16000),
      "",
      "## Canonical State",
      truncate(JSON.stringify(state, null, 2), 16000),
      "",
      "## Rehydrated Evidence",
      truncate(rehydrated, 16000),
    ].join("\n"),
  };
}

function buildCodexJudgeRequestBody(request) {
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const windowId = threadId + ":0";
  const installationId = resolveCodexInstallationId();
  const promptText = [
    request.judge_prompt,
    "",
    "## Candidate Hashes",
    JSON.stringify(request.candidate_hashes, null, 2),
    "",
    "## Response Schema",
    JSON.stringify(request.response_schema, null, 2),
    "",
    "## Allowed Evidence Refs",
    JSON.stringify(request.evidence_refs, null, 2),
  ].join("\n");
  return {
    ids: { sessionId, threadId, windowId, installationId },
    body: {
      model: JUDGE_MODEL,
      instructions:
        "You are an evidence-grounded compaction quality judge. Output only strict JSON matching the requested schema.",
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
      reasoning: { effort: JUDGE_REASONING_EFFORT },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      service_tier: JUDGE_SERVICE_TIER,
      prompt_cache_key: "claudecompact-judge-" + request.candidate_hashes.handoff_md_sha256.slice(0, 32),
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "semantic_compaction_judge",
          schema: request.response_schema,
        },
      },
      client_metadata: {
        "x-codex-installation-id": installationId,
        "x-codex-window-id": windowId,
        session_id: sessionId,
        thread_id: threadId,
        codex_harness: "claudecompact-patcher",
        request_kind: "semantic_compaction_judge",
        run_dir: request.run_dir,
        handoff_md_sha256: request.candidate_hashes.handoff_md_sha256,
        rehydrated_md_sha256: request.candidate_hashes.rehydrated_md_sha256,
        state_sha256: request.candidate_hashes.state_sha256,
      },
    },
  };
}

function redactCodexRequestForLog(request) {
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

function responseUsage(events) {
  return [...events].reverse().find((event) => event?.response?.usage)?.response?.usage ?? null;
}

function responseId(events) {
  return (
    events.find((event) => event?.type === "response.completed" && typeof event?.response?.id === "string")
      ?.response?.id ?? null
  );
}

async function callCodexJudge(request, outDir) {
  const auth = await loadChatgptAuth();
  const codexRequest = buildCodexJudgeRequestBody(request);
  await writeFile(
    join(outDir, "semantic-judge-codex-request.redacted.json"),
    JSON.stringify(redactCodexRequestForLog(codexRequest), null, 2) + "\n",
  );

  const startedAt = Date.now();
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + auth.accessToken,
      "ChatGPT-Account-Id": auth.accountId,
      originator: CODEX_ORIGINATOR,
      "User-Agent": CODEX_USER_AGENT,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "session-id": codexRequest.ids.sessionId,
      "thread-id": codexRequest.ids.threadId,
      "x-client-request-id": codexRequest.ids.threadId,
      "x-codex-installation-id": codexRequest.ids.installationId,
      "x-codex-window-id": codexRequest.ids.windowId,
    },
    body: JSON.stringify(codexRequest.body),
  });
  const raw = await response.text();
  await writeFile(join(outDir, "semantic-judge-response.sse"), raw);

  if (!response.ok) {
    const failure = {
      ok: false,
      dry_run: false,
      live: true,
      provider: "codex",
      endpoint: CODEX_RESPONSES_URL,
      model: JUDGE_MODEL,
      reasoning_effort: JUDGE_REASONING_EFFORT,
      service_tier: JUDGE_SERVICE_TIER,
      status: response.status,
      status_text: response.statusText,
      request_id: response.headers.get("x-request-id"),
      cf_ray: response.headers.get("cf-ray"),
      body_preview: raw.slice(0, 1000),
    };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(failure, null, 2) + "\n");
    throw new Error("Codex judge request failed with HTTP " + response.status);
  }

  const events = parseSse(raw);
  const outputText = collectOutputText(events);
  await writeFile(join(outDir, "semantic-judge-model-output.json"), outputText + "\n");
  let judgeOutput;
  try {
    judgeOutput = JSON.parse(outputText);
  } catch {
    const failure = {
      ok: false,
      dry_run: false,
      live: true,
      provider: "codex",
      endpoint: CODEX_RESPONSES_URL,
      model: JUDGE_MODEL,
      reasoning_effort: JUDGE_REASONING_EFFORT,
      service_tier: JUDGE_SERVICE_TIER,
      error: "output was not JSON",
      output_sha256: sha256Text(outputText),
      output_preview: outputText.slice(0, 1000),
    };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(failure, null, 2) + "\n");
    throw new Error("Codex judge output was not JSON");
  }

  const allowedRefs = new Set((request.evidence_refs || []).map((ref) => ref.id));
  const validationError = validateJudgeOutput(
    judgeOutput,
    allowedRefs,
    request.candidate_hashes,
    request.rubric.version,
  );
  const result = {
    ok: !validationError,
    dry_run: false,
    live: true,
    provider: "codex",
    endpoint: CODEX_RESPONSES_URL,
    model: JUDGE_MODEL,
    reasoning_effort: JUDGE_REASONING_EFFORT,
    service_tier: JUDGE_SERVICE_TIER,
    elapsed_ms: Date.now() - startedAt,
    event_count: events.length,
    response_id: responseId(events),
    usage: responseUsage(events),
    output_sha256: sha256Text(outputText),
    validation_error: validationError,
    overall_pass: judgeOutput.overall_pass ?? null,
    verdict_count: Array.isArray(judgeOutput.verdicts) ? judgeOutput.verdicts.length : 0,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  if (validationError) throw new Error("Codex judge output failed validation: " + validationError);
  return result;
}

async function main() {
  const runDir = resolve(positionalDir());
  const outDir = resolve(argValue("--out-dir", join(runDir, "semantic-judge")));
  const dryRun = process.argv.includes("--dry-run");
  const outputPath = argValue("--from-output", "");
  await mkdir(outDir, { recursive: true });
  const request = await buildJudgeRequest(runDir);
  await writeFile(join(outDir, "semantic-judge-request.json"), JSON.stringify(request, null, 2) + "\n");
  if (dryRun) {
    const result = {
      ok: true,
      dry_run: true,
      run_dir: runDir,
      request_artifact: join(outDir, "semantic-judge-request.json"),
      schema: request.schema,
      evidence_ref_count: request.evidence_refs.length,
    };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!outputPath) {
    const result = await callCodexJudge(request, outDir);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const judgeOutput = JSON.parse(await readFile(resolve(outputPath), "utf8"));
  const allowedRefs = new Set((request.evidence_refs || []).map((ref) => ref.id));
  const validationError = validateJudgeOutput(
    judgeOutput,
    allowedRefs,
    request.candidate_hashes,
    request.rubric.version,
  );
  const result = {
    ok: !validationError,
    dry_run: false,
    live: false,
    run_dir: runDir,
    judge_output: basename(resolve(outputPath)),
    validation_error: validationError,
    overall_pass: judgeOutput.overall_pass ?? null,
    verdict_count: Array.isArray(judgeOutput.verdicts) ? judgeOutput.verdicts.length : 0,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (validationError) process.exit(1);
}

await main();
