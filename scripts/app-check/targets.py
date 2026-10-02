"""
The boxes an app check looks at, named and checked before anything is built.

    python3 scripts/app-check/targets.py "4|Cigarette Butts" "4|Plastic Straws"
    python3 scripts/app-check/targets.py \
        "2|Other (do not write in the item name, just a number)|Glass"

One target per argument, as "card|item" or "card|item|section". Prints them one per line
as "card|item|section", or fails. ios.sh and android.py both read targets through here.

Three things this exists to stop:

- **Targets packed into one string.** They used to be one argument split on ";", and
  "Treated Wood (i.e. pallets; NOT driftwood)" has a ";" in it.
- **A typo coming back as MISSING.** MISSING means the box is not on the app's review
  list -- taken as read, or never offered -- and an item name the card does not have is
  not that. It is refused here, before a build.
- **The six "Other" rows.** They share a name, and the app lists each under its own
  section, so the section is how one is told from another. It is required for those and
  filled in for every other item.
"""

from __future__ import annotations

import difflib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def taxonomy() -> list[tuple[str, str]]:
    """(name, section) for every item on the card, from src/lib/taxonomy.ts."""
    src = (ROOT / "src" / "lib" / "taxonomy.ts").read_text()
    found = re.findall(
        r'\{\s*row:\s*\d+,\s*name:\s*"((?:[^"\\]|\\.)*)",\s*section:\s*"((?:[^"\\]|\\.)*)"', src
    )
    if len(found) < 50:
        raise SystemExit("could not read the item list from src/lib/taxonomy.ts")
    return found


def parse(args: list[str]) -> list[tuple[int, str, str]]:
    """Each argument as (card, item, section), or an exit naming everything wrong with them."""
    items = taxonomy()
    sections: dict[str, list[str]] = {}
    for name, section in items:
        sections.setdefault(name, []).append(section)

    out, errors = [], []
    for arg in args:
        parts = arg.split("|")
        if len(parts) not in (2, 3) or not parts[0].strip().isdigit() or int(parts[0]) < 1:
            errors.append(f'{arg!r}: expected "card|item" or "card|item|section"')
            continue
        card, item = int(parts[0]), parts[1].strip()
        known = sections.get(item)
        if not known:
            close = difflib.get_close_matches(item, list(sections), n=3, cutoff=0.6)
            hint = f" -- did you mean {' or '.join(repr(n) for n in close)}?" if close else ""
            errors.append(f"{arg!r}: no item called {item!r} on the card{hint}")
            continue
        section = parts[2].strip() if len(parts) == 3 else None
        if section is None:
            if len(known) > 1:
                errors.append(
                    f"{arg!r}: {len(known)} items share that name; add one of the sections: {known}"
                )
                continue
            section = known[0]
        elif section not in known:
            errors.append(
                f"{arg!r}: {item!r} is not in a section called {section!r}; it is in {known}"
            )
            continue
        out.append((card, item, section))

    if errors or not out:
        raise SystemExit("\n".join(errors) if errors else "no targets given")
    return out


if __name__ == "__main__":
    for card, item, section in parse(sys.argv[1:]):
        print(f"{card}|{item}|{section}")
