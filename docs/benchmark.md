# Current Compaction Benchmark

Canonical current benchmark for `claudecompact-patcher`. Every row below traces
to a run artifact under `runs/bench-*`. Scoring is two separate signals, the
deterministic gate and the v3 semantic judge; see `docs/judging-and-scoring.md`.

## Headline

All five scored models compact the 595k-token transcript successfully. The
two-layer score separates them on quality, and wall time separates them on speed.

- **Best quality:** `gpt-5.4` (codex) — top deterministic score and a clean
  10/10 judge on both renderers, at the cost of latency (~32-40s).
- **Best balance:** `gemini-3.5-flash` — 92/100 deterministic, 10/10 judge,
  ~18-22s.
- **Cross-provider alternate:** `grok-4.20` (xAI direct) — 89-90/100, 9-10/10
  judge, ~12-14s.
- **Fastest:** `gemini-3.1-flash-lite` (temperature 0.4, thinking `minimal`) —
  ~3-5s. With the tuned defaults the **sentinel** renderer is now the fast lane:
  86/100 deterministic and 9/10 judge, both passing. The stripped lane hits a
  perfect 10/10 judge but drops below the deterministic gate (79/100), so the
  fast lane must use sentinel under the tuned defaults.
- **Weakest:** Bedrock Mantle `xai.grok-4.3` — borderline and unstable. It
  straddles the deterministic gate and flips pass/fail across runs (this run, at
  temperature 0.4: sentinel 81 deterministic / 10 judge-pass; stripped 86 / 9
  judge-pass). `--reasoning-effort medium` lifts it over the gate (~85); at the
  default it stays borderline. Not recommended over the direct providers above.
- **`onto` renderer + `dspc` strategy (wired, benchmark pending):** a third
  transcript renderer `--transcript-renderer onto` (schema-once columnar framing,
  arXiv:2604.17512) and an importance-based tool-output compressor
  `--tool-output-compress-strategy dspc` (arXiv:2509.13723) are integrated and
  covered by `test-onto-renderer.mjs` / `test-dspc-compression.mjs` and the
  12-combination provider parity gate. The 595k benchmark rows for `onto` and for
  the `dspc` strategy are pending; the defaults (`stripped` / `headtail`) are
  unchanged so existing rows still hold.

## Benchmark Conditions

| Field | Value |
|---|---|
| Date | 2026-06-21 |
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
| `gemini-3.1-flash-lite` | sentinel | 3.4s | 86 pass | 9 pass | 159,221 | 384 | 23,550 | 2 / 2 / 0 | 12 | 60 |
| `gemini-3.1-flash-lite` | stripped | 4.7s | 79 **fail** | 10 pass | 187,471 | 557 | 23,671 | 2 / 3 / 0 | 17 | 35 |
| `xai.grok-4.3` (Mantle) | sentinel | 8.7s | 81 **fail** | 10 pass | 128,030 | 474 | 23,214 | 2 / 2 / 0 | 9 | 7 |
| `xai.grok-4.3` (Mantle) | stripped | 10.3s | 86 pass | 9 pass | 155,978 | 528 | 23,662 | 3 / 2 / 0 | 14 | 75 |

`grok-4.20` is `grok-4.20-0309-non-reasoning`. Codex runs at low reasoning,
priority tier. The script defaults to temperature 0.4 for `grok-4.3`,
`grok-4.20`, and `gemini-3.1-flash-lite`, and Gemini Flash-Lite to thinking
`minimal` (see `compact-full-transcript.mjs`). A non-conforming block -- a
multi-line or leading-marker "bullet", or a `code_block` -- is coerced to a
paragraph before local validation, so a single malformed block no longer aborts
the run; the earlier `summary_blocks[i].body must be a single bullet item` retry
is gone (regression test: `scripts/test-bullet-normalization.mjs`). `grok-4.3`
clears the deterministic gate with `--reasoning-effort medium` (~85); at the
default with no reasoning it stays borderline (81-84).

## Forcing completeness: density-gated reask

The two single-shot lanes that fail the deterministic gate fail on recall
density, not prose (judge 10/10): thin evidence capsules, few cited lines, and
dropped required literals. `--max-reasks N` (default 0, opt-in) closes this with
a post-parse validate-and-reask loop: after each attempt it scores handoff
density (`scripts/handoff-density.mjs`), and on a shortfall re-requests the
provider with specific corrective feedback up to N times, keeping the densest
attempt. It enforces density after parsing rather than via schema `minItems`,
which AWS Bedrock rejects with a 400 and Gemini Flash-Lite ignores at decode time
(see `docs/prompt-adaptation/design.md`, prior art Instructor / Guardrails /
oh-my-openagent). With `--max-reasks 2` both failing lanes clear the gate and
recover every missing literal:

