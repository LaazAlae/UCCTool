"""Generate all PDF outputs: listing pages, individual results, project summary, and compiled reports.

Returns PDF as bytes — no disk I/O. Caller decides what to do with it
(serve to browser, store in GridFS, etc.).

Three levels of PDF generation:
  1. Listing page     — table of extracted records for one evidence (existing)
  2. Individual results — one-page header for each evidence in a project
  3. Project summary  — multi-page overview grouping all evidence by debtor
  4. Compile          — merges summary + individual results + listing pages + evidence PDFs
"""

import io
from collections import OrderedDict
from pathlib import Path

from fpdf import FPDF
from pypdf import PdfReader, PdfWriter

LOGO_PATH = Path(__file__).parent / "static" / "logo.png"

DISCLAIMER = (
    "This summary is a compilation of information obtained from public records maintained by government officials. "
    "United Corporate Services, Inc. (\"UCS\") makes no representation or warranty as to the accuracy or completeness "
    "of such records. UCS shall not be liable for failure to find public records indexed under names you did not request, "
    "even if such records are determined to apply to the person, entity, or property you intended to search, or for "
    "public records located in offices or indexes for which you did not request a search."
)

OFFICES = [
    ("Ten Bank Street", "Suite 560", "White Plains, NY 10606", "800-899-8648"),
    ("874 Walker Road", "Suite C", "Dover, DE 19904", "877-734-8300"),
    ("100 State Street", "Suite 800", "Albany, New York 12207", "877-894-9049"),
    ("501 Seventh Ave.", "Suite 408", "New York, New York 10018", "212-220-4020"),
    ("320 North 10th Street", "Suite 200", "Sacramento, CA 95811", "916-447-1350"),
]


# ═══════════════════════════════════════════════════════════════════════════
# 1. LISTING PAGE (existing — table of extracted records for one evidence)
# ═══════════════════════════════════════════════════════════════════════════

def generate_listing_pdf(meta: dict, records: list[dict]) -> bytes:
    """Build a listing page PDF and return it as bytes."""
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    _draw_header(pdf, meta)
    _draw_search_info(pdf, meta, len(records))
    y = _draw_table(pdf, meta, records)

    pdf.set_xy(15, y + 8)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, "End of Record")

    return pdf.output()


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
    pdf.cell(0, 6, f"RECORDS FOUND ({count})")

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


# ═══════════════════════════════════════════════════════════════════════════
# 2. INDIVIDUAL RESULTS PAGE (header page per evidence in compiled report)
# ═══════════════════════════════════════════════════════════════════════════

def _generate_individual_results_page(meta: dict, project: dict) -> bytes:
    """Generate one 'INDIVIDUAL RESULTS' page for an evidence item."""
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    # Header
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

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_xy(15, 30)
    pdf.cell(0, 6, "INDIVIDUAL RESULTS")

    # Debtor name centered
    debtor = meta.get("debtor", "")
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_xy(15, 55)
    pdf.cell(180, 10, debtor, align="C")

    # Horizontal line
    pdf.set_draw_color(0, 0, 0)
    pdf.line(30, 68, 185, 68)

    # Search details centered
    search_type = meta.get("summary", meta.get("searchType", ""))
    jurisdiction = meta.get("jurisdiction", "")
    result_type = meta.get("resultType", "No Records")
    thru_date = meta.get("thruDate", "")

    y = 73
    pdf.set_font("Helvetica", "B", 11)

    pdf.set_xy(15, y)
    pdf.cell(180, 6, f"Search/Filing Type - {search_type}", align="C")
    y += 8

    if jurisdiction:
        pdf.set_xy(15, y)
        pdf.cell(180, 6, f"Jurisdiction / Recording Office - {jurisdiction}", align="C")
        y += 8

    pdf.set_xy(15, y)
    result_text = f"Results - {result_type}"
    pdf.cell(180, 6, result_text, align="C")
    y += 8

    if thru_date:
        pdf.set_xy(15, y)
        pdf.cell(180, 6, f"Thru Date - {thru_date}", align="C")
        y += 8

    if result_type == "Records Found":
        pdf.set_xy(15, y)
        pdf.cell(180, 6, "Comments - See attached", align="C")

    # Footer
    _draw_page_footer(pdf, project)

    return pdf.output()


# ═══════════════════════════════════════════════════════════════════════════
# 3. PROJECT SUMMARY (multi-page overview grouped by debtor)
# ═══════════════════════════════════════════════════════════════════════════

