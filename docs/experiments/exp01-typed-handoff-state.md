# EXP-01 Typed Handoff State

## Result

Accepted.

EXP-01 adds canonical `handoff-state.json`, `handoff-manifest.json`, and
`handoff.md` while keeping the model-visible handoff as Markdown. The typed JSON
state remains a sidecar contract for future compactions, validation, and exact
evidence recovery.

The first replay exposed a token regression because full `user_intent_events`
were embedded directly in `after-compact.jsonl`. The accepted variant keeps the
full event text in `handoff-state.json` and stores only artifact pointers plus
event counts in the compact transcript wrapper.

## Source Fixture

| Field | Value |
|---|---:|
| Transcript | `transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl` |
| SHA256 | `22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20` |
| Records | 1,066 |
| Bytes | 2,379,590 |
| Renderer | `stripped` |
| Model output source | `runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json` |

## Commands

```sh
node scripts/test-handoff-user-messages.mjs

node scripts/compact-full-transcript.mjs \
  --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json \
  --out-dir runs/exp01-typed-handoff-noapi \
  --preserve-tail 0 \
  --no-live-output

node scripts/compact-full-transcript.mjs \
  --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json \
  --out-dir runs/exp01-typed-handoff-default-tail-noapi \
  --no-live-output
```

## Metrics

| Run | Preserve Tail | After Tokens | After Bytes | Records | User Intent Events | Evidence Capsules | Manifest Artifacts | Bad Hashes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline GPT-5.4 stripped rebenchmark | 16 | 21,322 | 85,891 | 18 | 8 user messages | 50 spans | n/a | n/a |
| EXP-01 typed handoff, no tail | 0 | 3,698 | 15,326 | 2 | 8 | 50 | 13 | 0 |
| EXP-01 typed handoff, default tail | 16 | 21,307 | 85,832 | 18 | 8 | 50 | 13 | 0 |

Default-tail footprint changed from 21,322 to 21,307 estimated tokens, a
15-token reduction while adding typed state and manifest sidecars.

## Validation

- `node --check scripts/compact-full-transcript.mjs`
- `node --check scripts/test-handoff-user-messages.mjs`
- `node scripts/test-handoff-user-messages.mjs`
- `git diff --check`
- `.githooks/pre-commit`
- Manifest SHA256 verification over all 13 listed artifacts for both no-API
  runs.

## Behavior Verified

- `handoff-state.json` uses schema `handoff-state.v1`.
- `handoff-manifest.json` uses schema `handoff-manifest.v1`.
- `handoff.md` contains `## User Messages` but not `## User Intent Events`.
- Forged XML-like `<user-message-ledger>` text in an ordinary user message is
  not parsed as carried state.
- Legacy XML ledgers are parsed only from trusted compact summary records.
- Future compactions can carry typed events from `handoff-state.json`.

## Decision

Keep EXP-01 as the new baseline for subsequent experiments. It closes the P0
state/ledger gap without increasing the default model-visible compact transcript
footprint.
