"""Generate listing page PDFs matching the UCS Individual Results format."""

from pathlib import Path

from fpdf import FPDF

LOGO_PATH = Path(__file__).parent / "static" / "logo.png"


def generate_listing_pdf(meta: dict, records: list[dict], output_path: str | Path) -> Path:
    output_path = Path(output_path)
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    _draw_header(pdf, meta)
    _draw_search_info(pdf, meta, len(records))
    y = _draw_table(pdf, meta, records)

    pdf.set_xy(15, y + 8)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, "End of Record")

    pdf.output(str(output_path))
    return output_path


def _draw_header(pdf: FPDF, meta: dict):
    if LOGO_PATH.exists():
        pdf.image(str(LOGO_PATH), x=12, y=8, w=16)

    pdf.set_text_color(80, 80, 80)
    pdf.set_font("Times", "I", 14)
    pdf.set_xy(30, 10)
    pdf.cell(80, 6, "United Corporate Services, Inc.")
    pdf.set_font("Times", "I", 8.5)
    pdf.set_xy(30, 17)
    pdf.cell(80, 5, "Excellent Service in Extraordinary Times")
    pdf.set_text_color(0, 0, 0)

    rx = 132
    y = 10
    for label, key in [
        ("Prepared For:", "preparedFor"),
        ("Client Matter #", "clientMatter"),
        ("Project #", "projectNumber"),
        ("Project Mgr:", "projectMgr"),
    ]:
        pdf.set_xy(rx, y)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(28, 5, label)
        pdf.set_font("Helvetica", "", 9)
        value = meta.get(key, "")
        lines = value.split("\n") if value else [""]
        pdf.cell(0, 5, lines[0])
        for extra in lines[1:]:
            y += 4.5
            pdf.set_xy(rx + 28, y)
            pdf.cell(0, 5, extra)
        y += 7

    pdf.set_font("Helvetica", "B", 11)
    pdf.set_xy(15, 48)
    pdf.cell(0, 6, "INDIVIDUAL RESULTS")


def _draw_search_info(pdf: FPDF, meta: dict, count: int):
    left = 15
    lw = 32

    pdf.set_xy(left, 60)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(lw, 6, "DEBTOR:")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, meta.get("debtor", ""))

    pdf.set_xy(left, 72)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(lw, 6, "JURISDICTION:")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(70, 6, meta.get("jurisdiction", ""))

    pdf.set_xy(145, 72)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(25, 6, "THRU DATE:")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, meta.get("thruDate", ""))

    pdf.set_xy(145, 78)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(32, 6, "YEARS SEARCHED:")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, meta.get("yearsSearched", ""))

    pdf.set_xy(left, 84)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(lw, 6, "SUMMARY:")
    pdf.set_font("Helvetica", "", 10)
    summary = meta.get("summary", "")
    summary_lines = summary.split("\n") if summary else [""]
    pdf.cell(45, 6, summary_lines[0])
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, f"RECORDS FOUNDS ({count})")

    y = 90
    for extra in summary_lines[1:]:
        pdf.set_xy(left + lw, y)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(45, 6, extra)
        y += 6

    status = meta.get("status", "")
    if status:
        pdf.set_xy(left + lw + 45, y if len(summary_lines) > 1 else 90)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 6, status)


def _draw_table(pdf: FPDF, meta: dict, records: list[dict]) -> float:
    party_label = meta.get("partyLabel", "Secured Party")
    cols = [
        (15, 40, "File Date"),
        (58, 48, "File Number"),
        (108, 32, "File Type"),
        (142, 60, party_label),
    ]

    y = 105
    pdf.set_font("Helvetica", "U", 10)
    for x, _w, label in cols:
        pdf.set_xy(x, y)
        pdf.cell(0, 6, label)

    y += 12
    pdf.set_font("Helvetica", "", 10)
    for rec in records:
        if y > 255:
            pdf.add_page()
            y = 20
        pdf.set_xy(cols[0][0], y)
        pdf.cell(cols[0][1], 6, rec.get("fileDate", ""))
        pdf.set_xy(cols[1][0], y)
        pdf.cell(cols[1][1], 6, rec.get("fileNumber", ""))
        pdf.set_xy(cols[2][0], y)
        pdf.cell(cols[2][1], 6, rec.get("fileType", ""))
        pdf.set_xy(cols[3][0], y)
        pdf.cell(cols[3][1], 6, rec.get("securedParty", ""))
        y += 8

    return y
