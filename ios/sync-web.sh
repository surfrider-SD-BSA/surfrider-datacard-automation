#!/bin/sh
#
# Put a fresh copy of the built web bundle inside the iOS app.
#
# The app ships `dist/` verbatim and runs it offline, so the two must not drift:
# an app built against a stale bundle is the kind of bug that looks like a
# reading regression and is not one. Run this after any change to src/, or just
# run it before every build -- it takes under a second.
#
# check-dist.mjs runs as part of `npm run build` and is what stops volunteer
# data being copied in here. Do not route around it.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

echo "building the web bundle..."
npm run build

dest="$root/ios/SurfriderDataCards/web"
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$root/dist/." "$dest/"

echo "copied $(find "$dest" -type f | wc -l | tr -d ' ') files into ios/SurfriderDataCards/web"
