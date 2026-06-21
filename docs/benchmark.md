# Current Compaction Benchmark

Canonical current benchmark for `claudecompact-patcher`. Every row below traces
to a run artifact under `runs/bench-*`. Scoring is two separate signals, the
deterministic gate and the v3 semantic judge; see `docs/judging-and-scoring.md`.

## Headline

All five models compact the 595k-token transcript successfully. The two-layer
score separates them on quality, and wall time separates them on speed:

- **Best quality:** `gpt-5.4` (codex) — top deterministic score and a clean
  10/10 judge on both renderers, at the cost of latency (~32-40s).
- **Best balance:** `gemini-3.5-flash` — 92/100 deterministic, 10/10 judge,
  ~18-22s.
- **Cross-provider alternate:** `grok-4.20` (xAI direct) — 89-90/100, 9-10/10
  judge, ~12-14s.
- **Fastest:** `gemini-3.1-flash-lite` — ~4s, but only on the **stripped**
  renderer (9/10 judge). On sentinel it passes the deterministic gate yet fails
  the judge (7/10, next-step actionability absent), so the fast lane must use the
  stripped renderer.
- **Weakest:** Bedrock Mantle `xai.grok-4.3` — borderline and unstable. It
  straddles both gates and flips pass/fail across runs (this run: sentinel 84
  deterministic / 8 judge-pass; stripped 88 / 8 judge-fail on an absent next
  step). Not recommended over the direct providers above.

## Benchmark Conditions

| Field | Value |
|---|---|
| Date | 2026-06-20 |
| Source transcript | `transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl` |
| Transcript sha256 | `22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20` |
| Raw bytes | 2,379,590 |
| Raw char/4 estimate | 593,956 tokens |
| Records numbered (citable) | 799 of 1,066 raw |
| Preserve tail | 16 (default) |
| Renderers | `sentinel`, `stripped` |
| Deterministic score | `scripts/score-compaction-result.mjs` (`deterministic-compaction-score.v2`) |
| Semantic judge | `scripts/judge-compaction-result.mjs`, `gpt-5.5`, medium reasoning, 3 trials (median) |

Provider input-token accounting is not apples-to-apples: Gemini reports
`promptTokenCount`, Codex reports Responses `input_tokens`, xAI reports
chat-completions `prompt_tokens`. Wall time is a single serial run on a local
M4 Max (indicative, not averaged).

## Current Live Results

| Model | Renderer | Wall | Deterministic /100 | Judge /10 | Input tok | Summary tok | After tok | Rules/Plans/Promises | Capsules | Cited lines |
|---|---|---:|---|---|---:|---:|---:|---|---:|---:|
| `gpt-5.4` (codex) | sentinel | 32.0s | 94 pass | 10 pass | 130,971 | 1,515 | 25,186 | 9 / 7 / 3 | 55 | 799 |
| `gpt-5.4` (codex) | stripped | 39.6s | 92 pass | 10 pass | 159,169 | 1,657 | 25,263 | 8 / 7 / 0 | 55 | 672 |
| `gemini-3.5-flash` | sentinel | 17.8s | 92 pass | 10 pass | 159,221 | 999 | 24,453 | 3 / 7 / 1 | 39 | 120 |
| `gemini-3.5-flash` | stripped | 22.2s | 92 pass | 10 pass | 187,471 | 1,155 | 24,234 | 5 / 8 / 0 | 98 | 62 |
| `grok-4.20` (xAI) | sentinel | 12.3s | 89 pass | 9 pass | 127,438 | 957 | 24,718 | 4 / 5 / 3 | 18 | 668 |
| `grok-4.20` (xAI) | stripped | 13.6s | 90 pass | 10 pass | 155,386 | 973 | 24,650 | 3 / 2 / 1 | 25 | 799 |
| `gemini-3.1-flash-lite` | sentinel | 3.8s | 85 pass | 7 **fail** | 159,221 | 405 | 23,368 | 2 / 2 / 0 | 9 | 20 |
| `gemini-3.1-flash-lite` | stripped | 4.1s | 88 pass | 9 pass | 187,471 | 504 | 24,175 | 2 / 2 / 1 | 12 | 616 |
| `xai.grok-4.3` (Mantle) | sentinel | 10.1s | 84 **fail** | 8 pass | 128,030 | 489 | 23,498 | 2 / 2 / 1 | 15 | 15 |
| `xai.grok-4.3` (Mantle) | stripped | 9.7s | 88 pass | 8 **fail** | 155,978 | 406 | 23,631 | 2 / 3 / 1 | 10 | 52 |

