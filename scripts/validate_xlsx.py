#!/usr/bin/env python3
"""
Validate the xlsx export strategy against the chapter's real template.

This is a faithful Python mirror of src/lib/xlsx/sheet-patch.ts and
export.ts. It exists because the export design makes a strong claim --
"patching the worksheet XML in place preserves the shared formulas, the Excel
Table, and the drawing" -- and that claim is worth proving against the actual
file rather than asserting.

Stdlib only. Run:
    python3 scripts/validate_xlsx.py
Writes the filled workbook to out/validation-output.xlsx for opening in Excel.
"""

import re
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "assets" / "template" / "data-entry-template.xlsx"
OUT_DIR = ROOT / "out"
OUT = OUT_DIR / "validation-output.xlsx"

SHEET = "xl/worksheets/sheet1.xml"
WORKBOOK = "xl/workbook.xml"
RELS = "xl/_rels/workbook.xml.rels"
TYPES = "[Content_Types].xml"
PROVENANCE = "xl/worksheets/sheet2.xml"

# Parts that must survive untouched. These are exactly what a read-model-write
# round-trip through a spreadsheet library tends to drop.
MUST_BE_IDENTICAL = [
    "xl/tables/table1.xml",
    "xl/drawings/drawing1.xml",
    "xl/persons/person.xml",
    "xl/styles.xml",
    "xl/sharedStrings.xml",
    "xl/theme/theme1.xml",
    "xl/worksheets/_rels/sheet1.xml.rels",
]

failures = []
checks = 0


def check(cond, label):
    global checks
    checks += 1
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        failures.append(label)


# --------------------------------------------------------------------------
# Mirror of sheet-patch.ts
# --------------------------------------------------------------------------