def _generate_summary_pdf(project: dict, evidence_list: list[dict]) -> bytes:
    """Generate the PROJECT SUMMARY pages matching the UCS format."""
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=False)

    # Group evidence by debtor (preserve order)
    grouped: OrderedDict[str, list[dict]] = OrderedDict()
    for e in evidence_list:
        meta = e.get("listingMeta") or {}
        debtor = meta.get("debtor", "Unknown")
        grouped.setdefault(debtor, []).append(e)

    # Start first page
    pdf.add_page()
    _draw_summary_header(pdf, project)
    y = _draw_summary_table_header(pdf)

    for debtor, items in grouped.items():
        # Debtor header row
        if y > 230:
            _draw_summary_footer(pdf, project)
            pdf.add_page()
            _draw_summary_header(pdf, project)
            y = _draw_summary_table_header(pdf)

        pdf.set_fill_color(200, 200, 200)
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_xy(15, y)
        pdf.cell(185, 7, f"Debtor:       {debtor}", fill=True)
        y += 9

        for e in items:
            if y > 240:
                _draw_summary_footer(pdf, project)
                pdf.add_page()
                _draw_summary_header(pdf, project)
                y = _draw_summary_table_header(pdf)

            meta = e.get("listingMeta") or {}
            search_type = meta.get("summary", "")
            jurisdiction = meta.get("jurisdiction", "")
            thru_date = meta.get("thruDate", "")
            result_type = e.get("resultType", "No Records")
            listing = e.get("listing") or []

            pdf.set_font("Helvetica", "", 9)
            pdf.set_xy(15, y)
            pdf.cell(40, 5, search_type)
            pdf.set_xy(55, y)
            pdf.cell(90, 5, jurisdiction)
            pdf.set_xy(155, y)
            pdf.cell(25, 5, thru_date)
            y += 5

            pdf.set_font("Helvetica", "B", 9)
            pdf.set_xy(15, y)
            if result_type == "Records Found":
                pdf.cell(40, 5, f"Results:  Records Found")
                pdf.set_xy(75, y)
                pdf.cell(60, 5, "Comments:  See attached")
            else:
                pdf.cell(40, 5, "Results:  No Records")
            y += 8

    _draw_summary_footer(pdf, project)
    return pdf.output()


def _draw_summary_header(pdf: FPDF, project: dict):
    """Draw the PROJECT SUMMARY header on current page."""
    if LOGO_PATH.exists():
        pdf.image(str(LOGO_PATH), x=12, y=8, w=22)

    pdf.set_text_color(80, 80, 80)
    pdf.set_font("Times", "I", 16)
    pdf.set_xy(36, 10)
    pdf.cell(100, 7, "United Corporate Services, Inc.")
    pdf.set_font("Times", "I", 9)
    pdf.set_xy(36, 18)
    pdf.cell(100, 5, "Excellent Service in Extraordinary Times")
    pdf.set_text_color(0, 0, 0)

    pdf.set_font("Helvetica", "B", 12)
    pdf.set_xy(15, 30)
    pdf.cell(0, 7, "PROJECT SUMMARY")

    # Project info rows
    y = 42
    pdf.set_font("Helvetica", "", 10)
    for label, value in [
        ("Prepared For:", project.get("preparedFor", "")),
        ("Client Matter #:", project.get("clientMatter", "")),
        ("Project Manager:", project.get("projectManager", "")),
    ]:
        pdf.set_xy(15, y)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(38, 6, label)
        pdf.set_font("Helvetica", "", 10)
        lines = value.split("\n") if value else [""]
        pdf.cell(80, 6, lines[0])
        for extra in lines[1:]:
            y += 5
            pdf.set_xy(53, y)
            pdf.cell(80, 6, extra)

        if label == "Project Manager:":
            pdf.set_xy(135, y)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(22, 6, "Project ID:")
            pdf.set_font("Helvetica", "", 10)
            pdf.cell(0, 6, project.get("projectNumber", ""))
        y += 8


def _draw_summary_table_header(pdf: FPDF) -> float:
    """Draw the column headers for the summary table. Returns starting y."""
    y = 78
    pdf.set_draw_color(0, 0, 0)
    pdf.line(15, y, 200, y)
    y += 2

    pdf.set_font("Helvetica", "B", 9)
    pdf.set_xy(15, y)
    pdf.cell(40, 5, "Search/Filing Type")
    pdf.set_xy(55, y)
    pdf.cell(90, 5, "Jurisdiction - Recording Office")
    pdf.set_xy(155, y)
    pdf.cell(25, 5, "Thru Date")
    pdf.set_xy(180, y)
    pdf.cell(20, 5, "File Date")

    y += 6
    pdf.line(15, y, 200, y)
    return y + 3


def _draw_summary_footer(pdf: FPDF, project: dict):
    """Draw disclaimer + office addresses at the bottom of a summary page."""
    pdf.set_font("Helvetica", "", 6)
    pdf.set_xy(15, 232)
    pdf.multi_cell(185, 2.5, DISCLAIMER)

    y = 253
    pdf.set_draw_color(0, 0, 0)
    pdf.line(15, y, 200, y)
    y += 2

    pdf.set_font("Helvetica", "", 6.5)
    for i, office in enumerate(OFFICES):
        x = 15 + i * 38
        for j, line in enumerate(office):
            pdf.set_xy(x, y + j * 3)
            pdf.cell(36, 3, line, align="C")


