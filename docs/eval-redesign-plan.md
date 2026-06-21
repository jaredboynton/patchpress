# Compaction evaluation redesign: plan, reasoning, evidence

## Principle
Two layers with a hard boundary. Anything countable, hashable, or checkable is decided in code (no LLM). The LLM judge does only the one thing it is uniquely good at: judging whether a fresh agent, reading the fully-rehydrated handoff, can continue and execute toward the stated goals, promises, and next step, and whether the handoff's claims are faithful to the rehydrated evidence.

This mirrors the current SOTA two-phase pattern: DeepMind FACTS Grounding runs a deterministic eligibility/integrity check first, then an LLM grounding grade only on what passes (https://arxiv.org/pdf/2501.03200). Factory.ai's Dec 2025 compaction eval explicitly warns that compression ratio / counts are the wrong thing to put in front of a judge and grades continuation functionally instead (https://factory.ai/news/evaluating-compression).

## Layer 1 — Deterministic gate (code, no LLM)
A hard PASS/FAIL gate plus reported metrics. The judge runs only if this passes (FACTS two-phase eligibility). Everything here is already deterministic in `validateHandoffState()` and `score-compaction-result.mjs`; this layer consolidates them as the single gate and removes these concerns from the LLM judge.

Checks (each can fail):
- Schema validity of handoff-state / manifest.
- Hash integrity: every manifest artifact hash matches; every evidence capsule `raw_slice_sha256` / `extracted_text_sha256` recomputes; `text_segments` non-empty (the citable-filter invariant).
- Citation soundness: every cited span rehydrates to non-empty text (guaranteed by the citable filter; asserted here).
- Integrity echo: `transcript_sha256` and `transcript_lines_seen` match.
- Exact-literal recovery: required fixture literals present in rehydrated evidence.
- Structural presence: >=1 rule, >=1 plan/task item, a non-empty next step, >=1 user-intent event.
- Footprint: token reduction within configured bounds (reported as tokens-per-task context, not used as a quality verdict — Factory.ai: ratio is misleading).

Output: `gate.pass` (bool) + the metric block. Metrics are reported, never sent to the LLM judge as something to "score".

## Layer 2 — LLM continuation-quality judge (the smart part)
Runs only when the gate passes. Pointwise, analytic rubric, grounded.

### Criteria (5, each scored independently)
Deduplicated against Layer 1; grounded in Factory.ai / Slipstream / Anthropic continuation dimensions.
1. **goal_intent_fidelity** — captures the current objective and the latest user intent, not a stale/reframed one (Slipstream "forward intent"; Anthropic context-reset handoff).
2. **next_step_actionability** — a fresh agent could take the next concrete action without re-deriving it; the next step is specific and correct given the state.
3. **constraint_promise_preservation** — durable rules/constraints and promises the next step depends on are present and not weakened (Slipstream dropped-constraint failure mode).
4. **state_artifact_recoverability** — done/active work, active files, and per-task status are recoverable without re-fetching. Scored explicitly because artifact/file tracking is the universally weakest dimension across production compactors (Factory.ai: 2.19-2.45/5).
5. **faithfulness** — every material claim is supported by the rehydrated evidence, with no internal contradiction or overstatement (e.g. "complete" while pending). This is the grounded check.

### Scale
3-level anchored ordinal per criterion: `absent` (0) / `partial` (1) / `clear` (2), each with a one-line behavioral anchor. No 0-100, no 1-10: narrow anchored scales calibrate best; broad scales trigger central-tendency bias (Autorubric 2026-03 https://arxiv.org/html/2603.00077; practitioner synthesis https://jatinbansal.com/ai-engineering/llm-as-judge/).

### Grounding and ordering
- Feed the rehydrated evidence inline. Cold/ungrounded judging scores near chance; grounded claim-by-claim reached 0.75 vs 0.40 (https://galtea.ai/blog/llm-as-a-judge-evaluation).
- Per criterion, require a short evidence quote and reason BEFORE the level. Reason/evidence-first cuts run-to-run variance ~3.75x (https://www.learnwithparam.com/blog/llm-judges-enforcing-reasoning; ordering effect https://arxiv.org/html/2406.02863).
- External knowledge disallowed: true-in-the-world but not in source = unsupported. Absence of evidence != support (faithfulness research synthesis).

### Faithfulness is a hard sub-gate
If `faithfulness` is `absent` (an unsupported claim or an internal contradiction), `overall_pass=false` regardless of the other criteria. Never average a hallucination away (FACTS two-phase; twine rubric guidance https://www.twine.net/blog/how-to-write-an-llm-evaluation-rubric/).

### Overall verdict
`overall_pass` = faithfulness != absent AND every other criterion >= partial AND (sum of levels) >= threshold. Report the per-criterion levels and the total; the total is a diagnostic, not a single holistic score the judge produced.

### Bias mitigation and reproducibility
- Pointwise scoring, so position bias is N/A (pairwise flips ~35% under distractors vs 9% pointwise — https://openreview.net/forum?id=uyX5Vnow3U).
- Instruct the judge to ignore length and formatting and score content only; style/verbosity bias is the dominant under-mitigated bias (https://openreview.net/forum?id=QF4lAmG4zc).
- Pin judge model + version, rubric version (hashed), temperature, trial count. Same-family caveat: codex (gpt-5.x) outputs judged by gpt-5.5 is same-family; record it and allow a `--judge-model` override for a cross-family judge.

## Meta-validation: prove the judge discriminates
This is the failable check that the judge itself works (the user's "validate that it works"). Method: FBI/DHP targeted perturbation (https://aclanthology.org/2024.emnlp-main.911/; DHP https://aclanthology.org/2025.findings-naacl.451.pdf) plus counterfactual field-ablation (Factory/Slipstream; SSTA-32 drop-a-dimension https://arxiv.org/html/2604.16752).

From a known-good handoff, deterministically construct:
- **Degrading perturbations** (judge MUST score the targeted criterion strictly lower): drop the next step; drop a durable constraint/promise; inject a contradiction/overstatement ("fully complete" while pending); factual drift (mutate a file path / entity); strip the artifact/state list.
- **Quality-preserving perturbations** (judge MUST NOT penalize): paraphrase; reformat markdown->plain; benign verbosity padding.

Pass bar: every degrading variant ranks strictly below its clean parent on the targeted criterion, and no quality-preserving variant drops below the parent. Report a separation/discernment score. Treat invariance failures (penalizing a paraphrase) as blockers.

## Implementation checklist
- [ ] L1: Add a deterministic `gate-compaction-result.mjs` (or consolidate `score-compaction-result.mjs` + `validateHandoffState`) emitting `gate.pass` + metric block; pure code, no LLM.
- [ ] L2: Rewrite the judge rubric/prompt in `judge-compaction-result.mjs`: 5 criteria, 3-level anchored scale, evidence-quote-before-level, external-knowledge-disallowed, faithfulness hard sub-gate, ignore-length/format instruction.
- [ ] L2: Update the judge output JSON schema (criteria enum, level enum absent/partial/clear, per-criterion evidence_quote + reason ordered before level) and `validateJudgeOutput`.
- [ ] L2: Feed rehydrated evidence inline in the judge request; keep hash/rubric-version echo; fix the evidence-ref allowlist so the judge cannot fail validation for citing a low-priority intent (broaden allowed refs or drop intent refs from the allowlist).
- [ ] L2: Gate the judge on L1 (skip/short-circuit judge when gate fails; FACTS eligibility).
- [ ] META: Add `test-judge-discrimination.mjs` building degrading + quality-preserving perturbations from a real handoff and asserting the separation/invariance bar.
- [ ] VALIDATE: Run the judge on the 8 lanes; run the meta-validation; record separation numbers.
- [ ] DOCS: Rewrite `docs/benchmark.md` and add `docs/eval-architecture.md` to current-state only; remove all references to prior judging methods.

## Acceptance criteria (each a failable check)
- [ ] L1 gate passes on a known-good run and fails on a hash-tampered / empty-capsule / missing-next-step run.
- [ ] Judge meta-validation: 100% of degrading variants rank below clean parent on the targeted criterion; 0 quality-preserving variants penalized.
- [ ] Judge run on 8 lanes completes; faithfulness sub-gate behaves (a deliberately overstated handoff fails).
- [ ] Docs contain no reference to the prior scoring/judging method.
