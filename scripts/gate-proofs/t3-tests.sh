#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
echo "## CLAIM: refactored file is valid and all existing provider tests still pass."
echo
echo "### node --check:"
node --check scripts/compact-full-transcript.mjs && echo "  syntax OK (exit 0)"
node --check scripts/patcher/patch-claude.mjs && echo "  patcher syntax OK (exit 0)"
echo "### provider schema test:"
node scripts/test-provider-schema.mjs
echo "### handoff user-message + citable-filter tests:"
node scripts/test-handoff-user-messages.mjs
echo "### tool-output compression strategy tests (onto renderer, dspc, mask):"
node scripts/test-onto-renderer.mjs
node scripts/test-dspc-compression.mjs
node scripts/test-mask-compression.mjs
echo "### tool-use diff formatting tests:"
node scripts/test-tool-use-format.mjs
echo "### patcher anchor + dynamic helper-resolution test:"
node scripts/test-patcher-anchors.mjs
echo "### stable indirection shim test:"
node scripts/test-shim.mjs
echo "### managed ~/bin/claude launcher test:"
node scripts/test-wrapper.mjs
echo "### CLI + installer + launcher-shim syntax:"
node --check scripts/cli.mjs && node --check scripts/install.mjs && node --check scripts/patcher/launcher-shim.mjs && echo "  cli + install + launcher syntax OK (exit 0)"
