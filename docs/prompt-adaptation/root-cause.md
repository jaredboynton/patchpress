# Why grok-4.3 and flash-lite fail the deterministic gate

Both pass the semantic judge 10/10 yet fail the deterministic gate (<85). The
gate measures recall density and exact recovery, which these models underdeliver.

## Evidence (per-category, `scripts/score-compaction-result.mjs`)

| Category | flash-lite stripped (79) | grok-4.3 sentinel (81) |
|---|---|---|
| artifact_integrity | 25 | 25 |
| state_retention | 28 | 26 |
| evidence_grounding | 10 | 8 |
| continuity_state | 18 | 18 |
| exact_literal_recovery | 12 | 16 |
| unsupported_claims | 10 | 10 |
| footprint | 4 | 4 |

## Concrete defects (metrics block)

- **Thin evidence:** grok-4.3 produced 9 evidence capsules / 7 cited unique
  lines; flash-lite 17 caps / 35 lines. Passing models: codex 55 caps, gemini
  39-98. evidence_grounding scales with capsule count vs a fixture minimum.
- **Missing required literals (exact_literal_recovery):** both drop the verbatim
  path `/Users/.../devin-decompile/docs/03-endpoints.md`; flash-lite also drops
  `HTTPS_PROXY`. These are high-value strings the handoff must preserve.
- **Zero promises:** both captured `promises: 0`; continuity_state awards points
  for promiseCount>0.
- **Footprint:** the budget is now `max_after_estimated_tokens: 23022` in the
  fixture, set to the accepted selected baseline. Before that fix the scorer fell
  back to a stale 6k default that no model could meet (~23-25k after-tokens
  across codex/gemini/grok/flash-lite), so footprint was a constant 4/10 and
  never a differentiator. The 4/10 figures in the table above predate the
  recalibration; re-score against the updated fixture to refresh them.

## Differentiators (what makes these two fail vs others pass)

Recall completeness: evidence capsule density, cited-line breadth, verbatim
literal preservation, and promise capture. The prose is fine (judge 10/10); the
quantity and exactness of retained detail is low. Working hypothesis: a
provider/model-aware prompt that pushes harder on evidence density and verbatim
literal preservation for weaker models can close the gap. Research phase tests
this against provider best practices and prior art.
