"""Small helper layer over python-docx for building the CSST 102 documentation.

Keeps the section modules readable: they call h1()/p()/table() and never touch
the python-docx API directly.
"""

from __future__ import annotations

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ACCENT = RGBColor(0x1F, 0x4E, 0x79)
ACCENT_LIGHT = RGBColor(0x2E, 0x75, 0xB6)
GREY = RGBColor(0x59, 0x59, 0x59)

# Hex mirrors, so the PDF renderer can replay the same colours.
ACCENT_HEX = "1F4E79"
ACCENT_LIGHT_HEX = "2E75B6"
GREY_HEX = "595959"


def _shade(cell, hex_fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def _monospace(run, size=8.5) -> None:
    run.font.name = "Consolas"
    run.font.size = Pt(size)
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    r_fonts.set(qn("w:ascii"), "Consolas")
    r_fonts.set(qn("w:hAnsi"), "Consolas")


class Doc:
    """Thin wrapper that also numbers tables and figures for cross-reference."""

    def __init__(self) -> None:
        self.d = Document()
        self.table_no = 0
        self.figure_no = 0
        # Ordered event log so a second renderer (PDF) can replay the exact same
        # document instead of re-implementing 18,000 words of content.
        self.events: list[dict] = []
        self._setup_styles()
        self._setup_page()

    # ------------------------------------------------------------ recording
    def _rec(self, kind: str, **payload) -> None:
        payload["kind"] = kind
        self.events.append(payload)

    # ---------------------------------------------------------------- setup
    def _setup_page(self) -> None:
        for section in self.d.sections:
            section.page_width = Inches(8.27)   # A4
            section.page_height = Inches(11.69)
            section.left_margin = Inches(0.9)
            section.right_margin = Inches(0.9)
            section.top_margin = Inches(0.8)
            section.bottom_margin = Inches(0.8)

    def _setup_styles(self) -> None:
        normal = self.d.styles["Normal"]
        normal.font.name = "Calibri"
        normal.font.size = Pt(10.5)
        normal.paragraph_format.space_after = Pt(6)
        normal.paragraph_format.line_spacing = 1.15

        specs = {
            "Heading 1": (16, ACCENT, 18, 8),
            "Heading 2": (13, ACCENT_LIGHT, 14, 5),
            "Heading 3": (11.5, ACCENT_LIGHT, 10, 4),
            "Heading 4": (10.5, GREY, 8, 3),
        }
        for name, (size, colour, before, after) in specs.items():
            style = self.d.styles[name]
            style.font.name = "Calibri"
            style.font.size = Pt(size)
            style.font.color.rgb = colour
            style.font.bold = True
            style.paragraph_format.space_before = Pt(before)
            style.paragraph_format.space_after = Pt(after)
            style.paragraph_format.keep_with_next = True

    # ---------------------------------------------------------------- text
    def h1(self, text: str, page_break: bool = True):
        if page_break:
            self.page_break()
        self._rec("heading", level=1, text=text)
        return self.d.add_heading(text, level=1)

    def h2(self, text: str):
        self._rec("heading", level=2, text=text)
        return self.d.add_heading(text, level=2)

    def h3(self, text: str):
        self._rec("heading", level=3, text=text)
        return self.d.add_heading(text, level=3)

    def h4(self, text: str):
        self._rec("heading", level=4, text=text)
        return self.d.add_heading(text, level=4)

    def p(self, text: str = "", *, bold: bool = False, italic: bool = False,
          size: float | None = None, align: str | None = None, space_after: float | None = None):
        self._rec("p", text=text, bold=bold, italic=italic, size=size, align=align)
        para = self.d.add_paragraph()
        run = para.add_run(text)
        run.bold = bold
        run.italic = italic
        if size:
            run.font.size = Pt(size)
        if align == "center":
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif align == "justify":
            para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        elif align == "right":
            para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if space_after is not None:
            para.paragraph_format.space_after = Pt(space_after)
        return para

    def rich(self, parts: list[tuple[str, str]], align: str = "justify"):
        """Paragraph from (text, style) pairs; style in {'', 'b', 'i', 'bi', 'code'}."""
        self._rec("rich", parts=parts, align=align)
        para = self.d.add_paragraph()
        for text, style in parts:
            run = para.add_run(text)
            if "b" in style:
                run.bold = True
            if "i" in style:
                run.italic = True
            if style == "code":
                _monospace(run, 9.5)
        if align == "justify":
            para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        return para

    def bullet(self, text: str, level: int = 0, *, bold_lead: str | None = None):
        style = "List Bullet" if level == 0 else "List Bullet 2"
        self._rec("bullet", text=text, level=level, bold_lead=bold_lead)
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.28 if level == 0 else 0.55)
        para.paragraph_format.first_line_indent = Inches(-0.18)
        mark = "\u2022  " if level == 0 else "\u2013  "
        run = para.add_run(mark)
        if bold_lead:
            run = para.add_run(bold_lead)
            run.bold = True
        para.add_run(text)
        para.paragraph_format.space_after = Pt(3)
        return para

    def numbered(self, text: str, *, bold_lead: str | None = None,
                 marker: str | None = None):
        """Explicit marker avoids Word auto-numbering (which restarts unpredictably
        and duplicated the "Step N" the callers already write into bold_lead)."""
        self._rec("numbered", text=text, bold_lead=bold_lead, marker=marker)
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.28)
        para.paragraph_format.first_line_indent = Inches(-0.28)
        if marker:
            run = para.add_run(marker + "  ")
            run.bold = True
        if bold_lead:
            run = para.add_run(bold_lead)
            run.bold = True
        para.add_run(text)
        para.paragraph_format.space_after = Pt(3)
        return para

    def code(self, text: str, caption: str | None = None):
        self._rec("code", text=text, caption=caption)
        if caption:
            cap = self.d.add_paragraph()
            run = cap.add_run(caption)
            run.bold = True
            run.font.size = Pt(8.5)
            run.font.color.rgb = GREY
            cap.paragraph_format.space_after = Pt(2)
            cap.paragraph_format.keep_with_next = True
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.25)
        para.paragraph_format.space_after = Pt(10)
        para.paragraph_format.line_spacing = 1.0
        for i, line in enumerate(text.rstrip("\n").split("\n")):
            if i:
                para.add_run().add_break()
            run = para.add_run(line if line else " ")
            _monospace(run, 8.5)
        # light background box
        p_pr = para._p.get_or_add_pPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "F4F6F8")
        p_pr.append(shd)
        return para

    def quote(self, label: str, text: str):
        """Highlighted callout for key findings."""
        self._rec("quote", label=label, text=text)
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)
        _shade(cell, "EAF1F8")
        cell.paragraphs[0].text = ""
        head = cell.paragraphs[0].add_run(label)
        head.bold = True
        head.font.size = Pt(9.5)
        head.font.color.rgb = ACCENT
        body = cell.add_paragraph()
        run = body.add_run(text)
        run.font.size = Pt(10)
        body.paragraph_format.space_after = Pt(2)
        self._set_cell_borders(table)
        self.d.add_paragraph().paragraph_format.space_after = Pt(2)
        return table

    # --------------------------------------------------------------- tables
    @staticmethod
    def _set_cell_borders(table) -> None:
        tbl = table._tbl
        tbl_pr = tbl.tblPr
        borders = OxmlElement("w:tblBorders")
        for edge in ("top", "left", "bottom", "right"):
            element = OxmlElement(f"w:{edge}")
            element.set(qn("w:val"), "single")
            element.set(qn("w:sz"), "4")
            element.set(qn("w:color"), "BFCBDA")
            borders.append(element)
        tbl_pr.append(borders)

    def table(self, header: list[str], rows: list[list[str]], *,
              caption: str | None = None, widths: list[float] | None = None,
              align_numeric: bool = True, font_size: float = 9.0,
              header_fill: str = "1F4E79"):
        self._rec("table", header=list(header), rows=[list(r) for r in rows],
                  caption=caption, widths=widths, align_numeric=align_numeric,
                  font_size=font_size)
        if caption:
            self.table_no += 1
            cap = self.d.add_paragraph()
            run = cap.add_run(f"Table {self.table_no}. {caption}")
            run.bold = True
            run.font.size = Pt(8.5)
            run.font.color.rgb = GREY
            cap.paragraph_format.space_before = Pt(8)
            cap.paragraph_format.space_after = Pt(3)
            cap.paragraph_format.keep_with_next = True

        table = self.d.add_table(rows=1, cols=len(header))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = widths is None

        for i, text in enumerate(header):
            cell = table.rows[0].cells[i]
            cell.text = ""
            para = cell.paragraphs[0]
            run = para.add_run(text)
            run.bold = True
            run.font.size = Pt(font_size)
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            para.paragraph_format.space_after = Pt(1)
            _shade(cell, header_fill)

        for row in rows:
            cells = table.add_row().cells
            for i, text in enumerate(row):
                cells[i].text = ""
                para = cells[i].paragraphs[0]
                run = para.add_run(str(text))
                run.font.size = Pt(font_size)
                para.paragraph_format.space_after = Pt(1)
                para.paragraph_format.line_spacing = 1.0
                if align_numeric and i > 0 and _looks_numeric(str(text)):
                    para.alignment = WD_ALIGN_PARAGRAPH.RIGHT

        if widths:
            total = sum(widths)
            limit = 6.45
            if total > limit:  # never let a table run past the text column
                widths = [w * limit / total for w in widths]
            for row in table.rows:
                for i, width in enumerate(widths):
                    row.cells[i].width = Inches(width)

        self.d.add_paragraph().paragraph_format.space_after = Pt(2)
        return table

    def toc(self, entries: list[tuple[str, int]]):
        """Static table-of-contents listing: [(text, level), ...]."""
        self._rec("toc", entries=list(entries))
        for text, level in entries:
            para = self.d.add_paragraph()
            para.paragraph_format.space_after = Pt(2)
            if level == 2:
                para.paragraph_format.left_indent = Inches(0.35)
            run = para.add_run(text)
            run.font.size = Pt(10.5 if level == 1 else 9.5)
            run.bold = level == 1
            if level == 1:
                run.font.color.rgb = ACCENT

    def kv_block(self, rows: list[tuple[str, str]], *, label_width: float = 1.85,
                 value_width: float = 4.5, size: float = 11.0):
        """Borderless two-column label/value block (cover page header)."""
        self._rec("kv", rows=list(rows), label_width=label_width,
                  value_width=value_width, size=size)
        table = self.d.add_table(rows=0, cols=2)
        table.autofit = False
        for label, value in rows:
            cells = table.add_row().cells
            cells[0].width = Inches(label_width)
            cells[1].width = Inches(value_width)
            cells[0].text = ""
            cells[1].text = ""
            if label:
                run = cells[0].paragraphs[0].add_run(label)
                run.bold = True
                run.font.size = Pt(size)
            run = cells[1].paragraphs[0].add_run(value)
            run.font.size = Pt(size)
        return table

    def figure_placeholder(self, caption: str, instruction: str, height: float = 2.2):
        self.figure_no += 1
        self._rec("figure", caption=caption, instruction=instruction, number=self.figure_no)
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)
        _shade(cell, "FBF4E4")
        cell.paragraphs[0].text = ""
        run = cell.paragraphs[0].add_run("[ INSERT SCREENSHOT HERE ]")
        run.bold = True
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0xA0, 0x6A, 0x00)
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        hint = cell.add_paragraph()
        hint_run = hint.add_run(instruction)
        hint_run.italic = True
        hint_run.font.size = Pt(8)
        hint_run.font.color.rgb = GREY
        self._set_cell_borders(table)

        cap = self.d.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = cap.add_run(f"Figure {self.figure_no}. {caption}")
        run.bold = True
        run.font.size = Pt(8.5)
        run.font.color.rgb = GREY
        cap.paragraph_format.space_before = Pt(3)
        cap.paragraph_format.space_after = Pt(12)
        return table

    # -------------------------------------------------------------- controls
    def page_break(self) -> None:
        self._rec("page_break")
        self.d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    def spacer(self, points: float = 12) -> None:
        self._rec("spacer", points=points)
        para = self.d.add_paragraph()
        para.paragraph_format.space_after = Pt(points)

    def footer(self, text: str) -> None:
        for section in self.d.sections:
            footer = section.footer
            para = footer.paragraphs[0]
            para.text = ""
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = para.add_run(text + "   |   Page ")
            run.font.size = Pt(8)
            run.font.color.rgb = GREY
            fld = OxmlElement("w:fldSimple")
            fld.set(qn("w:instr"), "PAGE")
            inner = OxmlElement("w:r")
            r_pr = OxmlElement("w:rPr")
            sz = OxmlElement("w:sz")
            sz.set(qn("w:val"), "16")
            r_pr.append(sz)
            inner.append(r_pr)
            txt = OxmlElement("w:t")
            txt.text = "1"
            inner.append(txt)
            fld.append(inner)
            para._p.append(fld)

    def save(self, path: str) -> None:
        self.d.save(path)


def _looks_numeric(text: str) -> bool:
    cleaned = text.replace("%", "").replace(",", "").replace("±", "").replace("−", "-").strip()
    if not cleaned or cleaned in {"-", "—", "n/a"}:
        return False
    try:
        float(cleaned)
        return True
    except ValueError:
        return False
