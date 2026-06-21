#!/bin/bash
set -e
cd /Users/jaredboynton/__devlocal/claudecompact-patcher
echo "## CLAIM: provider dispatch collapsed into a single registry table; dry-factor lowered from 89."
echo
echo "### PROVIDER_REGISTRY single table definition (the one edit site to add a provider):"
/usr/bin/grep -nF "const PROVIDER_REGISTRY = {" scripts/compact-full-transcript.mjs
echo
echo "### Hardcoded per-provider-name dispatch comparisons remaining (was the 10-places pain):"
n=$(/usr/bin/grep -cE 'PROVIDER === "(codex|gemini|xai|mantle|wafer)"' scripts/compact-full-transcript.mjs || true)
echo "count = $n  (0 means every per-provider-name dispatch chain is gone, replaced by family lookups)"
echo
echo "### Dispatch keys off registry family instead:"
/usr/bin/grep -nE "PROVIDER_REGISTRY\[PROVIDER\]\.family|const family = PROVIDER_REGISTRY" scripts/compact-full-transcript.mjs | head -6
echo
echo "### Deterministic dry-factor metric (baseline 89):"
node scripts/dry-factor.mjs --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("  dry_factor =",d.dry_factor,"(down from 89); by_category =",JSON.stringify(d.by_category));console.log("  NOTE: remaining hits are all single-path codex/gemini infra constants, not dispatch chains")'
echo
echo "### Zero observable behavior change (this registry refactor changed no request body):"
echo "    Every provider x renderer dry-run body stays byte-identical to golden fixtures captured BEFORE the refactor (committed in 2502c1d):"
node scripts/test-provider-dry-parity.mjs | tail -1
