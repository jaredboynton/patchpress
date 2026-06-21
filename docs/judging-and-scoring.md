# Judging And Scoring

This repo uses two separate scores:

- the deterministic score: code-only checks for artifacts, hashes, source spans,
  required literals, state counts, and footprint.
- the LLM judge (`total_level_score` and `overall_pass`): a GPT-5.5 review of the
  rendered handoff a fresh agent receives as operating memory.

The split is intentional. Counts, hashes, schema validity, exact strings, and
token footprint are deterministic. The LLM judge is reserved for semantic
quality: whether `handoff.md` plus hydrated evidence lets the next agent
continue safely toward the current goals, promises, rules, and proof loop.

## Research Evidence

- Arize's May 2026 LLM-as-judge guidance says to use code evaluators for
  deterministic checks such as schema validity, exact match, regex match,
  latency, token count, tool names, and required fields, and to reserve LLM
  judges for semantic checks such as correctness, faithfulness, task
  completion, and tool appropriateness.
  Source: https://arize.com/blog/how-to-build-llm-as-a-judge-evaluators-that-hold-up-in-production/
- DeepEval's June 2026 guide separates custom semantic judges from DAG-style
  deterministic branches. It recommends explicit evaluation steps when criteria
  become important for CI and DAG-style hard gates when outputs are missing
  required structure.
  Source: https://deepeval.com/blog/llm-as-a-judge
- Factory's context-compression benchmark evaluates compaction by functional
  probes: recall, artifact, continuation, decision, completeness, continuity,
  and instruction following. It also reports that compression ratio alone is the
  wrong metric because the useful question is whether the compacted state lets
  the agent continue without expensive re-fetching.
  Source: https://factory.ai/news/evaluating-compression
- Recent operational-memory guidance argues that autocompaction should be
  tested as a structured handoff contract: objective, constraints, approvals,
  exact values, actions taken, errors/fixes, next safe step, and proof loop.
  The proposed gate is a blind resume check from the handoff alone.
  Source: https://gregshevchenko.com/notes/autocompaction-is-not-memory/
- Repo-backed prior art in `lastmile-ai/mcp-eval` separates immediate content
  and LLM judge checks from deferred tool/path/performance metrics that require
  full session traces.
  Source: https://github.com/lastmile-ai/mcp-eval/blob/main/GUIDE.md
- Repo-backed prior art in `microsoft/eval-recipes` shows a semantic-test
  evaluator with a rubric score, while still expressing file existence,
  recursion use, and correctness as explicit rubric criteria that can be tested
  by an auditor agent.
  Source: https://github.com/microsoft/eval-recipes/blob/main/llms.txt
- Repo-backed prior art in `IyadhKhalfallah/clauditor` uses Claude Code hooks
  around compaction, including `PreCompact` state capture, `PostCompact`
  merging of Claude's summary with mechanical transcript state, and
  `SessionStart` handoff injection.
  Source: https://github.com/IyadhKhalfallah/clauditor/blob/main/README.md
- OpenAI Codex exposes compact hooks and a compact API path; this supports
  treating compaction as a lifecycle event with structured state around it
  rather than as an opaque prose summary only.
  Source: https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/compact.rs

## Implementation Plan

- [x] Split the scorecard into two named outputs: deterministic score and LLM
  judge score.
- [x] Keep capsule counts, cited spans, required literals, hashes, schema
  validity, and token footprint out of the LLM judge.
- [x] Make deterministic scoring graduated so `46` evidence capsules ranks
  above `7` evidence capsules instead of both losing the same binary points.
- [x] Add a semantic judge score using a strict JSON schema and GPT-5.5 medium
  reasoning.
- [x] Judge only the rendered handoff a fresh agent receives, across five
  continuation dimensions: goal intent fidelity, next-step actionability,
  constraint and promise preservation, state and artifact recoverability, and
  faithfulness.
- [x] Score each dimension on a 3-level anchored scale (absent/partial/clear)
  with an evidence quote and reason required before the level, and make
  faithfulness a hard sub-gate.
- [x] Validate judge outputs locally: candidate hashes must match, each dimension
  must appear exactly once with a non-empty evidence quote, and the aggregate is
  recomputed in code so the model's self-reported total stays advisory.
- [x] Run multiple judge trials and aggregate by per-dimension median to damp
  single-sample variance.
- [x] Prove the judge discriminates with a failable perturbation meta-validation.
- [x] Update benchmark and experiment docs so current routing reports both
  scores and no longer presents the old single-score table as current reality.

## Deterministic Score

Script: `scripts/score-compaction-result.mjs`

Schema: `deterministic-compaction-score.v2` (max 100)