| Lane | Single-shot | `--max-reasks 2` | Capsules | Missing literals |
|---|---|---|---:|---|
| `xai.grok-4.3` (Mantle) sentinel | 81 **fail** | **92 pass** | 9 -> 40 | 1 -> 0 |
| `gemini-3.1-flash-lite` stripped | 79 **fail** | **91 pass** | 17 -> 29 | 2 -> 0 |

Default `--max-reasks 0` leaves the request byte-identical (the provider dry-run
parity gate still passes); only lanes that fall short pay for reasks. Regression
test: `scripts/test-reask-loop.mjs`. Run artifacts:
`runs/bench-mantle-sentinel-reask`, `runs/bench-g31lite-stripped-reask`.

## Forcing completeness: dynamic per-provider/model prompt mutation

A second, complementary lever shapes the FIRST request instead of correcting a
thin one. `--adapt-prompt` (default off) appends model-specific completeness
augmentations chosen by provider/model traits
(`scripts/prompt-adaptation.mjs`), matching documented best practices: the same
model-gated prompt selection oh-my-openagent (`createMetisAgent`) and openclaw
(`GPT5_BEHAVIOR_CONTRACT`) use. grok-4.3 on Bedrock gets a prompt-side count
floor (Bedrock rejects schema `minItems>1`) plus xAI "mine the transcript" and
literal-preservation directives; flash-lite gets non-reasoning decomposition plus
a Gemini concision-counter; strong models (codex, gemini-flash) get nothing and
stay byte-identical. Cited evidence: `docs/prompt-adaptation/provider-prompting.md`
(10-agent workflow, 30 findings).

The two levers stack. Measured on grok-4.3 sentinel (single-shot baseline 81/9
capsules):

| Config | Deterministic | Capsules | Missing literals |
|---|---|---:|---|
| single-shot | 81 **fail** | 9 | 1 |
| `--adapt-prompt` only | 82 fail | 25 | 2 |
| `--max-reasks 2` only | 92 pass | 40 | 0 |
| `--adapt-prompt --max-reasks 2` | **93 pass** | 41 | 0 |

Prompt mutation alone roughly triples evidence density (9 -> 25 capsules, 7 -> 23
cited lines) but does not clear the gate for the weakest model; the reask loop
closes the gap, and the two together score highest. Regression test:
`scripts/test-prompt-adaptation.mjs`. Run artifacts: `runs/bench-*-adapt`,
`runs/bench-mantle-sentinel-adapt-reask`.

## Reading the two scores

- **Deterministic /100 (gate):** code-only checks (artifacts, hashes, spans,
  required literals, state counts, footprint). The gate passes at >= 85 with no
  hard failure.
- **Judge /10 (verdict):** the v3 semantic judge's `total_level_score` (sum of
  five dimensions on absent/partial/clear) with `overall_pass`. A handoff fails
  if any dimension is absent, even when the deterministic gate passes. The two
  layers are meant to disagree: structural soundness is not continuation
  readiness. Under the tuned flash-lite defaults (temperature 0.4, thinking
  `minimal`) the disagreement now runs the other way: the stripped lane scores a
  perfect 10/10 judge yet fails the deterministic gate (79/100), while sentinel
  passes both (86/100, 9/10).

## Routing

1. **Default quality:** `gemini-3.5-flash` (either renderer) — 10/10 judge,
   92/100 deterministic, ~18-22s.
2. **Highest quality:** `gpt-5.4` (codex, either renderer) — top deterministic
   and 10/10 judge, when ~32-40s latency is acceptable.
3. **Fast lane:** `gemini-3.1-flash-lite` with the **sentinel** renderer
   (temperature 0.4, thinking `minimal`) — ~3.4s, 86/100 deterministic and 9/10
   judge, both passing. Do not pair flash-lite with stripped under the tuned
   defaults: that lane fails the deterministic gate (79/100) despite a 10/10
   judge.
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
`g35flash-stripped`, `xai-sentinel`, `xai-stripped`,
`g31lite-t04-min-sentinel`, `g31lite-t04-min-stripped`, `mantle-sentinel`,
`mantle-stripped`. Deterministic scores are reproduced with
`node scripts/score-compaction-result.mjs runs/bench-<lane>`.

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
