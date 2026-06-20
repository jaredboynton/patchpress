# claudecompact-patcher

Local experiments for replacing Claude Code compaction with an external summary path.

## Codex backend smoke

The first harness calls the ChatGPT Codex Responses backend using local ChatGPT auth
from `~/.codex/auth.json`.

```sh
node scripts/codex-backend-smoke.mjs --dry-run
node scripts/codex-backend-smoke.mjs
```

It requests `gpt-5.4`, low reasoning, `priority` service tier, and strict JSON-schema output.

## Full transcript compaction

The compaction harness sends the whole source JSONL transcript in a single
request, requires structured JSON output, and writes both the original and a
Claude-style compacted transcript artifact into `runs/`.

```sh
node scripts/compact-full-transcript.mjs --dry-run
node scripts/compact-full-transcript.mjs
```

By default it reads
`transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl`.

The request is streamed. While it runs, the script appends live deltas to
`runs/.../model-output.json`, writes the raw SSE stream to `runs/.../response.sse`,
and mirrors the deltas to stderr.

The shared compaction prompt is documented verbatim in
`docs/shared-compaction-prompt.md`. A `pre-commit` hook keeps that file in sync
with `buildFullTranscriptPrompt()`:

```sh
node scripts/compact-full-transcript.mjs --print-shared-prompt-markdown > docs/shared-compaction-prompt.md
```

## Benchmark Results

Both runs used the same source transcript:
`transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl`
(`1,066` records, `2,379,590` bytes, ~`593,956` char/4 tokens).

| Provider | Model | Wall time | API input tokens | API output tokens | `summary.md` | `summary.rehydrated.md` | `after-compact.jsonl` |
|---|---|---:|---:|---:|---:|---:|---:|
| Codex | `gpt-5.4`, low reasoning, priority | 145.95s | 890,616 | 5,231 | 2,168 tokens, 273.96:1 | 41,261 tokens, 14.4:1 | 20,252 tokens, 29.33:1 |
| Gemini | `gemini-3.5-flash`, low thinking | 124.41s | 1,016,973 | 3,275 | 803 tokens, 739.67:1 | 22,805 tokens, 26.04:1 | 18,789 tokens, 31.61:1 |

Fact retention here is measured by deterministic structural gates, not semantic
recall scoring. Both runs passed source-integrity echo checks, extracted all 8
real user messages, collapsed the one long user message deterministically, and
wrote rehydrated span artifacts.

| Provider | Summary blocks | Current rules | Plan/state items | Rehydrated spans | Source lines cited |
|---|---:|---:|---:|---:|---:|
| Codex | 5 | 5 | 10 | 59 | 69 |
| Gemini | 4 | 4 | 2 | 15 | 17 |

Saved reports:

- `runs/compact-user-messages-live-2026-06-20/benchmark-results.md`
- `runs/compact-gemini-35-flash-live-2026-06-20/benchmark-results.md`

### Gemini provider

The same compaction path can use the Gemini API with structured JSON output and
SSE streaming:

```sh
GEMINI_API_KEY=... node scripts/compact-full-transcript.mjs --provider gemini --dry-run
GEMINI_API_KEY=... node scripts/compact-full-transcript.mjs --provider gemini
```

`GOOGLE_API_KEY` is also accepted and takes precedence when both key variables are set.
The adapter calls `models/{model}:streamGenerateContent?alt=sse` with
`generationConfig.responseMimeType = "application/json"` and `responseJsonSchema`
so Gemini can enforce the harness JSON contract while streaming text chunks.

Defaults:

- model: `gemini-3.5-flash`
- thinking level: `low`
- max output tokens: `65536`

Overrides:

```sh
GEMINI_COMPACT_MODEL=gemini-3.5-flash \
GEMINI_COMPACT_THINKING_LEVEL=low \
GEMINI_COMPACT_MAX_OUTPUT_TOKENS=65536 \
node scripts/compact-full-transcript.mjs --provider gemini
```
