# Gemini Compaction Benchmark Results

Run: `runs/compact-gemini-35-flash-live-2026-06-20`

## Settings

- provider: `gemini`
- model: `gemini-3.5-flash`
- thinking level: `low`
- source transcript: 1066 records, 2,379,590 bytes, ~593,956 char/4 tokens

## Compaction Ratio

| Output | Est. tokens | Ratio | Reduction |
|---|---:|---:|---:|
| summary.md | 803 | 739.67:1 | 99.86% |
| summary.timeline.md | 2,122 | 279.9:1 | 99.64% |
| summary.rehydrated.md | 22,805 | 26.04:1 | 96.16% |
| after-compact.jsonl | 18,789 | 31.61:1 | 96.84% |

## Fact Retention

Method: deterministic structural retention checks, not semantic recall scoring.

| Check | Result |
|---|---:|
| integrity echo matches | true |
| user messages extracted | 8 |
| long user messages collapsed | 1 |
| summary blocks | 4 |
| rules and invariants | 4 |
| current rules and invariants | 4 |
| plans and task-state items | 2 |
| rehydrated spans | 15 |
| source lines cited | 17 |
| legacy model user messages discarded | 0 |

## Speed

| Metric | Value |
|---|---:|
| wall time | 124.41s |
| prompt tokens | 1,016,973 |
| output tokens | 3,275 |
| thoughts tokens | 7,736 |
| total tokens | 1,027,984 |
| output tokens/sec | 26.32 |
| total tokens/sec | 8263.07 |

## Artifacts

- `runs/compact-gemini-35-flash-live-2026-06-20/summary.md`
- `runs/compact-gemini-35-flash-live-2026-06-20/summary.timeline.md`
- `runs/compact-gemini-35-flash-live-2026-06-20/summary.rehydrated.md`
- `runs/compact-gemini-35-flash-live-2026-06-20/user-messages.json`
- `runs/compact-gemini-35-flash-live-2026-06-20/result.json`
