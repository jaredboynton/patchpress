# Compaction Handoff Recommendations

## Decision

Use a hybrid handoff protocol:

1. Keep `after-compact.jsonl` as the Claude-compatible resume wrapper.
2. Add a canonical `handoff-manifest.json` and `handoff-state.json` as the harness's trusted internal state contract.
3. Render those JSON artifacts into a freeform Markdown handoff for the receiving model; do not expose raw JSON as the primary session summary.
4. Keep exact evidence in sidecars (`before-*.jsonl`, `line-hashes.tsv`, `rehydrated-spans.json`, `user-messages.json`) and validate those artifacts before rendering the model-visible handoff.
4. Use provider-native opaque compaction where available, but keep the local span-grounded handoff as the audit, replay, and fallback layer.

This makes prose summary useful but non-authoritative. The authoritative state is typed, hash-addressed, and locally validated.

## Current Harness

The current harness already has the right foundation:

- The prompt uses a stripped, line-addressed transcript rendering by default, while the original JSONL remains local for source-span rehydration.
- The model returns strict structured JSON with `summary_blocks`, `rules_and_invariants`, `plans_and_task_state`, `promises_made`, and `source_spans`.
- The harness derives `source_lines_used`, renders `summary.md`, writes `summary.rehydrated.md`, and stores exact evidence in `rehydrated-spans.json`.
- User-authored messages are extracted deterministically into `user-messages.json` and rendered into `after-compact.jsonl` as quoted JSON data, not model-written summary text.
- The benchmark docs show the stripped renderer is the major token win: about 601 KB request bodies instead of about 2.57 MB raw JSONL bodies.

Important local references:

- `scripts/compact-full-transcript.mjs`
- `scripts/test-handoff-user-messages.mjs`
- `docs/phase-2-benchmark-results.md`
- `docs/model-mix-recommendation.md`

## Best Handoff Protocol

The best protocol for this repo is a manifest-first checkpoint:

```json
{
  "version": "handoff.v1",
  "checkpoint_id": "compact-2026-06-20T00-00-00Z",
  "source": {
    "transcript_path": "runs/.../before-source.jsonl",
    "transcript_sha256": "...",
    "records": 1066,
    "renderer": "stripped"
  },
  "provider": {
    "provider": "gemini",
    "model": "gemini-3.5-flash",
    "schema_fingerprint": "...",
    "native_compaction_artifact": null
  },
  "artifacts": [
    {
      "kind": "state",
      "path": "handoff-state.json",
      "sha256": "...",
      "authority": "validated-local"
    },
    {
      "kind": "evidence",
      "path": "rehydrated-spans.json",
      "sha256": "...",
      "authority": "raw-source"
    },
    {
      "kind": "user_messages",
      "path": "user-messages.json",
      "sha256": "...",
      "authority": "raw-source"
    }
  ],
  "validation": {
    "schema": "passed",
    "artifact_hashes": "passed",
    "source_integrity": "passed",
    "timeline_order": "passed",
    "security_scan": "passed"
  }
}
```

`handoff-state.json` should carry the canonical machine-readable state:

```json
{
  "current_objective": "...",
  "active_constraints": [
    {
      "id": "rule-001",
      "text": "...",
      "status": "current",
      "priority": "safety",
      "source": { "line": 12, "record_sha256": "..." }
    }
  ],
  "tasks": [
    {
      "id": "T-001",
      "title": "...",
      "status": "active",
      "depends_on": [],
      "evidence": ["span-0001"]
    }
  ],
  "user_intent_events": [
    {
      "id": "intent-001",
      "kind": "request",
      "status": "current",
      "priority": "current-task",
      "supersedes": [],
      "source": { "line": 44, "record_sha256": "..." }
    }
  ],
  "next_step": {
    "command_or_action": "...",
    "reason": "...",
    "blocked_by": null
  }
}
```

Handoff rendering protocol:

1. Read `handoff-manifest.json` first.
2. Validate the manifest schema and sidecar hashes.
3. Read `handoff-state.json`, `rehydrated-spans.json`, and bounded `user-messages.json` inside the harness.
4. Render a normal freeform Markdown handoff, for example `handoff.md` or `summary.rehydrated.md`.
5. Give the receiving model the rendered handoff, not raw JSON, as the primary summary.
6. Treat all carried user-message and evidence text as quoted history, not fresh instructions.
7. Use sidecars for exact literals and verification; do not trust prose to reproduce code, commands, IDs, errors, or security instructions.
8. If validation fails, mark the rendered handoff as untrusted and fall back to raw transcript inspection.

