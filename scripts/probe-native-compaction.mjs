#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function normalizeProvider(value) {
  const provider = String(value || "").toLowerCase();
  if (["openai", "xai", "anthropic"].includes(provider)) return provider;
  throw new Error("Unsupported provider: " + value + " (expected openai, xai, or anthropic)");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function logicalJsonlRecordCount(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function providerDefaults(provider) {
  if (provider === "anthropic") {
    return {
      endpoint: "https://api.anthropic.com/v1/messages",
      model: process.env.ANTHROPIC_COMPACT_MODEL || "claude-opus-4-8",
      docs: ["https://platform.claude.com/docs/en/build-with-claude/compaction"],
    };
  }
  if (provider === "xai") {
    return {
      endpoint: (process.env.XAI_API_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "") + "/responses/compact",
      model: process.env.XAI_COMPACT_MODEL || "grok-4.20-0309-non-reasoning",
      docs: ["https://docs.x.ai/developers/advanced-api-usage/context-compaction"],
    };
  }
  return {
    endpoint: (process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") + "/responses/compact",
    model: process.env.OPENAI_COMPACT_MODEL || "gpt-5.5",
    docs: ["https://developers.openai.com/api/docs/guides/compaction#standalone-compact-endpoint"],
  };
}

function buildRequest({ provider, transcript, stats }) {
  const defaults = providerDefaults(provider);
  const common = {
    schema: "native-compaction-probe-request.v1",
    provider,
    endpoint: defaults.endpoint,
    model: argValue("--model", defaults.model),
    source: {
      path: stats.inputPath,
      artifact_name: basename(stats.inputPath),
      sha256: stats.sha256,
      bytes: stats.bytes,
      records: stats.records,
    },
    safety: {
      dry_run_only_by_default: true,
      opaque_output_policy: "store-only-pass-through",
      preserve_local_audit_state: true,
      do_not_render_opaque_items_as_human_summary: true,
      redact_request_log: true,
    },
    references: defaults.docs,
  };

  if (provider === "anthropic") {
    return {
      ...common,
      method: "POST",
      headers: {
        "x-api-key": "<redacted>",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "compact-2026-01-12",
        "content-type": "application/json",
      },
      body: {
        model: common.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: transcript }],
        context_management: {
          edits: [
            {
              type: "compact_20260112",
              trigger: { type: "input_tokens", value: Number(argValue("--trigger-tokens", "50000")) },
              pause_after_compaction: true,
              instructions:
                "Compact the transcript for continuing the task in a later context window. Do not call tools while compacting; return text-only compaction content.",
            },
          ],
        },
      },
    };
  }

  return {
    ...common,
    method: "POST",
    headers: {
      authorization: "Bearer <redacted>",
      "content-type": "application/json",
    },
    body: {
      model: common.model,
      input: [{ role: "user", content: transcript }],
    },
  };
}

const provider = normalizeProvider(argValue("--provider"));
const inputPath = resolve(argValue("--input", "transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl"));
const outDir = resolve(argValue("--out-dir", join("runs", "native-compaction-probe-" + provider)));
const live = process.argv.includes("--live");
const dryRun = !live;

const transcript = await readFile(inputPath, "utf8");
const stats = {
  inputPath,
  sha256: sha256(transcript),
  bytes: Buffer.byteLength(transcript),
  records: logicalJsonlRecordCount(transcript),
};
const request = buildRequest({
  provider,
  transcript: dryRun ? "<source transcript omitted from redacted dry-run request>" : transcript,
  stats,
});
await mkdir(outDir, { recursive: true });
const requestPath = join(outDir, "native-compaction-request.redacted.json");
const redactedRequest = JSON.parse(JSON.stringify(request));
if (!dryRun) {
  if (provider === "anthropic") {
    redactedRequest.body.messages[0].content = "<source transcript omitted from request log>";
  } else {
    redactedRequest.body.input[0].content = "<source transcript omitted from request log>";
  }
}
await writeFile(requestPath, JSON.stringify(redactedRequest, null, 2) + "\n");

async function runLiveProbe() {
  const headers = { ...request.headers };
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is required for --live anthropic probe");
    headers["x-api-key"] = key;
  } else if (provider === "xai") {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY is required for --live xai probe");
    headers.authorization = "Bearer " + key;
  } else {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required for --live openai probe");
    headers.authorization = "Bearer " + key;
  }
  const startedAt = Date.now();
  const response = await fetch(request.endpoint, {
    method: request.method,
    headers,
    body: JSON.stringify(request.body),
  });
  const responseText = await response.text();
  let artifact;
  try {
    artifact = JSON.parse(responseText);
  } catch {
    artifact = { raw_text: responseText };
  }
  const artifactPath = join(outDir, "native-compaction-artifact.json");
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
  const result = {
    ok: response.ok,
    dry_run: false,
    provider,
    status: response.status,
    elapsed_ms: Date.now() - startedAt,
    request_path: requestPath,
    artifact_path: artifactPath,
    source_sha256: stats.sha256,
    records: stats.records,
    opaque_output_policy: request.safety.opaque_output_policy,
    parse_encrypted_content: false,
    use_as_authority: false,
    local_handoff_remains_authority: true,
    output_count: Array.isArray(artifact.output) ? artifact.output.length : null,
    usage: artifact.usage || null,
  };
  await writeFile(join(outDir, "native-compaction-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exit(1);
}

if (live) {
  await runLiveProbe();
} else {
  const result = {
    ok: true,
    dry_run: true,
    provider,
    request_path: requestPath,
    source_sha256: stats.sha256,
    records: stats.records,
    opaque_output_policy: request.safety.opaque_output_policy,
    parse_encrypted_content: false,
    use_as_authority: false,
    local_handoff_remains_authority: true,
  };
  await writeFile(join(outDir, "native-compaction-result.json"), JSON.stringify(result, null, 2) + "\n");

  console.log(JSON.stringify(result, null, 2));
}
