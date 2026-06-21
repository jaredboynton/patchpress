#!/bin/bash
set -e
cd /Users/jaredboynton/__devlocal/claudecompact-patcher
echo "## CLAIM: refactored file is valid and all existing provider tests still pass."
echo
echo "### node --check:"
node --check scripts/compact-full-transcript.mjs && echo "  syntax OK (exit 0)"
echo "### provider schema test:"
node scripts/test-provider-schema.mjs
echo "### handoff user-message + citable-filter tests:"
node scripts/test-handoff-user-messages.mjs
