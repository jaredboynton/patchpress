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
- [x] Benchmark sentinel/body compression against the current stripped baseline.
  Current dry-run evidence: `stripped` request body `601,526` bytes versus
  `sentinel` request body `468,748` bytes, with `11` old tool-output records
  compressed and `137,749` chars omitted from the model-visible prompt. That is
  about `34,437` char/4 tokens. Against the prior live Codex stripped run
  (`601,907` request bytes, `168,325` provider-reported input tokens), the same
  byte/token ratio projects Sentinel at about `131,087` input tokens, saving
  about `37,238`; this is projected, not observed live Sentinel usage.
- [x] Run native provider probe dry-runs for the three documented native paths:
  OpenAI `/responses/compact`, xAI `/v1/responses/compact`, and Anthropic
  `compact_20260112`. Live native calls remain explicit `--live` probes because
  native output is opaque and not authoritative.
- [x] Run semantic judge dry-run plus saved-output validation after
  deterministic scorecard pass. The saved output validates strict schema,
  candidate hashes, and evidence-reference mechanics; it is not a live semantic
  quality claim.
- [x] Update final selection docs after benchmark/probe evidence exists.

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

## Benchmark Evidence

- Sentinel dry-run request-body bytes: `468,748`.
- Stripped dry-run request-body bytes: `601,526`.
- Omitted model-visible tool-output chars: `137,749`, about `34,437` char/4
  tokens.
- Prior live stripped Codex request: `601,907` request bytes and `168,325`
  provider-reported input tokens. Sentinel's `468,748` request bytes project to
  about `131,087` input tokens, or about `37,238` fewer input tokens, if the
  same byte/token ratio holds.
- Sentinel no-API replay score: `100/100`, with `50` evidence capsules, `8`
  user intent events, `0` bad manifest hashes, and no missing required
  literals.
- Sentinel no-API replay footprint: `5,427` estimated after tokens and
  `22,242` after bytes with `--preserve-tail 0`.
- Artifact policy: all `13` manifest artifacts include retention, exposure,
  and redaction fields; manifest policy schema is
  `artifact-retention-policy.v1`.
- Native probe artifacts:
  - OpenAI: `runs/exp09-native-probes-noapi/openai/native-compaction-request.redacted.json`
    uses `https://api.openai.com/v1/responses/compact`, model `gpt-5.5`, source
    SHA256 `22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20`,
    and `1,066` source records.
  - xAI: `runs/exp09-native-probes-noapi/xai/native-compaction-request.redacted.json`
    uses `https://api.x.ai/v1/responses/compact`, model
    `grok-4.20-0309-non-reasoning`, the same source SHA256, and `1,066` source
    records.
  - Anthropic: `runs/exp09-native-probes-noapi/anthropic/native-compaction-request.redacted.json`
    uses `https://api.anthropic.com/v1/messages`,
    `anthropic-beta: compact-2026-01-12`, `compact_20260112`,
    `pause_after_compaction: true`, `trigger.value: 50000`, and no-tool
    compaction instructions.
  - All native probe results set `opaque_output_policy:
    store-only-pass-through`, `parse_encrypted_content: false`,
    `use_as_authority: false`, and `local_handoff_remains_authority: true`.
- Semantic judge artifacts:
  - `runs/exp09-semantic-judge-noapi/semantic-judge-request.json` generated a
    `semantic-compaction-judge-request.v1` request with `52` evidence refs,
    deterministic metrics from `runs/exp08-sentinel-noapi`, and
    `gates_remain_deterministic: true`.
  - `runs/exp09-semantic-judge-validated-noapi/semantic-judge-result.json`
    validated a saved strict JSON judge output with `4` verdicts,
    `validation_error: null`, candidate hashes, and mechanically checked
    evidence refs.
