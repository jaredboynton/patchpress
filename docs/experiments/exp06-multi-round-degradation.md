# EXP-06 Multi-Round Degradation Gate

## Result

Accepted.

EXP-06 adds a deterministic no-API degradation harness that compacts once from
the frozen GPT-5.4 output, then repeatedly recompacts from canonical
`handoff-state.json` using synthetic model outputs. This tests whether the
handoff substrate survives repeated compaction without spending live model calls.

The first smoke run failed: exact literals that lived only in sidecar evidence
were lost by round 2. The accepted implementation adds a bounded model-visible
`## Evidence Index` to `handoff.md`, derived from verified rehydrated spans and
carried forward exactly on later rounds.

## Command

```sh
node scripts/test-multi-round-compaction.mjs \
  --rounds 5,10,20 \
  --out-dir runs/exp06-multi-round-degradation-noapi \
  --preserve-tail 0
```

## Metrics

| Round | Tokens | Bytes | Records | Evidence | User Events | Bad Hashes | Missing Literals | Gate |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 5,508 | 22,567 | 2 | 50 | 8 | 0 | 0 | pass |
| 5 | 5,466 | 22,400 | 2 | 27 | 8 | 0 | 0 | pass |
| 10 | 5,481 | 22,460 | 2 | 27 | 8 | 0 | 0 | pass |
| 20 | 5,511 | 22,580 | 2 | 27 | 8 | 0 | 0 | pass |

## Gates

- High-priority user intent hashes preserved through round 20.
- Current objective hash preserved through round 20.
- Next-step hash preserved through round 20.
- Exact literals preserved: `/Users/jaredboynton/__devlocal/devin-decompile/docs/03-endpoints.md`,
  `uv run`, `unicorn`, `HTTPS_PROXY`, `application/proto`.
- Manifest hashes verified at each checkpoint.
- Integrity echo stayed true.
- Round-20 token growth stayed within the 10% gate.

## Selection Impact

The Evidence Index increases the default-tail current baseline to 23,022
estimated tokens, up from EXP-05's 21,261. The tradeoff is accepted because it
turns exact-literal recovery from a one-round sidecar property into a stable
multi-round handoff property.
