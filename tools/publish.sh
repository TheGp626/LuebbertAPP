#!/bin/bash
# Publishes the committed HEAD of the redesign branch to /testing/ (test database) and /testinglive/ (live database)
# on main. Never touches the live app (repo root of main) or /experimental/.
#   tools/publish.sh "<commit message>"
# Run from the repo checkout on branch redesign, after committing and pushing the change there.
set -e
MSG=${1:?usage: tools/publish.sh "<commit message>"}
REPO=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'cd "$REPO"; git worktree remove --force "$TMP/main" 2>/dev/null || true; rm -rf "$TMP"' EXIT
cd "$REPO"
[ "$(git rev-parse --abbrev-ref HEAD)" = "redesign" ] || { echo "not on branch redesign"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "uncommitted changes - commit first"; exit 1; }
SHA=$(git rev-parse --short HEAD)
git fetch -q --depth=50 origin main:refs/remotes/origin/main
mkdir -p "$TMP/src" && git archive HEAD | tar -x -C "$TMP/src"
git worktree add -q --detach "$TMP/main" origin/main
python3 "$REPO/tools/build_variant.py" testing "$TMP/src" "$TMP/main" "$TMP/out-t" "$SHA"
python3 "$REPO/tools/build_variant.py" testinglive "$TMP/src" "$TMP/main" "$TMP/out-l" "$SHA"
cd "$TMP/main"
rm -rf testing testinglive && cp -r "$TMP/out-t" testing && cp -r "$TMP/out-l" testinglive
git add -A testing testinglive
if git status --short | grep -v '^.. testing/\|^.. testinglive/' | grep -q .; then echo "unexpected changes outside testing/ and testinglive/"; exit 1; fi
if git diff --cached --quiet; then echo "nothing new to publish"; exit 0; fi
git commit -q -m "$MSG (redesign $SHA)

Co-Authored-By: Claude <noreply@anthropic.com>"
git fetch -q --depth=50 origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD || { echo "main moved meanwhile - run again"; exit 1; }
git -c push.negotiate=true push -q origin HEAD:main 2>&1 | grep -v "moved\|location" || true
echo "published $SHA → main $(git rev-parse --short HEAD)"
