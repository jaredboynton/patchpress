#!/usr/bin/env node
// Empirical conflict gate for assembled compaction prompts.
//
// For every (provider, model, renderer) combination the benchmark exercises, this
// dumps the REAL assembled promptText (base instructions + renderer guide + model
// adaptations) via `compact-full-transcript.mjs --dump-prompt ... --dry-run` and scans
// it for contradictory instruction pairs. The contract: no single assembled prompt may
// contain both sides of any stance axis. Conflicts are removed at the source (the
// overridden line is deleted), not papered over with an "override earlier guidance"
// header, so the model never receives mutually exclusive instructions.
//
// Exit 0 = no conflicts in any assembled prompt. Exit 1 = at least one conflict.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/compact-full-transcript.mjs";
const INPUT = process.env.CONFLICT_INPUT || "/tmp/e-reduced.jsonl";
const RENDERERS = ["sentinel", "stripped", "onto", "jsonl"];

// The model matrix the benchmark covers (scripts/benchmark-lanes.mjs). Codex is
// isStrong (no adaptation lines) but is still scanned so the base prompt + renderer
// guide stay internally coherent on their own.
const MODELS = [
  { provider: "codex", model: "gpt-5.4" },
  { provider: "codex", model: "gpt-5.5" },
  { provider: "gemini", model: "gemini-3.5-flash" },
  { provider: "gemini", model: "gemini-3.1-flash-lite" },
  { provider: "xai", model: "grok-4.20-0309-non-reasoning" },
  { provider: "mantle", model: "xai.grok-4.3" },
];

// Each axis lists the two mutually exclusive stances by the phrasings that express
// them. A prompt that matches BOTH sides of an axis carries a self-contradiction.
const AXES = [
  {
    axis: "block-body-length",
    sideA: { label: "verbose body", patterns: [/dense paragraph/i, /long paragraph body/i] },
    sideB: { label: "terse body", patterns: [/keep bodies short/i, /body is one short sentence/i] },
  },
  {
    axis: "output-budget",
    sideA: { label: "spend full budget", patterns: [/use your full output budget/i, /full output budget/i] },
    sideB: { label: "conserve budget", patterns: [/wastes the output budget/i, /risks truncating the json/i] },
  },
  {
    axis: "evidence-location",
    sideA: {
      label: "evidence copied into body",
      patterns: [/copied verbatim into a block body/i, /one dense paragraph naming exact file paths/i],
    },
    sideB: {
      label: "evidence carried by spans",
      patterns: [/not long verbatim body text/i, /the evidence, not the prose/i, /spans carry[\s\S]{0,40}evidence/i],
    },
  },
  {
    // The schema description (an instruction channel of its own) must not assert a
    // record-citation framing that the renderer guide contradicts. The stripped guide
    // uses <record line=...>; sentinel uses @@RECORD line=; onto uses the first pipe
    // field. A schema that hardcodes <record line=...> conflicts under sentinel/onto.
    axis: "record-citation-format",
    sideA: { label: "stripped framing", patterns: [/<record line=\.\.\.> wrapper/i, /from the <record line=/i] },
    sideB: {
      label: "non-stripped framing",
      patterns: [/first pipe field/i, /@@RECORD line=/i, /@@ONTO Transcript/i],
    },
  },
];

// Collect every string `description` field anywhere in the request body. The schema
// descriptions are a real instruction channel (Gemini reads them), so they belong in
// the conflict scan alongside the prompt text.
function collectDescriptions(node, acc = []) {
  if (node && typeof node === "object") {
    if (typeof node.description === "string") acc.push(node.description);
    for (const v of Object.values(node)) collectDescriptions(v, acc);
  }
  return acc;
}

// Returns the full instruction surface for one combo: the assembled promptText (minus
// the transcript body, to avoid false matches on transcript content) plus all schema
// descriptions sent in the request body.
function dumpPrompt(provider, model, renderer, tmp) {
  const out = join(tmp, `${provider}-${model.replace(/[^a-z0-9.]/gi, "_")}-${renderer}.txt`);
  const stdout = execFileSync(
    "node",
    [
      SCRIPT,
      "--provider", provider,
      "--model", model,
      "--transcript-renderer", renderer,
      "--input", INPUT,
      "--adapt-prompt",
      "--dump-prompt", out,
      "--dry-run",
      "--out-dir", join(tmp, "out"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, COMPACT_REASK_UNTIL_PASS: "0" } },
  );
  const promptText = readFileSync(out, "utf8").replace(/<transcript>[\s\S]*<\/transcript>/, "<transcript/>");
  // --dry-run prints two JSON objects: requestMeta, then the redacted request. Parse
  // the last brace-led block and harvest its schema descriptions.
  const blocks = stdout.split(/\n(?=\{)/).filter((s) => s.trim().startsWith("{"));
  let descriptions = [];
  try {
    const req = JSON.parse(blocks[blocks.length - 1]);
    descriptions = collectDescriptions(req.body || req);
  } catch {
    descriptions = [];
  }
  return promptText + "\n" + descriptions.join("\n");
}

function findConflicts(promptText) {
  const conflicts = [];
  for (const { axis, sideA, sideB } of AXES) {
    const aHits = sideA.patterns.filter((re) => re.test(promptText));
    const bHits = sideB.patterns.filter((re) => re.test(promptText));
    if (aHits.length && bHits.length) {
      conflicts.push({
        axis,
        a: { label: sideA.label, matched: aHits.map((re) => re.source) },
        b: { label: sideB.label, matched: bHits.map((re) => re.source) },
      });
    }
  }
  return conflicts;
}

const tmp = mkdtempSync(join(tmpdir(), "prompt-conflicts-"));
let total = 0;
let failed = 0;
const failures = [];
try {
  for (const { provider, model } of MODELS) {
    for (const renderer of RENDERERS) {
      total += 1;
      const promptText = dumpPrompt(provider, model, renderer, tmp);
      const conflicts = findConflicts(promptText);
      if (conflicts.length) {
        failed += 1;
        failures.push({ provider, model, renderer, conflicts });
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`PROMPT CONFLICTS: ${failed}/${total} assembled prompts contain contradictory instructions.\n`);
  for (const f of failures) {
    console.error(`  [${f.provider} / ${f.model} / ${f.renderer}]`);
    for (const c of f.conflicts) {
      console.error(`    axis=${c.axis}`);
      console.error(`      ${c.a.label}: ${c.a.matched.join(", ")}`);
      console.error(`      ${c.b.label}: ${c.b.matched.join(", ")}`);
    }
  }
  process.exit(1);
}

console.log(`PROMPT CONFLICTS: none. ${total} assembled prompts scanned across ${MODELS.length} models x ${RENDERERS.length} renderers, ${AXES.length} stance axes each.`);
