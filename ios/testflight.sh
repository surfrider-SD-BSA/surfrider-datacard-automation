#!/bin/sh
#
# Archive the app and upload it to TestFlight.
#
# NOTHING SECRET LIVES IN THIS REPOSITORY. The team, the bundle identifier and
# the App Store Connect API key all come from the environment, because this repo
# is public and because a signing key in a git history is a key you have to
# rotate.
#
# What you need before this will work, none of which can be done from a script:
#
#   1. An Apple Developer Program membership on the account that will own the
#      app. TestFlight is not available on a free account.
#   2. An App Store Connect API key: App Store Connect -> Users and Access ->
#      Integrations -> App Store Connect API -> generate one with "App Manager".
#      Put the downloaded AuthKey_XXXXXXXX.p8 in ~/.appstoreconnect/private_keys/
#      and do not commit it anywhere.
#   3. An app record in App Store Connect whose bundle ID matches BUNDLE_ID
#      below, and a registered App ID for it in the developer portal.
#   4. The share extension is a SECOND bundle, "$BUNDLE_ID.Share", and both it
#      and the app need the App Groups capability on "group.$BUNDLE_ID". No app
#      record is needed for the extension -- it ships inside the app -- but the
#      App ID and the group do have to exist. `-allowProvisioningUpdates` below
#      creates all three the first time this runs, which is why it is there;
#      without it the archive fails at signing with a missing-entitlement error
#      and no hint that a capability is what is missing.
#
# Then:
#
#   export TEAM_ID=ABCDE12345          # Membership Details in the dev portal
#   export BUNDLE_ID=org.example.datacards
#   export ASC_KEY_ID=XXXXXXXXXX       # from the key you generated
#   export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#   ./ios/testflight.sh
#
set -eu

: "${TEAM_ID:?set TEAM_ID to your Apple Developer team identifier}"
: "${ASC_KEY_ID:?set ASC_KEY_ID to your App Store Connect API key id}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID to your App Store Connect issuer id}"
BUNDLE_ID="${BUNDLE_ID:-org.surfrider.sd.datacards}"

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

build_dir="$root/ios/build"
archive="$build_dir/DataCards.xcarchive"
export_dir="$build_dir/export"

# Every upload needs a CFBundleVersion nobody has used before, and App Store
# Connect rejects a repeat rather than replacing it. Seconds since epoch is
# monotonic, fits the field, and needs no state kept anywhere.
build_number="${BUILD_NUMBER:-$(date +%s)}"

echo "==> refreshing the web bundle"
"$root/ios/sync-web.sh"

# APP_BUNDLE_ID, not PRODUCT_BUNDLE_IDENTIFIER: a setting given on the command
# line applies to every target, and handing the app and the share extension the
# same identifier produces an archive App Store Connect rejects. The project
# derives both from this one -- the app is $(APP_BUNDLE_ID) and the extension is
# $(APP_BUNDLE_ID).Share -- and the App Group with them.

# BETA=1 builds the unproven features in. Today that is photographing the cards
# instead of scanning them: the reading wants 200 DPI on the card's short edge
# and nobody has measured a handheld capture against that on a real card, which
# is a thing you learn by giving it to a few people who can, not by reasoning
# about it. Off by default, so an App Store archive cannot pick it up by
# forgetting something.
#
# Two things have to agree for that button to appear, and this is the only place
# they are set together:
#
#   BETA, the Swift compilation condition, which is what `Beta.cameraCapture`
#   reads; and NSCameraUsageDescription, which ships ABSENT because the store
#   build never opens a camera. Presenting VisionKit's scanner without that key
#   does not fail politely -- iOS terminates the app.
#
# The key is added to a copy of Info.plist rather than the committed file, so an
# interrupted beta build cannot leave the store build carrying a camera
# permission it does not use.
beta_settings=""
plist="ios/SurfriderDataCards/Info.plist"
if [ "${BETA:-0}" != "0" ]; then
  beta_plist="$build_dir/Info-beta.plist"
  mkdir -p "$build_dir"
  cp "$plist" "$beta_plist"
  /usr/libexec/PlistBuddy -c \
    "Add :NSCameraUsageDescription string Tally photographs the cleanup data cards so it can find the boxes somebody wrote in. The pictures stay on this phone; only the finished spreadsheet is ever shared." \
    "$beta_plist"
  beta_settings="SWIFT_ACTIVE_COMPILATION_CONDITIONS=BETA INFOPLIST_FILE=$beta_plist"
  echo "==> BETA: camera capture is IN this build, and so is the camera permission"
fi

echo "==> archiving (build $build_number, team $TEAM_ID, bundle $BUNDLE_ID)"
rm -rf "$archive" "$export_dir"
mkdir -p "$build_dir"
# shellcheck disable=SC2086 # beta_settings is deliberately two settings or none
xcodebuild \
  -project ios/SurfriderDataCards.xcodeproj \
  -scheme "Data Cards" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  APP_BUNDLE_ID="$BUNDLE_ID" \
  CURRENT_PROJECT_VERSION="$build_number" \
  $beta_settings \
  archive

echo "==> exporting a signed .ipa"
/usr/libexec/PlistBuddy -c "Add :teamID string $TEAM_ID" ios/ExportOptions.plist 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :teamID $TEAM_ID" ios/ExportOptions.plist
xcodebuild -exportArchive \
  -archivePath "$archive" \
  -exportOptionsPlist ios/ExportOptions.plist \
  -exportPath "$export_dir"
# Leave the committed file as it was found: the team id is not ours to keep.
/usr/libexec/PlistBuddy -c "Delete :teamID" ios/ExportOptions.plist 2>/dev/null || true

ipa=$(find "$export_dir" -name '*.ipa' | head -1)
[ -n "$ipa" ] || { echo "no .ipa was produced"; exit 1; }

echo "==> validating before upload, which is cheaper than a rejection"
xcrun altool --validate-app -f "$ipa" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> uploading to TestFlight"
xcrun altool --upload-app -f "$ipa" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo
echo "Uploaded. App Store Connect takes a few minutes to finish processing."
echo "Internal testers on your team get it without review; external testers"
echo "need Beta App Review first."
