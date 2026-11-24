#!/bin/bash
# All tests, quiet: one summary line when everything passes, otherwise only the failing tests with their message.
#   tools/test.sh            (from anywhere inside the repo)
cd "$(dirname "$0")/.." || exit 1
OUT=$(node --test tests/*.test.js supabase/functions/**/*.test.mjs 2>&1)
PASS=$(echo "$OUT" | grep -E '^# pass ' | awk '{print $3}')
FAIL=$(echo "$OUT" | grep -E '^# fail ' | awk '{print $3}')
if [ "${FAIL:-1}" = "0" ]; then echo "tests ok: $PASS passed"; exit 0; fi
echo "tests FAILED: ${FAIL:-?} failed, ${PASS:-?} passed"
echo "$OUT" | grep -E '^not ok|^\s+(error|expected|actual|location):' | head -40
exit 1
