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
const JUDGE_PROVIDER = String(
  argValue("--provider", process.env.CODEX_JUDGE_PROVIDER || "codex"),
).toLowerCase();
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
const GEMINI_API_BASE_URL = (
  process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/$/, "");
const JUDGE_MODEL = argValue(
  "--model",
  process.env.CODEX_JUDGE_MODEL || (JUDGE_PROVIDER === "gemini" ? "gemini-3.5-flash" : "gpt-5.5"),
);
const JUDGE_REASONING_EFFORT = argValue(
  "--reasoning-effort",
  process.env.CODEX_JUDGE_REASONING_EFFORT || "medium",
);
const JUDGE_SERVICE_TIER = argValue(
  "--service-tier",
  process.env.CODEX_JUDGE_SERVICE_TIER || "priority",
);
// Single-sample reasoning-model judging has real run-to-run variance (a lone
// faithfulness flip can spuriously fail a good handoff). Run multiple trials and
// take the per-dimension median level (self-consistency), then recompute the
// outcome from the aggregated levels. Default 3; set 1 for a cheap single pass.
const JUDGE_TRIALS = Math.max(1, Number.parseInt(argValue("--trials", process.env.CODEX_JUDGE_TRIALS || "3"), 10) || 1);
const JUDGE_CRITERIA = [
  "goal_intent_fidelity",
  "next_step_actionability",
  "constraint_promise_preservation",
  "state_artifact_recoverability",
  "faithfulness",
];
const LEVEL_SCORES = { absent: 0, partial: 1, clear: 2 };

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
    required: [
      "schema",
      "rubric_version",
      "candidate_hashes",
      "total_level_score",
      "overall_pass",
      "dimensions",
      "unknowns",
      "evidence_refs",
    ],
    properties: {
      schema: { type: "string", enum: ["semantic-compaction-judge-output.v3"] },
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
      total_level_score: { type: "integer", minimum: 0, maximum: JUDGE_CRITERIA.length * 2 },
      overall_pass: { type: "boolean" },
      dimensions: {
        type: "array",
        minItems: JUDGE_CRITERIA.length,
        maxItems: JUDGE_CRITERIA.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "evidence_quote", "reason", "level", "evidence_refs"],
          properties: {
            criterion: { type: "string", enum: JUDGE_CRITERIA },
            evidence_quote: { type: "string" },
            reason: { type: "string" },
            level: { type: "string", enum: ["absent", "partial", "clear"] },
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
  if (value.schema !== "semantic-compaction-judge-output.v3") return "schema invalid";
  if (typeof value.rubric_version !== "string" || !value.rubric_version) return "rubric_version missing";
  if (expectedRubricVersion && value.rubric_version !== expectedRubricVersion) {
    return "rubric_version mismatch: " + value.rubric_version;
  }
  if (
    !Number.isInteger(value.total_level_score) ||
    value.total_level_score < 0 ||
    value.total_level_score > JUDGE_CRITERIA.length * 2
  ) {
    return "total_level_score invalid";
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
  if (!Array.isArray(value.dimensions)) return "dimensions missing";
  if (value.dimensions.length !== JUDGE_CRITERIA.length) return "dimensions length invalid";
  const requiredCriteria = new Set(JUDGE_CRITERIA);
  for (const [idx, verdict] of value.dimensions.entries()) {
    if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return "dimensions[" + idx + "] invalid";
    if (!requiredCriteria.has(verdict.criterion)) {
      return "dimensions[" + idx + "].criterion invalid";
    }
    requiredCriteria.delete(verdict.criterion);
    if (typeof verdict.evidence_quote !== "string" || !verdict.evidence_quote.trim()) {
      return "dimensions[" + idx + "].evidence_quote missing";
    }
    if (typeof verdict.reason !== "string" || !verdict.reason.trim()) return "dimensions[" + idx + "].reason missing";
    if (!Object.hasOwn(LEVEL_SCORES, verdict.level)) return "dimensions[" + idx + "].level invalid";
    if (!Array.isArray(verdict.evidence_refs) || verdict.evidence_refs.length === 0) {
      return "dimensions[" + idx + "].evidence_refs missing";
    }
    for (const ref of verdict.evidence_refs) {
      if (!allowedEvidenceRefs.has(ref)) return "dimensions[" + idx + "] unknown evidence ref: " + ref;
    }
  }
  if (requiredCriteria.size > 0) {
    return "missing verdict criteria: " + Array.from(requiredCriteria).join(", ");
  }
  // Code-side aggregation (calculatedJudgeOutcome) is authoritative; the model's
  // self-reported total_level_score / overall_pass are advisory. A mismatch is
  // surfaced as a consistency warning by the caller, not a validation failure, so
  // the judge stays robust to model arithmetic slips on the redundant self-report.
  if (!Array.isArray(value.unknowns)) return "unknowns missing";
  if (!Array.isArray(value.evidence_refs)) return "evidence_refs missing";
  for (const ref of value.evidence_refs) {
    if (!allowedEvidenceRefs.has(ref)) return "unknown top-level evidence ref: " + ref;
  }
  return null;
}

function calculatedJudgeOutcome(judgeOutput) {
  const dimensions = Array.isArray(judgeOutput?.dimensions) ? judgeOutput.dimensions : [];
  const totalLevelScore = dimensions.reduce((sum, dimension) => sum + (LEVEL_SCORES[dimension.level] ?? 0), 0);
  const faithfulnessAbsent = dimensions.some(
    (dimension) => dimension.criterion === "faithfulness" && dimension.level === "absent",
  );
  const hasAbsentNonFaithfulness = dimensions.some(
    (dimension) => dimension.criterion !== "faithfulness" && dimension.level === "absent",
  );
  const overallPass = !faithfulnessAbsent && !hasAbsentNonFaithfulness && totalLevelScore >= 8;
  const warnings = [];
  if (judgeOutput?.total_level_score !== totalLevelScore) {
    warnings.push(
      "reported total_level_score " + judgeOutput?.total_level_score + " recalculated to " + totalLevelScore,
    );
  }
  if (judgeOutput?.overall_pass !== overallPass) {
    warnings.push("reported overall_pass " + judgeOutput?.overall_pass + " recalculated to " + overallPass);
  }
  return { totalLevelScore, overallPass, warnings };
}

const LEVEL_NAMES = ["absent", "partial", "clear"];

function medianLevel(levels) {
  const ranks = levels.map((l) => LEVEL_SCORES[l] ?? 0).sort((a, b) => a - b);
  if (ranks.length === 0) return "absent";
  const mid = Math.floor((ranks.length - 1) / 2); // lower-middle: conservative on even trial counts
  return LEVEL_NAMES[ranks[mid]];
}

// Combine K per-trial judge outputs into one via the per-dimension median level
// (self-consistency), damping single-sample outliers. evidence_quote / reason /
// evidence_refs come from a trial whose level equals the median.
function aggregateJudgeTrials(trials) {
  const base = trials[0];
  const dimensions = JUDGE_CRITERIA.map((criterion) => {
    const perTrial = trials.map((t) => (t.dimensions || []).find((d) => d.criterion === criterion)).filter(Boolean);
    const level = medianLevel(perTrial.map((d) => d.level));
    const rep = perTrial.find((d) => d.level === level) || perTrial[0] || {};
    const refs = [...new Set(perTrial.flatMap((d) => d.evidence_refs || []))];
    return {
      criterion,
      evidence_quote: rep.evidence_quote || "",
      reason: rep.reason || "",
      level,
      evidence_refs: refs.length ? refs : rep.evidence_refs || [],
    };
  });
  const calc = calculatedJudgeOutcome({ dimensions });
  return {
    schema: base.schema,
    rubric_version: base.rubric_version,
    candidate_hashes: base.candidate_hashes,
    total_level_score: calc.totalLevelScore,
    overall_pass: calc.overallPass,
    dimensions,
    unknowns: [...new Set(trials.flatMap((t) => t.unknowns || []))],
    evidence_refs: [...new Set(trials.flatMap((t) => t.evidence_refs || []))],
  };
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
  const userRefs = (state.user_intent_events || []).map((event) => ({
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
  const rubricVersion = "semantic-continuation-quality-rubric.v2";
  // Ground truth fed to the judge is the structured canonical state plus evidence,
  // with the rendered-handoff copies removed. The next agent receives only the
  // rendered handoff; if the judge could see a re-paste of it here, a section
  // dropped from the handoff would still appear present and escape detection.
  const judgeGroundTruth = { ...state };
  delete judgeGroundTruth.summary_markdown;
  delete judgeGroundTruth.rendered_handoff;
  delete judgeGroundTruth.summary_blocks;
  return {
    schema: "semantic-compaction-judge-request.v2",
    run_dir: runDir,
    candidate_hashes: candidateHashes,
    rubric: {
      version: rubricVersion,
      gates_remain_deterministic: true,
      judge_is_advisory: true,
      instruction:
        "Judge the semantic quality of the rendered handoff a fresh agent receives as operating memory. Do not score schema validity, hash validity, literal presence, evidence counts, token footprint, or JSON shape; those are deterministic. Use source evidence only; external knowledge is not allowed. Score each semantic dimension on the anchored absent/partial/clear scale, then report total_level_score as the sum of dimension levels.",
      dimensions: {
        goal_intent_fidelity:
          "Captures the current objective and latest user intent without reviving stale or reframed goals.",
        next_step_actionability:
          "A fresh agent could take the next concrete action without re-deriving it; the next step is specific and correct given the state.",
        constraint_promise_preservation:
          "Durable rules, constraints, promises, approvals, and do-not-redo instructions that affect continuation are present and not weakened.",
        state_artifact_recoverability:
          "Done and active work, active files, artifacts, validation results, and per-task status are recoverable without reopening the full transcript.",
        faithfulness:
          "Every material claim is supported by the rehydrated evidence, with no internal contradiction, unsupported completion claim, or stale state presented as current.",
      },
      scale: {
        clear: "The criterion is fully satisfied with cited evidence and no material continuation risk.",
        partial: "The criterion is partly satisfied but would require re-checking or some re-reading.",
        absent: "The criterion is missing, contradicted, unsupported, or unsafe to rely on.",
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
      "Deterministic gates remain authoritative; do not judge schema validity, hash validity, literal presence, evidence counts, token footprint, or JSON shape.",
      "Your job is semantic review of the rendered handoff as operating memory for the next agent.",
      "The Handoff section is the only operating memory the next agent receives. The Ground Truth and Rehydrated Evidence sections are the source of truth it does not see; use them to verify the handoff and to detect omissions.",
      "Score goal_intent_fidelity, next_step_actionability, constraint_promise_preservation, and state_artifact_recoverability on what the Handoff conveys. If a continuation-critical item present in Ground Truth (a durable rule, a pending task, the next step, an active file or artifact) is missing or weakened in the Handoff, that dimension is partial or absent.",
      "Score faithfulness by checking every material Handoff claim against Ground Truth and Rehydrated Evidence; an unsupported, contradicted, or overstated claim makes faithfulness absent.",
      "Ignore length, formatting, and markdown style; score content only.",
      "For each dimension, provide evidence_quote and reason before choosing level.",
      "Use level clear, partial, or absent. Set total_level_score to the sum where absent=0, partial=1, clear=2.",
      "Set overall_pass true only when faithfulness is not absent, no other dimension is absent, and total_level_score is at least 8.",
      "",
      "## Handoff (operating memory delivered to the next agent; evaluate THIS)",
      truncate(handoff, 16000),
      "",
      "## Ground Truth (canonical state and evidence; the next agent does NOT receive this section)",
      truncate(JSON.stringify(judgeGroundTruth, null, 2), 16000),
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
  const calculated = calculatedJudgeOutcome(judgeOutput);
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
    total_level_score: calculated.totalLevelScore,
    reported_total_level_score: judgeOutput.total_level_score ?? null,
    overall_pass: calculated.overallPass,
    reported_overall_pass: judgeOutput.overall_pass ?? null,
    judge_consistency_warnings: calculated.warnings,
    dimension_count: Array.isArray(judgeOutput.dimensions) ? judgeOutput.dimensions.length : 0,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  if (validationError) throw new Error("Codex judge output failed validation: " + validationError);
  return result;
}

// --- Gemini judge path (cross-family verdict) --------------------------------
// Mirrors callCodexJudge against the Gemini generateContent SSE API so the same
// provider-agnostic judge request (buildJudgeRequest) can be scored by a model
// from a different family, offsetting the same-family bias of a Codex judge on a
// Codex-produced handoff. buildJudgeRequest, validateJudgeOutput, and
// calculatedJudgeOutcome are shared unchanged.

function geminiJudgeThinkingConfig(model) {
  const requested = String(process.env.GEMINI_JUDGE_THINKING_LEVEL || "").trim().toLowerCase();
  if (requested && requested !== "none" && requested !== "off" && requested !== "disabled") {
    return { thinkingLevel: requested };
  }
  // Gemini 3.x Flash/Flash-Lite use thinkingLevel; "minimal" is the closest to off.
  const normalized = String(model || "").toLowerCase();
  if (
    normalized.includes("3.") ||
    normalized === "gemini-flash-latest" ||
    normalized === "gemini-flash-lite-latest"
  ) {
    return { thinkingLevel: "minimal" };
  }
  return null;
}

function geminiJudgeEndpoint() {
  return (
    GEMINI_API_BASE_URL + "/models/" + encodeURIComponent(JUDGE_MODEL) + ":streamGenerateContent?alt=sse"
  );
}

function buildGeminiJudgeRequestBody(request) {
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
  const generationConfig = {
    responseMimeType: "application/json",
    responseJsonSchema: request.response_schema,
  };
  const thinkingConfig = geminiJudgeThinkingConfig(JUDGE_MODEL);
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  return {
    body: {
      systemInstruction: {
        parts: [
          {
            text: "You are an evidence-grounded compaction quality judge. Output only strict JSON matching the requested schema.",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig,
    },
  };
}

function redactGeminiJudgeRequestForLog(endpoint, body) {
  return {
    url: endpoint,
    method: "POST",
    headers: {
      "x-goog-api-key": "<redacted>",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body,
  };
}

function collectGeminiOutputText(events) {
  let text = "";
  for (const event of events) {
    for (const candidate of event.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (typeof part.text === "string") text += part.text;
      }
    }
  }
  return text.trim();
}

function geminiUsage(events) {
  return [...events].reverse().find((event) => event?.usageMetadata)?.usageMetadata ?? null;
}

async function callGeminiJudge(request, outDir) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY for --provider gemini");
  }
  const endpoint = geminiJudgeEndpoint();
  const geminiRequest = buildGeminiJudgeRequestBody(request);
  await writeFile(
    join(outDir, "semantic-judge-gemini-request.redacted.json"),
    JSON.stringify(redactGeminiJudgeRequestForLog(endpoint, geminiRequest.body), null, 2) + "\n",
  );

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(geminiRequest.body),
  });
  const raw = await response.text();
  await writeFile(join(outDir, "semantic-judge-response.sse"), raw);

  if (!response.ok) {
    const failure = {
      ok: false,
      dry_run: false,
      live: true,
      provider: "gemini",
      endpoint,
      model: JUDGE_MODEL,
      status: response.status,
      status_text: response.statusText,
      body_preview: raw.slice(0, 1000),
    };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(failure, null, 2) + "\n");
    throw new Error("Gemini judge request failed with HTTP " + response.status);
  }

  const events = parseSse(raw);
  const outputText = collectGeminiOutputText(events);
  await writeFile(join(outDir, "semantic-judge-model-output.json"), outputText + "\n");
  let judgeOutput;
  try {
    judgeOutput = JSON.parse(outputText);
  } catch {
    const failure = {
      ok: false,
      dry_run: false,
      live: true,
      provider: "gemini",
      endpoint,
      model: JUDGE_MODEL,
      error: "output was not JSON",
      output_sha256: sha256Text(outputText),
      output_preview: outputText.slice(0, 1000),
    };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(failure, null, 2) + "\n");
    throw new Error("Gemini judge output was not JSON");
  }

  const allowedRefs = new Set((request.evidence_refs || []).map((ref) => ref.id));
  const validationError = validateJudgeOutput(
    judgeOutput,
    allowedRefs,
    request.candidate_hashes,
    request.rubric.version,
  );
  const calculated = calculatedJudgeOutcome(judgeOutput);
  const result = {
    ok: !validationError,
    dry_run: false,
    live: true,
    provider: "gemini",
    endpoint,
    model: JUDGE_MODEL,
    elapsed_ms: Date.now() - startedAt,
    event_count: events.length,
    usage: geminiUsage(events),
    output_sha256: sha256Text(outputText),
    validation_error: validationError,
    total_level_score: calculated.totalLevelScore,
    reported_total_level_score: judgeOutput.total_level_score ?? null,
    overall_pass: calculated.overallPass,
    reported_overall_pass: judgeOutput.overall_pass ?? null,
    judge_consistency_warnings: calculated.warnings,
    dimension_count: Array.isArray(judgeOutput.dimensions) ? judgeOutput.dimensions.length : 0,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  if (validationError) throw new Error("Gemini judge output failed validation: " + validationError);
  return result;
}

function callJudge(request, outDir) {
  if (JUDGE_PROVIDER === "gemini") return callGeminiJudge(request, outDir);
  return callCodexJudge(request, outDir);
}

// Run JUDGE_TRIALS independent judge passes and aggregate them by per-dimension
// median (self-consistency). Each trial gets a fresh session, so the samples are
// independent. With JUDGE_TRIALS === 1 this is exactly a single callCodexJudge.
async function judgeWithTrials(request, outDir) {
  if (JUDGE_TRIALS === 1) return callJudge(request, outDir);
  const trialOutputs = [];
  const perTrial = [];
  for (let i = 0; i < JUDGE_TRIALS; i++) {
    const trialDir = join(outDir, "trial" + i);
    await mkdir(trialDir, { recursive: true });
    try {
      const r = await callJudge(request, trialDir);
      const out = JSON.parse(await readFile(join(trialDir, "semantic-judge-model-output.json"), "utf8"));
      trialOutputs.push(out);
      perTrial.push({
        trial: i,
        total_level_score: r.total_level_score,
        overall_pass: r.overall_pass,
        levels: Object.fromEntries((out.dimensions || []).map((d) => [d.criterion, d.level])),
      });
    } catch (error) {
      perTrial.push({ trial: i, error: String(error.message).slice(0, 200) });
    }
  }
  if (trialOutputs.length === 0) {
    const failure = { ok: false, live: true, provider: JUDGE_PROVIDER, error: "all judge trials failed", trials: JUDGE_TRIALS, per_trial: perTrial };
    await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(failure, null, 2) + "\n");
    throw new Error("all judge trials failed");
  }
  const aggregated = aggregateJudgeTrials(trialOutputs);
  await writeFile(join(outDir, "semantic-judge-model-output.json"), JSON.stringify(aggregated) + "\n");
  const allowedRefs = new Set((request.evidence_refs || []).map((ref) => ref.id));
  const validationError = validateJudgeOutput(aggregated, allowedRefs, request.candidate_hashes, request.rubric.version);
  const calculated = calculatedJudgeOutcome(aggregated);
  const result = {
    ok: !validationError,
    live: true,
    provider: JUDGE_PROVIDER,
    model: JUDGE_MODEL,
    reasoning_effort: JUDGE_PROVIDER === "codex" ? JUDGE_REASONING_EFFORT : null,
    service_tier: JUDGE_PROVIDER === "codex" ? JUDGE_SERVICE_TIER : null,
    trials: JUDGE_TRIALS,
    valid_trials: trialOutputs.length,
    aggregation: "per_dimension_median",
    total_level_score: calculated.totalLevelScore,
    overall_pass: calculated.overallPass,
    judge_consistency_warnings: calculated.warnings,
    per_trial: perTrial,
    validation_error: validationError,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  if (validationError) throw new Error("Aggregated judge output failed validation: " + validationError);
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
    const result = await judgeWithTrials(request, outDir);
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
  const calculated = calculatedJudgeOutcome(judgeOutput);
  const result = {
    ok: !validationError,
    dry_run: false,
    live: false,
    run_dir: runDir,
    judge_output: basename(resolve(outputPath)),
    validation_error: validationError,
    total_level_score: calculated.totalLevelScore,
    reported_total_level_score: judgeOutput.total_level_score ?? null,
    overall_pass: calculated.overallPass,
    reported_overall_pass: judgeOutput.overall_pass ?? null,
    judge_consistency_warnings: calculated.warnings,
    dimension_count: Array.isArray(judgeOutput.dimensions) ? judgeOutput.dimensions.length : 0,
  };
  await writeFile(join(outDir, "semantic-judge-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (validationError) process.exit(1);
}

await main();
