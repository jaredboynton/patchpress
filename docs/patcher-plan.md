# Claude Code Compaction Patcher — Plan

Make Claude Code run this repo's external compaction
(`scripts/compact-full-transcript.mjs`) in place of native Anthropic
compaction, and keep the patch applied across Claude Code auto-updates.

## Target (verified 2026-06-20)

| Fact | Value |
|---|---|
| Active binary | `~/.local/share/claude/versions/2.1.185` |
| Type | Mach-O arm64, Bun-compiled standalone (`__BUN` section), embedded minified JS, 206 MB |
| Launcher | `~/.local/bin/claude` is a symlink to the active version |
| Update model | New version dirs appear under `versions/`; the symlink repoints. A one-shot patch does not survive this. |
| Native hooks | `PreCompact` / `PostCompact` exist but only augment compaction; they cannot replace the generated summary |

## Approach: patch the embedded JS, auto-reapplied

Rewrite the compaction call in the binary's embedded JS to shell out to our
compaction path. Persistence is achieved by re-applying the patch to every
version automatically, so an auto-update is followed by an automatic re-patch.

### Components

1. **patch-core** (`scripts/patcher/patch-claude.mjs`) — idempotent and
   version-resilient:
   - extract the embedded JS from the Bun binary;
   - locate the compaction orchestration by a stable structural anchor (the
     compaction system-prompt text / summarize call), not a byte offset;
   - splice a redirect that runs our compaction and returns the handoff in the
     shape Claude Code expects from native compaction;
   - write the patched binary atomically; record a marker plus the original
     SHA256 so re-runs are no-ops and the original can be restored.
2. **launcher shim** (takes over `~/.local/bin/claude`) — on each launch:
   resolve the active version, ensure it is patched (call patch-core
   idempotently), then exec it. Guarantees a freshly-updated version is patched
   before first real use. If the anchor is absent (a major Claude Code refactor),
   warn and exec the unpatched binary so Claude Code never breaks.
3. **version watcher** (optional launchd LaunchAgent) — watches `versions/` and
   patches new versions on arrival, covering non-shim entry points
   (`ClaudeCode.app`).
4. **uninstall** — restore the original launcher and remove patched
   binaries/markers in one command.

### Redirect contract

The patched call invokes `node scripts/compact-full-transcript.mjs` against the
live transcript and returns its handoff as the compaction result;
`after-compact.jsonl` already produces a Claude-compatible resume wrapper.
Default backend `gemini-3.5-flash` (the benchmark default in `docs/benchmark.md`),
overridable by env.

## Phases (each ends with a failable check)

| Phase | Work | Exit proof |
|---|---|---|
| 0 Feasibility | Can the embedded JS be modified and still run? Try same-length in-place byte patch first (no Bun-trailer changes); fall back to full re-serialization if needed. | A trivially patched binary (e.g. an altered banner string) launches and runs `claude --version`. |
| 1 Locate | Find the autocompact trigger + summarize request in the extracted JS; record a stable anchor. | A finder reports the anchor offset/context in 2.1.185 (and 2.1.183/184 if available). |
| 2 Redirect | Splice the shell-out; map our handoff into the expected return shape. | A live session compaction uses our path (our handoff content observed in the resumed context). |
| 3 Persistence | Launcher shim + watcher + idempotency + restore. | Simulate an update (fresh version copy) -> shim auto-patches -> compaction still redirected. |
| 4 Safety | Fail-open when the anchor is missing; preserve original; one-command uninstall; marker/hash bookkeeping. | Anchor removed from a fixture -> shim runs Claude Code unpatched and warns; uninstall restores the original SHA256. |

## Risks

- **Bun re-embedding fidelity** — Phase 0 gates the whole approach.
- **Anchor drift across versions** — mitigated by a structural anchor plus
  fail-open behavior.
- **Auto-update timing** — shim plus watcher give double coverage.
