"""Generate all PDF outputs: listing pages, project summary, and compiled reports.

Returns PDF as bytes -- no disk I/O. Caller decides what to do with it.

Two auto-generated page types:
  1. Listing page     -- table of extracted records for one evidence
  2. Project summary  -- multi-page overview grouping all evidence by debtor

Compile merges: summary + (listing+evidence for records found, raw evidence for no records)
"""

import io
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

from fpdf import FPDF
from pypdf import PdfReader, PdfWriter

LOGO_PATH = Path(__file__).parent / "static" / "logo.png"

DISCLAIMER = (
    "This summary is a compilation of information obtained from public records maintained by government officials. "
    "United Corporate Services, Inc. (\"UCS\") makes no representation or warranty as to the accuracy or completeness "
    "of such records. UCS shall not be liable for failure to find public records indexed under names you did not request, "
    "even if such records are determined to apply to the person, entity, or property you intended to search, or for "
    "public records located in offices or indexes for which you did not request a search. "
    "The liability of UCS with respect to this report and any related transaction shall be limited to the amount of "
    "the service fee(s) charged by UCS for the preparation and delivery of this report. For purposes of conducting "
    "and reporting UCC searches, reports shall contain copies of all Active, Lapsed and Terminated filings filed after "
    "the effective date of RA9 thru a financing statements natural lapse date unless specifically instructed by the "
    "client not to do so."
)

OFFICES = [
    ("Ten Bank Street", "Suite 560", "White Plains, NY 10606", "800-899-8648"),
    ("874 Walker Road", "Suite C", "Dover, DE 19904", "877-734-8300"),
    ("100 State Street", "Suite 800", "Albany, New York 12207", "877-894-9049"),
    ("501 Seventh Ave.", "Suite 408", "New York, New York 10018", "212-220-4020"),
    ("320 North 10th Street", "Suite 200", "Sacramento, CA 95811", "916-447-1350"),
]

# Brand colors
COLOR_PRIMARY = (155, 28, 28)
COLOR_DARK = (40, 36, 34)
COLOR_GRAY = (107, 102, 96)
COLOR_LIGHT_GRAY = (180, 175, 168)
COLOR_BG = (248, 247, 245)
COLOR_WHITE = (255, 255, 255)
COLOR_LINE = (220, 216, 210)
COLOR_SUCCESS = (21, 128, 61)


def _draw_logo_header(pdf: FPDF):
    """Draw the UCS logo + company name header."""
    if LOGO_PATH.exists():
        pdf.image(str(LOGO_PATH), x=15, y=8, w=18)

    pdf.set_text_color(*COLOR_DARK)
    pdf.set_font("Helvetica", "B", 15)
    pdf.set_xy(35, 9)
    pdf.cell(100, 7, "United Corporate Services, Inc.")

    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.set_font("Helvetica", "I", 8.5)
    pdf.set_xy(35, 17)
    pdf.cell(100, 5, "Excellent Service in Extraordinary Times")
    pdf.set_text_color(*COLOR_DARK)


def _draw_footer(pdf: FPDF, page_num: int = 0, total_pages: int = 0):
    """Draw disclaimer + office addresses at page bottom."""
    pdf.set_draw_color(*COLOR_LINE)
    pdf.line(15, 228, 200, 228)

    pdf.set_font("Helvetica", "", 5.5)
    pdf.set_text_color(*COLOR_GRAY)
    pdf.set_xy(15, 230)
    pdf.multi_cell(185, 2.3, DISCLAIMER)

    y = 252
    pdf.set_draw_color(*COLOR_LINE)
    pdf.line(15, y, 200, y)
    y += 2

    pdf.set_font("Helvetica", "", 6)
    pdf.set_text_color(*COLOR_GRAY)
    for i, office in enumerate(OFFICES):
        x = 15 + i * 38
        for j, line in enumerate(office):
            pdf.set_xy(x, y + j * 2.8)
            pdf.cell(36, 2.8, line, align="C")

    if page_num:
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(*COLOR_LIGHT_GRAY)
        pdf.set_xy(15, 268)
        now = datetime.now().strftime("%-m/%-d/%Y %-I:%M %p")
        pdf.cell(60, 4, f"Print Date/Time: {now}")
        if total_pages:
            pdf.set_xy(155, 268)
            pdf.cell(45, 4, f"Page {page_num} of {total_pages}", align="R")

    pdf.set_text_color(*COLOR_DARK)


# ===================================================================
# 1. LISTING PAGE (table of extracted records for one evidence)
# ===================================================================

def generate_listing_pdf(meta: dict, records: list[dict]) -> bytes:
    """Build a listing page PDF and return it as bytes."""
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    _draw_logo_header(pdf)

    # Title
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*COLOR_DARK)
    pdf.set_xy(15, 28)
    pdf.cell(0, 7, "INDIVIDUAL RESULTS")

    # Divider
    pdf.set_draw_color(*COLOR_PRIMARY)
    pdf.set_line_width(0.6)
    pdf.line(15, 36, 200, 36)
    pdf.set_line_width(0.2)

    # Info grid
    y = 40
    left_col = [
        ("Prepared For", meta.get("preparedFor", "")),
        ("Client Matter #", meta.get("clientMatter", "")),
        ("Project #", meta.get("projectNumber", "")),
        ("Project Mgr", meta.get("projectMgr", "")),
    ]
    right_col = [
        ("Debtor", meta.get("debtor", "")),
        ("Jurisdiction", meta.get("jurisdiction", "")),
        ("Thru Date", meta.get("thruDate", "")),
        ("Years Searched", meta.get("yearsSearched", "")),
    ]

    for i, ((ll, lv), (rl, rv)) in enumerate(zip(left_col, right_col)):
        pdf.set_xy(15, y)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(*COLOR_GRAY)
        pdf.cell(30, 5, ll)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*COLOR_DARK)
        lines = lv.split("\n") if lv else [""]
        pdf.cell(55, 5, lines[0])
        for extra in lines[1:]:
            y += 4
            pdf.set_xy(45, y)
            pdf.cell(55, 5, extra)

        pdf.set_xy(110, y)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(*COLOR_GRAY)
        pdf.cell(30, 5, rl)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*COLOR_DARK)
        pdf.cell(0, 5, rv)
        y += 6

    # Summary line
    summary = meta.get("summary", "")
    if summary:
        pdf.set_xy(15, y)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(*COLOR_GRAY)
        pdf.cell(30, 5, "Summary")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*COLOR_DARK)
        pdf.cell(0, 5, summary)
        y += 6

    # Record count badge
    y += 2
    pdf.set_xy(15, y)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*COLOR_PRIMARY)
    pdf.cell(0, 6, f"RECORDS FOUND ({len(records)})")
    pdf.set_text_color(*COLOR_DARK)
    y += 10

    # Table header
    party_label = meta.get("partyLabel", "Secured Party")
    cols = [
        (15, 32, "File Date"),
        (49, 42, "File/Case #"),
        (93, 28, "File Type"),
        (123, 77, party_label),
    ]

    pdf.set_draw_color(*COLOR_PRIMARY)
    pdf.set_line_width(0.5)
    pdf.line(15, y, 200, y)
    pdf.set_line_width(0.2)
    y += 1.5

    pdf.set_font("Helvetica", "B", 8.5)
    pdf.set_text_color(*COLOR_GRAY)
    for x, _w, label in cols:
        pdf.set_xy(x, y)
        pdf.cell(0, 5, label)
    y += 6

    pdf.set_draw_color(*COLOR_LINE)
    pdf.line(15, y, 200, y)
    y += 3

    # Table rows
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*COLOR_DARK)
    page_num = 1
    for idx, rec in enumerate(records):
        if y > 220:
            _draw_footer(pdf, page_num)
            pdf.add_page()
            _draw_logo_header(pdf)
            page_num += 1
            y = 30
            pdf.set_draw_color(*COLOR_PRIMARY)
            pdf.set_line_width(0.5)
            pdf.line(15, y, 200, y)
            pdf.set_line_width(0.2)
            y += 1.5
            pdf.set_font("Helvetica", "B", 8.5)
            pdf.set_text_color(*COLOR_GRAY)
            for x, _w, label in cols:
                pdf.set_xy(x, y)
                pdf.cell(0, 5, label)
            y += 6
            pdf.set_draw_color(*COLOR_LINE)
            pdf.line(15, y, 200, y)
            y += 3
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(*COLOR_DARK)

        # Alternate row background
        if idx % 2 == 0:
            pdf.set_fill_color(*COLOR_BG)
            pdf.rect(15, y - 1, 185, 7, "F")

        pdf.set_xy(cols[0][0], y)
        pdf.cell(cols[0][1], 5, rec.get("fileDate", ""))
        pdf.set_xy(cols[1][0], y)
        pdf.cell(cols[1][1], 5, rec.get("fileNumber", ""))
        pdf.set_xy(cols[2][0], y)
        pdf.cell(cols[2][1], 5, rec.get("fileType", ""))
        pdf.set_xy(cols[3][0], y)
        pdf.cell(cols[3][1], 5, rec.get("securedParty", ""))
        y += 7

    # End of record
    y += 4
    pdf.set_draw_color(*COLOR_LINE)
    pdf.line(15, y, 200, y)
    y += 4
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*COLOR_GRAY)
    pdf.set_xy(15, y)
    pdf.cell(0, 5, "End of Record")

    _draw_footer(pdf, page_num)
    pdf.set_text_color(*COLOR_DARK)
    return pdf.output()


