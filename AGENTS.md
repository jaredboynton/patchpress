# Agent Rules

- Favor the most recent version of any model or model family when adding code, docs, defaults, examples, or benchmark configs.
- In this repo, do not reference outdated Gemini Flash/Flash-Lite lines in code or documentation. Use the current Gemini Flash/Flash-Lite line instead.
- Exceptions are allowed only with specific reasoning recorded next to the choice, such as selecting a non-reasoning variant of a newer model family when that is the benchmark target.
- Provider credentials all resolve with no manual setup. The compaction script auto-loads the repo-local gitignored `.env` ([compact-full-transcript.mjs:13](file:///Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/compact-full-transcript.mjs)) and resolves a key per provider:
  - **codex** (the script's default provider): OAuth from `~/.codex/auth.json`, always present; no env key needed.
  - **gemini**: `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in `.env`, mirrored from `~/.zshrc`.
  - **xai**: `XAI_API_KEY` in `.env`, mirrored from `~/.zshrc`.
  - **mantle**: `AWS_BEARER_TOKEN_BEDROCK` (or `MANTLE_API_KEY` / `BEDROCK_MANTLE_API_KEY`) in `.env`.
  - **wafer** (OpenAI-compatible gateway `pass.wafer.ai`, default model `GLM-5.2`): `WAFER_API_KEY` in `.env`, mirrored from `~/.zshrc`. Needs a funded Wafer account balance.
  Keys live only in the gitignored `.env`; do not duplicate them in tracked files. The compaction redirect pins `--provider mantle`, so the live patch runs on the `.env` Bedrock credential.

## Adding a compaction provider

Provider dispatch is table-driven. To add an OpenAI chat-completions-compatible provider, add ONE entry to `PROVIDER_REGISTRY` ([compact-full-transcript.mjs:44](file:///Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/compact-full-transcript.mjs)) with `family: "chat"`, `resolveKey`, `endpoint`, `defaultModel`, and `missingKeyMsg`. Everything else (request builder, endpoint, redaction, SSE parsing, auth gate, Bearer header, metadata fields) reads off `PROVIDER_REGISTRY[PROVIDER].family`, so no other edit is needed. A provider on a genuinely different API shape needs a new family branch in the four family-keyed dispatchers (`buildRequestBody`, `providerEndpoint`, `redactRequestForLog`, `streamAdapter`) plus its own request builder. `scripts/dry-factor.mjs` reports the provider-coupling count (the lower the better); `scripts/test-provider-dry-parity.mjs` proves a dispatch change altered no request body by diffing all provider x renderer dry-runs against `tests/fixtures/dry-run-golden/` (regenerate fixtures intentionally with `--update`).

## Compaction Patcher & Launcher Shim Integration

### Architecture

To substitute native Anthropic API compaction in Claude Code with the custom harness [compact-full-transcript.mjs](file:///Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/compact-full-transcript.mjs), a two-layered patch is implemented:

1. **Patcher Core** ([patch-claude.mjs](file:///Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/patcher/patch-claude.mjs)):
   - Reads the binary file using `latin1` encoding to guarantee a 1-to-1 byte-to-character mapping.
   - Locates the target `Sel` compaction orchestrator function signature in the JS trailer using a flexible regex that handles varying destructured parameters.
   - Calculates the exact brace boundaries of the function body.
   - Writes a byte-aligned minified redirect payload, padded with comments to match the original body length down to the single byte.
   - Creates a `.original` backup of the clean binary and re-signs the patched target using `codesign -f -s -`.

2. **Launcher Shim** ([launcher-shim.mjs](file:///Users/jaredboynton/__devlocal/claudecompact-patcher/scripts/patcher/launcher-shim.mjs)):
   - Installed directly at `~/.local/bin/claude`.
   - On invocation, scans `~/.local/share/claude/versions/` for the latest version by semver.
   - Scans the binary for the patch signature `CLAUDE_COMPACT_PATCH_v1`. If absent, it invokes the patcher on the new binary.
   - Spawns the patched binary, inheriting standard IO and exit codes.
   - Fails open gracefully to the unpatched original binary if parsing or patching fails.

### Wiring into `~/bin/claude`

The user command [~/bin/claude](file:///Users/jaredboynton/bin/claude) is first in the interactive PATH and is not rewritten by Claude Code's auto-updater, which only re-symlinks `~/.local/bin/claude` to the new version (deobfuscated installer `3761.js:465`). Before exec, the wrapper resolves the latest `~/.local/share/claude/versions/<semver>` binary and, when the `CLAUDE_COMPACT_PATCH_v1` marker is absent, runs the patcher on it. This is the durable persistence hook: every post-update version is patched on its first launch. The block fails open, so a patch error never blocks launching Claude Code. `CLAUDE_COMPACT_PATCHER` and `CLAUDE_VERSIONS_DIR` override the patcher and versions-directory paths. The `~/.local/bin/claude` shim performs the same patch-on-launch for the current session; the updater overwrites it on the next update, so `~/bin/claude` is what carries the patch across versions.

## Benchmark procedure (token-compressed)

Tx=`transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl` (sha `22894a74...`, ~595k tok). Per provider P / model M, run BOTH renderers R in {sentinel, stripped}:
`node scripts/compact-full-transcript.mjs --provider P --model M --transcript-renderer R --input Tx --out-dir runs/bench-P-R` (defaults: preserve-tail 16, temp null).
Score each: `node scripts/score-compaction-result.mjs runs/bench-P-R` -> deterministic /100 (`deterministic-compaction-score.v2`).
Judge each: `node scripts/judge-compaction-result.mjs runs/bench-P-R` -> `gpt-5.5`, medium reasoning, 3 trials, per-dimension median, /10.
Then add one `docs/benchmark.md` table row per renderer: Wall, Det /100, Judge /10, input/summary/after tok, Rules/Plans/Promises, Capsules, Cited lines; refresh the Headline. Transient `rate_limit_error` / `ttfb_gate_shed` ("at capacity") -> retry. OpenAI-compatible providers (xai, mantle, wafer) share the chat-completions path.

