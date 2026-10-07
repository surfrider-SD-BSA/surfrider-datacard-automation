#!/usr/bin/env bash
#
# Read a scan in the iOS app on a simulator, and record what the review screen
# says about the boxes named.
#
#   scripts/app-check/ios.sh scans/6.13.25_Seaport-Village_CH54.pdf \
#     "4|Cigarette Butts" "4|Plastic Straws" "4|Plastic Cutlery"
#
# Each target is "card|item", one per argument, as the app's "All cards" list
# shows them -- or "card|item|section" for the six "Other" rows, which share a
# name (scripts/app-check/targets.py checks them all before anything is built).
# Writes out/app-check/ios-<scan>/log.txt and a screenshot of each box, and
# prints the log. A box that is not on the review list is logged as NOT ON THE
# LIST -- taken as read, or never offered -- which is an answer, not a failure.
# Exits non-zero when the UI test itself fails. With EXPORT=1 it then makes the
# spreadsheet and copies it into the same directory.
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

if [ $# -lt 2 ]; then
  sed -n '3,16p' "$0" >&2
  exit 2
fi
# Made absolute before the cd below, so a path relative to wherever this was run
# from means what it says.
scan="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [ ! -f "$scan" ]; then
  echo "no such scan: $1" >&2
  exit 2
fi
shift

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
targets="$(python3 scripts/app-check/targets.py "$@")"

if [ -z "${DEVELOPER_DIR:-}" ]; then
  selected="$(xcode-select -p)"
  case "$selected" in
    *CommandLineTools*)
      for xcode in /Applications/Xcode-beta.app /Applications/Xcode.app; do
        if [ -d "$xcode" ]; then
          DEVELOPER_DIR="$xcode/Contents/Developer"
          break
        fi
      done
      ;;
    *)
      # A full Xcode is already selected -- after the `sudo xcode-select -s` the
      # Claude Code simulator tools ask for, for instance.
      DEVELOPER_DIR="$selected"
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

# Matched on the device type as well as the name, so DEVICE_TYPE is honoured
# when an "App Check" of another type already exists: each type gets its own.
udid="$(xcrun simctl list devices -j | python3 -c '
import json, sys
name, runtime, kind = sys.argv[1], sys.argv[2], sys.argv[3]
for d in json.load(sys.stdin)["devices"].get(runtime, []):
    if d["name"] == name and d["isAvailable"] and d.get("deviceTypeIdentifier") == kind:
        print(d["udid"])
        break
' "$name" "$runtime" "$device_type")"
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
status=0
TEST_RUNNER_OUT="$out" TEST_RUNNER_TARGETS="$targets" TEST_RUNNER_EXPORT="${EXPORT:-0}" \
  xcodebuild test-without-building -project ios/build-uitest/Harness.xcodeproj -scheme Harness \
  -destination "id=$udid" -derivedDataPath "$dd" > "$out/xcodebuild.log" 2>&1 || status=$?

# EXPORT=1: the spreadsheet the app made, from its temporary directory.
if [ "${EXPORT:-0}" = 1 ]; then
  # The newest: each export gets a fresh directory, and earlier runs' are kept.
  made="$(ls -t "$(xcrun simctl get_app_container "$udid" "$bundle" data)"/tmp/*/*.xlsx 2>/dev/null | head -1)"
  if [ -n "$made" ]; then cp "$made" "$out/"; fi
  ls "$out"/*.xlsx 2>/dev/null || echo "no spreadsheet came out" >&2
fi

# The log as far as it got, then the verdict: a run cut short is not a result.
if [ -f "$out/log.txt" ]; then cat "$out/log.txt"; fi
echo "screenshots in ${out#"$root"/}"
if [ "$status" -ne 0 ]; then
  echo "the UI test failed (xcodebuild exit $status): see ${out#"$root"/}/xcodebuild.log" >&2
  grep -m 3 -E "error: |XCTAssert" "$out/xcodebuild.log" >&2 || true
  exit 1
fi
