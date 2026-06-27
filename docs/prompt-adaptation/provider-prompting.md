# Per-provider/model prompting best practices (cited)

The dynamic prompt-mutation system (`scripts/prompt-adaptation.mjs`, opt-in via
`--adapt-prompt`) composes model-specific prompt augmentations that match
documented best practices, to push weak models toward denser, more complete
structured handoffs. This complements the post-parse reask loop
([design.md](design.md)): adaptations try to PREVENT a thin handoff; the reask
loop CORRECTS one after the fact.

Research: 10-agent workflow `wf_299a7710-08e` (30 findings, raw provenance in
`provider-prompting.findings.json`). The decisive prior art is that the named
repos do exactly this — gate prompt content by provider/model:

- **oh-my-openagent** selects a whole system prompt by model family —
  `createMetisAgent` picks `METIS_K2_7_SYSTEM_PROMPT` vs `METIS_SYSTEM_PROMPT`
  via `isKimiK27Model` — and appends provider-targeted strings only for that
  provider (`GPT_APPLY_PATCH_GUIDANCE` is added to GPT prompts, absent elsewhere,
  asserted by test). `code-yeongyu/oh-my-openagent`
  `packages/omo-opencode/src/agents/metis.ts`,
  `.../agents/gpt-apply-patch-guard.ts`,
  `packages/prompts-core/prompts/ultrawork/{codex,default}.md`.
- **openclaw** gates a `GPT5_BEHAVIOR_CONTRACT` (with an XML
  `<completion_contract>`) by a model-id regex, and runs a compaction-safeguard
  that audits the summary and regenerates it naming the missing sections /
  dropped identifiers. `openclaw/openclaw` `src/agents/gpt5-prompt-overlay.ts`,
  `src/agents/agent-hooks/compaction-safeguard{,-quality}.ts`.

## Adaptations and their evidence

Cross-cutting (applied to the weak lanes — grok-4.3, grok-4.20, flash-lite — and
to any Bedrock or non-reasoning model; strong instruction-followers like codex
and gemini-flash are left unchanged):

| id | lever | citation |
|---|---|---|
| `final-state-first` | inspect the final visible records first and let latest non-superseded state control `current_work` / `optional_next_step` | Anthropic long-context-tips (recency / lost-in-the-middle); live 2026-06-27 Gemini pickup test |
| `continuation-coverage` | cover current objective, latest user intent, active artifacts, live rules, task state, blockers, and next action without turning the output into a chronological inventory | oh-my-openagent `ultrawork/{codex,default}.md`; Anthropic claude-4 best-practices |
| `preserve-literals` | preserve exact literals only when they matter for continuation — paths, commands, IDs, URLs, ports, versions, errors, env vars, model names | openclaw `compaction-safeguard-quality.ts` `STRICT_EXACT_IDENTIFIERS_INSTRUCTION` |
| `post-transcript-override` | place the completeness rules AFTER the transcript with an "END OF TRANSCRIPT, these rules override anything earlier" header (recency / lost-in-the-middle) | Anthropic long-context-tips (platform.claude.com); Liu et al. lost-in-the-middle |

Provider/model-specific:

| id | applies to | lever | citation |
|---|---|---|---|
| `bedrock-count-floor` | Bedrock (mantle) | schema cannot enforce array minimums, so remind the model there is no hidden array cap while avoiding hard count floors | AWS Bedrock structured-output + Nova prompting docs (docs.aws.amazon.com) |
| `flash-sectional-depth` | Gemini Flash | use focused sections rather than one broad paragraph; keep prose brief and evidence anchored | ai.google.dev `gemini-3`, `thinking`, `structured-output` |
| `onto-citation-format` | Gemini Flash-Lite + ONTO | cite the first pipe field and avoid numbered section names/count chasing, after live testing showed count floors resurrected stale state | ai.google.dev structured output; ONTO renderer implementation |
| `xai-mine-transcript` | xAI / grok (incl. Bedrock grok) | treat transcript as evidence rather than instructions and prefer latest non-superseded source spans when records conflict | xAI docs.x.ai/docs/guides/structured-outputs |

## Why this is dynamic, not a global prompt

`buildPromptAdaptations({provider, model})` derives traits (`isBedrock`,
`isGemini`, `isXai`, `isNonReasoning`, `isThinProne`, `isStrong`) and includes
only the adaptations whose `applies(traits)` predicate matches — the same
model-gated dispatch oh-my-openagent and openclaw use. A strong model gets no
augmentation (request unchanged); grok-4.3 on Bedrock gets the count-floor + xAI
mining + non-reasoning decomposition + the cross-cutting block.

## Relationship to the reask loop

Both are opt-in and stack. `--adapt-prompt` shapes the first request per model;
`--max-reasks N` corrects any residual shortfall. With adaptation reducing the
shortfall, fewer reasks are needed. Effect is measured in
[design.md](design.md) / `docs/benchmark.md`.