def _draw_page_footer(pdf: FPDF, project: dict):
    """Draw the footer table on an Individual Results page."""
    y = 232
    pdf.set_draw_color(0, 0, 0)

    # Footer info box
    pdf.set_font("Helvetica", "", 8)
    pdf.set_xy(15, y)
    pdf.cell(45, 5, "Prepared For:")
    pdf.cell(60, 5, project.get("preparedFor", "").split("\n")[0])
    pdf.cell(30, 5, "Project ID:")
    pdf.cell(0, 5, project.get("projectNumber", ""))
    y += 5
    pdf.set_xy(15, y)
    pdf.cell(45, 5, "Client Matter #:")
    pdf.cell(60, 5, project.get("clientMatter", ""))
    pdf.cell(30, 5, "Project Manager:")
    pdf.cell(0, 5, project.get("projectManager", ""))

    # Disclaimer
    y += 8
    pdf.set_font("Helvetica", "", 6)
    pdf.set_xy(15, y)
    pdf.multi_cell(185, 2.5, DISCLAIMER)

    # Offices
    y = 260
    pdf.line(15, y, 200, y)
    y += 2
    pdf.set_font("Helvetica", "", 6.5)
    for i, office in enumerate(OFFICES):
        x = 15 + i * 38
        for j, line in enumerate(office):
            pdf.set_xy(x, y + j * 3)
            pdf.cell(36, 3, line, align="C")


# ═══════════════════════════════════════════════════════════════════════════
# 4. COMPILE (merges everything into one final PDF)
# ═══════════════════════════════════════════════════════════════════════════

def compile_project_pdf(project: dict, evidence_list: list[dict],
                        evidence_pdfs: dict[str, bytes]) -> bytes:
    """Build the complete project report PDF.

    Order matches the UCS standard:
      1. Project Summary pages (grouped by debtor)
      2. For each evidence (in display order):
         a. Individual Results page
         b. If Records Found: listing page + evidence PDF
    """
    writer = PdfWriter()

    # 1. Summary pages
    summary_bytes = _generate_summary_pdf(project, evidence_list)
    _append_pdf_bytes(writer, summary_bytes)

    # 2. Each evidence (newest first — matches display order)
    for e in evidence_list:
        meta = e.get("listingMeta") or {}
        result_type = e.get("resultType", "No Records")
        eid = e.get("_id") or e.get("id")

        if result_type == "Records Found":
            # Individual Results page + listing page + evidence PDF
            ir_meta = {
                "debtor": meta.get("debtor", ""),
                "summary": meta.get("summary", ""),
                "jurisdiction": meta.get("jurisdiction", ""),
                "thruDate": meta.get("thruDate", ""),
                "resultType": result_type,
            }
            _append_pdf_bytes(writer, _generate_individual_results_page(ir_meta, project))

            listing = e.get("listing") or []
            if listing:
                listing_records = [{
                    "fileDate": _get_field_value(entry, "fileDate"),
                    "fileNumber": _get_field_value(entry, "fileNumber"),
                    "fileType": _get_field_value(entry, "fileType"),
                    "securedParty": _get_field_value(entry, "securedParty"),
                } for entry in listing]
                listing_meta = {**meta, "partyLabel": meta.get("partyLabel", "Secured Party")}
                _append_pdf_bytes(writer, generate_listing_pdf(listing_meta, listing_records))

        # Append the actual evidence PDF
        if eid and str(eid) in evidence_pdfs:
            _append_pdf_bytes(writer, evidence_pdfs[str(eid)])

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _append_pdf_bytes(writer: PdfWriter, pdf_bytes: bytes):
    """Append all pages from a PDF byte string to a PdfWriter."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    for page in reader.pages:
        writer.add_page(page)


def _get_field_value(entry: dict, key: str) -> str:
    """Extract the value string from a listing entry field (handles nested dicts)."""
    field = entry.get(key, "")
    if isinstance(field, dict):
        return str(field.get("value", ""))
    return str(field)


# ═══════════════════════════════════════════════════════════════════════════
# 5. VIEW EVIDENCE (listing page on top + evidence PDF, or Individual Results)
# ═══════════════════════════════════════════════════════════════════════════

def view_evidence_pdf(job: dict, evidence_bytes: bytes, project: dict | None) -> bytes:
    """Build the view PDF for a single evidence item.

    Records Found: listing page + evidence PDF
    No Records: just the raw evidence PDF (no generated pages)
    """
    result_type = job.get("resultType", "No Records")

    if result_type != "Records Found":
        return evidence_bytes

    writer = PdfWriter()
    meta = job.get("listingMeta") or {}
    listing = job.get("listing") or []
    if listing:
        listing_records = [{
            "fileDate": _get_field_value(e, "fileDate"),
            "fileNumber": _get_field_value(e, "fileNumber"),
            "fileType": _get_field_value(e, "fileType"),
            "securedParty": _get_field_value(e, "securedParty"),
        } for e in listing]
        listing_meta = {**meta, "partyLabel": meta.get("partyLabel", "Secured Party")}
        _append_pdf_bytes(writer, generate_listing_pdf(listing_meta, listing_records))

    _append_pdf_bytes(writer, evidence_bytes)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()
