# State-Of-Art Compaction Recommendations

## Executive Summary

The current harness is ahead of plain compaction in three important ways:

- It uses strict structured output instead of freeform summaries.
- It requires source spans and rehydrates evidence locally from raw JSONL.
- It now carries user-authored messages deterministically in `## User Messages`.

The gap is that it is still mostly a summarization harness. State-of-art agent
context systems are moving toward hybrid state: provider-native opaque
compaction for model continuity, deterministic local evidence for audit, and a
typed checkpoint/state graph for long-horizon recovery. To push past the state
of the art, this repo should become a restorable compaction system, not only a
better summary writer.

## Research Inputs

This synthesis used 14+ delegated research attempts plus direct Exa/Octocode
fills where agents were interrupted by runtime limits. Completed subagent slices
covered user-message preservation, structured outputs, provider-native
compaction, tokenization/rendering, multi-round compaction, security/privacy,
and hydration/rehydration. Direct research filled compaction algorithms,
prompting/tooling, evaluation, open-source agent implementations, memory, and
handoff protocols.

## Current Harness Strengths

- `transcript_renderer=stripped` is a large real reduction from raw JSONL while
  preserving line-addressed evidence.
- `summary_blocks`, `rules_and_invariants`, `plans_and_task_state`, and
  `promises_made` all have `source_spans`.
- `summary.rehydrated.md` and `rehydrated-spans.json` recover exact local
  evidence rather than trusting model prose.
- `## User Messages` now preserves user-authored prompts deterministically and
  carries them across future compactions.
- Model output is validated locally after strict schema parsing.

## Critical Gaps

| Done | Priority | Gap | Why It Matters |
|---|---|---|---|
| [x] | P0 | `## User Messages` is XML-ish text, not strict JSON | User content can inject `</user-message>` or forged ledgers; parsing from arbitrary records is unsafe. |
| [x] | P0 | No canonical `handoff-state.json` / manifest | The actual handoff is still markdown embedded in JSONL; sidecars are not a typed state contract. |
| [ ] | P0 | Source spans are record ranges only | Good for transcript records, weak for exact code/literal boundaries inside long messages. |
| [ ] | P0 | No multi-round degradation gate | A single successful compaction can still decay badly by round 5 or 20. |
| [ ] | P1 | Model schema still has required unanchored arrays | `primary_request_and_intent`, `problem_solving`, etc. invite ungrounded filler. |
| [ ] | P1 | No provider-native compaction path | We resend full transcripts and miss OpenAI/xAI/Anthropic opaque compaction state. |
| [ ] | P1 | Newest-only user-message selection | Older live safety constraints or preferences can lose to newer low-value chatter. |
| [ ] | P1 | No artifact retention/security policy | Raw JSONL, SSE, model output, user messages, and rehydrated spans can contain secrets indefinitely. |
| [ ] | P2 | Renderer format still uses injectable pseudo-XML | `stripped` is good, but sentinel/block delimiters may be smaller and safer. |
| [ ] | P2 | Benchmarking is mostly structural counts | Counts do not prove downstream sufficiency or absence of false facts. |

## Recommended Target Architecture

### 1. Hybrid Native + Local Audit

Use provider-native compaction where available, but keep local artifacts as the
auditable source of truth.

| Provider | Native Path | Local Role |
|---|---|---|
| Anthropic | `compact_20260112` with `pause_after_compaction` | Add deterministic user/system/developer state after native compaction. |
| OpenAI/Codex | `/responses/compact` compaction items | Preserve opaque compaction item plus local manifest/evidence. |
| xAI | `/v1/responses/compact` | Prefer Responses-native compaction over Chat Completions summaries. |
| Gemini | no equivalent opaque compaction found | Use current structured-output path plus context caching/token preflight. |
| Bedrock Mantle | Responses support documented; compact support unproven | Probe `/responses/compact`; fall back to current chat-completions path. |

This avoids choosing between opaque speed and transparent audit. The native item
keeps model-continuity state; the local manifest keeps replayability,
provenance, and portability.

### 2. Canonical Handoff State

Add two canonical artifacts:

- `handoff-state.json`: typed state consumed by the harness and future compactions.
- `handoff-manifest.json`: artifact digests, schema/model fingerprints,
  authority labels, privacy flags, and validation status.

`after-compact.jsonl` should point to the manifest and include only the compact
human-readable bridge plus necessary immediate state. The manifest becomes the
machine contract. A fresh model should receive a rendered freeform Markdown view
of this state, not raw JSON sidecars as its primary summary.

Suggested `handoff-state.json` shape:

```json
{
  "version": 1,
  "checkpoint_id": "sha256:...",
  "source_transcripts": [],
  "native_compaction_items": [],
  "active_state": {
    "current_objective": "",
    "next_step": "",
    "open_questions": [],
    "blockers": []
  },
  "user_intent_events": [],
  "rules_and_invariants": [],
  "plans_and_task_state": [],
  "promises_made": [],
  "evidence_capsules": [],
  "artifact_manifest": "handoff-manifest.json"
}
```

