"""Build the CSST 102 documentation in the school's mandated template format.

Unlike ``docx_engine.Doc`` (which composes a document from scratch), this engine
**clones the official template** ``CSST 102(IS) - Documentation Template.docx``
and replaces its body. That keeps three things the template owns and that cannot
be re-created faithfully by hand:

* the anchored **LSPU seal** in the page header, with its exact position,
* the four-line ``Republic of the Philippines`` header block, and
* the page geometry (A4, 1" margins, 0.49" header/footer distance).

If the template file is absent the engine falls back to assembling an equivalent
document from the committed seal image plus the same paragraph text, so a fresh
checkout can still rebuild. The fallback is layout-approximate; the cloned
template is the canonical path.

Only three visual primitives are needed to match the template:

``section_bar``  a one-cell table shaded #F7CAAC, Arial 14 pt bold
``sub``          an Arial bold sub-heading (Project Description, Dataset Name, ...)
``table``        a plain Table Grid with a bold, unshaded header row
"""

from __future__ import annotations

import copy
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

# ---------------------------------------------------------------- template look
BODY_FONT = "Arial"
BODY_SIZE = 11.0
BAR_FILL = "F7CAAC"          # peach section bar, sampled from the template XML
INK = RGBColor(0x0D, 0x0D, 0x0D)   # template uses themeColor text1 / shade F2
HEADER_TEXT = (
    "Republic of the Philippines",
    "Laguna State Polytechnic University",
    "Province of Laguna",
    "College of Computer Studies",
)
TEXT_COLUMN_IN = 6.26        # 9026 twips of usable width on A4 with 1" margins

SEAL_PATH = Path(__file__).resolve().parent / "lspu_seal.jpeg"


