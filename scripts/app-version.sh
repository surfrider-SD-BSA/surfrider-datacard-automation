#!/bin/sh
#
# The version the apps show at the foot of their first screen, as JSON:
#
#   {"version":"#72","commit":"3e9be18"}
#
# "#72" is the newest pull request in the code being built. Every change here
# lands as a squash-merged pull request whose commit ends "(#72)", so the
# highest such number in the history is the newest change a build contains --
# and it counts up by itself, with nothing to remember to bump. The whole
# history is searched rather than the first-parent line, because android/main
# takes ios/main by merge and its own first parents are merge commits.
#
# "dev" when there is no pull request in the history at all, which is a fresh
# fork. The commit is there for whoever needs to know exactly which one.
#
# Written into the web bundle by ios/sync-web.sh and android/sync-web.sh, and
# read by CleanupsScreen on both.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

pr=$(git log --format=%s 2>/dev/null |
  sed -n -E 's/.*\(#([0-9]+)\)$/\1/p; s/^Merge pull request #([0-9]+) .*/\1/p' |
  sort -n | tail -1)
commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)

if [ -n "$pr" ]; then
  version="#$pr"
else
  version="dev"
fi

printf '{"version":"%s","commit":"%s"}\n' "$version" "$commit"