## Critique Of `after-compact.jsonl`

Strengths:

- It is compatible with the target consumer because it emits a compact boundary, a compact summary record, and preserved tail records.
- It preserves raw-source provenance through line hashes and rehydrated spans instead of relying only on model prose.
- It keeps user-authored messages deterministic and outside the model output contract.
- It records useful metadata on the boundary record, including provider, model, renderer, source transcript hash, and user-message retention counts.

Gaps:

- The canonical state is still embedded primarily as markdown inside a `type: "user"` summary record. The next version should render a freeform handoff from typed state and make quoted historical user messages visually and semantically distinct from live instructions.
- There is no single manifest that lists all handoff artifacts with hashes, authority level, token/line budgets, and validation status.
- The model schema still requires legacy unanchored arrays such as `primary_request_and_intent`, `key_technical_concepts`, `errors_and_fixes`, and `pending_tasks`. They invite filler and are less trustworthy than the anchored blocks.
- User-message retention is chronological. It does not yet prioritize active safety constraints, current preferences, correction chains, and the latest explicit request ahead of low-value recent chatter.
- Repeated compaction needs an authority model. A later run should distinguish raw-source spans from prior-summary spans so summary-derived claims do not become primary evidence.
- The stripped prompt renderer uses XML-like record tags around unescaped body text. That is readable, but an alternate sentinel renderer should be benchmarked to reduce delimiter confusion.
- Provider-native compaction is not yet part of the runtime path. The current local flow is auditable and portable, but it resends the full rendered transcript and cannot preserve provider-internal opaque state.
- Quality validation is mostly structural. There is no multi-round sufficiency benchmark that proves the handoff still preserves active constraints, exact literals, open tasks, and next-step usability after repeated compactions.

## Top 3 Changes

1. Add manifest-first canonical handoff artifacts.

   Implement `handoff-manifest.json` and `handoff-state.json`; make `after-compact.jsonl` point to them. Validate artifact hashes, source integrity, schema version, provider/schema fingerprint, and authority levels before building the final compacted transcript.

2. Add typed intent and authority tracking.

   Add `user_intent_events` with `kind`, `status`, `priority`, `supersedes`, source line, and record hash. Use priority-aware retention so active safety rules, current constraints, durable preferences, correction chains, and current requests survive before ordinary recent messages. Mark spans as `raw-source`, `summary-derived`, or `preserved-tail`.

3. Add hybrid native compaction plus multi-round evals.

   Use Anthropic `compact_20260112` and OpenAI/xAI Responses compaction when available, while preserving the local span-grounded state as audit and fallback. Add repeated-compaction tests that compact the same trace 5 to 20 times and fail on missing active constraints, lost exact literals, stale superseded rules, invalid artifact hashes, or insufficient next-step state.

## Secondary Changes

- Split provider-submitted schemas from local validation schemas. Keep provider schemas compatible and enforce stricter line bounds, authority, and semantic checks locally.
- Add a renderer A/B lane for sentinel records such as `@@ 000123 type role timestamp`, then compare provider token counts and retention quality against current stripped XML-like records.
- Add refusal, incomplete-output, max-token, safety-block, JSON-parse, and local-validation failure classes so retries are routed intentionally.
- Upgrade new premium benchmark lanes to the latest available model family. Existing `gpt-5.4` benchmark rows can remain as historical benchmark evidence, but new examples and defaults should prefer the current line.

## Sources

- Anthropic compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic context engineering cookbook: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
- OpenAI compaction: https://developers.openai.com/api/docs/guides/compaction
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI agent safety: https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI Agents handoffs: https://openai.github.io/openai-agents-python/handoffs/
- LangChain handoffs: https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs
- Model Context Protocol spec: https://modelcontextprotocol.io/specification/2025-11-25/index
- Agent Client Protocol session setup: https://agentclientprotocol.com/protocol/session-setup
- OWASP prompt injection prevention: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- Codex compaction prompt: https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/compact/prompt.md
- Codex remote compaction implementation: https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_remote_v2.rs
- Continue conversation compaction: https://github.com/continuedev/continue/blob/main/core/util/conversationCompaction.ts
- AAHP manifest-first handoff proposal: https://github.com/homeofe/AAHP
- Warp open-source repo: https://github.com/warpdotdev/warp
