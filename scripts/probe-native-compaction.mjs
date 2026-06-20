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
      endpoint: (process.env.XAI_API_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "") + "/responses",
      model: process.env.XAI_COMPACT_MODEL || "grok-4.20-0309-non-reasoning",
      docs: ["https://docs.x.ai/developers/model-capabilities/text/comparison"],
    };
  }
  return {
    endpoint: (process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") + "/responses",
    model: process.env.OPENAI_COMPACT_MODEL || "gpt-5.5",
    docs: ["https://developers.openai.com/api/docs/guides/compaction#server-side-compaction"],
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
        context_management: { edits: [{ type: "compact_20260112" }] },
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
      store: false,
      input: [{ role: "user", content: transcript }],
      context_management: { compact_threshold: 0 },
    },
  };
}

const provider = normalizeProvider(argValue("--provider"));
const inputPath = resolve(argValue("--input", "transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl"));
const outDir = resolve(argValue("--out-dir", join("runs", "native-compaction-probe-" + provider)));
const dryRun = process.argv.includes("--dry-run");

if (!dryRun) {
  throw new Error("Live native compaction probes are not implemented; rerun with --dry-run");
}

const transcript = await readFile(inputPath, "utf8");
const stats = {
  inputPath,
  sha256: sha256(transcript),
  bytes: Buffer.byteLength(transcript),
  records: logicalJsonlRecordCount(transcript),
};
const request = buildRequest({
  provider,
  transcript: "<source transcript omitted from redacted dry-run request>",
  stats,
});
await mkdir(outDir, { recursive: true });
const requestPath = join(outDir, "native-compaction-request.redacted.json");
await writeFile(requestPath, JSON.stringify(request, null, 2) + "\n");

console.log(
  JSON.stringify(
    {
      ok: true,
      dry_run: true,
      provider,
      request_path: requestPath,
      source_sha256: stats.sha256,
      records: stats.records,
    },
    null,
    2
  )
);
