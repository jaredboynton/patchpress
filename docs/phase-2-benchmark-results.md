# Phase 2 Benchmark Results

Source transcript: `transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl`

- records: `1066`
- bytes: `2379590`
- char/4 token estimate: `593956`
- sha256: `22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20`

The first Grok attempts sent raw JSONL and failed. The harness now defaults to
`transcript_renderer: stripped`: the model sees line-addressed plain text, while
the raw JSONL stays local for source-span rehydration.

## Prompt Size

| Renderer | Request body bytes | Gemini `countTokens` on exact prompt | xAI server-side prompt tokens |
|---|---:|---:|---:|
| Raw JSONL | 2,570,772 | 1,016,730 | 859,949 |
| Stripped text | 601,215 | 200,749 | 163,458 |

Provider token counts are not directly comparable. The stripped request bodies
are essentially the same size across providers, but Gemini reports
`promptTokenCount`, Codex reports Responses `input_tokens`, and xAI reports
chat-completions `prompt_tokens` using different tokenizers and accounting
rules. In the stripped runs, Gemini reports about 200.8k prompt tokens, Codex
reports 168.3k input tokens, and xAI reports about 164.6k prompt tokens for the
same source transcript.

## Results

| Provider | Model / mode | Status | Wall time | API input tokens | API output tokens | `summary.md` | `after-compact.jsonl` | Integrity |
|---|---|---|---:|---:|---:|---:|---:|---|
| Gemini | `gemini-3.5-flash`, minimal thinking, stripped renderer | pass | 22.76s | 200,765 | 2,545 | 854 tokens | 18,860 tokens | pass |
| Gemini | `gemini-3.1-flash-lite`, medium thinking, stripped renderer | pass | 6.82s | 200,765 | 1,428 | 495 tokens | 18,500 tokens | pass |
| Gemini | `gemini-3.1-flash-lite`, medium thinking, temp 0, stripped renderer | pass | 4.64s | 200,765 | 1,301 | 347 tokens | 18,332 tokens | pass |
| Gemini | `gemini-3.1-flash-lite`, high thinking, temp 0, stripped renderer | pass | 6.32s | 200,765 | 1,264 | 391 tokens | 18,373 tokens | pass |
| Bedrock Mantle | `xai.grok-4.3`, stripped renderer | pass | 14.74s | 165,298 | 1,598 | 453 tokens | 18,448 tokens | pass |
| xAI direct | `grok-4.20-0309-non-reasoning`, temp 0, stripped renderer | pass | 19.66s | 164,569 | 2,476 | 845 tokens | 18,853 tokens | pass |
| xAI direct | `grok-4.20-0309-reasoning`, temp 0, stripped renderer | pass | 32.02s | 164,571 | 4,220 | 1,495 tokens | 19,501 tokens | pass |
| Codex | `gpt-5.4`, low reasoning, priority, stripped renderer | pass | 52.23s | 168,325 | 4,167 | 1,534 tokens | 21,322 tokens | pass |

## Deterministic Retention Signals

| Provider | Model / mode | Summary blocks | Current rules | Plan/state items | Rehydrated spans | Source lines cited | User messages |
|---|---|---:|---:|---:|---:|---:|---:|
| Gemini | `gemini-3.5-flash`, minimal thinking, stripped renderer | 8 | 3 | 2 | 48 | 52 | 8 |
| Gemini | `gemini-3.1-flash-lite`, medium thinking, stripped renderer | 2 | 3 | 2 | 13 | 13 | 8 |
| Gemini | `gemini-3.1-flash-lite`, medium thinking, temp 0, stripped renderer | 2 | 2 | 2 | 12 | 14 | 8 |
| Gemini | `gemini-3.1-flash-lite`, high thinking, temp 0, stripped renderer | 3 | 2 | 3 | 10 | 9 | 8 |
| Bedrock Mantle | `xai.grok-4.3`, stripped renderer | 4 | 2 | 2 | 18 | 15 | 8 |
| xAI direct | `grok-4.20-0309-non-reasoning`, temp 0, stripped renderer | 4 | 5 | 5 | 19 | 26 | 8 |
| xAI direct | `grok-4.20-0309-reasoning`, temp 0, stripped renderer | 10 | 3 | 4 | 19 | 24 | 8 |
| Codex | `gpt-5.4`, low reasoning, priority, stripped renderer | 8 | 9 | 7 | 50 | 41 | 8 |

## Judge Placement

The rebenchmarked stripped GPT-5.4 Codex run remains the quality leader in this
benchmark set by deterministic state coverage, with 9 current rules, 7 plan
items, 3 promises, 50 rehydrated spans, and 41 cited source lines. It is not the
automatic default because it took 52.23s, about 2.3x the Gemini 3.5 Flash run
and 7.7x the Flash-Lite medium run.