# ===================================================================
# 2. PROJECT SUMMARY (multi-page overview grouped by debtor)
# ===================================================================

def _generate_summary_pdf(project: dict, evidence_list: list[dict]) -> bytes:
    """Generate the PROJECT SUMMARY pages."""
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=False)

    # Group evidence by debtor (preserve order from evidence list)
    grouped: OrderedDict[str, list[dict]] = OrderedDict()
    for e in evidence_list:
        meta = e.get("listingMeta") or {}
        debtor = meta.get("debtor") or "Unknown"
        grouped.setdefault(debtor, []).append(e)

    # Count total pages needed (estimate for page numbering)
    total_pages = 1
    row_count = sum(len(items) for items in grouped.values()) + len(grouped)
    if row_count > 12:
        total_pages = 1 + (row_count - 12) // 15 + 1

    page_num = 1
    pdf.add_page()
    _draw_summary_page_header(pdf, project)
    y = _draw_summary_table_header(pdf)

    for debtor, items in grouped.items():
        if y > 215:
            _draw_footer(pdf, page_num, total_pages)
            pdf.add_page()
            page_num += 1
            _draw_summary_page_header(pdf, project)
            y = _draw_summary_table_header(pdf)

        # Debtor header row
        pdf.set_fill_color(225, 222, 218)
        pdf.set_font("Helvetica", "B", 9.5)
        pdf.set_text_color(*COLOR_DARK)
        pdf.set_xy(15, y)
        pdf.cell(185, 7, f"  Debtor:       {debtor}", fill=True)
        y += 9

        for item_idx, e in enumerate(items):
            if y > 218:
                _draw_footer(pdf, page_num, total_pages)
                pdf.add_page()
                page_num += 1
                _draw_summary_page_header(pdf, project)
                y = _draw_summary_table_header(pdf)

            meta = e.get("listingMeta") or {}
            search_type = meta.get("summary", "")
            jurisdiction = meta.get("jurisdiction", "")
            thru_date = meta.get("thruDate", "")
            result_type = e.get("resultType", "No Records")
            listing = e.get("listing") or []

            # Alternate shading within each debtor group
            if item_idx % 2 == 0:
                pdf.set_fill_color(*COLOR_BG)
                pdf.rect(15, y - 0.5, 185, 12, "F")

            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(*COLOR_DARK)
            pdf.set_xy(15, y)
            pdf.cell(40, 5, search_type)
            pdf.set_xy(55, y)
            pdf.cell(95, 5, jurisdiction)
            pdf.set_xy(155, y)
            pdf.cell(25, 5, thru_date)
            y += 5

            pdf.set_font("Helvetica", "B", 8.5)
            pdf.set_xy(15, y)
            if result_type == "Records Found":
                pdf.set_text_color(*COLOR_SUCCESS)
                pdf.cell(40, 5, f"Results:  Records Found")
                pdf.set_text_color(*COLOR_GRAY)
                pdf.set_font("Helvetica", "I", 8)
                pdf.set_xy(70, y)
                pdf.cell(60, 5, "See attached")
            else:
                pdf.set_text_color(*COLOR_GRAY)
                pdf.cell(40, 5, "Results:  No Records")
            y += 7.5

        pdf.set_text_color(*COLOR_DARK)

    _draw_footer(pdf, page_num, total_pages)
    return pdf.output()


