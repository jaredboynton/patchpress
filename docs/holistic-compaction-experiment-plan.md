# Holistic Compaction Experiment Plan

This plan turns `docs/state-of-art-compaction-recommendations.md` into
incremental implementation experiments. Each experiment has a commit boundary so
git history records both the implementation and the benchmark evidence.

## Constraints

- Keep `transcript_renderer=stripped` as the comparable default until a renderer
  experiment beats it on request size and retention.
- Keep raw JSONL transcripts and full run directories ignored by default.
- Commit concise result reports or docs for every experiment.
- Prefer typed harness state over model-visible JSON. The model-visible handoff
  stays freeform Markdown rendered from structured sidecars.
- Treat raw transcript spans as authoritative evidence; prior summaries are
  lower-authority unless they point back to raw evidence.

## Experiment Sequence

| ID | Change | Gaps | Files | Benchmark Command | Commit Boundary | Selection Gate |
|---|---|---|---|---|---|---|
| EXP-01 | Add typed `handoff-state.json` with `user_intent_events`; render `## User Messages` from typed state; parse carried state only from trusted compact-summary/state records. | P0 XML-ish ledger, P0 missing canonical state | `scripts/compact-full-transcript.mjs`, `scripts/test-handoff-user-messages.mjs`, docs | `node scripts/test-handoff-user-messages.mjs && node scripts/compact-full-transcript.mjs --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json --out-dir runs/exp01-typed-handoff-noapi --preserve-tail 0 --no-live-output` | Commit tests + implementation, then commit no-API benchmark report. | Forged ledger text in ordinary user messages is ignored; carried/current counts stay correct; after-token growth is <= 5%. |
| EXP-02 | Add `handoff-manifest.json` with artifact SHA256s, schema/model fingerprints, authority labels, sensitivity labels, and validation status. Point `after-compact.jsonl` at it. | P0 no manifest, P1 artifact/security policy | `scripts/compact-full-transcript.mjs`, README/docs | `node scripts/compact-full-transcript.mjs --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json --out-dir runs/exp02-manifest-noapi --no-live-output` | Commit manifest writer/validator, then commit benchmark report. | Manifest hashes verify and locate state, evidence, and user-message sidecars without transcript search. |
| EXP-03 | Make user-message retention priority-aware: active safety/security constraints, current request, correction chain, durable preferences, recent tail, then budgeted chronology. | P1 newest-only selection | `scripts/compact-full-transcript.mjs`, `scripts/test-handoff-user-messages.mjs` | `node scripts/test-handoff-user-messages.mjs` plus a tight-budget fixture | Commit priority tests + implementation + fixture result. | Older active safety/current preference survives over newer low-value chatter under tight limits. |
| EXP-04 | Upgrade `source_spans` sidecar into evidence capsules with authority, record range, raw slice hash, extracted text hash, and validation status. Render `summary.rehydrated.md` from capsules. | P0 record-only spans | `scripts/compact-full-transcript.mjs`, docs | `node scripts/compact-full-transcript.mjs --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json --out-dir runs/exp04-evidence-capsules-noapi --no-live-output` | Commit capsule implementation, then commit no-API benchmark report. | 100% capsule hash verification; no loss in cited span count; exact paths/commands/errors recover from capsules. |
| EXP-05 | Split provider schema from local validation with `makeProviderSchema(provider)`, schema fingerprints, and local rich validation. Anchor or derive legacy arrays. | P1 unanchored arrays, provider schema quirks | `scripts/compact-full-transcript.mjs`, prompt docs | `node scripts/compact-full-transcript.mjs --dry-run --provider gemini && node scripts/compact-full-transcript.mjs --dry-run --provider mantle` | Commit schema split + dry-run evidence. | Provider requests stay valid; local validation gets stricter; unanchored filler is removed or derived. |
| EXP-06 | Add multi-round degradation harness for 5, 10, and 20 no-API compaction rounds, then live lanes after it is useful. | P0 no multi-round gate | New `scripts/test-multi-round-compaction.mjs`, docs | `node scripts/test-multi-round-compaction.mjs --rounds 5,10,20` | Commit harness + first degradation report. | No loss of active constraints, current objective, exact literals, manifest validity, or user intent precedence by round 20. |
| EXP-07 | Add sufficiency/fact scorecard for retained facts, unsupported claims, exact literal recovery, and next-step usability. | P2 structural counts only | New `scripts/score-compaction-result.mjs`, docs | `node scripts/score-compaction-result.mjs runs/<candidate>` | Commit scorer, then commit score reports. | Candidate beats baseline on retention/sufficiency without increasing unsupported claims. |
| EXP-08 | A/B sentinel renderer and selective old-tool-output body compression. | P2 XML-ish prompt renderer | `scripts/compact-full-transcript.mjs`, docs | `node scripts/compact-full-transcript.mjs --dry-run --transcript-renderer sentinel`; live Gemini lane only after dry-run win | Commit renderer, then commit A/B benchmark report. | Request bytes/tokens lower or equal; retention and validation no worse than `stripped`. |
| EXP-09 | Probe provider-native compaction only after local state and manifest exist: Anthropic native compact, OpenAI/Codex Responses compact, xAI Responses compact, Mantle probe. | P1 no native compaction path | Provider adapters, smoke scripts, docs | Provider-specific smoke, then same scorecard as EXP-07 | Commit each provider probe result, including failures. | Native lane only wins if it preserves local audit artifacts, improves latency/cost, and passes sufficiency/security gates. |

## First Experiment

Start with EXP-01. It addresses two P0 gaps at once and unlocks every later
experiment: canonical state, safe carried user intent, and model-visible
Markdown rendered from structured backing data.

The no-API benchmark uses the existing GPT-5.4 stripped rebenchmark output so
implementation regressions can be measured without a fresh model call. Live
benchmarks should be separate commits.

## Benchmark History Strategy

Raw runs remain local ignored artifacts. Each experiment should commit one of:

- a concise `docs/experiments/<experiment-id>.md` report;
- a whitelisted `runs/<experiment-id>/benchmark-results.md` plus JSON summary;
- or an update to the standardized result tables when the result changes model
  selection.

Each committed report must include:

- source transcript hash, record count, and renderer;
- provider/model/config if a live model was called;
- wall time for live runs;
- request bytes and provider token usage when available;
- summary tokens, after tokens, retention signals, and integrity status;
- validation commands and pass/fail outcome.

## Selection Rule

The final selected implementation must beat the current baseline on holistic
score, not a single metric. The scorecard should consider:

- safety and injection resistance;
- recoverability from sidecars;
- user-intent precedence;
- evidence hash validity;
- repeated-compaction stability;
- continuation sufficiency;
- latency and provider cost;
- model-visible token footprint.

## Sources

- Recommendations: `docs/state-of-art-compaction-recommendations.md`
- OpenAI compaction: https://developers.openai.com/api/docs/guides/compaction
- Anthropic compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
- xAI context compaction: https://docs.x.ai/developers/advanced-api-usage/context-compaction
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Slipstream trajectory-grounded validation: https://arxiv.org/html/2605.08580
- Context Window Lifecycle: https://arxiv.org/html/2606.11213
