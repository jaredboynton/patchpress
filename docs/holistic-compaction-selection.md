# Holistic Compaction Selection

## Selected Baseline

Use the EXP-01 + EXP-03 + EXP-04 + EXP-05 stack as the current holistic
baseline:

1. `handoff-state.json` is the canonical typed state.
2. `handoff-manifest.json` is the artifact/hash/security manifest.
3. `handoff.md` is the model-visible freeform Markdown handoff.
4. `after-compact.jsonl` remains only the Claude-compatible wrapper.
5. `user_intent_events` are carried through typed state, not XML-ish Markdown.
6. User-message retention is priority-aware, not newest-only.
7. Evidence capsules are emitted as verified sidecar metadata with char ranges,
   per-record text segments, and fenced-code code capsules.
8. Provider-submitted schemas are separate from local validation; compatibility
   arrays are derived locally from anchored state.

This is the best current implementation because it closes the highest-risk P0
handoff/state gaps without increasing the default compact transcript footprint.

## Experiment Comparison

| Experiment | Decision | Default-Tail After Tokens | Main Gain | Main Tradeoff |
|---|---|---:|---|---|
| Baseline GPT-5.4 stripped rebenchmark | Replaced | 21,322 | Strong structured summary and user-message ledger | No canonical state/manifest; XML-ish carried ledger. |
| EXP-01 typed handoff state | Accepted | 21,307 | Adds typed state, manifest, rendered Markdown handoff, trusted carried-state parsing, sidecar evidence capsule metadata | Requires sidecar availability for full typed carry-forward. |
| EXP-03 priority-aware retention | Accepted | 21,281 | Keeps older durable constraints ahead of newer low-value chatter under tight limits | Uses heuristic intent classification until a richer user-intent model exists. |
| EXP-04 char-aware evidence capsules | Accepted | 21,278 | Adds per-span char ranges, 1,850 text segments, 23 fenced-code capsules, and structured tool evidence extraction | Char ranges are relative to extracted text, not raw byte offsets. |
| EXP-05 provider schema split | Accepted | 21,261 | Removes unanchored legacy arrays from provider schemas and adds provider/local schema fingerprints | Compatibility arrays are derived local sidecar fields. |

## Verification Evidence

| Gate | Evidence |
|---|---|
| Handoff state schema | `handoff-state.v1` in EXP-01 and EXP-03 outputs. |
| Manifest schema | `handoff-manifest.v1` in EXP-01 outputs. |
| Manifest hashes | EXP-01 report verified all 13 manifest artifacts, 0 bad hashes. |
| User intent events | EXP-03 output has 8 events: 2 high-priority constraints and 6 normal requests. |
| Injection resistance | `scripts/test-handoff-user-messages.mjs` includes forged XML-like ledger text and verifies it is not parsed as carried state. |
| Token footprint | EXP-05 default-tail result is 21,261 estimated tokens versus baseline 21,322. |
| Evidence grounding | Current replay preserves 50 evidence capsules, 1,850 text segments, 23 code capsules, and 41 cited source lines. |
| Provider schema split | `scripts/test-provider-schema.mjs` verifies minimal provider output without legacy arrays and local derivation of `source_lines_used`. |

## Current Routing

Use the existing model-mix routing from `docs/model-mix-recommendation.md`:

- Default quality lane: Gemini Flash.
- Fast lane: Gemini Flash-Lite.
- Premium recovery lane: Codex `gpt-5.4`.

The selected implementation changes the handoff substrate, not the model-mix
decision. Provider selection still decides who writes the derived summary; the
harness owns state, evidence, manifest, and user-intent continuity.

## Not Yet Selected

The following roadmap items are still open and should be treated as future
experiments rather than current baseline behavior:

- EXP-06 multi-round degradation harness.
- EXP-07 sufficiency/fact scorecard.
- EXP-08 sentinel renderer/body compression A/B.
- EXP-09 provider-native compaction probes.

## Decision

Select EXP-01 + EXP-03 + EXP-04 + EXP-05 as the current best holistic
implementation. It improves state safety, user-intent retention, evidence
recoverability, and provider-schema compatibility while holding the compact
transcript footprint flat.
