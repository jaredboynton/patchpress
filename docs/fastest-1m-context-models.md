# The Fastest Million-Token Models You Can Actually Use

**If you want to feed a model a million tokens and get an answer back quickly, these are your ten best options today.** Ranked purely by how fast each one writes — output tokens per second — across every hosted model that exposes a context window of at least 1,000,000 tokens.

*Checked 2026-06-21. Speeds from [Artificial Analysis](https://artificialanalysis.ai/) unless noted.*

## The list

| Rank | Model | Best provider | Context window | Input $/M | Output $/M | Output speed |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | Gemini 3.1 Flash-Lite | Google AI Studio | 1,048,576 in / 65,536 out | $0.25 | $1.50 | **285.9 t/s** |
| 2 | Grok 4.3 high | Amazon Bedrock | 1,000,000 | $1.25 | $2.50 | 229.6 t/s |
| 3 | GLM-5.2 max | Wafer | 1,000,000+ | $1.20 | $4.10 | 219.7 t/s |
| 4 | Grok 4.20 0309 v2 (non-reasoning) | xAI | 1,000,000+ | $1.25 | $2.50 | 212.1 t/s |
| 5 | Gemini 3.5 Flash minimal | Google AI Studio | 1,048,576 in / 65,536 out | $1.50 | $9.00 | 178.8 t/s |
| 6 | GPT-4.1 nano | OpenAI | 1,047,576 | $0.10 | $0.40 | 150.8 t/s |
| 7 | Qwen3.7-Max | Alibaba Cloud | 1,000,000 | $2.50 | $7.50 | 117.4 t/s |
| 8 | DeepSeek V4 Flash max | DeepSeek | 1,000,000 | $0.14 | $0.28 | 107.3 t/s |
| 9 | Claude Opus 4.8 | Anthropic | 1,000,000 | $5.00 | $25.00 | 68.1 t/s |
| 10 | GPT-5.5 | Amazon Bedrock | 1,050,000 | $5.50 | $33.00 | 64.3 t/s |

The takeaway: the fastest million-token model on the board is also one of the two cheapest. **Gemini 3.1 Flash-Lite** writes at 285.9 t/s for $1.50 per million output tokens — more than 4x faster than Claude Opus 4.8 and over 20x cheaper to write with. Raw throughput and frontier price tags do not travel together. (It is also why this repo's compaction harness runs on Flash-Lite instead of a frontier model.)

## How we ranked them

Four rules, so the comparison stays apples-to-apples:

- **Speed only.** Ranking is sustained output throughput in tokens per second. First-token latency is ignored — this is about how fast a long answer streams out, not how fast it starts.
- **A real million-token window.** Every model here exposes at least 1,000,000 tokens of context on the listed provider. Endpoints that cap lower didn't qualify, even for the same model.
- **Direct providers only.** We count first-party APIs, [Wafer](https://app.wafer.ai/models), and Amazon Bedrock. Third-party routers and resellers (Azure, Nebius, Baseten, Makora, Together, Groq, Vertex, OpenRouter, DeepInfra, Novita, Parasail, and the like) are excluded — Bedrock is the one cloud exception. Some of those hosts are faster, which is why a few fast configurations sit in the near-misses below.
- **Newest version of each line.** When a newer snapshot replaces an older one, only the new one is listed; preview aliases and superseded snapshots are dropped.

On pricing: figures are list USD per 1M tokens at the fastest provider in each row, standard on-demand tier (no batch, flex, or priority surcharges unless that tier is the only published price). DeepSeek input uses the cache-miss rate. Gemini 3.1 Flash-Lite input is the text/image/video rate (audio input is $0.50/M).

## Fast, but they didn't make the cut

Several configurations are faster than rows on the list but fail one of the rules above:

- **NVIDIA Nemotron 3 Super** on Nebius/Baseten beats the top row, but those hosts are excluded. NVIDIA's own direct 1M throughput wasn't verified.
- **GPT-4.1 nano on Azure** hits 293.8 t/s — faster than #1 — but Azure is excluded.
- **DeepSeek V4 Flash max on Makora** hits 244.5 t/s, but Makora is excluded.
- **Llama 4 Scout on Groq** runs about 444 t/s, but Groq is excluded and its endpoint only exposes 131,072 tokens. Bedrock's Llama endpoints are allowed by the provider rule but expose ~128,000 tokens, under the bar.
- **Older Gemini Flash and Grok 4.20 snapshots** are dropped by the newest-version rule.
- **Command A+** reaches ~199.1 t/s but its context is well under 1M. **Mistral, Cohere Command, and current Kimi/Moonshot** lines also fail the million-token gate.

## Sources

### Throughput and context

- Gemini 3.1 Flash-Lite throughput: https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview/providers
- Gemini 3.1 Flash-Lite context: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- Grok 4.3 high throughput: https://artificialanalysis.ai/models/grok-4-3/providers
- Grok 4.3 context: https://docs.x.ai/developers/models/grok-4.3
- GLM-5.2 max throughput: https://artificialanalysis.ai/models/glm-5-2/providers
- GLM-5.2 context: https://docs.z.ai/guides/overview/migrate-to-glm-new
- Wafer GLM availability: https://app.wafer.ai/models
- Grok 4.20 non-reasoning throughput: https://artificialanalysis.ai/models/grok-4-20-non-reasoning/providers
- Grok 4.20 non-reasoning context: https://docs.x.ai/developers/models/grok-4.20-0309-non-reasoning
- Gemini 3.5 Flash minimal throughput: https://artificialanalysis.ai/models/gemini-3-5-flash-minimal/providers
- Gemini 3.5 Flash context: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- GPT-4.1 nano throughput: https://artificialanalysis.ai/models/gpt-4-1-nano/providers
- GPT-4.1 nano context: https://developers.openai.com/api/docs/models/gpt-4.1-nano
- Qwen3.7-Max throughput: https://artificialanalysis.ai/models/qwen3-7-max/providers
- Qwen3.7-Max context: https://artificialanalysis.ai/models/qwen3-7-max
- DeepSeek V4 Flash max throughput: https://artificialanalysis.ai/models/deepseek-v4-flash/providers
- DeepSeek V4 Flash context: https://api-docs.deepseek.com/news/news260424
- Claude Opus 4.8 throughput: https://artificialanalysis.ai/models/claude-opus-4-8/providers
- Claude 1M context docs: https://platform.claude.com/docs/en/about-claude/context-windows
- GPT-5.5 throughput: https://artificialanalysis.ai/models/gpt-5-5/providers
- GPT-5.5 context: https://developers.openai.com/api/docs/models/gpt-5.5
- Llama 4 Scout provider limitation: https://console.groq.com/docs/models
- Llama 4 Scout throughput: https://artificialanalysis.ai/models/llama-4-scout/providers
- Command A+ context: https://artificialanalysis.ai/models/command-a-plus
- Mistral model contexts: https://docs.mistral.ai/models/overview
- Cohere model contexts: https://docs.cohere.com/docs/models
- Kimi model contexts: https://platform.kimi.ai/docs/models

### Pricing

- Gemini API pricing (3.1 Flash-Lite, 3.5 Flash): https://ai.google.dev/gemini-api/docs/pricing
- Amazon Bedrock pricing (Grok 4.3, GPT-5.5): https://aws.amazon.com/bedrock/pricing/
- GLM-5.2 (max) Wafer pricing: https://artificialanalysis.ai/models/glm-5-2/providers
- Grok 4.20 non-reasoning pricing: https://docs.x.ai/developers/models/grok-4.20-0309-non-reasoning
- GPT-4.1 nano pricing: https://developers.openai.com/api/docs/models/gpt-4.1-nano
- Qwen3.7-Max pricing: https://modelstudio.alibabacloud.com/
- DeepSeek V4 Flash pricing: https://api-docs.deepseek.com/quick_start/pricing
- Claude Opus 4.8 pricing: https://platform.claude.com/docs/en/about-claude/pricing
