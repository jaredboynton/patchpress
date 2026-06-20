# EXP-07 Sufficiency And Fact Scorecard

## Result

Accepted.

EXP-07 adds `scripts/score-compaction-result.mjs`, a deterministic scorecard for
artifact integrity, state retention, exact literal recovery, unsupported
high-risk literals, and footprint. It uses a fixture file rather than a live
judge so it can run in CI and before provider-native experiments.

## Fixture

`docs/experiments/fixtures/devin-reverse-engineering.v1.json` requires:

- 8 user intent events;
- 50 evidence capsules for full baseline runs;
- verified manifest hashes;
- integrity echo;
- exact recovery of the five EXP-06 literals.

## Commands

```sh
node scripts/score-compaction-result.mjs \
  runs/exp07-selected-baseline-noapi \
  --out runs/exp07-scorecard-noapi/current-baseline.score.json \
  --markdown runs/exp07-scorecard-noapi/current-baseline.score.md

node scripts/score-compaction-result.mjs \
  runs/exp05-schema-split-noapi \
  runs/exp06-multi-round-degradation-noapi/round-005 \
  runs/exp06-multi-round-degradation-noapi/round-010 \
  runs/exp06-multi-round-degradation-noapi/round-020 \
  --out runs/exp07-scorecard-noapi/scorecard.json \
  --markdown runs/exp07-scorecard-noapi/benchmark-results.md
```

## Scores

| Run | Score | Tokens | Evidence | User Events | Missing Literals | Bad Hashes |
|---|---:|---:|---:|---:|---:|---:|
| Current selected baseline | 100/100 | 23,022 | 50 | 8 | 0 | 0 |
| EXP-05 schema split | 100/100 | 21,261 | 50 | 8 | 0 | 0 |
| EXP-06 round 5 | 90/100 | 5,466 | 27 | 8 | 0 | 0 |
| EXP-06 round 10 | 90/100 | 5,481 | 27 | 8 | 0 | 0 |
| EXP-06 round 20 | 90/100 | 5,511 | 27 | 8 | 0 | 0 |

The multi-round scores lose 10 state-retention points because repeated
compactions collapse raw evidence capsule count from 50 to 27. They still pass
because exact literals, user intent, objective, next step, manifest integrity,
and unsupported-claim checks hold.

## Decision

Keep EXP-07 and require the scorecard before accepting future renderer or
provider-native compaction experiments.