| Category | Max | What Code Checks |
|---|---:|---|
| `artifact_integrity` | 25 | run success, manifest artifact hashes, artifact-hash validation, no bad evidence capsules |
| `evidence_grounding` | 15 | evidence-capsule coverage, cited-line coverage, non-empty text segments, no invalid spans |
| `continuity_state` | 20 | user-intent events, active objective, next step, and at least one rule, plan item, and promise |
| `exact_literal_recovery` | 20 | required fixture literals appear in `summary.rehydrated.md` |
| `unsupported_claims` | 10 | no high-risk literal lives only in hidden state while missing from the readable handoff |
| `footprint` | 10 | non-empty compact output and after-token estimate within the configured bound (`max_after_estimated_tokens`, set to the 23,022-token accepted baseline; defaults to 6000 when the fixture omits it) |

`state_retention` is also reported as a roll-up of `evidence_grounding` +
`continuity_state` (max 35).

The score is a deterministic quality/risk signal, not a semantic proof. The gate
(`gate_pass`) requires a score of at least `85` and no hard failure: the run
succeeded, manifest hashes verify, no bad or empty evidence capsules, no invalid
spans, no missing required literals, and the state carries a current objective
and a next step.

## LLM Judge Score

Script: `scripts/judge-compaction-result.mjs`

Schema: `semantic-compaction-judge-output.v3`

The judge evaluates the rendered handoff (`handoff.md`) as the operating memory a
fresh agent actually receives. The canonical state and rehydrated evidence are
supplied as ground truth the next agent does not see: the judge uses them to
verify faithfulness and to detect continuation-critical omissions from the
handoff. The rendered-handoff copies inside the state (`summary_markdown`,
`rendered_handoff`, `summary_blocks`) are withheld from the ground-truth view, so
a section dropped from the handoff cannot appear present.

Judge defaults:

| Field | Value |
|---|---|
| Provider | Codex Responses backend |
| Model | `gpt-5.5` |
| Reasoning | `medium` |
| Service tier | `priority` |
| Trials | `3`, aggregated by per-dimension median (`--trials` / `CODEX_JUDGE_TRIALS`) |

Rubric dimensions, each scored independently:

| Dimension | What The Judge Scores |
|---|---|
| `goal_intent_fidelity` | Captures the current objective and latest user intent without reviving stale or reframed goals. |
| `next_step_actionability` | A fresh agent could take the next concrete action without re-deriving it; the next step is specific and correct given the state. |
| `constraint_promise_preservation` | Durable rules, constraints, promises, approvals, and do-not-redo instructions that affect continuation are present and not weakened. |
| `state_artifact_recoverability` | Done and active work, active files, artifacts, validation results, and per-task status are recoverable from the handoff. |
| `faithfulness` | Every material claim is supported by the evidence, with no internal contradiction, unsupported completion claim, or stale state presented as current. |

Scale: a 3-level anchored ordinal per dimension, `absent` (0) / `partial` (1) /
`clear` (2). The judge must give an `evidence_quote` and `reason` before choosing
the level and is instructed to ignore length and formatting. `total_level_score`
is the sum of dimension levels (max `10`), recomputed in code; the model's
self-reported total is advisory.

`overall_pass` is true only when `faithfulness` is not `absent`, no other
dimension is `absent`, and `total_level_score >= 8`. Faithfulness is a hard
sub-gate: a single unsupported or contradicted claim fails the handoff regardless
of the other dimensions.

### Reliability and meta-validation

Single-sample reasoning-model judging has real run-to-run variance, so the judge
runs `JUDGE_TRIALS` independent passes (fresh session each) and takes the
per-dimension median, then recomputes the outcome from the aggregated levels.

`scripts/test-judge-discrimination.mjs` is a failable meta-validation. From a
known-good handoff it builds targeted degrading perturbations (drop the next
action, drop durable constraints, strip artifact references, inject an
overstatement, drift a path) and quality-preserving ones (reformat headers,
restyle bullets), then requires every degrading variant to score below the clean
parent and no preserving variant to be penalized. It first checks the base is
rated fully `clear`; a base the judge already finds defective is rejected rather
than used as a known-good parent.

## Validation Commands

```sh
node --check scripts/score-compaction-result.mjs
node --check scripts/judge-compaction-result.mjs
node scripts/score-compaction-result.mjs runs/<run-dir>
node scripts/judge-compaction-result.mjs runs/<run-dir> --dry-run
node scripts/judge-compaction-result.mjs runs/<run-dir>
node scripts/test-judge-discrimination.mjs --run-dir runs/<clean-run-dir>
```
