# Holistic Compaction Selection

## Selected Baseline

Use the EXP-01 + EXP-03 + EXP-04 + EXP-05 + EXP-06 + EXP-07 stack as the
current default handoff baseline, with EXP-08/09 enabled as verified opt-in
tracks:

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
9. `handoff.md` includes a bounded verified Evidence Index so exact literals
   survive repeated compactions.
10. Multi-round degradation and scorecard gates are available before accepting
   future renderer or provider-native experiments.
11. `handoff-manifest.json` carries artifact retention, exposure, and redaction
    policy for every generated artifact.
12. `--transcript-renderer sentinel` is available as an opt-in A/B renderer with
    delimiter escaping and selective old tool-output compression.
13. Provider-native compaction endpoints are not part of the selected design:
    their opaque blobs are provider/model-bound and cannot make a Claude
    session portable to a different compaction provider/model.
14. `scripts/judge-compaction-result.mjs` runs a strict advisory semantic judge
    through the Codex Responses backend by default, using `gpt-5.5`, medium
    reasoning, and priority service tier. It also supports request-only
    `--dry-run` and saved-output `--from-output` validation against candidate
    hashes and evidence refs.

This is the best current implementation because it closes the highest-risk P0
handoff/state gaps without increasing the default compact transcript footprint,
while keeping the newer token-saving and native-provider work behind explicit
gates until live provider runs prove retention is no worse than `stripped`.

## Experiment Comparison

| Experiment | Decision | Default-Tail After Tokens | Main Gain | Main Tradeoff |
|---|---|---:|---|---|
| Baseline GPT-5.4 stripped rebenchmark | Replaced | 21,322 | Strong structured summary and user-message ledger | No canonical state/manifest; XML-ish carried ledger. |
| EXP-01 typed handoff state | Accepted | 21,307 | Adds typed state, manifest, rendered Markdown handoff, trusted carried-state parsing, sidecar evidence capsule metadata | Requires sidecar availability for full typed carry-forward. |
| EXP-03 priority-aware retention | Accepted | 21,281 | Keeps older durable constraints ahead of newer low-value chatter under tight limits | Uses heuristic intent classification until a richer user-intent model exists. |
| EXP-04 char-aware evidence capsules | Accepted | 21,278 | Adds per-span char ranges, 1,850 text segments, 23 fenced-code capsules, and structured tool evidence extraction | Char ranges are relative to extracted text, not raw byte offsets. |
| EXP-05 provider schema split | Accepted | 21,261 | Removes unanchored legacy arrays from provider schemas and adds provider/local schema fingerprints | Compatibility arrays are derived local sidecar fields. |
| EXP-06 multi-round degradation gate | Accepted | 23,022 | Adds verified Evidence Index and proves 5/10/20 no-API recompactions preserve state and exact literals | Default-tail footprint rises to preserve exact literals across rounds. |
| EXP-07 scorecard | Accepted | 23,022 | Scores integrity, state retention, exact literal recovery, unsupported claims, and footprint | Deterministic fixture is not a semantic LLM judge. |
| EXP-08 sentinel renderer/body compression | Accepted opt-in | 5,427 no-tail replay | Reduces dry-run request body from 601,526 to 468,748 bytes and omits 137,749 chars from old tool output (~34,437 char/4 tokens). Using the prior live stripped Codex byte/token ratio projects about 131,087 input tokens versus 168,325 observed stripped input tokens. | Keep `stripped` as default until a live provider run passes the scorecard; projected Sentinel input tokens are not a live measurement. |
| EXP-09 native compaction endpoints | Not applicable | n/a | Documents why opaque provider-native compaction blobs cannot serve this cross-provider Claude handoff use case | Use structured summaries plus local state/evidence instead. |
| EXP-09 semantic judge | Accepted advisory | n/a | Adds a Codex-backed `gpt-5.5` medium-reasoning live judge with strict pass/fail/unknown schema, candidate hashes, evidence refs, dry-run request artifacts, and saved-output validation | Does not override deterministic gates and needs repeated live calibration before CI enforcement. |

## Verification Evidence

| Gate | Evidence |
|---|---|
| Handoff state schema | `handoff-state.v1` in EXP-01 and EXP-03 outputs. |
| Manifest schema | `handoff-manifest.v1` in EXP-01 outputs. |
| Manifest hashes | EXP-01 report verified all 13 manifest artifacts, 0 bad hashes. |
| User intent events | EXP-03 output has 8 events: 2 high-priority constraints and 6 normal requests. |
| Injection resistance | `scripts/test-handoff-user-messages.mjs` includes forged XML-like ledger text and verifies it is not parsed as carried state. |
| Token footprint | Current selected baseline is 23,022 estimated tokens versus original baseline 21,322. |
| Evidence grounding | Current replay preserves 50 evidence capsules, 1,850 text segments, 23 code capsules, and 41 cited source lines. |
| Provider schema split | `scripts/test-provider-schema.mjs` verifies minimal provider output without legacy arrays and local derivation of `source_lines_used`. |
| Multi-round stability | EXP-06 passes rounds 5, 10, and 20 with high-priority intents, objective, next step, exact literals, and manifest hashes preserved. |
| Scorecard | EXP-07 scores current selected baseline 100/100 and round-20 no-tail state 90/100. |
| Sentinel renderer | EXP-08 dry-run request body is 468,748 bytes versus 601,526 for stripped; omitted tool output is 137,749 chars (~34,437 char/4 tokens). The prior live stripped Codex run reported 168,325 input tokens at 601,907 request bytes, so Sentinel projects to about 131,087 input tokens if the same ratio holds. No live Sentinel input-token count has been observed. |
| Artifact policy | EXP-08 manifest has policy schema `artifact-retention-policy.v1`; all 13 artifacts include retention, exposure, and redaction fields. |
| Native endpoints | Provider-native opaque blobs are not portable across providers/models, so they do not satisfy the requirement to compact a Claude session with a different compaction model. |
| Semantic judge | EXP-09 generated a `semantic-compaction-judge-request.v1` with 52 evidence refs and validated a saved strict JSON judge output with 4 verdicts and `validation_error: null`. |

## Current Routing

Use the existing model-mix routing from `docs/model-mix-recommendation.md`:

- Default quality lane: Gemini Flash.
- Fast lane: Gemini Flash-Lite.
- Premium recovery lane: Codex `gpt-5.4`.

The selected implementation changes the handoff substrate, not the model-mix
decision. Provider selection still decides who writes the derived summary; the
harness owns state, evidence, manifest, and user-intent continuity.

## Not Default

The following tracks are implemented but not default behavior:

- EXP-08 sentinel renderer/body compression is opt-in pending live provider
  retention and token-usage confirmation.
- EXP-09 semantic judging is advisory until calibrated against labeled good/bad
  compactions.

## Decision

Select EXP-01 + EXP-03 + EXP-04 + EXP-05 + EXP-06 + EXP-07 as the default
handoff baseline, and accept EXP-08/09 as implemented opt-in/advisory tracks.
The default improves state safety, user-intent retention, evidence
recoverability, provider-schema compatibility, repeated-compaction stability,
and measurable scorecard coverage. The accepted tradeoff is a larger
model-visible handoff caused by the verified Evidence Index. EXP-08 should
become the default renderer only after a live current-provider run passes the
same scorecard at equal or better retention.