### 3. Replace XML Ledger With Typed User Intent Events

Keep raw user messages, but add a deterministic higher-level layer:

```json
{
  "kind": "request | correction | safety | preference | constraint",
  "status": "current | superseded | removed",
  "priority": "must_keep | high | normal | low",
  "source_line": 475,
  "source_hash": "...",
  "message_sha256": "...",
  "supersedes": ["..."],
  "text": "..."
}
```

Retention should become priority-aware:

1. keep active safety/security constraints;
2. keep current user request and latest correction chain;
3. keep durable preferences;
4. keep recent user tail;
5. then spend remaining budget chronologically.

Parse carried state only from trusted `isCompactSummary` or typed state records,
not from arbitrary text containing `<user-message-ledger>`.

### 4. Evidence Capsules Instead Of Plain Spans

Upgrade `source_spans` into evidence capsules:

```json
{
  "id": "ev-000123",
  "authority": "raw_transcript | compact_summary | artifact | git",
  "source_kind": "jsonl_record | file | tool_output | user_message",
  "record_range": [475, 475],
  "char_range": [0, 107],
  "start_hash": "...",
  "end_hash": "...",
  "raw_slice_sha256": "...",
  "extracted_text_sha256": "...",
  "validation": "verified"
}
```

For code-like evidence, add typed code capsules:

```json
{
  "language": "ts",
  "source_record": 812,
  "char_range": [1200, 1880],
  "exact_text_sha256": "...",
  "normalized_code_sha256": "..."
}
```

The model should select spans; the harness should re-read raw sources, verify
hashes, and render exact evidence.

### 5. Anchored Iterative Compaction

Stop regenerating everything from the full transcript as the only strategy.
Factory-style anchored iterative summarization and multi-round research point to
a better update rule:

```text
next_state = merge(previous_canonical_state, summarize(new_raw_segment))
```

Rules:

- New summaries may update canonical state, but raw evidence stays authoritative.
- Summary-derived spans are non-authoritative unless they point back to raw
  evidence capsules.
- Each compaction round records parent checkpoint id and source segment range.

### 6. Async Validation Before Swap

Adopt a Slipstream-like acceptance gate:

1. start compaction while the original context continues for the next `k` steps;
2. judge candidate compacted state against those next steps;
3. accept only if plan-level and statement-level sufficiency pass;
4. otherwise patch the candidate or fall back to synchronous/higher-fidelity lane.

This validates what source-faithfulness cannot: whether the handoff preserves
what the agent actually needed next.

### 7. Context Lifecycle, Not Just Summary

Borrow from Context Window Lifecycle-style systems:

- annotate episodes as exploration, action, decision, error, artifact, user
  correction, or checkpoint;
- track dependencies between episodes;
- evict recoverable action/tool output first;
- preserve user turns, active exploratory context, and dependency roots;
- avoid LLM calls for content already persisted in files, git, or artifacts.

This turns compaction from “summarize old text” into deterministic eviction over
a structured work graph.

## Prompt And Schema Recommendations

1. Remove or anchor required legacy arrays:
   - `primary_request_and_intent`
   - `key_technical_concepts`
   - `files_and_code_sections`
   - `errors_and_fixes`
   - `problem_solving`
   - `pending_tasks`

   Either derive them locally from anchored blocks or require source spans for
   each item.

2. Split provider schema from local validation:
   - provider schema: compatible subset for OpenAI/Gemini/xAI/Mantle;
   - local validation schema: rich constraints, line bounds, semantic checks,
     source integrity, evidence capsule validation.

3. Add `makeProviderSchema(provider)` and schema fingerprints so grammar/cache
   behavior is stable and auditable.

4. Replace `format: paragraph | bullet` with one of:
   - `paragraph`;
   - `bullet_items: string[]`;
   - `evidence_reference`;
   - `code_capsule`.

   This avoids multi-line bullet slop and `- - item` rendering.

## Renderer Recommendations

Keep `stripped` as default today. It is the major win over raw JSONL. Do not
switch wholesale to CSV/TSV without evals.

Next renderer experiment:

```text
@@ 000123 type=user role=user timestamp=...
body
@@
```

This is smaller than the current XML-ish wrapper, avoids XML-close injection,
and keeps line-addressed visual scanning. TSV remains useful for sidecars, but
raw multiline TSV is risky for the prompt body.

Token work should focus less on delimiter shaving and more on selective body
compression:

- keep current user messages, active files, paths, commands, errors, and exact
  identifiers verbatim;
- head/tail old tool logs;
- optionally test LLMLingua/LongLLMLingua for low-priority older tool output
  behind retention gates.

## Evaluation Recommendations

Current metrics are necessary but insufficient. Add these gates:

| Gate | What It Tests |
|---|---|
| Multi-round compaction | 5, 10, and 20 compaction rounds over the same trace. |
| Sufficiency probes | Can the next agent take the same next action as with full context? |
| Fact-retention probes | Inject known facts and ask targeted questions after compaction. |
| False-fact detection | Judge whether summary claims are unsupported by evidence capsules. |
| Evidence correctness | Every cited span re-reads and hashes to the expected raw source. |
| User-intent precedence | Later corrections supersede earlier instructions correctly. |
| Security injection | User text containing fake ledger/summary tags cannot alter carried state. |
| Literal preservation | Exact file paths, commands, endpoint names, error strings, and IDs survive. |
| Artifact recovery | Fresh session can find source artifacts from manifest without transcript search. |

## Security And Privacy Recommendations

1. Add `--redact-secrets`, `--local-artifact-ttl`, and optional artifact
   encryption.
2. Mark sensitive artifacts in `handoff-manifest.json`: raw transcript, user
   messages, SSE, model output, rehydrated spans.
3. Add provider privacy gates:
   - fail or warn if provider path is not ZDR-eligible;
   - avoid cache writes for raw transcripts unless explicitly enabled;
   - keep raw JSONL local-only by default.
4. Treat historical user messages as quoted evidence, not live instructions.
   The receiving prompt should say: user messages preserve intent and correction
   history; live rules come from `rules_and_invariants` and current user input.

## Roadmap

### Phase 1: Hardening

- Replace XML-ish `## User Messages` ledger with strict JSON in
  `handoff-state.json`, then render it back into a plain `## User Messages`
  Markdown section for model handoff.
- Parse carried state only from trusted compact-summary/state records.
- Add adversarial ledger-injection tests.
- Anchor or remove unanchored schema arrays.
- Add artifact manifest with SHA256s and sensitivity labels.

### Phase 2: Evidence Capsules

- Implement evidence capsules with char offsets and raw slice hashes.
- Add typed code capsules.
- Verify rehydration by re-reading raw sources.
- Make `summary.rehydrated.md` a view over capsules, not a parallel format.

### Phase 3: Recursive State

- Add checkpoint ids and parent checkpoint links.
- Summarize only new raw segments into previous canonical state.
- Mark summary-derived evidence as non-authoritative unless backed by raw
  capsules.
- Add 5/10/20-round compaction stress tests.

### Phase 4: Hybrid Native Backends

- Add Anthropic native compaction backend.
- Add OpenAI/xAI `/responses/compact` backend.
- Probe Mantle Responses compact support.
- Store opaque native compaction items beside local audit state.

### Phase 5: SOTA Evaluation Harness

- Add trajectory-sufficiency judge using next-k actions.
- Add fact injection/recall tests using LongMemEval-style categories.
- Add provider reliability/cost latency repeated trials.
- Add benchmark scorecards that combine retention, false facts, sufficiency,
  privacy, and speed.

## Sources

- Anthropic compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic context editing: https://platform.claude.com/docs/en/build-with-claude/context-editing
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- OpenAI compaction: https://developers.openai.com/api/docs/guides/compaction
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI agent safety: https://developers.openai.com/api/docs/guides/agent-builder-safety
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini token counting: https://ai.google.dev/gemini-api/docs/tokens
- Gemini context caching: https://ai.google.dev/gemini-api/docs/caching
- xAI context compaction: https://docs.x.ai/developers/advanced-api-usage/context-compaction
- AWS Bedrock data retention: https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html
- AWS Grok 4.3 model card: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-3.html
- Claude Code compaction reference: `references/claude-code-default-compaction-prompt.md`
- Codex compaction prompt reference: `references/codex-cli-default-compaction-prompt.md`
- AMP Handoff: https://ampcode.com/news/handoff
- Codex remote compaction source: https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_remote_v2.rs
- Codex compact prompt: https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/compact/prompt.md
- Aider history summarization: https://github.com/Aider-AI/aider/blob/main/aider/history.py
- Aider prompt source: https://github.com/Aider-AI/aider/blob/main/aider/prompts.py
- Slipstream trajectory-grounded compaction validation: https://arxiv.org/html/2605.08580
- Context Window Lifecycle: https://arxiv.org/html/2606.11213
- Parallel Context Compaction: https://arxiv.org/html/2605.23296
- EMBER: https://arxiv.org/html/2606.05894v1
- FullCite: https://arxiv.org/html/2606.07130v1
- `sui-1`: https://arxiv.org/pdf/2601.08472
- Lost in Compaction: https://github.com/profff/lost-in-compaction
- LongMemEval: https://github.com/xiaowu0162/LongMemEval
- STATE-Bench: https://opensource.microsoft.com/blog/2026/05/19/introducing-state-bench-a-benchmark-for-ai-agent-memory/
- LLMLingua: https://aclanthology.org/2023.emnlp-main.825/
- LongLLMLingua: https://aclanthology.org/2024.acl-long.91/
- LLMLingua repo: https://github.com/microsoft/LLMLingua
- Context Ledger: https://github.com/wiztek-llc/context-ledger
- Continuity Ledger: https://github.com/AdemVessell/continuity-ledger
- ContextCompressionEngine: https://github.com/SimplyLiz/ContextCompressionEngine
