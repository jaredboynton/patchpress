# Codex CLI Default Compaction Prompt

Local sources:

- `/Users/jaredboynton/__devlocal/codex/codex-rs/prompts/templates/compact/prompt.md`
- `/Users/jaredboynton/__devlocal/codex/codex-rs/prompts/templates/compact/summary_prefix.md`
- `/Users/jaredboynton/__devlocal/codex/codex-rs/prompts/src/compact.rs`
- `/Users/jaredboynton/__devlocal/codex/codex-rs/core/src/compact.rs`
- `/Users/jaredboynton/__devlocal/codex/codex-rs/core/src/tasks/compact.rs`

## Prompt Template

Source: `codex-rs/prompts/templates/compact/prompt.md`

```text
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

## Summary Prefix

Source: `codex-rs/prompts/templates/compact/summary_prefix.md`

```text
Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:
```

## Wiring

`codex-rs/prompts/src/compact.rs` embeds both files:

```rust
pub const SUMMARIZATION_PROMPT: &str = include_str!("../templates/compact/prompt.md");
pub const SUMMARY_PREFIX: &str = include_str!("../templates/compact/summary_prefix.md");
```

`codex-rs/core/src/compact.rs` uses the configured compact prompt if one exists, otherwise the built-in template:

```rust
let prompt = turn_context
    .config
    .compact_prompt
    .as_deref()
    .unwrap_or(SUMMARIZATION_PROMPT)
    .to_string();
```

The installed summary is prefixed before it is added back to the session:

```rust
let summary_text = format!("{SUMMARY_PREFIX}\n{summary_suffix}");
```

Manual local `/compact` uses the same fallback in `codex-rs/core/src/tasks/compact.rs`.

## Remote Compaction Note

The local markdown prompt is not the only Codex compaction path. The source also has remote compaction code paths:

- `codex-rs/core/src/compact_remote.rs`
- `codex-rs/core/src/compact_remote_v2.rs`

Those use Codex protocol compaction items and `/responses/compact` style behavior rather than directly sending the markdown summarization prompt as a normal user text item.
