# EXP-08/09 Future Work Integration

This document tracks the remaining future-work items from
`docs/state-of-art-compaction-recommendations.md`: sentinel/body-compressed
rendering, provider-native compaction probes, artifact retention/security
policy, and semantic judging.

## Research Evidence

- OpenAI Responses compaction has both server-side `context_management` and a
  standalone `/responses/compact` endpoint. The standalone endpoint returns a
  canonical compacted output window that should be passed to the next
  `/responses` call as-is; the encrypted compaction item is opaque and not
  intended for human interpretation.
  Source: https://developers.openai.com/api/docs/guides/compaction
- OpenAI OpenAPI defines `POST /responses/compact` returning
  `object: "response.compaction"` with an `output` array containing retained
  items plus a compaction item.
  Source: https://api.openai.com/v1/responses/compact
- xAI exposes an OpenAI-compatible `POST /v1/responses/compact`; its docs warn
  that `encrypted_content` is opaque, should not be parsed or hand-merged, and
  should be passed back verbatim.
  Source: https://docs.x.ai/developers/advanced-api-usage/context-compaction
- Anthropic `compact_20260112` is a server-side Messages API context edit with
  beta header `compact-2026-01-12`. It supports trigger thresholds,
  `pause_after_compaction`, and custom instructions; the docs also note tool
  clearing as a lighter-weight way to drop stale tool results.
  Source: https://platform.claude.com/docs/en/build-with-claude/compaction
- Codex remote compaction retains user/developer/system messages under a token
  budget, expects exactly one compaction output item, and installs that opaque
  item into replacement history.
  Source:
  https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_remote_v2.rs
- Continue and Aider are contrast examples of client-side prose summaries.
  They preserve continuity, but do not provide the same local manifest,
  evidence-capsule, and hash-audit structure this repo now relies on.
  Sources:
  https://github.com/continuedev/continue/blob/main/core/util/conversationCompaction.ts
  and https://github.com/Aider-AI/aider/blob/main/aider/history.py
- Current evaluation guidance for LLM-as-judge systems favors locked rubrics,
  structured outputs, evidence-grounded findings, and deterministic checks that
  remain authoritative.
  Sources: https://arxiv.org/html/2601.08654 and
  https://arxiv.org/html/2606.01629v1
- Tool-output clearing/offloading prior art supports compressing old,
  re-fetchable tool outputs before invoking full summarization, while retaining
  canonical artifacts for recovery.
  Sources:
  https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
  and https://www.langchain.com/blog/context-management-for-deepagents

## Decisions

- [x] Keep the deterministic local handoff as the authority. Native provider
  compaction outputs are useful probes/artifacts, but opaque compaction blobs
  must not replace `handoff-state.json`, `handoff-manifest.json`, evidence
  capsules, or deterministic scorecards.
- [x] Add a sentinel renderer as an A/B lane, not the default. It avoids XML-ish
  body parsing ambiguity and records source line/hash metadata in a compact
  delimiter format.
- [x] Add selective old tool-output compression only for sentinel rendering.
  Full tool output remains recoverable through the source transcript and
  evidence sidecars.
- [x] Add artifact retention/security metadata to the manifest. Every artifact
  now declares retention class/action, exposure policy, and redaction status.
- [x] Add provider-native compaction probes for OpenAI, xAI, and Anthropic.
  Dry-run probes are safe by default; live probes store returned native output
  as opaque store-only-pass-through artifacts.
- [x] Add a semantic judge request/validation scaffold. It is evidence-grounded
  and explicitly cannot override deterministic gates.
- [ ] Benchmark sentinel/body compression against the current stripped baseline.
- [ ] Run native provider probes when credentials and desired provider/model are
  selected.
- [ ] Run semantic judge live or with a saved judge output after deterministic
  scorecard pass.
- [ ] Update final selection docs after benchmark evidence exists.

## Implementation Checklist

- [x] `scripts/compact-full-transcript.mjs`: support
  `--transcript-renderer sentinel`.
- [x] `scripts/compact-full-transcript.mjs`: support
  `--tool-output-compress-after`, `--tool-output-compress-min-chars`,
  `--tool-output-compress-head-chars`, and
  `--tool-output-compress-tail-chars`.
- [x] `scripts/compact-full-transcript.mjs`: record renderer policy in
  `handoff-manifest.json`.
- [x] `scripts/compact-full-transcript.mjs`: record artifact retention,
  exposure, and redaction policy in `handoff-manifest.json`.
- [x] `scripts/probe-native-compaction.mjs`: produce OpenAI/xAI/Anthropic
  native compaction dry-run request artifacts and optional live probe artifacts.
- [x] `scripts/judge-compaction-result.mjs`: produce a semantic judge request
  artifact and validate saved judge output against a strict schema.
- [x] `scripts/test-future-work.mjs`: cover the integrated future-work
  contracts.
- [x] `scripts/test-sentinel-renderer.mjs`: cover sentinel rendering,
  body-compression stats, and sentinel delimiter escaping.

## Evidence To Fill During Benchmarking

- Sentinel dry-run request-body bytes:
- Stripped dry-run request-body bytes:
- Sentinel no-API replay score:
- Native probe artifacts:
- Semantic judge artifacts:
