# Warp Compaction Reference

Canonical repo: `https://github.com/warpdotdev/warp`

Important caveat: Warp's public repo exposes the client-side command surface and request payload. It does not expose the literal built-in summarization prompt for the server-side Warp agent. Warp's FAQ says the built-in agent harness runs server-side and is not open in the repo today.

## Public Command Surface

Source: `app/src/search/slash_command_menu/static_commands/commands.rs`

Public command definitions:

```rust
pub static COMPACT:LazyLock<StaticCommand> = LazyLock::new(|| StaticCommand{name:"/compact",description:"Free up context by summarizing convo history",icon_path:"bundled/svg/collapse_content.svg",availability:Availability::AGENT_VIEW | Availability::ACTIVE_CONVERSATION | Availability::NO_LRC_CONTROL | Availability::AI_ENABLED | Availability::NOT_CLOUD_AGENT,auto_enter_ai_mode:true,argument:Some( Argument::optional().with_hint_text("<optional custom summarization instructions>"),),});
pub static COMPACT_AND:LazyLock<StaticCommand> = LazyLock::new(|| StaticCommand{name:"/compact-and",description:"Compact conversation and then send a follow-up prompt",icon_path:"bundled/svg/collapse_content.svg",availability:Availability::AGENT_VIEW | Availability::ACTIVE_CONVERSATION | Availability::NO_LRC_CONTROL | Availability::AI_ENABLED | Availability::NOT_CLOUD_AGENT,auto_enter_ai_mode:true,argument:Some(Argument::optional().with_hint_text("<prompt to send after compaction>")),});
pub static FORK_AND_COMPACT:LazyLock<StaticCommand> = LazyLock::new(||{let hint_text = "<optional prompt to send after compaction>";StaticCommand{name:"/fork-and-compact",description:"Fork current conversation and compact it in the forked copy",icon_path:"bundled/svg/fork_and_compact.svg",availability:Availability::AGENT_VIEW | Availability::ACTIVE_CONVERSATION | Availability::NO_LRC_CONTROL | Availability::AI_ENABLED | Availability::NOT_CLOUD_AGENT,auto_enter_ai_mode:true,argument:Some(Argument::optional().with_hint_text(hint_text)),}});
```

## Parser Behavior

Source: `app/src/ai/blocklist/controller/slash_command.rs`

The public client parses `/compact` into a summarize request. The prompt is only optional user text after the command:

```rust
if let Some(prompt) = query.strip_prefix(commands::COMPACT.name){return Some(Self::Summarize{prompt:prompt.strip_prefix(' ').map(String::from),});}
```

The request becomes an agent input:

```rust
SlashCommandRequest::Summarize{prompt,..}=>{vec![AIAgentInput::SummarizeConversation{prompt,context}]}
```

## API Request Shape

Source: `app/src/ai/agent/api/convert_to.rs`

```rust
AIAgentInput::SummarizeConversation{prompt,context}=>{return Ok(api::request::Input{context:Some(convert_context(context.as_ref())),r#type:Some(api::request::input::Type::SummarizeConversation( api::request::input::SummarizeConversation{prompt:prompt.unwrap_or_default(),},)),});}
```

## Follow-Up Variants

Source: `specs/APP-4594/TECH.md`

Warp documents `/compact-and <prompt>` and `/fork-and-compact <prompt>` as summarize/fork-then-summarize flows that queue a follow-up prompt after compaction completes:

```text
Today `/compact-and <prompt>` and `/fork-and-compact <prompt>` still file their follow-up prompts through the legacy `PendingUserQueryBlock` path while a summarize (or fork-then-summarize) runs.
```

The same spec says `/compact-and` dispatches `WorkspaceAction::SummarizeAIConversation` and `/fork-and-compact` dispatches `WorkspaceAction::ForkAIConversation { summarize_after_fork: true, ... }`.

## Conclusion

There is no public Warp compaction prompt to copy from the open-source client. The transferable prior art is the shape:

- `/compact` is a first-class summarize-conversation operation.
- Optional user text is custom summarization guidance.
- `/compact-and` and `/fork-and-compact` treat compaction as a continuation workflow with a queued next prompt.
- The actual summarizer prompt appears to be server-side.
