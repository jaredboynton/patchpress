# Top 10 Fastest 1M+ Context Models

Date checked: 2026-06-21

Criterion: sustained output throughput only, measured in output tokens per second. First-token latency is ignored. The ranking uses hosted API model/provider configurations where the exposed context window is at least 1,000,000 tokens.

Pricing: list input and output USD per 1M tokens at the fastest provider in each row (standard/on-demand API tier; excludes batch, flex, and priority surcharges unless that tier is the only published price). DeepSeek input uses cache-miss rate. Gemini 3.1 Flash-Lite uses text/image/video input (audio is $0.50/M in).

Provider filter: include only direct provider APIs, Wafer, or Amazon Bedrock. Exclude Azure, Nebius, Baseten, Makora, Together, Groq, Vertex, OpenRouter routing, DeepInfra, Novita, Parasail, and other third-party hosts. Bedrock is the only non-direct cloud exception.

Version filter: keep the newest available version in each model line or size class. Older snapshots and preview aliases are excluded when a newer version replaces them. Benchmark numbers are from Artificial Analysis unless noted.

| Rank | Model / configuration | Fastest provider | Exposed context | Input $/M | Output $/M | Output speed | Notes |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Gemini 3.1 Flash-Lite | Google AI Studio | 1,048,576 input / 65,536 output | $0.25 | $1.50 | 285.9 t/s | Latest Flash-Lite line; direct Google API. |
| 2 | Grok 4.3 high | Amazon Bedrock | 1,000,000 | $1.25 | $2.50 | 229.6 t/s | Latest Grok general model line; Bedrock is allowed by exception. |
| 3 | GLM-5.2 max | Wafer | 1,000,000+ | $1.20 | $4.10 | 219.7 t/s | Latest GLM/Z.ai line; Wafer is explicitly allowed. |
| 4 | Grok 4.20 0309 v2 non-reasoning | xAI | 1,000,000+ | $1.25 | $2.50 | 212.1 t/s | Latest Grok 4.20 non-reasoning line; keep only if treating 4.20 as distinct from Grok 4.3. |
| 5 | Gemini 3.5 Flash minimal | Google AI Studio | 1,048,576 input / 65,536 output | $1.50 | $9.00 | 178.8 t/s | Latest Gemini Flash line; direct Google API. |
| 6 | GPT-4.1 nano | OpenAI | 1,047,576 | $0.10 | $0.40 | 150.8 t/s | Latest 1M nano-class GPT; Azure is faster but excluded by provider filter. |
| 7 | Qwen3.7-Max | Alibaba Cloud | 1,000,000 | $2.50 | $7.50 | 117.4 t/s | Latest qualifying Qwen Max line; direct Alibaba provider. |
| 8 | DeepSeek V4 Flash max | DeepSeek | 1,000,000 | $0.14 | $0.28 | 107.3 t/s | Latest DeepSeek V4 Flash line; Makora is faster but excluded. |
| 9 | Claude Opus 4.8 | Anthropic | 1,000,000 | $5.00 | $25.00 | 68.1 t/s | Latest available Opus line; Fable/Mythos 5 are suspended. |
| 10 | GPT-5.5 | Amazon Bedrock | 1,050,000 | $5.50 | $33.00 | 64.3 t/s | Latest GPT-5 frontier line; Bedrock is slightly faster than OpenAI direct in the benchmark. |

## Excluded Near-Misses

- NVIDIA Nemotron 3 Super on Nebius/Baseten is faster than the top row, but those are excluded by the provider filter. NVIDIA direct 1M throughput was not verified.
- GPT-4.1 nano on Azure reaches 293.8 t/s, but Azure is excluded by the provider filter.
- DeepSeek V4 Flash max on Makora reaches 244.5 t/s, but Makora is excluded by the provider filter.
- Older Gemini Flash reasoning and non-reasoning lines are excluded by the version filter because Gemini 3.5 Flash is the newer Flash line.
- Grok 4.20 older 0309 snapshots are excluded by the version filter; only the v2/current non-reasoning row remains.
- Llama 4 Scout on Groq is faster at about 444 t/s, but Groq is excluded by the provider filter and the Groq endpoint exposes only 131,072 tokens.
- Llama 4 Bedrock endpoints are allowed by provider rule, but the checked Bedrock Llama endpoints expose about 128,000 tokens, below the 1M requirement.
- Command A+ reaches about 199.1 t/s, but its exposed context is well below 1M tokens.
- Mistral, Cohere Command, and current Kimi/Moonshot lines fail the 1M-context gate.

## Sources

### Throughput

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
