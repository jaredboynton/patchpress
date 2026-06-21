# Fix design: make empty evidence capsules structurally impossible

## Decision (from research + diagnosis + user framing)
Adopt **Variant B (dense citable index)** built on an **extended extractor**, not the post-hoc filter (Variant A).
Rationale: only B makes the schema bound itself the guarantee — present/number only text-bearing records so `start_line,end_line ∈ [1,N]` structurally implies a citation rehydrates to non-empty text. A bounded integer range is what constrained decoding enforces cheaply (an enum of valid lines times out at ~1066 records). Research lean: B; A is belt-and-suspenders only. User ask: "architect the structured output so it's not even possible," "not a prompt thing."

## Target invariant
**citable ⟺ rehydrates to non-empty text**, enforced in one place: the citable set presented/numbered to the model is exactly the set of records for which the (extended) extractor returns non-empty text.

## Two-class extractor extension (do FIRST, both classes from diagnosis)
Extend `extractRecordText` (and align presentation `recordTextForPrompt`) to surface real text from:
- `last-prompt` → `record.lastPrompt`
- `ai-title` → `record.aiTitle`
- `summary` → `record.summary` (verify field name in real records)
Genuinely contentless after that (`mode`, `permission-mode`, bare `last-prompt`, etc.) become non-citable.

## Open implementation questions for the logic subagent to resolve with evidence
1. **B1 vs B2.**
   - B1 "filter": drop non-citable records from the numbered transcript entirely. Simplest; model loses non-citable context (may include `system`, `file-history-snapshot`, thinking-only records — check what would actually be dropped and whether it hurts summarization).
   - B2 "present-all, number-citable": show non-citable records as context WITHOUT a citable index; only citable records get a dense `[1,N]` index the schema bounds. Preserves context; needs an index→original-line map.
2. **Provenance dependency.** Does anything depend on line numbers being ORIGINAL JSONL file positions (vs dense positions over the citable list)? Check `lineHash`/`entries[lineNumber-1]`, `line-hashes.tsv`, `extractUserMessages`, `collectSourceHashes`, any native-compaction comparison, and the tests. If nothing external maps back to the source file, B1's simple "filter then number" needs no dual map (hashes recompute over the filtered list). If something does, B2's map is required.
3. **Presentation/rehydration unification.** Ensure the text the model SEES for a citable record (`recordTextForPrompt`) is non-empty whenever `extractRecordText` is non-empty — otherwise the model cites a line it saw as a placeholder. Prefer unifying both on one extractor.
4. **Schema bound.** `createSummarySchema(recordCount)` (1162-1185): `recordCount` must become the citable count N, and the schema `description` must reference the citable numbering.

## Silent-failure mitigation (REQUIRED — advisor)
The structural fix guarantees non-empty text, NOT that the cited span supports the item (faithfulness). Risk: model re-anchors a bogus "Output strict JSON" rule onto a real line that rehydrates fine. Gate: run the repo's semantic judge on the now-passing xAI/Codex outputs and confirm score does not regress. Keep a loud internal assertion (throw) if any citable record ever rehydrates empty — that would mean the invariant was violated, a bug, never a silent drop.

## Resolved (evidence from census + code, recovered from logic subagent run)
- **Census (real 1066-record transcript):** extended extractor → **799 citable / 267 non-citable**. `lastPrompt`/`aiTitle` recover 54 each; no `summary` records present here. Non-citable: `mode` 55, `permission-mode` 55, `file-history-snapshot` 35, thinking-only `assistant` 109, `system` 10, `queue-operation` 2, bare `last-prompt` 1.
- **Q1 → B1 "filter-then-number".** `renderPartForPrompt` (285-316) returns "" for thinking blocks, so non-citable records are shown to the model only as a 160-char raw-JSON `preview` / `[no textual content extracted]`, never real content. Dropping them loses negligible signal; all conversational records (user/assistant text, tool_use, tool_result) are citable and preserved. B1 is far simpler than B2 and the semantic-judge + Gemini-lane gate will catch any regression.
- **Q2 → filter-then-number, no dual map.** The line number IS the positional index into both `records` (parseJsonl, ~3692) and `entries` (buildRecordArtifacts/logicalJsonlLines, ~3693); both are same-length, same-order. `lineHash` = `entries[n-1].hash`; `deriveRehydrationSpans` slices `records`; `extractUserMessages` uses `idx+1`; `line-hashes.tsv` is self-describing; the judge/scorer key off hashes, not line numbers; `transcript_lines_seen` is not validated against record count. Nothing maps a line number to the original file position. So filtering the transcript to citable records at one point, before both `records` and `entries` are built, keeps the whole chain consistent.
- **Q3 unification:** extend BOTH `extractRecordText` (rehydration) and `recordTextForPrompt` (presentation) for `lastPrompt`/`aiTitle`/`summary`, so a citable metadata-with-text record is shown to the model as its real text and rehydrates to the same.
- **Tests:** both fixtures in test-handoff-user-messages.mjs are all-citable; renumbering is a no-op on them; `line=000001` holds.
- **Judge runner:** `node scripts/judge-compaction-result.mjs <run-dir>` (default model gpt-5.5, reasoning medium).

## Implementation shape (B1)
Single-point citable filter: derive `citableTranscript` = the logical JSONL lines whose record has non-empty (extended) `extractRecordText`, then build `records` and `lineHashArtifacts` from that filtered set. Schema `recordCount` and validation `maxLine` then become the citable count automatically. Add a loud `throw` if any cited span still rehydrates empty (invariant violation = bug, never a silent drop). Keep full-transcript handles only where diagnostics need them (renderer-stats/native comparison).

## Blast-radius map (sites that read a line number)
- Presentation + schema bound: renderers `renderStrippedRecord`/`renderSentinelRecord` (368-422) use `entry.lineNumber`; `createSummarySchema` max (1175); prompt `buildFullTranscriptPrompt` (1373+).
- Validation: `validateSummary` bounds vs `entries.length` (2066-2123).
- Provenance/hashing (keyed to original JSONL positions today): `lineHash` = `entries[lineNumber-1].hash` (2372); `deriveRehydrationSpans` slice + start/end hash + raw_slice_sha256 (2491-2526); `collectSourceHashes` (3405-3410); `extractUserMessages` (972-990); `line-hashes.tsv` (3788-3807).
- Rehydration→capsule: `buildExtractedSpanText` (2437-2456), `buildEvidenceCapsules` (2857-2893), `validateHandoffState` (2986-3028).