Use it as a premium recovery lane when maximum continuation fidelity is more
important than latency. Keep Gemini 3.5 Flash as the default quality lane and
Flash-Lite medium as the fast lane.

## Raw JSONL Failure Diagnostics

- A prior xAI direct candidate was removed from the benchmark set because its context window is below the project threshold. Historical artifacts remain ignored under `runs/`.
- Bedrock Mantle streamed an error with code `validation_error`: the raw JSONL request was blocked by an automated content safety check before model output. AWS documents Bedrock Guardrails as evaluating both inputs and model responses, and input interventions discard model inference; AWS also documents input tagging so only selected text is processed by guardrails when guardrails are explicitly configured.
- AWS documents `xai.grok-4.3` on Mantle as supporting structured outputs, but Bedrock structured-output schemas reject unsupported JSON Schema features with an immediate `400`. In particular, numerical constraints such as `minimum` and `maximum` are unsupported, so the Mantle adapter omits line-number bounds from the submitted schema and enforces them locally instead.
- Stripping the JSON envelope fixed both issues for the same source transcript.

## Artifacts

- `runs/phase2-gemini-35-flash-minimal-2026-06-20/result.json`
- `runs/phase2-gemini-35-flash-minimal-2026-06-20/summary.md`
- `runs/phase2-gemini-35-flash-minimal-2026-06-20/summary.rehydrated.md`
- `runs/phase2-gemini-31-flash-lite-medium-2026-06-20/result.json`
- `runs/phase2-gemini-31-flash-lite-medium-2026-06-20/summary.md`
- `runs/phase2-gemini-31-flash-lite-medium-2026-06-20/summary.rehydrated.md`
- `runs/phase2-gemini-35-flash-minimal-stripped-2026-06-20/result.json`
- `runs/phase2-gemini-35-flash-minimal-stripped-2026-06-20/summary.md`
- `runs/phase2-gemini-35-flash-minimal-stripped-2026-06-20/summary.rehydrated.md`
- `runs/phase2-gemini-31-flash-lite-medium-stripped-2026-06-20/result.json`
- `runs/phase2-gemini-31-flash-lite-medium-stripped-2026-06-20/summary.md`
- `runs/phase2-gemini-31-flash-lite-medium-stripped-2026-06-20/summary.rehydrated.md`
- `runs/phase2-mantle-xai-grok-43-2026-06-20/failure.json`
- `runs/phase2-mantle-xai-grok-43-stripped-2026-06-20/result.json`
- `runs/phase2-mantle-xai-grok-43-stripped-2026-06-20/summary.md`
- `runs/phase2-mantle-xai-grok-43-stripped-2026-06-20/summary.rehydrated.md`
- `runs/phase3-gemini-31-flash-lite-medium-temp0-salvaged-2026-06-20/result.json`
- `runs/phase3-gemini-31-flash-lite-medium-temp0-salvaged-2026-06-20/summary.md`
- `runs/phase3-gemini-31-flash-lite-high-temp0-2026-06-20/result.json`
- `runs/phase3-gemini-31-flash-lite-high-temp0-2026-06-20/summary.md`
- `runs/phase3-xai-grok-420-non-reasoning-temp0-fixed-2026-06-20/result.json`
- `runs/phase3-xai-grok-420-non-reasoning-temp0-fixed-2026-06-20/summary.md`
- `runs/phase3-xai-grok-420-reasoning-temp0-fixed-2026-06-20/result.json`
- `runs/phase3-xai-grok-420-reasoning-temp0-fixed-2026-06-20/summary.md`
- `runs/phase3-codex-gpt-54-low-stripped-2026-06-20/result.json`
- `runs/phase3-codex-gpt-54-low-stripped-2026-06-20/summary.md`
- `runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/result.json`
- `runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/summary.md`

## Reference Docs

- Gemini thinking levels: https://ai.google.dev/gemini-api/docs/thinking
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- xAI structured outputs: https://docs.x.ai/developers/model-capabilities/text/structured-outputs
- xAI reasoning controls: https://docs.x.ai/developers/model-capabilities/text/reasoning
- xAI Responses migration: https://docs.x.ai/developers/model-capabilities/text/comparison
- xAI context compaction: https://docs.x.ai/developers/advanced-api-usage/context-compaction
- AWS Bedrock Mantle overview: https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
- AWS `xai.grok-4.3` model card: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-3.html
- AWS structured outputs: https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html
- AWS guardrails behavior: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-how.html
- AWS guardrails input tagging: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-tagging.html
