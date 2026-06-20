# Current Compaction Benchmark

This is the canonical current benchmark document for `claudecompact-patcher`.
Older benchmark tables are historical unless their numbers are repeated here.

## Current Decision

Use Gemini for validated live routing until the xAI/Codex empty-span
rehydration issue is fixed and rerun.

| Lane | Provider | Model | Renderer | Routing Status |
|---|---|---|---|---|
| Default quality | Gemini | `gemini-3.5-flash` | Sentinel | Current best speed/quality pass. |
| Fast | Gemini | `gemini-3.1-flash-lite` | Sentinel | Current fastest validated pass. |
| Stable fallback | Gemini | `gemini-3.5-flash` | stripped | Use when avoiding Sentinel-specific behavior. |
| xAI candidate | xAI | `grok-4.20-0309-non-reasoning` | Sentinel or stripped | Do not route yet; latest run failed local validation. |
| Codex candidate | Codex | `gpt-5.4` | Sentinel or stripped | Do not route yet; latest run failed local validation. |
| Mantle candidate | Bedrock Mantle | `xai.grok-4.3` | Sentinel | Not rerun; local key unavailable. |

## Benchmark Conditions

| Field | Value |
|---|---:|
| Rerun date | 2026-06-20 |
| Source transcript | `transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl` |
| Records | 1,066 |
| Raw bytes | 2,379,590 |
| Raw char/4 estimate | 593,956 tokens |
| Current prompt/schema | `scripts/compact-full-transcript.mjs` current working version |
| Handoff renderer | ordered+dedup handoff renderer |
| User messages | deterministic `## User Messages` ledger |
| Preserve tail | `--preserve-tail 0` |
| Local scorecard | `scripts/score-compaction-result.mjs` |
| Semantic judge | `scripts/judge-compaction-result.mjs`, `gpt-5.5`, medium reasoning |

Provider token counts are not apples-to-apples. Gemini reports
`promptTokenCount`; Codex reports Responses `input_tokens`; xAI-compatible
providers report chat-completions `prompt_tokens` with different accounting.

## Current Live Results

| Lane | Model | Renderer | Status | Wall Time | Provider Input Tokens | Output Tokens | Summary Tokens | After Tokens | Retention Signals | Score | Judge |
|---|---|---|---|---:|---:|---:|---:|---:|---|---:|---|
| Default quality | `gemini-3.5-flash` | Sentinel | pass | 19.70s | 175,193 | 2,526 | 1,092 | 4,513 | 4 rules, 4 plan items, 2 promises, 36 capsules, 34 cited lines | 90/100 | pass |
| Fast | `gemini-3.1-flash-lite` | Sentinel | pass | 3.74s | 175,193 | 1,001 | 416 | 3,512 | 2 rules, 2 plan items, 1 promise, 13 capsules, 12 cited lines | 90/100 | pass |
| Stable fallback | `gemini-3.5-flash` | stripped | pass | 20.45s | 200,836 | 1,761 | 758 | 3,917 | 3 rules, 4 plan items, 1 promise, 46 capsules, 38 cited lines | 90/100 | pass |
| Fast stripped | `gemini-3.1-flash-lite` | stripped | pass | 3.53s | 200,836 | 880 | 328 | 4,134 | 2 rules, 2 plan items, 0 promises, 7 capsules, 10 cited lines | 90/100 | pass |

## Current Failed Or Blocked Runs

| Provider | Model | Renderer | Observed Status | Evidence |
|---|---|---|---|---|
| xAI direct | `grok-4.20-0309-non-reasoning` | Sentinel | local validation failed after 15.45s | Structured output cited spans that rehydrated to empty evidence-capsule text segments. |
| xAI direct | `grok-4.20-0309-non-reasoning` | stripped | local validation failed after 13.51s | Structured output cited spans that rehydrated to empty evidence-capsule text segments. |
| Codex | `gpt-5.4`, low reasoning, priority | Sentinel | local validation failed after 38.58s | Structured output cited metadata-only or otherwise non-text spans that rehydrated empty. |
| Codex | `gpt-5.4`, low reasoning, priority | stripped | local validation failed after 30.00s+ | Structured output cited metadata-only or otherwise non-text spans that rehydrated empty. |
| Bedrock Mantle | `xai.grok-4.3` | Sentinel | not run | Missing `MANTLE_API_KEY` / `BEDROCK_MANTLE_API_KEY` in this environment. |

Structured outputs worked at the JSON Schema layer for the failed xAI/Codex
runs. The failure happened later in the local grounding contract: the cited line
ranges did not produce non-empty `text_segments` during local rehydration.

## Artifact Paths

| Run | Result |
|---|---|
| Gemini 3.5 Flash Sentinel | `runs/rerun-sentinel-gemini-35-flash-2026-06-20/result.json` |
| Gemini Flash-Lite Sentinel | `runs/rerun-sentinel-gemini-31-flash-lite-medium-2026-06-20/result.json` |
| Gemini 3.5 Flash stripped | `runs/rerun-current-stripped-gemini-35-flash-2026-06-20/result.json` |
| Gemini Flash-Lite stripped | `runs/rerun-current-stripped-gemini-31-flash-lite-medium-2026-06-20/result.json` |
| xAI Sentinel failed output | `runs/rerun-sentinel-xai-grok-420-nonreasoning-2026-06-20/model-output.json` |
| xAI stripped failed output | `runs/rerun-current-stripped-xai-grok-420-nonreasoning-2026-06-20/model-output.json` |
| Codex Sentinel failed output | `runs/rerun-sentinel-codex-gpt-54-low-2026-06-20/model-output.json` |
| Codex stripped failed output | `runs/rerun-current-stripped-codex-gpt-54-low-2026-06-20/model-output.json` |
| Gemini 3.5 Flash Sentinel judge | `runs/semantic-judge-rerun-sentinel-gemini-35-flash-2026-06-20/semantic-judge-result.json` |
| Gemini Flash-Lite Sentinel judge | `runs/semantic-judge-rerun-sentinel-gemini-31-flash-lite-medium-2026-06-20/semantic-judge-result.json` |
| Gemini 3.5 Flash stripped judge | `runs/semantic-judge-rerun-current-stripped-gemini-35-flash-2026-06-20/semantic-judge-result.json` |
| Gemini Flash-Lite stripped judge | `runs/semantic-judge-rerun-current-stripped-gemini-31-flash-lite-medium-2026-06-20/semantic-judge-result.json` |

## Current Routing

1. Use `gemini-3.5-flash` with Sentinel as the default quality lane.
2. Use `gemini-3.1-flash-lite` with Sentinel as the fast lane.
3. Use `gemini-3.5-flash` with stripped renderer when Sentinel behavior is under investigation.
4. Do not route xAI or Codex until empty-span rehydration is repaired and a fresh rerun passes local validation, scorecard, and semantic judge.
5. Rerun Mantle after credentials are available.

## Historical Benchmark Docs

The following files are link-preserving stubs and must not contain current
benchmark tables:

- `docs/model-mix-recommendation.md`
- `docs/phase-2-benchmark-results.md`

Other experiment and design docs may explain why features exist, but this file
is the only current source for benchmark results and routing.

## Acceptance Checks For This Document

- `docs/benchmark.md` is the only full current benchmark document.
- `docs/model-mix-recommendation.md` and `docs/phase-2-benchmark-results.md` are pointers, not duplicate tables.
- Current rows trace to the run artifacts listed above.
- xAI/Codex are described as current validation failures, not permanent model failures.
- Historical benchmark numbers are not presented as current routing evidence.
