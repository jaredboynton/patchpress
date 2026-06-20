# Model Mix Recommendation

## Decision

Use `transcript_renderer=stripped` for all providers. Do not send raw JSONL to
external models; the stripped renderer keeps source line numbers for evidence
spans while the raw JSONL remains local for rehydration.

| Lane | Provider | Model | Peak Config | Routing Decision |
|---|---|---|---|---|
| Default quality | Gemini | `gemini-3.5-flash` | minimal thinking, stripped renderer | Default automatic compaction where continuation fidelity matters. |
| Fast | Gemini | `gemini-3.1-flash-lite` | medium thinking, stripped renderer | Latency-sensitive compaction and frequent background compaction. |
| xAI direct | xAI | `grok-4.20-0309-non-reasoning` | `temperature=0`, stripped renderer | Direct xAI lane and non-Gemini diversification. |
| Provider fallback | Bedrock Mantle | `xai.grok-4.3` | stripped renderer | AWS-routed fallback when Gemini or direct xAI is unavailable. |
| Premium recovery | Codex | `gpt-5.4` | low reasoning, priority service tier, stripped renderer | Manual/high-fidelity recovery when retention matters more than latency. |

## Benchmark Conditions

Source transcript:
`transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl`

| Field | Value |
|---|---:|
| Records | 1,066 |
| Raw bytes | 2,379,590 |
| Raw char/4 estimate | 593,956 tokens |
| Stripped request body | ~601 KB |

Provider token counts are not apples-to-apples. Gemini reports
`promptTokenCount`, Codex reports Responses `input_tokens`, and xAI-compatible
providers report chat-completions `prompt_tokens` using different tokenizers and
accounting rules. `After Tokens` is the current no-API re-rendered handoff size
after adding the deterministic `## User Messages` ledger and preserving the
default 16 tail records.

## Standardized Results

| Lane | Model | Wall Time | Request Bytes | Provider Input Tokens | Output Tokens | Reasoning/Thought Tokens | Summary Tokens | After Tokens | Retention Signals | Integrity |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Default quality | `gemini-3.5-flash` | 22.76s | 601,215 | 200,765 | 2,545 | n/a | 854 | 20,641 | 3 rules, 2 plan items, 1 promise, 48 spans, 52 cited lines | pass |
| Fast | `gemini-3.1-flash-lite` | 6.82s | 601,214 | 200,765 | 1,428 | 832 thoughts | 495 | 20,282 | 3 rules, 2 plan items, 1 promise, 13 spans, 13 cited lines | pass |
| Provider fallback | `xai.grok-4.3` via Mantle | 14.74s | 601,432 | 165,298 | 1,598 | 0 | 453 | 20,232 | 2 rules, 2 plan items, 0 promises, 18 spans, 15 cited lines | pass |
| xAI direct | `grok-4.20-0309-non-reasoning` | 19.66s | 601,488 | 164,569 | 2,476 | 0 | 845 | 20,631 | 5 rules, 5 plan items, 4 promises, 19 spans, 26 cited lines | pass |
| xAI recovery | `grok-4.20-0309-reasoning` | 32.02s | 601,484 | 164,571 | 4,220 | 929 reasoning | 1,495 | 21,279 | 3 rules, 4 plan items, 1 promise, 19 spans, 24 cited lines | pass |
| Premium recovery | `gpt-5.4` via Codex | 52.23s | 601,907 | 168,325 | 4,167 | 9 reasoning | 1,534 | 21,322 | 9 rules, 7 plan items, 3 promises, 50 spans, 41 cited lines | pass |

Current handoff user-message ledger for this transcript: 8 selected messages, 0
omitted, 1,582 estimated tokens, 117 rendered lines.

## Objective Winners

| Objective | Pick | Reason |
|---|---|---|
| Best automatic default | `gemini-3.5-flash` | Strongest default balance: good source-span density and continuation detail at 22.76s. |
| Lowest latency | `gemini-3.1-flash-lite` medium | Fastest passing peak configuration at 6.82s. Higher thinking plus `temperature=0` was terser but did not improve retention. |
| Highest retention | Codex `gpt-5.4` | Strongest deterministic state coverage after the header/body rebenchmark, but 52.23s still makes it a recovery lane. |
| Best xAI direct | `grok-4.20-0309-non-reasoning` | Better rules/plans/promises balance than the reasoning variant for less time and output. |
| Best provider fallback | Mantle `xai.grok-4.3` | Good AWS-routed fallback, but missed promises in this benchmark. |

## Fallback Policy

1. Always use `transcript_renderer=stripped`.
2. Preflight token count when a provider exposes a practical token-count API.
3. Retry transient `429`, `5xx`, network failures, and interrupted SSE at most twice with jitter.
4. Do not retry deterministic prompt-length errors unchanged.
5. For safety-validation failures, retry once with stripped/minimized input, then fail over to Gemini.
6. If fast-lane output fails validation or has weak retention, rerun with `gemini-3.5-flash`.
7. If Gemini is unavailable, use Bedrock Mantle `xai.grok-4.3`.
8. Use xAI direct `grok-4.20-0309-non-reasoning` when direct xAI comparison or provider diversification is required.
9. Use xAI direct `grok-4.20-0309-reasoning` only for difficult recovery cases where causal reconstruction matters more than latency and verbosity.
10. Use Codex `gpt-5.4` for premium recovery when maximum retention matters more than latency.

## Handoff Implication

The model mix only decides who writes the derived summary. User-authored
messages are now a deterministic handoff artifact in `## User Messages`, with
collapsed head/tail rendering and count/token/line bounds. This follows the
same broad direction as Claude Code's default compaction prompt, which treats
all non-tool-result user messages as critical state, but avoids trusting the
summarizer to preserve them.

## References

- Benchmark evidence: `docs/phase-2-benchmark-results.md`
- Claude API compaction docs: https://platform.claude.com/docs/en/build-with-claude/compaction
- Claude Code default compaction prompt: `references/claude-code-default-compaction-prompt.md`
- Codex default compaction prompt: `references/codex-cli-default-compaction-prompt.md`
- AMP compaction prompt: `references/amp-cli-compaction-prompt.md`
- Warp compaction reference: `references/warp-compaction-reference.md`
- Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- xAI structured outputs: https://docs.x.ai/developers/model-capabilities/text/structured-outputs
- xAI reasoning: https://docs.x.ai/developers/model-capabilities/text/reasoning
- AWS `xai.grok-4.3`: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-3.html
