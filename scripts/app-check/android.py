"""
Read a scan in the Android app on the emulator, and record what the review screen says
about the boxes named. The counterpart of scripts/app-check/ios.sh.

    python3 scripts/app-check/android.py scans/6.13.25_Seaport-Village_CH54.pdf \\
        "4|Cigarette Butts;4|Plastic Straws;4|Plastic Cutlery"

Each target is a card number and an item name, as the app's "All cards" list shows them.
Writes out/app-check/android-<scan>/log.txt and a screenshot of each box, and prints the
log as it goes. A box the tool took as read is not on the review list, and is logged as
MISSING -- which is the answer, not a failure.

What it reads with is this checkout: `android/sync-web.sh` rebuilds the bundle from src/
and `gradlew installDebug` puts it on the device. With no device attached it boots the
project's emulator, `tally-pixel`, without a window, and leaves it running for the next
check (`adb emu kill` stops it).

It drives the screens a volunteer does, through `uiautomator dump` and `adb shell input`:
"Start a cleanup", a beach, "Scan the cards", the system file picker, "Start checking",
"All cards", then each box's row. The scan goes in through the picker because the shell
cannot hand another app a MediaStore URI (android/README.md).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SDK = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library" / "Android" / "sdk"))
ADB = str(SDK / "platform-tools" / "adb")
PACKAGE = "com.mateobesse.surfriderdatacards"
KEYPAD = set("0123456789") | {"C", "Delete"}


def adb(*args: str) -> str:
    return subprocess.run([ADB, *args], capture_output=True, text=True).stdout


def nodes() -> list[dict]:
    raw = ""
    for _ in range(5):
        adb("shell", "uiautomator", "dump", "/sdcard/app-check.xml")
        raw = adb("exec-out", "cat", "/sdcard/app-check.xml")
        if raw.lstrip().startswith("<?xml"):
            break
        time.sleep(1)
    out = []
    for n in ET.fromstring(raw).iter("node"):
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            label = n.get("text") or n.get("content-desc") or ""
            out.append(
                {"label": label, "cls": n.get("class", ""), "c": ((x1 + x2) // 2, (y1 + y2) // 2)}
            )
    return out


def texts() -> list[str]:
    return [n["label"] for n in nodes() if n["label"]]


def wait(label: str, timeout: float = 30) -> dict | None:
    end = time.time() + timeout
    while time.time() < end:
        for n in nodes():
            if n["label"] == label:
                return n
        time.sleep(1.5)
    return None


def tap_at(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def tap(label: str, timeout: float = 30) -> None:
    n = wait(label, timeout)
    if not n:
        raise SystemExit(f"not on screen: {label!r}\n{texts()}")
    tap_at(*n["c"])


def size() -> tuple[int, int]:
    w, h = re.search(r"(\d+)x(\d+)", adb("shell", "wm", "size")).groups()
    return int(w), int(h)


def swipe(y1: float, y2: float, ms: int) -> None:
    w, h = size()
    adb("shell", "input", "swipe", str(w // 2), str(int(y1)), str(w // 2), str(int(y2)), str(ms))


class Check:
    def __init__(self, scan: Path):
        self.out = ROOT / "out" / "app-check" / f"android-{scan.stem}"
        shutil.rmtree(self.out, ignore_errors=True)
        self.out.mkdir(parents=True)

    def log(self, line: str) -> None:
        print(line, flush=True)
        with (self.out / "log.txt").open("a") as f:
            f.write(line + "\n")

    def shot(self, name: str) -> None:
        png = subprocess.run([ADB, "exec-out", "screencap", "-p"], capture_output=True).stdout
        (self.out / (name.replace("/", "-") + ".png")).write_bytes(png)


def ensure_device() -> None:
    if adb("get-state").strip() == "device":
        return
    emulator = SDK / "emulator" / "emulator"
    print("no device attached: booting tally-pixel without a window", flush=True)
    subprocess.Popen(
        [str(emulator), "-avd", "tally-pixel", "-no-window", "-no-audio", "-no-boot-anim"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    adb("wait-for-device")
    while adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        time.sleep(2)


def install() -> None:
    env = dict(os.environ)
    studio_jdk = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    env.setdefault("JAVA_HOME", studio_jdk)
    subprocess.run(["./android/sync-web.sh"], cwd=ROOT, env=env, check=True, capture_output=True)
    subprocess.run(["./gradlew", "-q", "installDebug"], cwd=ROOT / "android", env=env, check=True)


def find_row(card: int, item: str) -> dict | None:
    """The row for this card and item on the "All cards" list, scrolling down until it shows."""
    _, h = size()
    tag = f"C{card}"
    last = None
    for _ in range(300):
        ns = nodes()
        for it in (n for n in ns if n["label"] == item):
            if any(n["label"] == tag and abs(n["c"][1] - it["c"][1]) < 90 for n in ns):
                return it
        seen = "|".join(n["label"] for n in ns)
        if seen == last:
            return None
        last = seen
        swipe(h * 0.75, h * 0.35, 600)
        time.sleep(0.8)
    return None


def to_top() -> None:
    _, h = size()
    for _ in range(60):
        before = texts()
        swipe(h * 0.3, h * 0.85, 150)
        if texts() == before:
            return


def to_middle(card: int, item: str, row: dict) -> dict:
    """Drag the row clear of the header and the pinned button, slowly enough not to fling."""
    _, h = size()
    for _ in range(6):
        y = row["c"][1]
        if h * 0.3 < y < h * 0.62:
            break
        start = min(max(y, h * 0.3), h * 0.75)
        swipe(start, start + (h * 0.45 - y), 1500)
        time.sleep(1)
        row = find_row(card, item) or row
    return row


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    scan = Path(sys.argv[1]).resolve()
    targets = []
    for t in sys.argv[2].split(";"):
        card, _, item = t.partition("|")
        targets.append((int(card), item))

    ensure_device()
    install()
    check = Check(scan)
    adb("push", str(scan), "/sdcard/Download/")
    adb("shell", "content", "call", "--method", "scan_volume", "--uri", "content://media",
        "--arg", "external_primary")  # fmt: skip

    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    # Always on the first screen. A draft offered beside it is left where it is.
    tap("Start a cleanup", 20)

    # Screen 2: the date defaults to today; a beach is needed.
    field = next(n for n in nodes() if n["cls"].endswith("EditText"))
    tap_at(*field["c"])
    adb("shell", "input", "text", "App%sCheck%sBeach")
    adb("shell", "input", "keyevent", "111")  # the keyboard away
    tap("Scan the cards")
    tap("Choose a scanned PDF")

    # The system picker, which opens on Downloads.
    if not wait(scan.name, 10):
        tap("Show roots")
        tap("Downloads")
    tap(scan.name)
    began = time.time()
    if not wait("Start checking", 1800):
        check.shot("reading-stuck")
        raise SystemExit(f"reading did not finish: {texts()}")
    check.log(f"read in {int(time.time() - began)}s")
    check.shot("reading-done")
    tap("Start checking")
    time.sleep(2)
    check.log(f"review first: {texts()}")
    tap("All cards")
    time.sleep(2)
    check.log(f"cards header: {texts()[:4]}")

    for card, item in targets:
        row = find_row(card, item)
        if not row:
            to_top()
            row = find_row(card, item)
        if not row:
            check.log(f"MISSING C{card} {item}: not on the review list")
            to_top()
            continue
        row = to_middle(card, item, row)
        same = [n["label"] for n in nodes() if n["label"] and abs(n["c"][1] - row["c"][1]) < 90]
        check.log(f"row C{card} {item}: {same}")
        tap_at(*row["c"])
        time.sleep(3)
        check.log(f"review C{card} {item}: {[t for t in texts() if t not in KEYPAD]}")
        check.shot(f"review-C{card}-{item[:20]}")
        tap("Back")
        time.sleep(1.5)
        to_top()

    print(f"screenshots in {check.out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
