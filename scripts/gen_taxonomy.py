#!/usr/bin/env python3
"""
Generate src/lib/taxonomy.ts from the chapter's Excel template.

The template is the single source of truth for item names and row numbers.
Transcribing them by hand drifts: the prototype's CLAUDE.md lists the catch-all
rows as "Other (Plastic)", "Other (Glass/Ceramic)", etc., but the template
actually reads "Other (do not write in the item name, just a number)".

Section boundaries are not hardcoded either -- they are read from the template's
own shared-formula blocks (B18:B33, B35:B42, ...), which partition the item rows
into exactly the 11 sections printed on the data card.

Stdlib only, so this runs anywhere without an install step.

Usage:
    python3 scripts/gen_taxonomy.py
"""

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "assets" / "template" / "data-entry-template.xlsx"
OUT = ROOT / "src" / "lib" / "taxonomy.ts"

# Section name, page side, and printed column for each shared-formula block,
# keyed by the block's first row.
#
# These are read off the physical card (assets/reference/sample-card.pdf), not
# guessed from the spreadsheet: each page of the card is laid out as TWO
# independent columns, each with its own TOTAL column, and the template's
# shared-formula blocks line up exactly with the card's printed sub-blocks.
# That is also why rows 34, 43, 52, ... are spacers -- they are column and
# section breaks on paper.
#
# Note SMOKING is on the BACK of the card, immediately under the
# "PLASTIC & STYROFOAM CONT." banner -- not on the front with the other
# plastics, as the row numbering might suggest.
SECTIONS = {
    18: ("Common & Priority Items", "front", "left"),
    35: ("Food & Beverage Packaging", "front", "right"),
    44: ("Personal Care", "front", "right"),
    53: ("Smoking", "back", "left"),
    59: ("Fishing", "back", "left"),
    71: ("Other (Plastic / Foam)", "back", "left"),
    80: ("Glass", "back", "right"),
    84: ("Paper & Wood", "back", "right"),
    96: ("Metal", "back", "right"),
    102: ("Rubber & Latex", "back", "right"),
    107: ("Other Materials", "back", "right"),
}

HEADER_ROWS = [
    ("dataEntryVolunteer", 1, "Data Entry Volunteer Name"),
    ("club", 3, "Club & Email Contact"),
    ("date", 5, "Date"),
    ("shoreline", 7, "Shoreline"),
    ("volunteers", 9, "Number of volunteers"),
    ("pounds", 11, "Pounds of Trash"),
    ("duration", 13, "Duration"),
]


def load_sheet(path):
    """Return (raw sheet XML, {cell ref -> text}).

    Cell values are resolved through the shared-string table with a real XML
    parser; matching them with a regex silently returns the string *index*
    instead of the string.
    """
    z = zipfile.ZipFile(path)
    shared = []
    try:
        sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in sst.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    except KeyError:
        pass

    raw = z.read("xl/worksheets/sheet1.xml")
    cells = {}
    sheet = ET.fromstring(raw)
    for c in sheet.iter(f"{{{NS['m']}}}c"):
        ref = c.get("r")
        v = c.find("m:v", NS)
        if v is None or v.text is None:
            inline = c.find("m:is", NS)
            if inline is not None:
                cells[ref] = "".join(
                    t.text or "" for t in inline.iter(f"{{{NS['m']}}}t")
                )
            continue
        cells[ref] = shared[int(v.text)] if c.get("t") == "s" else v.text

    return raw.decode(), cells


def cell_text(cells, ref):
    return cells.get(ref)


def blocks(xml):
    """Item-row blocks, straight from the template's shared SUM formulas."""
    out = []
    for m in re.finditer(r'<f t="shared" ref="B(\d+):B(\d+)" si="\d+">', xml):
        out.append((int(m.group(1)), int(m.group(2))))
    return sorted(out)