`grok-4.20` is `grok-4.20-0309-non-reasoning`. Codex runs at low reasoning,
priority tier.

## Reading the two scores

- **Deterministic /100 (gate):** code-only checks (artifacts, hashes, spans,
  required literals, state counts, footprint). The gate passes at >= 85 with no
  hard failure.
- **Judge /10 (verdict):** the v3 semantic judge's `total_level_score` (sum of
  five dimensions on absent/partial/clear) with `overall_pass`. A handoff fails
  if any dimension is absent, even when the deterministic gate passes — which is
  exactly what happens to `gemini-3.1-flash-lite` on sentinel (gate 85, judge
  7/10 because next-step actionability is absent). The two layers are meant to
  disagree: structural soundness is not continuation readiness.

## Routing

1. **Default quality:** `gemini-3.5-flash` (either renderer) — 10/10 judge,
   92/100 deterministic, ~18-22s.
2. **Highest quality:** `gpt-5.4` (codex, either renderer) — top deterministic
   and 10/10 judge, when ~32-40s latency is acceptable.
3. **Fast lane:** `gemini-3.1-flash-lite` with the **stripped** renderer — ~4s,
   9/10 judge. Do not pair flash-lite with sentinel: that lane fails the judge.
4. **Cross-provider alternate:** `grok-4.20` (xAI direct) — ~12-14s, 9-10/10
   judge.

Bedrock Mantle (`xai.grok-4.3`) is runnable but not recommended: its handoffs are
the thinnest of the field and its sentinel lane fails both layers.

## Request parity across providers

Every lane uses the same provider-independent prompt from
`buildFullTranscriptPrompt()` (`scripts/compact-full-transcript.mjs:1380`); only
the renderer (sentinel vs stripped) varies the evidence instructions, equally
across providers. The prompt is instruction-only, with no few-shot examples.

All providers use strict structured output (`json_schema`, `strict: true`) against
the identical summary schema, including the `minimum:1`/`maximum:N` bounds on
source-span line numbers (`compact-full-transcript.mjs:1348`). A direct probe
confirms Bedrock accepts the full bounded schema under `strict:true` (HTTP 200),
so Mantle uses the same schema as every provider with no carve-out. Bedrock's one
quirk is an intermittent content-safety block (a 400 that clears on retry),
unrelated to schema shape. Mantle's weak handoffs are the model, not the request
shape.

## Artifact Paths

Each lane writes `runs/bench-<lane>/result.json` (compaction) and
`runs/bench-<lane>/semantic-judge/semantic-judge-result.json` (v3 judge,
3-trial median). Lanes: `codex-sentinel`, `codex-stripped`, `g35flash-sentinel`,
`g35flash-stripped`, `xai-sentinel`, `xai-stripped`, `g31lite-sentinel`,
`g31lite-stripped`, `mantle-sentinel`, `mantle-stripped`. Deterministic scores
are reproduced with `node scripts/score-compaction-result.mjs runs/bench-<lane>`.

## Reproduce

```sh
# one lane (gemini-3.5-flash, stripped)
node scripts/compact-full-transcript.mjs --provider gemini --model gemini-3.5-flash \
  --transcript-renderer stripped \
  --input transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl \
  --out-dir runs/bench-g35flash-stripped
node scripts/score-compaction-result.mjs runs/bench-g35flash-stripped
node scripts/judge-compaction-result.mjs runs/bench-g35flash-stripped
```

Codex adds `--provider codex --model gpt-5.4 --reasoning-effort low --service-tier priority`;
xAI uses `--provider xai --model grok-4.20-0309-non-reasoning`; Mantle uses
`--provider mantle --model xai.grok-4.3` and authenticates with `MANTLE_API_KEY`,
`BEDROCK_MANTLE_API_KEY`, or `AWS_BEARER_TOKEN_BEDROCK`.
