# EXP-08 Sentinel Renderer

EXP-08 adds an opt-in `sentinel` transcript renderer and compresses older large
tool-output bodies in the model-visible prompt. The raw JSONL transcript,
line-hash sidecar, evidence capsules, and rehydrated artifacts remain exact.

## Implementation

- `--transcript-renderer sentinel` renders records as `@@RECORD line=...`
  blocks instead of XML-like `<record>` blocks.
- Older tool-output records outside the recent tail are head/tail compressed
  when they exceed `--tool-output-compress-min-chars`.
- Compression markers include original char count, omitted chars, body hash, and
  source record hash.
- Lines inside record bodies that begin with sentinel markers are escaped with a
  leading space to avoid boundary spoofing.
- The default renderer remains `stripped`.

## Dry-Run A/B

Source transcript:
`transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl`

SHA256:
`22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20`

| Renderer | Request bytes | Wrapped transcript bytes | Wrapped char/4 tokens |
|---|---:|---:|---:|
| `stripped` | 601,526 | 565,633 | 140,921 |
| `sentinel` | 468,748 | 442,969 | 110,355 |

Sentinel compression metrics:

| Metric | Value |
|---|---:|
| compressed tool-output records | 11 |
| original compressed body chars | 153,149 |
| rendered compressed body chars | 43,111 |
| omitted tool-output chars | 137,749 |

## No-API Replay

Command:

```sh
node scripts/compact-full-transcript.mjs \
  --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json \
  --out-dir runs/exp08-sentinel-noapi \
  --preserve-tail 0 \
  --no-live-output \
  --transcript-renderer sentinel
```

Result:

| Metric | Value |
|---|---:|
| integrity echo matches | true |
| rehydrated spans | 50 |
| user intent events | 8 |
| evidence capsules | 50 |
| after bytes | 22,242 |
| after estimated tokens | 5,427 |

Scorecard:

```sh
node scripts/score-compaction-result.mjs \
  runs/exp07-selected-baseline-noapi \
  runs/exp08-sentinel-noapi
```

Both runs scored `100/100`; EXP-08 had no missing literals, no unsupported
high-risk literals, and no bad manifest hashes.

## Validation

```sh
node --check scripts/compact-full-transcript.mjs
node --check scripts/test-sentinel-renderer.mjs
node scripts/test-sentinel-renderer.mjs
node scripts/test-provider-schema.mjs
node scripts/test-handoff-user-messages.mjs
```

All validation commands passed.

## Sources

- OpenAI compaction guide: https://developers.openai.com/api/docs/guides/compaction
- OpenAI Responses compact endpoint: https://developers.openai.com/api/docs/api-reference/responses/compact
- Anthropic compaction docs: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic tool-use context compaction cookbook: https://platform.claude.com/cookbook/tool-use-automatic-context-compaction
- Codex remote compaction implementation: https://github.com/openai/codex/blob/main/codex-rs/core/src/compact_remote.rs
- Cloudflare Agents older tool-output truncation: https://github.com/cloudflare/agents/commit/7090e9eec337ae1496afce1a544044d9c765a021

## Selection

Keep `sentinel` opt-in until a live Gemini lane confirms provider token usage and
retention are no worse than `stripped`.
