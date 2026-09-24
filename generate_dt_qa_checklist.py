"""
Designer Textile – QA Checklist Generator
Generates an Excel workbook with two sheets:

  Sheet 1 – Panel Combos  : every Fabric × Shade combination (275 rows)
  Sheet 2 – Emboss Combos : every Fabric × Shade × Emboss Pattern × Size
                            (only valid combos per the availableSizes gate)

Run:
    python generate_dt_qa_checklist.py

Output: designer_textile_qa_checklist.xlsx (in this folder)
"""

import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ──────────────────────────────────────────────────────────────
# Data (mirrored from frontend/src/data/skus.js)
# ──────────────────────────────────────────────────────────────

COLOR_GROUPS = [
    {"id": "Blue",    "shades": ["Blue_1","Blue_2","Blue_3","Blue_4","Blue_5","Blue_6","Blue_7","Blue_8"],
     "hexes": ["#7AA4BD","#355270","#7A869A","#8BAECA","#95A6B8","#026C84","#7CACB6","#8CBEBD"]},
    {"id": "Green",   "shades": ["Green_1","Green_2","Green_3","Green_4","Green_5","Green_6","Green_7"],
     "hexes": ["#5A8059","#667E64","#5F897B","#4B7A6A","#817B41","#A4A272","#949456"]},
    {"id": "Grey",    "shades": ["Grey_1","Grey_2","Grey_3","Grey_4","Grey_5","Grey_6","Grey_7","Grey_8","Grey_9","Grey_10"],
     "hexes": ["#DADADA","#DBD8CF","#969696","#737977","#6F696B","#7B7B7B","#AEB3B7","#B3AEAA","#6F7478","#A19AA2"]},
    {"id": "Neutral", "shades": ["Neutral_1","Neutral_2","Neutral_3","Neutral_4","Neutral_5","Neutral_6",
                                  "Neutral_7","Neutral_8","Neutral_9","Neutral_10","Neutral_11"],
     "hexes": ["#D7CEC8","#CDB9A9","#735243","#D1B59A","#CDAE90","#A78C6C",
               "#BAAE98","#D1A684","#785C46","#D4B690","#E1D3C8"]},
    {"id": "Yellow",  "shades": ["Yellow_1","Yellow_2","Yellow_3","Yellow_4","Yellow_5"],
     "hexes": ["#E0B026","#F1B93E","#EBCA42","#F2D66A","#EDD388"]},
    {"id": "Rust",    "shades": ["Rust_1","Rust_2","Rust_3","Rust_4","Rust_5"],
     "hexes": ["#7F311A","#5E2118","#975F34","#9A3A24","#934A27"]},
    {"id": "Brown",   "shades": ["Brown_1","Brown_2","Brown_3","Brown_4"],
     "hexes": ["#84522F","#725432","#5E4831","#97775E"]},
    {"id": "Pink",    "shades": ["Pink_1","Pink_2","Pink_3","Pink_4","Pink_5"],
     "hexes": ["#986466","#94716D","#C19CA3","#BD908F","#CAAFBA"]},
]

FABRICS = ["FB1", "FB2", "FB3", "FB4", "FB5"]

SIZES = ["1200x2800", "1200x2400", "600x600", "600x1200"]

EMBOSS_PATTERNS = [
    {"id": "ribbed_25mm", "name": "Ribbed 25mm",  "sizes": ["1200x2800", "1200x2400"]},
    {"id": "ribbed_45mm", "name": "Ribbed 45mm",  "sizes": ["1200x2800", "1200x2400"]},
    {"id": "ribbed_60mm", "name": "Ribbed 60mm",  "sizes": ["1200x2800", "1200x2400"]},
    {"id": "ribbed_duo",  "name": "Ribbed Duo",   "sizes": ["1200x2800", "1200x2400"]},
    {"id": "elliptera",   "name": "Elliptera",    "sizes": ["1200x2800", "1200x2400"]},
    {"id": "ellipsia",    "name": "Ellipsia",     "sizes": ["1200x2800", "1200x2400"]},
    {"id": "flux_ribbed", "name": "Flux Ribbed",  "sizes": ["1200x2800", "1200x2400"]},
    {"id": "drift",       "name": "Drift",        "sizes": ["1200x2800", "1200x2400"]},
    {"id": "aqualine",    "name": "Aqualine",     "sizes": ["1200x2800", "1200x2400"]},
    {"id": "tappered",    "name": "Tapered",      "sizes": ["1200x2800", "1200x2400"]},
    {"id": "weave",       "name": "Weave",        "sizes": ["1200x2800", "1200x2400"]},
    {"id": "bloom",       "name": "Bloom",        "sizes": ["1200x2800", "1200x2400"]},
    {"id": "afterflute",  "name": "Afterflute",   "sizes": ["1200x2800", "1200x2400"]},
    {"id": "penray",      "name": "Penray",       "sizes": ["1200x2800", "1200x2400"]},
    {"id": "shard",       "name": "Shard",        "sizes": ["1200x2800", "1200x2400"]},
    {"id": "axis",        "name": "Axis",         "sizes": ["1200x2400", "600x600", "600x1200"]},
    {"id": "square_8",    "name": "Square 8",     "sizes": ["1200x2400", "600x600", "600x1200"]},
    {"id": "square_30",   "name": "Square 30",    "sizes": ["1200x2400", "600x600", "600x1200"]},
    {"id": "deck",        "name": "Deck",         "sizes": ["1200x2400", "600x600", "600x1200"]},
    {"id": "triangle",    "name": "Triangle",     "sizes": ["1200x2400", "600x600", "600x1200"]},
    {"id": "symmetric",   "name": "Symmetric",    "sizes": ["1200x2400", "600x1200"]},
]