def escape_xml(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def find_cell(xml, ref):
    m = re.search(r'<c r="%s"(?=[\s/>])' % re.escape(ref), xml)
    if not m:
        raise KeyError(f"cell {ref} not found")
    start = m.start()
    tag_end = xml.index(">", start)
    start_tag = xml[start : tag_end + 1]
    if start_tag.endswith("/>"):
        return start, tag_end + 1, start_tag
    close = xml.index("</c>", tag_end)
    return start, close + 4, start_tag


def style_attr(start_tag):
    m = re.search(r'\ss="(\d+)"', start_tag)
    return f' s="{m.group(1)}"' if m else ""


def render_cell(ref, style, value):
    kind, val = value
    if kind == "number":
        return f'<c r="{ref}"{style}><v>{val}</v></c>'
    return (
        f'<c r="{ref}"{style} t="inlineStr"><is>'
        f'<t xml:space="preserve">{escape_xml(str(val))}</t></is></c>'
    )


def patch_sheet_xml(xml, cells):
    edits = []
    for ref, value in cells.items():
        start, end, start_tag = find_cell(xml, ref)
        edits.append((start, end, render_cell(ref, style_attr(start_tag), value)))
    edits.sort(key=lambda e: -e[0])
    out = xml
    for start, end, text in edits:
        out = out[:start] + text + out[end:]
    return out


def force_full_calc(xml):
    if re.search(r'<calcPr[^>]*fullCalcOnLoad="1"', xml):
        return xml
    if re.search(r"<calcPr\s*/>", xml):
        return re.sub(r"<calcPr\s*/>", '<calcPr fullCalcOnLoad="1"/>', xml)
    if re.search(r"<calcPr\b", xml):
        return re.sub(r"<calcPr\b", '<calcPr fullCalcOnLoad="1"', xml)
    return xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')


def column_name(index):
    n, name = index, ""
    while n > 0:
        n, rem = (n - 1) // 26, (n - 1) % 26
        name = chr(65 + rem) + name
    return name


# --------------------------------------------------------------------------
# Sample event -- shaped like real chapter data, including the tricky bits
# --------------------------------------------------------------------------

EVENT = {
    "date": "2025-08-02",
    "shoreline": "Ocean Beach",
    "volunteers": 5,
    "pounds": 85,
    "durationHours": 2,
    "dataEntryVolunteer": "Test Runner",
    "club": "San Diego CH54 <test@example.org>",  # exercises XML escaping
}

CARDS = [
    # Volunteer 1 -> column C. Includes the "11 vs two tallies" case from the
    # accuracy report.
    {"cardNumber": 1, "pages": [1, 2], "type": "total",
     "values": [(18, 46, 0.98), (19, 2, 0.99), (36, 11, 0.61), (97, 3, 0.95)]},
    # Volunteer 2 -> column D.
    {"cardNumber": 2, "pages": [3, 4], "type": "total",
     "values": [(18, 100, 0.97), (30, 28, 0.55), (32, 50, 0.52), (110, 1, 0.90)]},
    # A tally-only card, low confidence throughout.
    {"cardNumber": 3, "pages": [5, 6], "type": "tally",
     "values": [(18, 7, 0.40), (80, 2, 0.35)]},
    # Last usable column (BZ) -- boundary check.
    {"cardNumber": 76, "pages": [151, 152], "type": "total",
     "values": [(18, 1, 0.99)]},
]

HEADER_ROWS = {
    "dataEntryVolunteer": 1, "club": 3, "date": 5,
    "shoreline": 7, "volunteers": 9, "pounds": 11, "duration": 13,
}


def build_edits():
    edits = {}
    edits[f"B{HEADER_ROWS['dataEntryVolunteer']}"] = ("text", EVENT["dataEntryVolunteer"])
    edits[f"B{HEADER_ROWS['club']}"] = ("text", EVENT["club"])
    edits[f"B{HEADER_ROWS['date']}"] = ("text", EVENT["date"])
    edits[f"B{HEADER_ROWS['shoreline']}"] = ("text", EVENT["shoreline"])
    edits[f"B{HEADER_ROWS['volunteers']}"] = ("number", EVENT["volunteers"])
    edits[f"B{HEADER_ROWS['pounds']}"] = ("number", EVENT["pounds"])
    edits[f"B{HEADER_ROWS['duration']}"] = ("text", f"{EVENT['durationHours']} hours")
    for card in CARDS:
        col = column_name(3 + card["cardNumber"] - 1)
        for row, value, _conf in card["values"]:
            if value > 0:
                edits[f"{col}{row}"] = ("number", value)
    return edits


def provenance_xml():
    rows, r = [], 1

    def text_row(cells):
        nonlocal r
        tds = "".join(
            f'<c r="{column_name(i + 1)}{r}" t="inlineStr"><is>'
            f'<t xml:space="preserve">{escape_xml(str(c))}</t></is></c>'
            for i, c in enumerate(cells)
        )
        rows.append(f'<row r="{r}">{tds}</row>')
        r += 1

    text_row(["Source PDF", "8.2.25_Ocean-Beach_CH54.pdf"])
    text_row(["Generated", "2026-07-28T00:00:00.000Z"])
    text_row(["Event date", EVENT["date"]])
    text_row(["Shoreline", EVENT["shoreline"]])
    text_row(["Cards", str(len(CARDS))])
    text_row([])
    text_row(["Card", "Column", "PDF pages", "Card type", "Item row",
              "Item", "Value", "Confidence", "Source"])
    for card in CARDS:
        col = column_name(3 + card["cardNumber"] - 1)
        for row, value, conf in card["values"]:
            text_row([card["cardNumber"], col, ", ".join(map(str, card["pages"])),
                      card["type"], row, f"item{row}", value, f"{conf:.3f}", "recognized"])
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(rows)}</sheetData></worksheet>"
    )


