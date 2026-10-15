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

# The Drive button's settings, for every build and not only TestFlight's: see
# ios/Drive.xcconfig. Read from the gitignored ios/.env.local, written to the
# gitignored Drive.local.xcconfig; nothing is written without the file.
if [ -f "$root/ios/.env.local" ]; then
  (
    # shellcheck disable=SC1091
    . "$root/ios/.env.local"
    # In an xcconfig "//" starts a comment, so a URL's is written "/$()/".
    setting() { [ -n "$2" ] && printf '%s = %s\n' "$1" "$(printf '%s' "$2" | sed 's#//#/$()/#g')"; true; }
    {
      echo "// Written by ios/sync-web.sh from ios/.env.local. Gitignored; do not commit."
      setting GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
      setting GOOGLE_API_KEY "${GOOGLE_API_KEY:-}"
      setting GOOGLE_DRIVE_FOLDER_ID "${GOOGLE_DRIVE_FOLDER_ID:-}"
      setting GOOGLE_PICKER_URL "${GOOGLE_PICKER_URL:-}"
      setting GOOGLE_APP_ID "${GOOGLE_APP_ID:-}"
      setting GOOGLE_SHARED_DRIVES "${GOOGLE_SHARED_DRIVES:-}"
    } > "$root/ios/Drive.local.xcconfig"
  )
  echo "Drive settings written for every build (ios/Drive.local.xcconfig)"
fi

echo "building the web bundle..."
npm run build

dest="$root/ios/SurfriderDataCards/web"
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$root/dist/." "$dest/"

echo "copied $(find "$dest" -type f | wc -l | tr -d ' ') files into ios/SurfriderDataCards/web"

# The version shown at the foot of the first screen: the newest pull request in
# this code, "#73". Written here rather than kept in the repository, so it is
# whatever the build actually contains. See scripts/app-version.sh.
sh "$root/scripts/app-version.sh" > "$dest/version.json"
echo "version $(sed -E 's/.*"version":"([^"]*)".*/\1/' "$dest/version.json")"