def _draw_summary_page_header(pdf: FPDF, project: dict):
    """Draw the PROJECT SUMMARY header on current page."""
    _draw_logo_header(pdf)

    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*COLOR_DARK)
    pdf.set_xy(15, 28)
    pdf.cell(0, 7, "PROJECT SUMMARY")

    # Red accent line
    pdf.set_draw_color(*COLOR_PRIMARY)
    pdf.set_line_width(0.6)
    pdf.line(15, 36, 200, 36)
    pdf.set_line_width(0.2)

    # Project info
    y = 40
    fields = [
        ("Prepared For", project.get("preparedFor", "")),
        ("Client Matter #", project.get("clientMatter", "")),
    ]
    for label, value in fields:
        pdf.set_xy(15, y)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*COLOR_GRAY)
        pdf.cell(32, 5, label)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(*COLOR_DARK)
        lines = value.split("\n") if value else [""]
        pdf.cell(80, 5, lines[0])
        for extra in lines[1:]:
            y += 4.5
            pdf.set_xy(47, y)
            pdf.cell(80, 5, extra)
        y += 7

    # Project Manager + Project ID on same row
    pdf.set_xy(15, y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*COLOR_GRAY)
    pdf.cell(32, 5, "Project Manager")
    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(*COLOR_DARK)
    pdf.cell(55, 5, project.get("projectManager", ""))

    pdf.set_xy(120, y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*COLOR_GRAY)
    pdf.cell(22, 5, "Project ID")
    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(*COLOR_DARK)
    pdf.cell(0, 5, project.get("projectNumber", ""))


def _draw_summary_table_header(pdf: FPDF) -> float:
    """Draw the column headers for the summary table. Returns starting y."""
    y = 72
    pdf.set_draw_color(*COLOR_PRIMARY)
    pdf.set_line_width(0.5)
    pdf.line(15, y, 200, y)
    pdf.set_line_width(0.2)
    y += 2

    pdf.set_font("Helvetica", "B", 8.5)
    pdf.set_text_color(*COLOR_GRAY)
    pdf.set_xy(15, y)
    pdf.cell(40, 5, "Search/Filing Type")
    pdf.set_xy(55, y)
    pdf.cell(95, 5, "Jurisdiction - Recording Office")
    pdf.set_xy(155, y)
    pdf.cell(25, 5, "Thru Date")
    pdf.set_xy(182, y)
    pdf.cell(18, 5, "File Date")

    y += 6
    pdf.set_draw_color(*COLOR_LINE)
    pdf.line(15, y, 200, y)
    pdf.set_text_color(*COLOR_DARK)
    return y + 3


# ===================================================================
# 3. COMPILE (merges summary + evidence PDFs)
# ===================================================================

def compile_project_pdf(project: dict, evidence_list: list[dict],
                        evidence_pdfs: dict[str, bytes]) -> bytes:
    """Build the complete project report PDF.

    Structure:
      1. Project Summary pages (grouped by debtor)
      2. For each evidence (in display order):
         - Records Found: listing page + evidence PDF
         - No Records: just the evidence PDF
    """
    writer = PdfWriter()

    # 1. Summary pages
    summary_bytes = _generate_summary_pdf(project, evidence_list)
    _append_pdf_bytes(writer, summary_bytes)

    # 2. Each evidence in order
    for e in evidence_list:
        meta = e.get("listingMeta") or {}
        result_type = e.get("resultType", "No Records")
        eid = e.get("_id") or e.get("id")

        if result_type == "Records Found":
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


# ===================================================================
# 4. VIEW EVIDENCE (listing page + evidence for records found)
# ===================================================================

def view_evidence_pdf(job: dict, evidence_bytes: bytes, project: dict | None) -> bytes:
    """Build the view PDF for a single evidence item.

    Records Found: listing page + evidence PDF
    No Records: just the raw evidence PDF
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


def preview_listing_with_evidence(meta: dict, records: list[dict],
                                  evidence_bytes: bytes) -> bytes:
    """Generate listing page + append evidence PDF for in-browser preview."""
    writer = PdfWriter()
    _append_pdf_bytes(writer, generate_listing_pdf(meta, records))
    _append_pdf_bytes(writer, evidence_bytes)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


# ===================================================================
# Helpers
# ===================================================================

def _append_pdf_bytes(writer: PdfWriter, pdf_bytes: bytes):
    """Append all pages from a PDF byte string to a PdfWriter."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    for page in reader.pages:
        writer.add_page(page)


def _get_field_value(entry: dict, key: str) -> str:
    """Extract the value string from a listing entry field."""
    field = entry.get(key, "")
    if isinstance(field, dict):
        return str(field.get("value", ""))
    return str(field)
