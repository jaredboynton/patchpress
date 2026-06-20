# Compaction Benchmark Results

Run: `runs/compact-user-messages-live-2026-06-20`

## Settings

- model: `gpt-5.4`
- service tier: `priority`
- reasoning effort: `low`
- source transcript: 1066 records, 2,379,590 bytes, ~593,956 tokens

## Compaction Ratio

| Output | Est. tokens | Ratio | Reduction |
|---|---:|---:|---:|
| summary.md | 2,168 | 273.96:1 | 99.63% |
| summary.timeline.md | 3,638 | 163.26:1 | 99.39% |
| summary.rehydrated.md | 41,261 | 14.4:1 | 93.05% |
| after-compact.jsonl | 20,252 | 29.33:1 | 96.59% |

## Fact Retention

Method: deterministic structural retention checks, not semantic recall scoring.

| Check | Result |
|---|---:|
| integrity echo matches | true |
| user-message hashes match | true |
| full user text recoverable | true |
| user messages extracted | 8 |
| long user messages collapsed | 1 |
| summary blocks | 5 |
| rules and invariants | 6 |
| current rules and invariants | 5 |
| plans and task-state items | 10 |
| rehydrated spans | 59 |
| source lines cited | 69 |
| legacy model user messages discarded | 0 |

## Speed

| Metric | Value |
|---|---:|
| wall time | 145.95s |
| input tokens | 890,616 |
| output tokens | 5,231 |
| total tokens | 895,847 |
| output tokens/sec | 35.84 |
| total tokens/sec | 6138.04 |

## Artifacts

- `runs/compact-user-messages-live-2026-06-20/summary.md`
- `runs/compact-user-messages-live-2026-06-20/summary.timeline.md`
- `runs/compact-user-messages-live-2026-06-20/summary.rehydrated.md`
- `runs/compact-user-messages-live-2026-06-20/user-messages.json`
- `runs/compact-user-messages-live-2026-06-20/result.json`
