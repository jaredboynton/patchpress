#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
echo "## CLAIM: zero observable behavior change -- every provider x renderer dry-run request body is byte-identical to the committed golden fixture captured BEFORE the refactor."
echo "## Fixtures live in tests/fixtures/dry-run-golden/ and were committed in 2502c1d before any refactor."
echo
node scripts/test-provider-dry-parity.mjs
