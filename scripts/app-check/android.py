"""
Read a scan in the Android app on the emulator, and record what the review screen says
about the boxes named. The counterpart of scripts/app-check/ios.sh.

    python3 scripts/app-check/android.py scans/6.13.25_Seaport-Village_CH54.pdf \\
        "4|Cigarette Butts" "4|Plastic Straws" "4|Plastic Cutlery"

Each target is "card|item", one per argument, as the app's "All cards" list shows them --
or "card|item|section" for the six "Other" rows, which share a name. targets.py checks
them all before anything is built. Writes out/app-check/android-<scan>/log.txt and a
screenshot of each box, and prints the log as it goes. A box that is not on the review
list -- taken as read, or never offered -- is logged as NOT ON THE LIST, which is an
answer, not a failure. A read the app refuses ends the run with an error. With EXPORT=1
it then makes the spreadsheet and copies it into the same directory.

What it reads with is this checkout: `android/sync-web.sh` rebuilds the bundle from src/
and `gradlew installDebug` puts it on the device. With no device attached it boots the
project's emulator, `tally-pixel`, without a window, and leaves it running for the next
check (`adb emu kill` stops it). With more than one attached, set ANDROID_SERIAL.

It drives the screens a volunteer does, through `uiautomator dump` and `adb shell input`:
"Start a cleanup", a beach, "Scan the cards", the system file picker, "Start checking",
"All cards", then each box's row. The scan goes in through the picker because the shell
cannot hand another app a MediaStore URI (android/README.md); a copy pushed to Download
for the run is removed afterwards, unless one was there already.
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

from targets import parse

ROOT = Path(__file__).resolve().parents[2]
SDK = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library" / "Android" / "sdk"))
ADB = str(SDK / "platform-tools" / "adb")
PACKAGE = "com.mateobesse.surfriderdatacards"
KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "Delete"]


def adb(*args: str) -> str:
    return subprocess.run([ADB, *args], capture_output=True, text=True).stdout


def nodes() -> list[dict]:
    """The screen as uiautomator sees it. Never a stale one: a dump that fails, fails."""
    for _ in range(5):
        adb("shell", "rm", "-f", "/sdcard/app-check.xml")
        adb("shell", "uiautomator", "dump", "/sdcard/app-check.xml")
        raw = adb("exec-out", "cat", "/sdcard/app-check.xml")
        if raw.lstrip().startswith("<?xml"):
            break
        time.sleep(1)
    else:
        raise SystemExit("uiautomator could not dump the screen five times running")
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


def wait_any(labels: list[str], timeout: float = 30) -> dict | None:
    end = time.time() + timeout
    while time.time() < end:
        for n in nodes():
            if n["label"] in labels:
                return n
        time.sleep(1.5)
    return None


def wait(label: str, timeout: float = 30) -> dict | None:
    return wait_any([label], timeout)


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
    attached = [ln.split()[0] for ln in adb("devices").splitlines()[1:] if ln.strip()]
    if len(attached) > 1 and not os.environ.get("ANDROID_SERIAL"):
        raise SystemExit(f"{len(attached)} devices attached ({attached}): set ANDROID_SERIAL")
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
    end = time.time() + 300
    while adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        if time.time() > end:
            raise SystemExit("tally-pixel did not finish booting in five minutes")
        time.sleep(2)


def install() -> None:
    env = dict(os.environ)
    studio_jdk = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    env.setdefault("JAVA_HOME", studio_jdk)
    # So a checkout without the gitignored android/local.properties builds too.
    env.setdefault("ANDROID_HOME", str(SDK))
    subprocess.run(["./android/sync-web.sh"], cwd=ROOT, env=env, check=True, capture_output=True)
    subprocess.run(["./gradlew", "-q", "installDebug"], cwd=ROOT / "android", env=env, check=True)


def find_row(card: int, item: str, section: str) -> dict | None:
    """The row on the "All cards" list, scrolling down until it shows or the list ends.

    A row is four texts on one line: "C4", the item, its section, the value. The section
    is matched as well as the name, because six "Other" rows differ only in theirs.
    """
    _, h = size()
    tag = f"C{card}"
    last = None
    for _ in range(300):
        ns = nodes()
        for it in (n for n in ns if n["label"] == item):
            line = [n["label"] for n in ns if abs(n["c"][1] - it["c"][1]) < 90]
            if tag in line and section in line:
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


def to_middle(card: int, item: str, section: str, row: dict) -> dict:
    """Drag the row clear of the header and the pinned button, slowly enough not to fling."""
    _, h = size()
    for _ in range(6):
        y = row["c"][1]
        if h * 0.3 < y < h * 0.62:
            break
        start = min(max(y, h * 0.3), h * 0.75)
        swipe(start, start + (h * 0.45 - y), 1500)
        time.sleep(1)
        row = find_row(card, item, section) or row
    return row


def review_screen() -> list[str]:
    """The review screen's texts, with the keypad taken out and the box's number kept.

    The number in the box sits just before the keypad's "1" ... "9", and is itself often
    a single digit, so the keypad is removed by position rather than by what it says.
    """
    t = texts()
    for k in range(len(t) - len(KEYS) + 1):
        if t[k : k + len(KEYS)] == KEYS:
            return t[:k] + t[k + len(KEYS) :]
    return t


def pick(name: str) -> None:
    """Choose the scan in the system file picker, from Downloads.

    The picker usually opens on Downloads already, with a new file below the fold,
    so it scrolls first. Only when it opened elsewhere is the drawer used -- and its
    "Downloads" is the last one on screen: the first is the page's own heading.
    """
    if not wait("Files in Downloads", 5):
        tap("Show roots")
        time.sleep(1.5)  # the drawer slides in; a tap during it lands nowhere
        downloads = [n for n in nodes() if n["label"] == "Downloads"]
        if not downloads:
            raise SystemExit(f"no Downloads in the picker's drawer\n{texts()}")
        tap_at(*downloads[-1]["c"])
        time.sleep(1.5)
    _, h = size()
    last = None
    for _ in range(30):
        n = wait(name, 2)
        if n:
            tap_at(*n["c"])
            return
        seen = texts()
        if seen == last:
            break
        last = seen
        swipe(h * 0.75, h * 0.35, 600)
    raise SystemExit(f"{name} is not in the picker's Downloads\n{texts()}")


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    scan = Path(sys.argv[1]).resolve()
    if not scan.is_file():
        raise SystemExit(f"no such scan: {sys.argv[1]}")
    targets = parse(sys.argv[2:])

    ensure_device()
    install()
    check = Check(scan)
    remote = f"/sdcard/Download/{scan.name}"
    already = adb("shell", "ls", remote).strip() == remote
    adb("push", str(scan), remote)
    # Indexed by name, so the picker lists it at once: a scan of the whole volume
    # had not reached a newly pushed file by the time the picker opened.
    adb("shell", "content", "call", "--method", "scan_file", "--uri", "content://media",
        "--arg", remote)  # fmt: skip

    try:
        run(check, scan, targets)
    finally:
        if not already:
            adb("shell", "rm", "-f", remote)
    print(f"screenshots in {check.out.relative_to(ROOT)}")


def run(check: Check, scan: Path, targets: list[tuple[int, str, str]]) -> None:
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
    pick(scan.name)

    # Reading ends in "Start checking", or in a scan that could not be read ("Try
    # another scan"), or in a page refused ("Look at that page first").
    began = time.time()
    end = wait_any(["Start checking", "Try another scan", "Look at that page first"], 1800)
    if not end or end["label"] != "Start checking":
        check.shot("reading-refused" if end else "reading-stuck")
        why = "the scan was not read" if end else "reading did not finish in 30 minutes"
        raise SystemExit(f"{why}: {texts()}")
    check.log(f"read in {int(time.time() - began)}s")
    check.shot("reading-done")
    tap("Start checking")
    time.sleep(2)
    check.log(f"review first: {review_screen()}")
    tap("All cards")
    time.sleep(2)
    check.log(f"cards header: {texts()[:4]}")

    for card, item, section in targets:
        row = find_row(card, item, section)
        if not row:
            to_top()
            row = find_row(card, item, section)
        if not row:
            if not wait("Make the spreadsheet", 5):
                raise SystemExit(f"lost the All cards list looking for C{card} {item}\n{texts()}")
            check.log(
                f"NOT ON THE LIST C{card} {item} ({section}): taken as read, or never offered"
            )
            to_top()
            continue
        row = to_middle(card, item, section, row)
        same = [n["label"] for n in nodes() if n["label"] and abs(n["c"][1] - row["c"][1]) < 90]
        check.log(f"row C{card} {item}: {same}")
        tap_at(*row["c"])
        if not wait("Back", 10):
            raise SystemExit(f"the tap did not open C{card} {item}\n{texts()}")
        time.sleep(2)
        check.log(f"review C{card} {item}: {review_screen()}")
        check.shot(f"review-C{card}-{item[:20]}")
        tap("Back")
        time.sleep(1.5)
        to_top()

    # EXPORT=1: make the spreadsheet as the list stands, and copy it out of the app.
    if os.environ.get("EXPORT") == "1":
        tap("Make the spreadsheet")
        time.sleep(1.5)
        tap("Make the spreadsheet")
        if not wait("Ready to send", 120):
            raise SystemExit(f"no spreadsheet: {texts()}")
        check.log(f"exported: {texts()}")
        check.shot("exported")
        # The app keeps only the latest export, in a fresh directory of its own.
        made = adb("shell", "run-as", PACKAGE, "find", ".", "-name", "*.xlsx").split()
        if not made:
            raise SystemExit("no spreadsheet came out")
        data = subprocess.run(
            [ADB, "exec-out", "run-as", PACKAGE, "cat", made[0]], check=True, capture_output=True
        ).stdout
        (check.out / Path(made[0]).name).write_bytes(data)
        check.log(f"spreadsheet: {check.out.relative_to(ROOT) / Path(made[0]).name}")


if __name__ == "__main__":
    main()
