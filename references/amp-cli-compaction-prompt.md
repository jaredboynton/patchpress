# Amp CLI Compaction Prompt

Local source: `/Users/jaredboynton/__devlocal/kep/.discovery/amp-ref/readable-subset/0676-kT.js`

Public reverse-engineered reference:

- Repo: `https://github.com/ben-vargas/ai-amp-cli`
- README states it contains artifact-backed documentation extracted from the Amp CLI minified bundle.
- Source build documented there: `0.0.1777185893-gae6d40`

## Literal Prompt

Source: `Mt1` in `readable-subset/0676-kT.js`.

```text
You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:
1. Task Overview
The user's core request and success criteria
Any clarifications or constraints they specified
2. Current State
What has been completed so far
Files created, modified, or analyzed (with paths if relevant)
Key outputs or artifacts produced
3. Important Discoveries
Technical constraints or requirements uncovered
Decisions made and their rationale
Errors encountered and how they were resolved
What approaches were tried that didn't work (and why)
4. Next Steps
Specific actions needed to complete the task
Any blockers or open questions to resolve
Priority order if multiple steps remain
5. Context to Preserve
User preferences or style requirements
Domain-specific details that aren't obvious
Any promises made to the user
Be concise but complete—err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.
Wrap your summary in <summary></summary> tags.
```

## Wiring

The same file defines:

```js
var Et1 = 100000
var Mt1 = `...`
```

The compaction path checks `params.compactionControl`, uses a threshold, appends the selected prompt as a final user message, and marks the request with a compaction helper header:

```js
let Z = K1(this, t7, "f").params.compactionControl
if (!Z || !Z.enabled) {
  return false
}
let Y = Z.contextTokenThreshold ?? Et1
let X = Z.model ?? K1(this, t7, "f").params.model
let K = Z.summaryPrompt ?? Mt1
let V = K1(this, t7, "f").params.messages
...
let G = await this.client.beta.messages.create(
  {
    model: X,
    messages: [
      ...V,
      {
        role: "user",
        content: [
          {
            type: "text",
            text: K,
          },
        ],
      },
    ],
    max_tokens: K1(this, t7, "f").params.max_tokens,
  },
  {
    headers: {
      "x-stainless-helper": "compaction",
    },
  },
)
```

After the compaction response:

```js
if (G.content[0]?.type !== "text") {
  throw new o4("Expected text response for compaction")
}
K1(this, t7, "f").params.messages = [
  {
    role: "user",
    content: G.content,
  },
]
return true
```

The local deobfuscated client also exposes streaming `compaction_delta` handling and a separate `compact(J, Z)` client method that posts to `/responses/compact`.