def _shade(cell, hex_fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def _force_font(run, size: float | None = None, bold: bool | None = None) -> None:
    """Set Arial on a run, overriding the template's theme-font inheritance."""
    run.font.name = BODY_FONT
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        r_fonts.set(qn(attr), BODY_FONT)


def _clear_body(document) -> None:
    """Delete every body element except the final sectPr (page size + header ref)."""
    body = document.element.body
    for child in list(body):
        if child.tag == qn("w:sectPr"):
            continue
        body.remove(child)


def _build_header_from_scratch(document) -> None:
    """Fallback header: seal on the left, four centred lines of school text."""
    header = document.sections[0].header
    para = header.paragraphs[0]
    para.text = ""
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if SEAL_PATH.exists():
        run = para.add_run()
        run.add_picture(str(SEAL_PATH), height=Inches(0.85))
    for i, line in enumerate(HEADER_TEXT):
        p = header.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        run = p.add_run(line)
        _force_font(run, size=10 if i == 1 else 9.5, bold=(i == 1))


class TemplateDoc:
    """Append-only façade over a document cloned from the CSST 102 template."""

    def __init__(self, template: Path | None = None) -> None:
        self.cloned = False
        if template is not None and Path(template).exists():
            self.d = Document(str(template))
            _clear_body(self.d)
            self.cloned = True
        else:
            self.d = Document()
            self._setup_fallback_page()
            _build_header_from_scratch(self.d)
        self._setup_normal()
        self.table_no = 0
        self.figure_no = 0
        self.events: list[dict] = []

    # ------------------------------------------------------------------ setup
    def _setup_normal(self) -> None:
        normal = self.d.styles["Normal"]
        normal.font.name = BODY_FONT
        normal.font.size = Pt(BODY_SIZE)
        r_pr = normal.element.get_or_add_rPr()
        r_fonts = r_pr.find(qn("w:rFonts"))
        if r_fonts is None:
            r_fonts = OxmlElement("w:rFonts")
            r_pr.append(r_fonts)
        for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            r_fonts.set(qn(attr), BODY_FONT)
        pf = normal.paragraph_format
        pf.space_after = Pt(8)
        pf.line_spacing = 1.15

    def _setup_fallback_page(self) -> None:
        section = self.d.sections[0]
        section.page_width = Inches(8.27)
        section.page_height = Inches(11.69)
        for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
            setattr(section, side, Inches(1.0))
        section.header_distance = Inches(0.49)
        section.footer_distance = Inches(0.49)

    # ------------------------------------------------------------------ blocks
    def section_bar(self, number: int, title: str) -> None:
        """Full-width peach bar holding 'N. TITLE' — a one-cell table, as in the template."""
        self.events.append({"kind": "bar", "number": number, "title": title})
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        table.style = "Table Grid"
        cell = table.cell(0, 0)
        cell.width = Inches(TEXT_COLUMN_IN)
        _shade(cell, BAR_FILL)
        cell.paragraphs[0].text = ""
        para = cell.paragraphs[0]
        para.paragraph_format.space_after = Pt(4)
        para.paragraph_format.space_before = Pt(4)
        run = para.add_run(f"{number}. ")
        _force_font(run, size=14, bold=True)
        run.font.color.rgb = INK
        run = para.add_run(title)
        _force_font(run, size=14, bold=True)
        run.font.color.rgb = INK
        self.spacer(10)

    def sub(self, text: str, *, space_before: float = 12) -> None:
        """Bold sub-heading inside a section (Project Description, Dataset Name, ...)."""
        self.events.append({"kind": "sub", "text": text})
        para = self.d.add_paragraph()
        para.paragraph_format.space_before = Pt(space_before)
        para.paragraph_format.space_after = Pt(4)
        para.paragraph_format.keep_with_next = True
        run = para.add_run(text)
        _force_font(run, bold=True)
        run.font.color.rgb = INK

    def body(self, text: str, *, align: str = "left", size: float | None = None,
             italic: bool = False, space_after: float = 8,
             indent: float | None = None) -> None:
        self.events.append({"kind": "p", "text": text})
        para = self.d.add_paragraph()
        para.paragraph_format.space_after = Pt(space_after)
        if align == "justify":
            para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        elif align == "center":
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif align == "left":
            para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        if indent:
            para.paragraph_format.left_indent = Inches(indent)
        run = para.add_run(text)
        _force_font(run, size=size, bold=False)
        run.italic = italic

    def rich(self, parts: list[tuple[str, str]], *, align: str = "left",
             size: float | None = None, space_after: float = 8) -> None:
        """Paragraph from (text, style) pairs; style in {'', 'b', 'i', 'bi'}."""
        self.events.append({"kind": "rich", "parts": parts})
        para = self.d.add_paragraph()
        para.paragraph_format.space_after = Pt(space_after)
        if align == "justify":
            para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        elif align == "center":
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        else:
            para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        for text, style in parts:
            run = para.add_run(text)
            _force_font(run, size=size, bold="b" in style)
            if "i" in style:
                run.italic = True

    def bullet(self, text: str, *, level: int = 0, bold_lead: str | None = None,
               size: float | None = None) -> None:
        self.events.append({"kind": "bullet", "text": text, "level": level})
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.3 if level == 0 else 0.6)
        para.paragraph_format.first_line_indent = Inches(-0.2)
        para.paragraph_format.space_after = Pt(4)
        para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        mark = "\u2022  " if level == 0 else "\u2013  "
        _force_font(para.add_run(mark), size=size)
        if bold_lead:
            _force_font(para.add_run(bold_lead), size=size, bold=True)
        _force_font(para.add_run(text), size=size)

    def numbered(self, marker: str, text: str, *, bold_lead: str | None = None,
                 size: float | None = None) -> None:
        """Explicit marker — Word auto-numbering restarts unpredictably across tables."""
        self.events.append({"kind": "numbered", "marker": marker, "text": text})
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.35)
        para.paragraph_format.first_line_indent = Inches(-0.25)
        para.paragraph_format.space_after = Pt(4)
        para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        _force_font(para.add_run(f"{marker}  "), size=size)
        if bold_lead:
            _force_font(para.add_run(bold_lead), size=size, bold=True)
        _force_font(para.add_run(text), size=size)

    def table(self, header: list[str], rows: list[list[str]], *,
              widths: list[float] | None = None, font_size: float = 9.0,
              caption: str | None = None) -> None:
        """Plain bordered table with a bold, unshaded header row (template style)."""
        self.events.append({
            "kind": "table", "header": list(header),
            "rows": [list(r) for r in rows], "caption": caption,
            "widths": widths, "font_size": font_size,
        })
        if caption:
            self.table_no += 1
            cap = self.d.add_paragraph()
            cap.paragraph_format.space_before = Pt(10)
            cap.paragraph_format.space_after = Pt(3)
            cap.paragraph_format.keep_with_next = True
            run = cap.add_run(f"Table {self.table_no}. {caption}")
            _force_font(run, size=9.0, bold=True)
            run.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

        table = self.d.add_table(rows=1, cols=len(header))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = widths is None

        for i, text in enumerate(header):
            cell = table.rows[0].cells[i]
            cell.text = ""
            para = cell.paragraphs[0]
            para.paragraph_format.space_after = Pt(1)
            para.paragraph_format.line_spacing = 1.0
            run = para.add_run(text)
            _force_font(run, size=font_size, bold=True)
            run.font.color.rgb = INK

        for row in rows:
            cells = table.add_row().cells
            for i, text in enumerate(row):
                cells[i].text = ""
                para = cells[i].paragraphs[0]
                para.paragraph_format.space_after = Pt(1)
                para.paragraph_format.line_spacing = 1.0
                run = para.add_run(str(text))
                _force_font(run, size=font_size, bold=False)

        if widths:
            total = sum(widths)
            scaled = [w * TEXT_COLUMN_IN / total for w in widths]
            table.autofit = False
            for row in table.rows:
                for i, width in enumerate(scaled):
                    row.cells[i].width = Inches(width)
        self.spacer(8)

    def key_value(self, rows: list[tuple[str, str]], *,
                  label_width: float = 2.0, size: float = 11.0) -> None:
        """Borderless label/value grid used by the template's PROJECT NAME block."""
        self.events.append({"kind": "kv", "rows": rows})
        table = self.d.add_table(rows=0, cols=2)
        table.autofit = False
        for label, value in rows:
            cells = table.add_row().cells
            cells[0].width = Inches(label_width)
            cells[1].width = Inches(TEXT_COLUMN_IN - label_width)
            for cell in cells:
                cell.text = ""
                cell.paragraphs[0].paragraph_format.space_after = Pt(2)
            if label:
                run = cells[0].paragraphs[0].add_run(label)
                _force_font(run, size=size, bold=True)
            if value:
                run = cells[1].paragraphs[0].add_run(value)
                _force_font(run, size=size)
        self.spacer(10)

    def code(self, text: str, caption: str | None = None) -> None:
        """Monospaced listing with a small bold caption above it."""
        self.events.append({"kind": "code", "text": text, "caption": caption})
        if caption:
            cap = self.d.add_paragraph()
            cap.paragraph_format.space_before = Pt(8)
            cap.paragraph_format.space_after = Pt(2)
            cap.paragraph_format.keep_with_next = True
            run = cap.add_run(caption)
            _force_font(run, size=9.0, bold=True)
            run.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

        table = self.d.add_table(rows=1, cols=1)
        table.style = "Table Grid"
        table.autofit = False
        cell = table.cell(0, 0)
        cell.width = Inches(TEXT_COLUMN_IN)
        _shade(cell, "F4F6F8")
        cell.paragraphs[0].text = ""
        for i, line in enumerate(text.rstrip("\n").split("\n")):
            para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
            para.paragraph_format.space_after = Pt(0)
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.line_spacing = 1.0
            run = para.add_run(line if line else " ")
            run.font.name = "Consolas"
            run.font.size = Pt(8.5)
            r_pr = run._element.get_or_add_rPr()
            r_fonts = r_pr.find(qn("w:rFonts"))
            if r_fonts is None:
                r_fonts = OxmlElement("w:rFonts")
                r_pr.append(r_fonts)
            for attr in ("w:ascii", "w:hAnsi", "w:cs"):
                r_fonts.set(qn(attr), "Consolas")
        self.spacer(8)

    def figure_placeholder(self, caption: str, instruction: str) -> None:
        """Dashed 'insert screenshot here' box plus its Figure caption."""
        self.figure_no += 1
        self.events.append({"kind": "figure", "caption": caption,
                            "instruction": instruction, "number": self.figure_no})
        table = self.d.add_table(rows=1, cols=1)
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        cell = table.cell(0, 0)
        cell.width = Inches(TEXT_COLUMN_IN)
        _shade(cell, "FBF4E4")
        cell.paragraphs[0].text = ""
        head = cell.paragraphs[0]
        head.alignment = WD_ALIGN_PARAGRAPH.CENTER
        head.paragraph_format.space_before = Pt(18)
        head.paragraph_format.space_after = Pt(2)
        run = head.add_run("[ INSERT SCREENSHOT HERE ]")
        _force_font(run, size=9.5, bold=True)
        run.font.color.rgb = RGBColor(0xA0, 0x6A, 0x00)
        hint = cell.add_paragraph()
        hint.alignment = WD_ALIGN_PARAGRAPH.CENTER
        hint.paragraph_format.space_after = Pt(18)
        run = hint.add_run(instruction)
        _force_font(run, size=8.5)
        run.italic = True
        run.font.color.rgb = RGBColor(0x59, 0x59, 0x59)

        cap = self.d.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.space_before = Pt(4)
        cap.paragraph_format.space_after = Pt(10)
        run = cap.add_run(f"Figure {self.figure_no}. {caption}")
        _force_font(run, size=9.0, bold=True)
        run.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    def spacer(self, points: float = 8) -> None:
        self.events.append({"kind": "spacer", "points": points})
        para = self.d.add_paragraph()
        para.paragraph_format.space_after = Pt(points)
        para.paragraph_format.line_spacing = 1.0
        # An empty spacer paragraph still costs a line; shrink the run to nothing.
        para.paragraph_format.space_before = Pt(0)
        run = para.add_run("")
        _force_font(run, size=2)

    def page_break(self) -> None:
        self.events.append({"kind": "page_break"})
        from docx.enum.text import WD_BREAK
        self.d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    def save(self, path: str) -> None:
        self.d.save(path)