# ──────────────────────────────────────────────────────────────
# Style helpers
# ──────────────────────────────────────────────────────────────

HEADER_FILL    = PatternFill("solid", fgColor="1F3864")
HEADER_FONT    = Font(color="FFFFFF", bold=True, size=10)
ALT_ROW_FILL   = PatternFill("solid", fgColor="F2F2F2")
THIN_BORDER    = Border(
    left=Side(style="thin", color="D9D9D9"),
    right=Side(style="thin", color="D9D9D9"),
    top=Side(style="thin", color="D9D9D9"),
    bottom=Side(style="thin", color="D9D9D9"),
)
STATUS_OPTIONS  = "Pass / Fail / Skip"
CENTER          = Alignment(horizontal="center", vertical="center", wrap_text=True)


def write_header(ws, cols):
    for c, title in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c, value=title)
        cell.fill    = HEADER_FILL
        cell.font    = HEADER_FONT
        cell.alignment = CENTER
        cell.border  = THIN_BORDER


def style_data_row(ws, row_idx, num_cols, group_color_hex=None):
    fill = ALT_ROW_FILL if row_idx % 2 == 0 else None
    for c in range(1, num_cols + 1):
        cell = ws.cell(row=row_idx, column=c)
        if fill:
            cell.fill = fill
        cell.border    = THIN_BORDER
        cell.alignment = Alignment(vertical="center", wrap_text=False)
        # colour swatch column (last before QA cols)
        if group_color_hex and c == 5:   # Hex column
            try:
                hex_clean = group_color_hex.lstrip("#")
                cell.fill = PatternFill("solid", fgColor=hex_clean)
                # pick readable font colour
                r, g, b = int(hex_clean[0:2], 16), int(hex_clean[2:4], 16), int(hex_clean[4:6], 16)
                luma = 0.299 * r + 0.587 * g + 0.114 * b
                cell.font = Font(color="000000" if luma > 140 else "FFFFFF", size=9)
            except Exception:
                pass


# ──────────────────────────────────────────────────────────────
# Sheet 1 – Panel Combos
# ──────────────────────────────────────────────────────────────

def build_panel_sheet(wb):
    ws = wb.create_sheet("Panel Combos")

    COLS = [
        "#", "Fabric", "Color Group", "Shade ID", "Hex Code",
        "Panel Image Path",
        "Thumbnail Loads?", "Panel Loads?", "Color Accurate?",
        "Status", "Tester", "Notes",
    ]
    write_header(ws, COLS)

    ws.column_dimensions["A"].width = 5
    ws.column_dimensions["B"].width = 8
    ws.column_dimensions["C"].width = 13
    ws.column_dimensions["D"].width = 16
    ws.column_dimensions["E"].width = 10
    ws.column_dimensions["F"].width = 42
    ws.column_dimensions["G"].width = 16
    ws.column_dimensions["H"].width = 14
    ws.column_dimensions["I"].width = 16
    ws.column_dimensions["J"].width = 12
    ws.column_dimensions["K"].width = 12
    ws.column_dimensions["L"].width = 22
    ws.row_dimensions[1].height = 28

    row = 2
    idx = 1
    for fabric in FABRICS:
        for grp in COLOR_GROUPS:
            for shade_id, hex_code in zip(grp["shades"], grp["hexes"]):
                panel_path = f"static/images/fabric/designer_textile/panels/{fabric}_{shade_id}.jpg"
                ws.cell(row=row, column=1,  value=idx)
                ws.cell(row=row, column=2,  value=fabric)
                ws.cell(row=row, column=3,  value=grp["id"])
                ws.cell(row=row, column=4,  value=shade_id)
                ws.cell(row=row, column=5,  value=hex_code)
                ws.cell(row=row, column=6,  value=panel_path)
                ws.cell(row=row, column=7,  value="")   # Thumbnail Loads
                ws.cell(row=row, column=8,  value="")   # Panel Loads
                ws.cell(row=row, column=9,  value="")   # Color Accurate
                ws.cell(row=row, column=10, value="")   # Status (Pass/Fail/Skip)
                ws.cell(row=row, column=11, value="")   # Tester
                ws.cell(row=row, column=12, value="")   # Notes
                style_data_row(ws, row, len(COLS), hex_code)
                row += 1
                idx += 1

    # Freeze header
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:L{row - 1}"
    print(f"  Sheet 1 – Panel Combos: {idx - 1} rows")


