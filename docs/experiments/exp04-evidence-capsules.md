# EXP-04 Char-Aware Evidence Capsules

## Result

Accepted.

EXP-04 upgrades record-range evidence into richer local sidecars. The model still
selects one-based JSONL record spans, but the harness now derives per-span
character ranges, per-record text segments, and typed fenced-code capsules with
exact and normalized hashes.

## Defect Proven First

The focused handoff test was extended with a raw fenced code block and a
structured Claude `tool_use` record. The pre-implementation test failed because
capsules had no `char_range`, no `text_segments`, and no code capsules.

The first full replay then exposed a real transcript edge case: structured
`tool_use` / `tool_result` records were being treated as blank evidence. The
extractor now serializes those structured parts into evidence text before
hashing and segmenting.

## Source Fixture

| Field | Value |
|---|---:|
| Transcript | `transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl` |
| SHA256 | `22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20` |
| Records | 1,066 |
| Bytes | 2,379,590 |
| Renderer | `stripped` |
| Model output source | `runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json` |
| Live model call | no |

## Commands

```sh
node --check scripts/compact-full-transcript.mjs
node --check scripts/test-handoff-user-messages.mjs
node scripts/test-handoff-user-messages.mjs

node scripts/compact-full-transcript.mjs \
  --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json \
  --out-dir runs/exp04-evidence-capsules-noapi \
  --no-live-output
```

## Metrics

| Run | Preserve Tail | After Tokens | After Bytes | Records | Evidence Capsules | Text Segments | Code Capsules | Bad Hashes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| EXP-03 priority baseline | 16 | 21,281 | 85,728 | 18 | 50 | n/a | n/a | 0 |
| EXP-04 evidence capsules | 16 | 21,278 | 85,715 | 18 | 50 | 1,850 | 23 | 0 |

## Additional Signals

| Field | Value |
|---|---:|
| Source lines cited | 41 |
| User intent events | 8 |
| Selected user messages | 8 |
| Omitted user messages | 0 |
| Manifest artifacts verified | 13 |
| Integrity echo | pass |
| No-API replay duration | 74 ms |

## Validation

- `node --check scripts/compact-full-transcript.mjs`
- `node --check scripts/test-handoff-user-messages.mjs`
- `node scripts/test-handoff-user-messages.mjs`
- Manifest SHA256 verification over all 13 listed artifacts.
- Recomputed `raw_slice_sha256` and `extracted_text_sha256` for all 50 spans.
- Literal recovery checks in `summary.rehydrated.md` for paths, commands, env
  vars, and MIME strings.

## Caveats

- `raw_slice_sha256` hashes the harness's canonical reserialized JSONL records,
  not original byte offsets from the source file.
- `char_range` is relative to extracted span text, not raw transcript bytes.
- `code_capsules` are limited to fenced code blocks. Inline commands and errors
  remain recoverable through text segments, not typed command capsules.

## Decision

Keep EXP-04 and make EXP-01 + EXP-03 + EXP-04 the selected baseline. It closes
the record-only evidence gap without increasing the model-visible compact
transcript footprint.
