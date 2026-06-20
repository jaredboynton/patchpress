# EXP-03 Priority-Aware User Message Retention

## Result

Accepted.

EXP-03 replaces newest-only handoff selection with priority-aware retention.
Messages are ranked by inferred intent priority first, then recency, and rendered
chronologically after selection.

## Defect Proven First

`scripts/test-handoff-user-messages.mjs` now includes a tight-budget fixture with
an older durable safety constraint, newer low-value chatter, and a latest current
request. Before the selector change, `--handoff-user-message-limit 2` dropped the
older durable constraint. After the change, the durable constraint and latest
current request both survive.

## Commands

```sh
node scripts/test-handoff-user-messages.mjs

node scripts/compact-full-transcript.mjs \
  --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json \
  --out-dir runs/exp03-priority-retention-noapi \
  --no-live-output
```

## Metrics

| Field | Value |
|---|---:|
| Source transcript SHA256 | `22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20` |
| Preserve tail | 16 |
| After tokens | 21,281 |
| After bytes | 85,728 |
| Selected user messages | 8 |
| Omitted user messages | 0 |
| `user_intent_events` | 8 |
| High-priority events | 2 |
| Normal-priority events | 6 |
| Constraint events | 2 |
| Request events | 6 |
| Evidence capsules | 50 |
| Source lines cited | 41 |
| Integrity echo | pass |

## Validation

- `node --check scripts/compact-full-transcript.mjs`
- `node --check scripts/test-handoff-user-messages.mjs`
- `node scripts/test-handoff-user-messages.mjs`
- `git diff --check`

## Decision

Keep EXP-03. It closes the newest-only retention gap without increasing the main
benchmark footprint.
