# Empty evidence-capsule failure: empirical diagnosis

## Symptom
`validateHandoffState()` rejects with `handoff state evidence_capsules[N].text_segments empty`.
Observed on 4 current-era runs (same input transcript `before-...session-81c06368-approx-595k-tokens.jsonl`, 1066 records):

| Run | Failing capsule | Section | Cited lines | Record kinds at those lines |
|-----|-----------------|---------|-------------|------------------------------|
| sentinel / xai grok-4.20 | 8 | Rules | 1 | `last-prompt` (no text) |
| stripped / xai grok-4.20 | 5 | Plans | 1008-1009 | `last-prompt` (has `lastPrompt`), `ai-title` |
| sentinel / codex gpt-5.4 | 0 | Rules | 1-3 | `last-prompt`, `mode`, `permission-mode` |
| stripped / codex gpt-5.4 | 0 | Rules | 1 | `last-prompt` (no text) |

## Causal chain (verified)
1. The session JSONL contains non-conversational metadata records: `last-prompt`, `mode`, `permission-mode`, `ai-title` (and similar). These carry no message text.
2. `wrapTranscript()` (scripts/compact-full-transcript.mjs:432-465) presents **every** record — metadata included — to the model as a numbered, citable line.
3. The provider JSON schema (`createSummarySchema()` ~1162-1338) bounds citations to integers in `[1, recordCount]`. recordCount counts metadata lines, so citing a metadata-only line is schema-VALID.
4. The model anchors items to those lines. Empirically it does this most when the "rule" it extracted is a **harness/prompt instruction with no real source line** ("Output only strict JSON matching the provided compaction schema", "Return strict JSON only", "No mention of these guidelines"), and it grabs line 1 as convenient grounding.
5. `extractRecordText()` (2412-2425) returns `""` for these metadata records (no `content` / `message.content` / `toolUseResult` / `attachment`).
6. `buildExtractedSpanText()` (2437-2456) skips zero-length records, producing `text_segments: []`.
7. `validateHandoffState()` (~2995-3007) rejects empty `text_segments` → `failure.json`, exit 1.

## Two record classes (opposite treatment)
The cited metadata records split into two classes that need **opposite** fixes:

**Text-bearing but unread by `extractRecordText`** — excluding them would discard real evidence:
- `last-prompt` with a `lastPrompt` field (line 1008: `"let's document all of this in /Users/.../devin-decompile"` — the user's actual prompt).
- `ai-title` with `aiTitle` (line 1009: `"Build Rust binary decompilation tool pipeline"`).
- (likely also `summary` records carrying `summary`.)
These should be **surfaced** by extending the extractor.

**Genuinely contentless** — no recoverable text, should be **non-citable**:
- `mode` (`"normal"`), `permission-mode` (`"bypassPermissions"`), bare `last-prompt` (only `type`/`leafUuid`/`sessionId`, no `lastPrompt`).

## Why the prior diagnosis was incomplete
The prior agent framed it partly as "extractor doesn't read `record.lastPrompt`". That explains exactly **one** of four capsules (stripped/xai line 1008). The other three cite a bare `last-prompt`, `mode`, `permission-mode`, `ai-title` — and of those, `ai-title` is actually text-bearing-but-unread, while `mode`/`permission-mode`/bare `last-prompt` are genuinely contentless. So the fix is two-sided, not one.

Root cause is structural: **the citable space presented to the model includes records that cannot rehydrate to text, and the schema permits anchoring to them.** Structured output enforces shape (`start_line`/`end_line` integers in range); it cannot enforce "this line rehydrates to non-empty text" while contentless lines are inside the citable range.

## Unifying invariant
**citable ⟺ rehydrates to non-empty text.** Reach it by (1) extending `extractRecordText` to maximize the text-bearing set, then (2) defining the citable set as exactly the records the extractor returns non-empty for, and constraining the model's citation space to that set.

## The hard half (silent-failure risk)
Making empty `text_segments` unrepresentable is the easy half. The hard half: a structural fix can convert a **loud** failure (empty → run fails) into a **silent** one — the model re-anchors a bogus "Output strict JSON" rule onto some other real line that rehydrates fine and passes validation while not actually supporting the rule. The user's bar is "quality maintained or improved," so the discriminating gate is **the semantic judge run on the now-passing xAI/Codex outputs**, not a green validator alone.

Secondary (quality) defect: models summarize prompt/harness instructions as durable "rules" and cite metadata line 1 as fake grounding. A structural fix that removes metadata from the citable space also removes the convenient fake anchor.

## Fix direction (to be pressure-tested by research/logic subagents)
Make the citable space contain **only** records that rehydrate to non-empty text, and constrain the schema to that space, so an empty-rehydration citation is unrepresentable — not merely rejected after the fact.
