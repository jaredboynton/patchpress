# Agent Rules

- Favor the most recent version of any model or model family when adding code, docs, defaults, examples, or benchmark configs.
- In this repo, do not reference outdated Gemini Flash/Flash-Lite lines in code or documentation. Use the current Gemini Flash/Flash-Lite line instead.
- Exceptions are allowed only with specific reasoning recorded next to the choice, such as selecting a non-reasoning variant of a newer model family when that is the benchmark target.
- Bedrock Mantle benchmark auth lives in the repo-local ignored `.env`. Source it before Mantle runs, for example `set -a; source .env; set +a`; do not duplicate the key in tracked files.

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

The user command [~/bin/claude](file:///Users/jaredboynton/bin/claude) executes the real binary via `$HOME/.local/bin/claude`. Since our launcher shim occupies `$HOME/.local/bin/claude`, any launch through `~/bin/claude` runs the shim, ensuring any newly installed Claude Code updates are automatically patched before execution.

