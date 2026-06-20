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

By default, the model sees a stripped, line-addressed text rendering of the
transcript rather than raw JSONL. The original JSONL is still copied into the
run directory and used for source-span rehydration. Use
`--transcript-renderer jsonl` only for diagnostics.

The request is streamed. While it runs, the script appends live deltas to
`runs/.../model-output.json`, writes the raw SSE stream to `runs/.../response.sse`,
and mirrors the deltas to stderr.

The shared compaction prompt is documented verbatim in
`docs/shared-compaction-prompt.md`. A `pre-commit` hook keeps that file in sync
with `buildFullTranscriptPrompt()`:

```sh
node scripts/compact-full-transcript.mjs --print-shared-prompt-markdown > docs/shared-compaction-prompt.md
```

### Handoff user messages

Each run writes a canonical handoff bundle:

- `handoff-state.json`: typed state with `user_intent_events`, active task
  state, rules, promises, and verified evidence capsules.
- `handoff-manifest.json`: artifact paths, SHA256s, authority labels,
  sensitivity flags, provider metadata, and validation status.
- `handoff.md`: the model-visible Markdown handoff rendered from the canonical
  state, including a bounded verified Evidence Index for exact literal recovery
  across repeated compactions.

`after-compact.jsonl` remains the Claude-compatible resume wrapper. Its compact
summary record includes the rendered `handoff.md` content plus typed pointers to
the manifest/state artifacts. The harness extracts real user-authored messages,
collapses long messages with head/tail preservation, and carries selected
`user_intent_events` forward across later compactions.

Bounds:

- `--handoff-user-message-limit` default `64`
- `--handoff-user-message-token-budget` default `8000` using char/4 estimate
- `--handoff-user-message-line-limit` default `300`
- `--user-message-collapse-at` default `2400`
- `--user-message-head-chars` default `900`
- `--user-message-tail-chars` default `900`

When limits are hit, priority-aware retention keeps active safety/security
constraints, current requests, durable preferences, and correction chains before
low-value recency. Selected messages are rendered back in chronological order.
The sidecar `user-messages.json` records current, carried, and selected messages
plus the applied limits. Legacy XML user-message ledgers are parsed only from
trusted compact summary records.

### Experiment gates

The current selected default local implementation is the EXP-01 + EXP-03 +
EXP-04 + EXP-05 + EXP-06 + EXP-07 stack:

- typed handoff state and manifest;
- priority-aware user-message retention;
- char-aware evidence capsules and fenced-code capsules;
- provider schema split from local validation;
- multi-round 5/10/20 no-API degradation gate;
- deterministic scorecard for integrity, state retention, exact literals,
  unsupported high-risk literals, and footprint.

EXP-08/09 are implemented as gated tracks:

- `--transcript-renderer sentinel` is an opt-in A/B renderer with delimiter
  escaping and selective old tool-output compression. Current dry-run evidence
  reduced request body size from `601,526` to `468,748` bytes, omitted
  `137,749` model-visible chars (~`34,437` char/4 tokens), and passed the
  no-API scorecard. The prior live stripped Codex run used `168,325` input
  tokens; applying that observed byte/token ratio projects Sentinel at about
  `131,087` input tokens, saving about `37,238`. That projection is not a live
  Sentinel token measurement, so `stripped` remains default until live provider
  retention and token usage are confirmed.
- `scripts/probe-native-compaction.mjs` generates redacted dry-run, or explicit
  `--live`, native compaction probes for OpenAI `/responses/compact`, xAI
  `/v1/responses/compact`, and Anthropic `compact_20260112`. Native output is
  stored as opaque provider state and does not replace local handoff artifacts.
- `scripts/judge-compaction-result.mjs` generates advisory semantic judge
  requests with strict pass/fail/unknown output, candidate hashes, and
  mechanically checked evidence refs. Deterministic gates remain authoritative.

Current no-API selected baseline: `23,022` estimated tokens in
`after-compact.jsonl`, `50` evidence capsules, `1,850` text segments, `23` code
capsules, and scorecard `100/100`. The 20-round no-tail degradation gate passes
with `5,511` estimated tokens, `8` user intent events, `27` evidence capsules,
no missing required literals, and scorecard `90/100`.

## Benchmark Results

Both runs used the same source transcript:
`transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl`
(`1,066` records, `2,379,590` bytes, ~`593,956` char/4 tokens).

| Provider | Model | Wall time | API input tokens | API output tokens | `summary.md` | `summary.rehydrated.md` | `after-compact.jsonl` |
|---|---|---:|---:|---:|---:|---:|---:|
| Codex | `gpt-5.4`, low reasoning, priority, stripped renderer | 52.23s | 168,325 | 4,167 | 1,534 tokens, 387.19:1 | 86,063 tokens, 6.9:1 | 21,322 tokens, 27.86:1 |
| Gemini | `gemini-3.5-flash`, low thinking | 124.41s | 1,016,973 | 3,275 | 803 tokens, 739.67:1 | 22,805 tokens, 26.04:1 | 18,789 tokens, 31.61:1 |

Fact retention here is measured by deterministic structural gates, not semantic
recall scoring. Both runs passed source-integrity echo checks, extracted all 8
real user messages, collapsed the one long user message deterministically, and
wrote rehydrated span artifacts.

| Provider | Summary blocks | Current rules | Plan/state items | Rehydrated spans | Source lines cited |
|---|---:|---:|---:|---:|---:|
| Codex | 8 | 9 | 7 | 50 | 41 |
| Gemini | 4 | 4 | 2 | 15 | 17 |

Saved reports:

- `runs/compact-user-messages-live-2026-06-20/benchmark-results.md`
- `runs/compact-gemini-35-flash-live-2026-06-20/benchmark-results.md`
- `runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/result.json`
- `docs/phase-2-benchmark-results.md`
- `docs/model-mix-recommendation.md`

The current cross-provider comparison is in
`docs/phase-2-benchmark-results.md`. The stripped GPT-5.4 Codex run is the
quality leader, but the routing recommendation keeps it as a premium recovery
lane because it is much slower than the Gemini default and fast lanes.

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
- thinking level: `none`
- max output tokens: `65536`

`none` is translated per Gemini model family: Gemini 3.x Flash/Flash-Lite use
`thinkingLevel: "minimal"` because those models do not expose full
thinking-off; older non-thinking Flash lines omit `thinkingConfig`.

Overrides:

```sh
GEMINI_COMPACT_MODEL=gemini-3.5-flash \
GEMINI_COMPACT_THINKING_LEVEL=none \
GEMINI_COMPACT_MAX_OUTPUT_TOKENS=65536 \
node scripts/compact-full-transcript.mjs --provider gemini
```

### OpenAI-compatible providers

The harness also supports xAI direct and Bedrock Mantle chat-completions
surfaces with the same strict JSON-schema contract:

```sh
XAI_API_KEY=... \
node scripts/compact-full-transcript.mjs --provider xai --model grok-4.20-0309-non-reasoning

MANTLE_API_KEY=... \
node scripts/compact-full-transcript.mjs --provider mantle --model xai.grok-4.3
```

Provider defaults:

- xAI direct: `grok-4.20-0309-non-reasoning` at `https://api.x.ai/v1/chat/completions`
- Bedrock Mantle: `xai.grok-4.3` at `https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions`

For Gemini phase-2 runs, use `gemini-3.5-flash` with minimal thinking and
`gemini-3.1-flash-lite` with medium thinking.
