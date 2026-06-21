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
2. **durable launch hook** (`~/bin/claude`) — the user's own wrapper, first in
   the interactive PATH and never rewritten by Claude Code's auto-updater (the
   updater only re-symlinks `~/.local/bin/claude` to the new version, per the
   deobfuscated installer at `3761.js:465`). Before exec it resolves the latest
   `versions/<semver>` binary, calls patch-core idempotently when the marker is
   absent, then execs Claude Code. Fail-open: any error here is swallowed so a
   launch is never blocked. This is the mechanism that survives updates.
3. **launcher shim** (`scripts/patcher/launcher-shim.mjs`) — the same
   patch-on-launch logic for an entry point installed at `~/.local/bin/claude`.
   It covers the immediate session, and the auto-updater overwrites it on the
   next update, so `~/bin/claude` carries persistence across versions.
4. **uninstall** — `patch-claude.mjs --restore <binary>` restores the original
   from the `.original` backup (byte-identical, SHA verified) and recreates the
   active symlink.

### Redirect contract

The patched call invokes `node scripts/compact-full-transcript.mjs --provider
mantle` against the live messages via an async `spawn` awaited inside the
compaction function, so the Bun event loop keeps rendering the TUI during the
run. `after-compact.jsonl` produces a Claude-compatible resume wrapper; the
redirect reads `lines[1].message.content[0].text` as the summary and returns it
in the assistant shape the caller's `rW` extractor expects (`5189.js:1551`).
Provider is pinned to `mantle`, whose credential the script auto-loads from the
repo `.env` (`AWS_BEARER_TOKEN_BEDROCK`). On any failure the redirect rethrows
rather than returning a mock, so the autocompact runner (`4409.js:225`) keeps
the un-compacted conversation instead of replacing it with placeholder text.

## Phases (each ends with a failable check)

| Phase | Work | Exit proof |
|---|---|---|
| 0 Feasibility | Can the embedded JS be modified and still run? Try same-length in-place byte patch first (no Bun-trailer changes); fall back to full re-serialization if needed. | A trivially patched binary (e.g. an altered banner string) launches and runs `claude --version`. |
| 1 Locate | Find the autocompact trigger + summarize request in the extracted JS; record a stable anchor. | A finder reports the anchor offset/context in 2.1.185 (and 2.1.183/184 if available). |
| 2 Redirect | Splice the shell-out; map our handoff into the expected return shape. | A live session compaction uses our path (our handoff content observed in the resumed context). |
| 3 Persistence | Durable `~/bin/claude` hook + idempotency + restore. | Fresh version copy -> launch via `~/bin/claude` -> auto-patched (marker + async redirect present), byte-stable on re-launch. |
| 4 Safety | Fail-open when the anchor is missing; preserve original; one-command uninstall; marker/hash bookkeeping. | Anchor removed from a fixture -> shim runs Claude Code unpatched and warns; uninstall restores the original SHA256. |

## Risks

- **Bun re-embedding fidelity** — Phase 0 gates the whole approach.
- **Anchor drift across versions** — mitigated by a structural anchor plus
  fail-open behavior.
- **Auto-update timing** — shim plus watcher give double coverage.
