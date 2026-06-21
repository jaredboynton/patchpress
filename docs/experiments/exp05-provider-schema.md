# EXP-05 Provider Schema Split

## Result

Accepted.

EXP-05 splits provider-submitted JSON Schema from local validation. Provider
requests now ask only for anchored continuation fields, while the harness
derives local compatibility fields before validation and records separate
provider/local schema fingerprints in `handoff-manifest.json`.

Strict structured outputs require all schema properties to be required, so
legacy optional fields are not exposed in the provider schema:
https://developers.openai.com/api/docs/guides/structured-outputs

## Contract

- Provider schema: `summary_blocks`, `rules_and_invariants`,
  `plans_and_task_state`, `promises_made`, `current_work`,
  `optional_next_step`, and `source_integrity`.
- Local-only derived compatibility fields:
  `primary_request_and_intent`, `key_technical_concepts`,
  `files_and_code_sections`, `errors_and_fixes`, `problem_solving`,
  `pending_tasks`, and `source_lines_used`.
- Mantle provider schema carries the same numeric line bounds as every provider:
  a direct probe confirms Bedrock accepts `minimum`/`maximum` under strict
  `json_schema` (HTTP 200), so there is no provider carve-out.

## Commands

```sh
node scripts/test-provider-schema.mjs
node scripts/test-handoff-user-messages.mjs

for provider in codex gemini xai mantle; do
  node scripts/compact-full-transcript.mjs \
    --input /tmp/cc-schema-inspect.K4CvHb/input.jsonl \
    --dry-run \
    --provider "$provider" >/tmp/compact-dry-$provider.json
done

node scripts/compact-full-transcript.mjs \
  --from-output runs/rebenchmark-codex-gpt-54-low-stripped-2026-06-20/model-output.json \
  --out-dir runs/exp05-schema-split-noapi \
  --no-live-output
```

## Metrics

| Run | Request Bytes | After Tokens | After Bytes | Evidence Capsules | Source Lines | Derived Source Lines | Integrity |
|---|---:|---:|---:|---:|---:|---:|---|
| EXP-04 evidence capsules | 601,907 | 21,278 | 85,715 | 50 | 41 | 41 | pass |
| EXP-05 schema split | 601,526 | 21,261 | 85,650 | 50 | 41 | 41 | pass |

Provider dry-runs:

| Provider | Status | Schema Notes |
|---|---|---|
| Codex `gpt-5.4` | pass | Provider schema omits legacy compatibility arrays and keeps line bounds. |
| Gemini `gemini-3.5-flash` | pass | Provider schema omits legacy compatibility arrays and keeps line bounds. |
| xAI `grok-4.20-0309-non-reasoning` | pass | Provider schema omits legacy compatibility arrays and keeps line bounds. |
| Mantle `xai.grok-4.3` | pass | Provider schema omits legacy compatibility arrays and keeps line bounds. |

## Local Validation

| Field | Value |
|---|---|
| Local validation schema | `summary-local-validation.v1` |
| Local validation fingerprint | `fd19c43d8fc350857611be04f68c97ce141b61593a9ef1378c30f12aa8b762f8` |
| Provider schema fingerprint | `015e813cf00691528b960cf384c3f5647e524715e707f3dddf8922c04cf712d5` |
| Manifest artifacts verified | 13 |

## Validation

- `node --check scripts/compact-full-transcript.mjs`
- `node --check scripts/test-handoff-user-messages.mjs`
- `node --check scripts/test-provider-schema.mjs`
- `node scripts/test-provider-schema.mjs`
- `node scripts/test-handoff-user-messages.mjs`
- provider dry-run matrix for `codex`, `gemini`, `xai`, and `mantle`
- Manifest SHA256 verification over all 13 listed artifacts for the no-API
  replay.

## Behavior Verified

- Provider schemas no longer expose unanchored legacy inventories.
- Minimal provider output without legacy arrays passes after local derivation
  from anchored summary fields.
- `source_lines_used` is derived from anchored spans before validation.
- Handoff state still includes compatibility arrays as local fields.
- Manifest provider metadata includes both provider schema and local validation
  fingerprints.

## Decision

Keep EXP-05 in the selected baseline. It removes avoidable provider-side filler
pressure while preserving strict local validation and deriving compatibility
fields from anchored state.
