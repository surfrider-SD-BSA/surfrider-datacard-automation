#!/usr/bin/env bash
#
# Read a scan in the iOS app on a simulator, and record what the review screen
# says about the boxes named.
#
#   scripts/app-check/ios.sh scans/6.13.25_Seaport-Village_CH54.pdf \
#     "4|Cigarette Butts;4|Plastic Straws;4|Plastic Cutlery"
#
# Each target is a card number and an item name, as the app's "All cards" list
# shows them. Writes out/app-check/ios-<scan>/log.txt and a screenshot of each
# box, and prints the log. A box the tool took as read is not on the review
# list, and is logged as MISSING -- which is the answer, not a failure.
#
# It needs no `xcode-select` switch, which needs the owner's password: every
# command is given DEVELOPER_DIR. And it never touches a simulator it did not
# make: it reads on its own device, "App Check" (an iPhone 17 on iOS 27.0 unless
# DEVICE_TYPE and RUNTIME say otherwise), made the first time and kept. Other
# sessions on this Mac boot and shut down simulators of their own, so "booted"
# is never used to mean this one.
#
# What it builds is this checkout: `ios/sync-web.sh` rebuilds the bundle from
# src/, the UI-test target comes from `ios_harness.py`, and everything generated
# lands in the gitignored ios/build-uitest/.
set -euo pipefail

if [ $# -ne 2 ]; then
  sed -n '3,9p' "$0" >&2
  exit 2
fi
scan="$1"
targets="$2"

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if [ -z "${DEVELOPER_DIR:-}" ]; then
  case "$(xcode-select -p)" in
    *CommandLineTools*)
      for xcode in /Applications/Xcode-beta.app /Applications/Xcode.app; do
        if [ -d "$xcode" ]; then
          DEVELOPER_DIR="$xcode/Contents/Developer"
          break
        fi
      done
      ;;
  esac
fi
if [ -z "${DEVELOPER_DIR:-}" ]; then
  echo "no full Xcode found; set DEVELOPER_DIR" >&2
  exit 1
fi
export DEVELOPER_DIR

name="App Check"
device_type="${DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}"
runtime="${RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-27-0}"
bundle=com.mateobesse.surfriderdatacards

udid="$(xcrun simctl list devices -j | python3 -c '
import json, sys
name, runtime = sys.argv[1], sys.argv[2]
for d in json.load(sys.stdin)["devices"].get(runtime, []):
    if d["name"] == name and d["isAvailable"]:
        print(d["udid"])
        break
' "$name" "$runtime")"
if [ -z "$udid" ]; then
  udid="$(xcrun simctl create "$name" "$device_type" "$runtime")"
  echo "made the simulator \"$name\": $udid"
fi
# Booted again right before each use, not only here: on this Mac other sessions'
# simulator work has been seen to shut a running device down under a check.
boot() { xcrun simctl bootstatus "$udid" -b > /dev/null; }

./ios/sync-web.sh > /dev/null
python3 scripts/app-check/ios_harness.py > /dev/null

dd=ios/build-uitest/dd
# Signed ad hoc, so that the App Group drawer exists on the simulator.
xcodebuild build-for-testing -project ios/build-uitest/Harness.xcodeproj -scheme Harness \
  -destination "id=$udid" -derivedDataPath "$dd" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= -quiet

boot
xcrun simctl install "$udid" "$dd/Build/Products/Debug-iphonesimulator/Data Cards.app"
drawer="$(xcrun simctl get_app_container "$udid" "$bundle" "group.$bundle")/Inbox"
mkdir -p "$drawer"
# Named the way SharedInbox.deposit names what the share extension leaves.
cp "$scan" "$drawer/$(uuidgen)__$(basename "$scan")"

out="$root/out/app-check/ios-$(basename "$scan" .pdf)"
rm -rf "$out"
mkdir -p "$out"

boot
TEST_RUNNER_OUT="$out" TEST_RUNNER_TARGETS="$targets" \
  xcodebuild test-without-building -project ios/build-uitest/Harness.xcodeproj -scheme Harness \
  -destination "id=$udid" -derivedDataPath "$dd" > "$out/xcodebuild.log" 2>&1 \
  || echo "the UI test failed: see $out/xcodebuild.log" >&2

cat "$out/log.txt"
echo "screenshots in ${out#"$root"/}"