def ts_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    if not TEMPLATE.exists():
        sys.exit(f"ERROR: template not found at {TEMPLATE}")

    xml, cells = load_sheet(TEMPLATE)
    blks = blocks(xml)
    if len(blks) != len(SECTIONS):
        sys.exit(
            f"ERROR: template has {len(blks)} formula blocks but SECTIONS "
            f"describes {len(SECTIONS)}. The template layout changed -- update "
            f"SECTIONS in this script before regenerating."
        )

    items = []
    for start, end in blks:
        if start not in SECTIONS:
            sys.exit(f"ERROR: no section name for block starting at row {start}")
        section, side, column = SECTIONS[start]
        for row in range(start, end + 1):
            name = cell_text(cells, f"A{row}")
            if not name:
                sys.exit(f"ERROR: expected an item name in A{row}, found none")
            items.append((row, name, section, side, column))

    # Sanity: the SUM range in column B must target C..BZ, which is what the
    # exporter relies on when it writes one column per volunteer from C.
    if "SUM(C18:BZ18)" not in xml:
        sys.exit("ERROR: column B SUM range is not C:BZ -- exporter assumptions break")

    lines = []
    lines.append("// GENERATED FILE -- do not edit by hand.")
    lines.append("// Source: assets/template/data-entry-template.xlsx")
    lines.append("// Regenerate: python3 scripts/gen_taxonomy.py")
    lines.append("//")
    lines.append("// Item names and row numbers are read straight from the chapter's Excel")
    lines.append("// template so the two can never drift. Section boundaries come from the")
    lines.append("// template's own shared-formula blocks.")
    lines.append("")
    lines.append('export type CardSide = "front" | "back";')
    lines.append('/** Each side of the card is printed as two independent columns. */')
    lines.append('export type CardColumn = "left" | "right";')
    lines.append("")
    lines.append("export interface TaxonomyItem {")
    lines.append("  /** 1-based row in the Excel template. Also the stable id for an item. */")
    lines.append("  readonly row: number;")
    lines.append("  /** Item label exactly as it appears in column A of the template. */")
    lines.append("  readonly name: string;")
    lines.append("  /** Printed section heading on the data card. */")
    lines.append("  readonly section: string;")
    lines.append("  /** Which side of the card this item is printed on. */")
    lines.append("  readonly side: CardSide;")
    lines.append("  /** Which printed column of that side, each with its own TOTAL column. */")
    lines.append("  readonly column: CardColumn;")
    lines.append("}")
    lines.append("")
    lines.append("export const TAXONOMY: readonly TaxonomyItem[] = [")
    for row, name, section, side, column in items:
        lines.append(
            f"  {{ row: {row}, name: {ts_string(name)}, "
            f"section: {ts_string(section)}, side: {ts_string(side)}, "
            f"column: {ts_string(column)} }},"
        )
    lines.append("] as const;")
    lines.append("")
    lines.append("/** Header field -> row in column B of the template. */")
    lines.append("export const HEADER_ROWS = {")
    for key, row, label in HEADER_ROWS:
        lines.append(f"  {key}: {{ row: {row}, label: {ts_string(label)} }},")
    lines.append("} as const;")
    lines.append("")
    lines.append("export type HeaderField = keyof typeof HEADER_ROWS;")
    lines.append("")
    lines.append("/** First volunteer column. Column B holds SUM formulas and is never written. */")
    lines.append("export const FIRST_DATA_COLUMN = 3; // C")
    lines.append("/** Last column covered by the template's SUM(C:BZ) formulas. */")
    lines.append("export const LAST_DATA_COLUMN = 78; // BZ")
    lines.append(
        "export const MAX_VOLUNTEERS = LAST_DATA_COLUMN - FIRST_DATA_COLUMN + 1;"
    )
    lines.append("")
    lines.append("const BY_ROW = new Map(TAXONOMY.map((i) => [i.row, i]));")
    lines.append("")
    lines.append("export function itemForRow(row: number): TaxonomyItem | undefined {")
    lines.append("  return BY_ROW.get(row);")
    lines.append("}")
    lines.append("")
    lines.append("export function itemsForSide(side: CardSide): TaxonomyItem[] {")
    lines.append("  return TAXONOMY.filter((i) => i.side === side);")
    lines.append("}")
    lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))

    front = sum(1 for i in items if i[3] == "front")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"  {len(items)} items ({front} front, {len(items) - front} back)")
    print(f"  {len(blks)} sections, rows {items[0][0]}-{items[-1][0]}")


if __name__ == "__main__":
    main()
