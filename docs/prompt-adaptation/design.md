# Forcing handoff completeness via validate-and-reask

## Problem (root cause)

grok-4.3 (mantle) and gemini-flash-lite fail the deterministic gate while passing
the judge 10/10. The gate measures recall density; these models return thin
handoffs. See [root-cause.md](root-cause.md). The two binding failures:

1. **Missing required literals -> hard gate fail.** `gate_pass` is false whenever
   any fixture `required_literals` string is absent; both lanes drop 1-2
   (`scripts/score-compaction-result.mjs`; fixture
   `docs/experiments/fixtures/devin-reverse-engineering.v1.json` ->
   `required_literals` [5], `required_state.min_evidence_capsules: 50`).
2. **Thin evidence sinks the score.** grok-4.3 produced 9 evidence capsules / 7
   cited lines, flash-lite 17 / 35, against a target of 50 (passing codex 55,
   gemini 39-98).

## Prior art (10-agent research workflow, run wf_8f51f1b8-fed)

### Consensus: post-parse validate-and-reask is the universal mechanism
Every framework that forces completeness validates the parsed output, then
re-requests with the validation error fed back, up to N times:
- **Instructor** (Tenacity `Retrying(stop=stop_after_attempt(max_retries+1))`,
  retries on `ValidationError`, feeds the error back). `567-labs/instructor`
  `instructor/v2/core/retry.py`.
- **Guardrails AI** (`Runner.__call__` loops `for index in range(num_reasks + 1)`,
  injects targeted reask feedback). `guardrails-ai/guardrails`
  `guardrails/run/runner.py`.
- **oh-my-openagent** (`buildRetryGuidance(errorInfo)` -> error type + fix hint +
  what was missing + retry directive, appended before the model's next turn).
  `code-yeongyu/oh-my-openagent`
  `packages/delegate-core/src/retry-guidance.ts`,
  `packages/omo-opencode/src/hooks/delegate-task-retry/hook.ts`.
- **openclaw** has no reask (validate-and-throw only) -- explicitly not a model to
  copy. `openclaw/openclaw` `llm-task` / `src/utils/zod-parse.ts`.

### Decisive constraint: decode-time `minItems` is provider-split and unsafe
Schema array `minItems` is NOT a portable way to force density:
- **Self-hosted engines enforce it** (llguidance / Outlines / guidance mask the
  closing `]` until N items are produced) -- not available to API providers.
  `dottxt-ai/outlines`, `guidance-ai/llguidance`.
- **xAI direct** enforces `minItems` at decode time (up to 256). xAI docs.
- **OpenAI** enforces `minItems` at decode time since May 2025 (non-fine-tuned).
  OpenAI structured-outputs docs.
- **Gemini Flash-Lite** does NOT reliably enforce `minItems` at decode time.
  Gemini API docs.
- **AWS Bedrock rejects `minItems > 1` with a 400** -- and grok-4.3 runs via
  Bedrock (mantle). AWS Bedrock structured-output docs.

Therefore bumping schema `minItems` would 400 the exact lane being fixed. The
reask loop is the portable enforcement layer; schema `minItems` is at best an
opportunistic per-provider nudge and must stay `<= 1` on the Bedrock path.

## Design: density-gated validate-and-reask loop

Hook at the single-shot send->parse->validate seam
(`scripts/compact-full-transcript.mjs:4075-4110`, no existing retry).

1. **Make the send resendable.** Factor build-request -> fetch -> stream -> parse
   into an inner step that accepts an optional `correctiveFeedback` string
   appended to the user prompt, returning `{summary, outputText, events}` or a
   structured failure.
2. **Density gate** `evaluateHandoffDensity(summary, lineHashArtifacts, thresholds)`
   -> `{pass, shortfalls[], feedback}`. Thresholds (flag/env, sane defaults):
   `minEvidenceCapsules`, `minCitedLines`, `requirePromisesWhenCommitments`.
   Reuses the same metrics the scorer reads (capsule count, unique cited lines,
   promises length).
3. **Loop** up to `--max-reasks N` (default 2): send (attempt > 0 includes the
   prior attempt's corrective feedback) -> `validateSummary` (structural) ->
   density gate. Keep the best structural-valid attempt by density; break on
   density pass.
4. **Corrective feedback** (Guardrails/Instructor/omo pattern), specific and
   imperative: "Your previous handoff was incomplete: only 9 evidence capsules
   (produce at least 50, each citing a distinct transcript span); promises_made
   was empty (capture every commitment). Regenerate the COMPLETE handoff."
5. **No hard abort on density shortfall.** After retries, proceed with the best
   attempt (consistent with the bullet-relaxation philosophy: never replace the
   conversation with a worse artifact). Structural/parse failures keep the
   existing `failure.json` + exit path.

Self-gating cost: strong models meet thresholds on attempt 0 (no retry, no extra
cost); only thin lanes pay for reasks.

### Scope notes
- `required_literals` are a benchmark-fixture concept the runtime does not see;
  the loop targets generic density (capsules / cited lines / promises), which
  raises score and incidentally improves literal coverage. An optional
  `--require-literals` input can enforce specific strings when a caller supplies
  them; left out of the first cut to avoid teaching-to-the-test.

## Exit proof (achieved)
With `--max-reasks 2`, both single-shot gate failures clear the gate, recovering
every missing required literal:
- grok-4.3 (mantle) sentinel: 81 fail -> 92 pass; capsules 9 -> 40; missing
  literals 1 -> 0.
- gemini-3.1-flash-lite stripped: 79 fail -> 91 pass; capsules 17 -> 29; missing
  literals 2 -> 0.

Default `--max-reasks 0` keeps every provider request byte-identical (the
12-combination dry-run parity gate still passes), so the loop is opt-in and only
thin lanes pay for reasks. Implementation: the loop wraps the single-shot
send/parse seam in `scripts/compact-full-transcript.mjs`; the density gate is
`scripts/handoff-density.mjs`. Regression + full-goal evidence:
`scripts/test-reask-loop.mjs` (and `scripts/test-handoff-density.mjs`). Run
artifacts: `runs/bench-mantle-sentinel-reask`, `runs/bench-g31lite-stripped-reask`.
