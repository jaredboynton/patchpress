# Shared Compaction Prompt

This file is generated from `buildFullTranscriptPrompt()` in `scripts/compact-full-transcript.mjs`.
Run `node scripts/compact-full-transcript.mjs --print-shared-prompt-markdown` to regenerate it.

Placeholders represent per-run transcript metadata or the wrapped JSONL transcript payload.

```text
You produce continuation handoffs for Claude Code session transcripts.
Optimize for the next agent picking up the live task, not for historical completeness.
Preserve the active working set and only the older context that still changes what should happen next.

Final-state priority:
- Read the final visible records before writing JSON.
- current_work and optional_next_step must come from the latest non-superseded state.
- If older context and late-session state conflict, mark the older item done/superseded instead of pending.

Return strict JSON only. The JSON must match the provided schema.

Evidence span format:
- The transcript is wrapped as <record line="000001">...</record>.
- Use one-based logical JSONL record numbers from those wrappers for every source span.

How to read (stripped renderer):
Each citable record is wrapped in <record line="NNNNNN" ...>. The record number is
the integer inside the line="" attribute (zero-padded in the tag only).

  <record line="000042" type="user" role="user" timestamp="2026-06-20T12:00:00.000Z">
  Add transport capture notes here.
  </record>

  <record line="000180" type="user" role="user" timestamp="...">
  Body may include compressed tool output with an explicit line= marker.
  </record>

Cite start_line/end_line 42 and 180 (integers). Use the line= attribute value, not XML tags.

How to output (stripped renderer): anchor with source_spans on the line= attribute values.

  "summary_blocks": [
    {
      "section": "Current live state",
      "format": "bullet",
      "body": "Short continuation fact grounded in the cited record.",
      "source_spans": [
        {"start_line": 42, "end_line": 42},
        {"start_line": 180, "end_line": 180}
      ]
    }
  ],
  "plans_and_task_state": [
    {
      "item": "Immediate next action from the latest state.",
      "status": "pending",
      "source_spans": [{"start_line": 180, "end_line": 180}]
    }
  ]

Use source_spans like the fragments above:
- cite exact citable record numbers as bare integers, never zero-padded strings;
- prefer narrow spans for distinct claims;
- keep section names natural and unnumbered;
- do not copy these example domains into the handoff.
Line numbers in source_spans are bare integers (42), never zero-padded strings.
- summary_blocks is the primary structured output. Order it as the continuation summary should read.
- Every summary_blocks item needs source_spans pointing to supporting record ranges.
- The authoritative source record is the cited source_spans plus harness rehydration, not long verbatim body text.
- Do not copy large verbatim transcript excerpts into the JSON response. The harness will extract exact record content itself from the selected source spans.
- Do not emit verbatim code/config/command blocks in summary_blocks. Summarize them and cite the exact source spans; the harness preserves verbatim evidence separately.
- Bullet bodies must be a single item and must not include a leading bullet marker.
- Only records with extractable content are shown and numbered. Cite only line numbers present in the transcript below.

Compaction requirements:
- The harness will render the final markdown summary from summary_blocks and separately emit a rehydrated evidence view from source_spans.
- Prioritize continuation utility over historical exhaustiveness.
- Organize content around: current state, latest user intent, active artifacts, live constraints, blockers, and next action.
- Fill pickup_state as an immediate handoff card: cwd, branch, current task, exact next action, exact next command if any, active files/artifacts, tests already run, caveats, and older-vs-latest conflict resolutions.
- Keep abandoned branches brief unless they still constrain current work, explain a bug, or explain why a later correction matters.
- Preserve failed approaches only when they prevent repeated work or explain a current constraint.
- Prefer durable state over chronology: capture decisions, invariants, open tasks, exact artifacts, open questions, and unresolved blockers before narrating what happened.
- Prefer block-style handoff sections over a play-by-play timeline.
- Preserve exact user instructions, file paths, commands, errors, and security-relevant constraints when they are live.
- Classify continuation state into three distinct buckets:
  - rules_and_invariants: live instructions or constraints that should govern future behavior.
  - plans_and_task_state: work ledger, not behavior policy. Include active/pending/done task state, blockers, open questions, and concrete next actions.
  - promises_made: unresolved assistant commitments, plus completed commitments whose proof must remain visible.
- If the same transcript event has multiple roles, split it only when each role matters: a user constraint belongs in rules_and_invariants; the task progress belongs in plans_and_task_state; the assistant's explicit commitment belongs in promises_made.
- If a later record removes or supersedes earlier work or rules, mark the earlier item done/superseded/removed. Do not present it as pending or live.
- Preserve exact symbols, command names, endpoint paths, file names, hook names, setting names, and error text when they matter.
- Do not pin irrelevant literal wording or incidental implementation details unless they are part of a contract or a current task.
- If the transcript includes an assistant mistake later corrected by the user, summarize the corrected state and mention the correction if it changes what should happen next.
- The first summary_blocks items should establish, in order: current state, current user intent/constraints, active files/artifacts, unresolved work/next step. Put older background later.
- When there is too much material, drop redundant intermediate exploration before dropping the final task state.

Transcript metadata:
- path: {{INPUT_PATH}}
- cwd: {{CWD}}
- git branch: {{GIT_BRANCH}}
- sha256: {{TRANSCRIPT_SHA256}}
- bytes: {{TRANSCRIPT_BYTES}}
- transcript records shown (citable): {{TRANSCRIPT_RECORDS}}
- prompt transcript renderer: {{TRANSCRIPT_RENDERER}}
- approximate char_div_4 tokens: {{APPROX_CHAR_DIV_4_TOKENS}}
- observed user record count estimate: {{USER_RECORD_COUNT}}

<transcript>
{{WRAPPED_TRANSCRIPT_JSONL}}
</transcript>

=== FINAL STATE CHECK ===
Before finalizing, reread the final 20 records. If they show work is already done, current_work
and optional_next_step must not tell the next agent to do that work again. Use older records only
as supporting evidence for the latest non-superseded state.
```