# ──────────────────────────────────────────────────────────────
# Sheet 2 – Emboss Combos
# ──────────────────────────────────────────────────────────────

def build_emboss_sheet(wb):
    ws = wb.create_sheet("Emboss Combos")

    COLS = [
        "#", "Fabric", "Color Group", "Shade ID", "Hex Code",
        "Size", "Emboss Pattern",
        "Panel Renders?", "Emboss Accurate?",
        "Status", "Tester", "Notes",
    ]
    write_header(ws, COLS)

    ws.column_dimensions["A"].width = 5
    ws.column_dimensions["B"].width = 8
    ws.column_dimensions["C"].width = 13
    ws.column_dimensions["D"].width = 16
    ws.column_dimensions["E"].width = 10
    ws.column_dimensions["F"].width = 14
    ws.column_dimensions["G"].width = 18
    ws.column_dimensions["H"].width = 16
    ws.column_dimensions["I"].width = 18
    ws.column_dimensions["J"].width = 12
    ws.column_dimensions["K"].width = 12
    ws.column_dimensions["L"].width = 22
    ws.row_dimensions[1].height = 28

    row = 2
    idx = 1
    for fabric in FABRICS:
        for grp in COLOR_GROUPS:
            for shade_id, hex_code in zip(grp["shades"], grp["hexes"]):
                for emboss in EMBOSS_PATTERNS:
                    for size in emboss["sizes"]:
                        ws.cell(row=row, column=1,  value=idx)
                        ws.cell(row=row, column=2,  value=fabric)
                        ws.cell(row=row, column=3,  value=grp["id"])
                        ws.cell(row=row, column=4,  value=shade_id)
                        ws.cell(row=row, column=5,  value=hex_code)
                        ws.cell(row=row, column=6,  value=size)
                        ws.cell(row=row, column=7,  value=emboss["name"])
                        ws.cell(row=row, column=8,  value="")
                        ws.cell(row=row, column=9,  value="")
                        ws.cell(row=row, column=10, value="")
                        ws.cell(row=row, column=11, value="")
                        ws.cell(row=row, column=12, value="")
                        style_data_row(ws, row, len(COLS), hex_code)
                        row += 1
                        idx += 1

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:L{row - 1}"
    print(f"  Sheet 2 – Emboss Combos: {idx - 1} rows")


# ──────────────────────────────────────────────────────────────
# Sheet 3 – Summary
# ──────────────────────────────────────────────────────────────

def build_summary_sheet(wb):
    ws = wb.create_sheet("Summary", 0)   # insert first

    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 18

    title_font = Font(bold=True, size=14, color="1F3864")
    label_font = Font(bold=True, size=11)
    val_font   = Font(size=11)

    ws["A1"] = "Designer Textile – QA Checklist"
    ws["A1"].font = title_font

    data = [
        ("", ""),
        ("Scope",                  "Designer Textile product"),
        ("Fabrics",                ", ".join(FABRICS)),
        ("Color Groups",           str(len(COLOR_GROUPS))),
        ("Total Shades",           str(sum(len(g["shades"]) for g in COLOR_GROUPS))),
        ("Sizes",                  ", ".join(SIZES)),
        ("Emboss Patterns",        str(len(EMBOSS_PATTERNS))),
        ("", ""),
        ("Sheet: Panel Combos",    f"{len(FABRICS) * sum(len(g['shades']) for g in COLOR_GROUPS)} rows"),
        ("  → columns to fill",    "Thumbnail Loads, Panel Loads, Color Accurate, Status, Tester, Notes"),
        ("", ""),
        ("Sheet: Emboss Combos",   "Fabric × Shade × Emboss × valid Size"),
        ("  → columns to fill",    "Panel Renders, Emboss Accurate, Status, Tester, Notes"),
        ("", ""),
        ("Status values",          "Pass  /  Fail  /  Skip"),
    ]

    for i, (label, val) in enumerate(data, start=2):
        ws.cell(row=i, column=1, value=label).font = label_font
        ws.cell(row=i, column=2, value=val).font   = val_font

    print("  Sheet 0 – Summary written")


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────

def main():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)          # remove default empty sheet

    build_summary_sheet(wb)
    build_panel_sheet(wb)
    build_emboss_sheet(wb)

    out = "designer_textile_qa_checklist.xlsx"
    wb.save(out)
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