def main():
    if not TEMPLATE.exists():
        sys.exit(f"ERROR: template not found at {TEMPLATE}")

    src = zipfile.ZipFile(TEMPLATE)
    original = {n: src.read(n) for n in src.namelist()}

    parts = dict(original)
    edits = build_edits()

    parts[SHEET] = patch_sheet_xml(original[SHEET].decode(), edits).encode()
    parts[WORKBOOK] = force_full_calc(original[WORKBOOK].decode()).encode()

    rels = original[RELS].decode()
    used = [int(m) for m in re.findall(r'Id="rId(\d+)"', rels)]
    rel_id = f"rId{max(used) + 1}"
    parts[RELS] = rels.replace(
        "</Relationships>",
        f'<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/'
        f'officeDocument/2006/relationships/worksheet" '
        f'Target="worksheets/sheet2.xml"/></Relationships>',
    ).encode()

    wb = parts[WORKBOOK].decode()
    sheet_ids = [int(m) for m in re.findall(r'sheetId="(\d+)"', wb)]
    parts[WORKBOOK] = wb.replace(
        "</sheets>",
        f'<sheet state="visible" name="Provenance" '
        f'sheetId="{max(sheet_ids) + 1}" r:id="{rel_id}"/></sheets>',
    ).encode()

    parts[TYPES] = original[TYPES].decode().replace(
        "</Types>",
        '<Override ContentType="application/vnd.openxmlformats-officedocument.'
        'spreadsheetml.worksheet+xml" PartName="/xl/worksheets/sheet2.xml"/></Types>',
    ).encode()

    parts[PROVENANCE] = provenance_xml().encode()

    OUT_DIR.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)

    # ---------------- verification ----------------
    print(f"\nWrote {OUT.relative_to(ROOT)}\n")
    print("Verifying the written workbook:")

    out = zipfile.ZipFile(OUT)
    bad = out.testzip()
    check(bad is None, "zip integrity")

    for name in MUST_BE_IDENTICAL:
        check(out.read(name) == original[name], f"{name} byte-identical")

    sheet = out.read(SHEET).decode()

    # The whole point: shared formulas in column B must survive.
    shared_before = original[SHEET].decode().count('t="shared"')
    check(sheet.count('t="shared"') == shared_before == 83,
          f"all {shared_before} shared formulas preserved")
    check('<f t="shared" ref="B18:B33" si="1">SUM(C18:BZ18)</f>' in sheet,
          "master SUM formula B18 intact")
    check('<f t="shared" ref="B107:B110" si="11">SUM(C107:BZ107)</f>' in sheet,
          "master SUM formula B107 intact")

    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    tree = ET.fromstring(out.read(SHEET))
    cells = {}
    for c in tree.iter(f"{{{ns['m']}}}c"):
        v = c.find("m:v", ns)
        if v is not None and v.text is not None:
            cells[c.get("r")] = ("v", v.text, c.get("t"))
        else:
            i = c.find("m:is", ns)
            if i is not None:
                cells[c.get("r")] = (
                    "is", "".join(t.text or "" for t in i.iter(f"{{{ns['m']}}}t")), None)

    check(cells.get("C18") == ("v", "46", None), "volunteer 1 cigarette butts -> C18 = 46")
    check(cells.get("D18") == ("v", "100", None), "volunteer 2 cigarette butts -> D18 = 100")
    check(cells.get("C36") == ("v", "11", None), "the '11 vs ||' value -> C36 = 11")
    check(cells.get("BZ18") == ("v", "1", None), "76th volunteer lands in BZ (last column)")
    check(cells.get("B5") == ("is", "2025-08-02", None), "event date -> B5")
    check(cells.get("B9") == ("v", "5", None), "volunteer count -> B9")
    check(cells.get("B3") == ("is", "San Diego CH54 <test@example.org>", None),
          "XML-escaped club field round-trips")

    # Style preservation: C18 had s="10" in the template.
    m = re.search(r'<c r="C18"[^>]*>', sheet)
    check(m is not None and 's="10"' in m.group(0), "cell style preserved on C18")

    # No item-row column B cell may have been turned into a literal.
    item_rows = set()
    for mm in re.finditer(r'<f t="shared" ref="B(\d+):B(\d+)"', original[SHEET].decode()):
        item_rows.update(range(int(mm.group(1)), int(mm.group(2)) + 1))
    clobbered = [f"B{r}" for r in sorted(item_rows)
                 if re.search(r'<c r="B%d"[^>]*>(?!<f)' % r, sheet)]
    check(not clobbered, f"no column B formula overwritten ({len(item_rows)} rows checked)")

    check('fullCalcOnLoad="1"' in out.read(WORKBOOK).decode(),
          "fullCalcOnLoad set so column B recalculates")
    check('name="Provenance"' in out.read(WORKBOOK).decode(),
          "provenance sheet registered in workbook")
    check("/xl/worksheets/sheet2.xml" in out.read(TYPES).decode(),
          "provenance sheet declared in [Content_Types].xml")
    ET.fromstring(out.read(PROVENANCE))
    check(True, "provenance sheet is well-formed XML")

    # Every part referenced by the rels must actually exist in the zip.
    names = set(out.namelist())
    missing = [t for t in re.findall(r'Target="([^"]+)"', out.read(RELS).decode())
               if not t.startswith("http") and f"xl/{t}" not in names]
    check(not missing, f"all workbook relationship targets exist {missing or ''}")

    print(f"\n{checks - len(failures)}/{checks} checks passed")
    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("Export strategy validated against the real template.")


if __name__ == "__main__":
    main()
