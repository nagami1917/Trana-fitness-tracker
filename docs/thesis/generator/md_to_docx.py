"""Convert a documentation Markdown file into a .docx for Google Docs import.

Uploading raw Markdown to Drive converts it to a Doc, but the pipes and hashes
survive as literal text — no headings, no tables. This walks the Markdown instead
and emits real Word structure, so the resulting Google Doc is navigable and its
tables are actual tables.

Supported (deliberately a small subset, matched to what the thesis docs use):

    # / ## / ### / ####     heading levels 1-4
    | a | b |               pipe tables, first row is the header
    - item                  bullet
    1. item                 numbered
    > quote                 shaded call-out (with optional **Lead.** bold)
    ```lang ... ```         monospaced block
    **bold**  `code`        inline, resolved inside paragraphs and table cells
    ---                     horizontal rule

Usage:
    python docs/thesis/generator/md_to_docx.py INPUT.md OUTPUT.docx
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

FONT = "Arial"
MONO = "Consolas"
INK = RGBColor(0x1A, 0x1A, 0x1A)
GREY = RGBColor(0x59, 0x59, 0x59)
ACCENT = RGBColor(0x1F, 0x4E, 0x79)
QUOTE_FILL = "EEF3F8"
CODE_FILL = "F4F6F8"
HEAD_FILL = "E8EDF3"
TEXT_WIDTH = 6.5  # letter, 1" margins


# --------------------------------------------------------------------- helpers
def _shade(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _font(run, *, size: float | None = None, bold: bool | None = None,
          italic: bool | None = None, name: str = FONT,
          color: RGBColor | None = None) -> None:
    run.font.name = name
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = color
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        r_fonts.set(qn(attr), name)


INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


def write_inline(para, text: str, *, size: float = 10.5,
                 color: RGBColor | None = INK) -> None:
    """Emit a run per inline segment, honouring **bold** and `code`."""
    for segment in INLINE.split(text):
        if not segment:
            continue
        if segment.startswith("**") and segment.endswith("**") and len(segment) > 4:
            _font(para.add_run(segment[2:-2]), size=size, bold=True, color=color)
        elif segment.startswith("`") and segment.endswith("`") and len(segment) > 2:
            _font(para.add_run(segment[1:-1]), size=size - 0.5, name=MONO,
                  color=RGBColor(0x8B, 0x2B, 0x2B))
        else:
            _font(para.add_run(segment), size=size, color=color)


def parse_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def is_separator(line: str) -> bool:
    return bool(re.fullmatch(r"\s*\|?[\s:|-]+\|?\s*", line)) and "-" in line


# ------------------------------------------------------------------- converter
class Converter:
    def __init__(self) -> None:
        self.d = Document()
        self._page()
        self._base_style()

    def _page(self) -> None:
        s = self.d.sections[0]
        s.page_width = Inches(8.5)
        s.page_height = Inches(11)
        for side in ("left_margin", "right_margin"):
            setattr(s, side, Inches(1.0))
        s.top_margin = Inches(0.9)
        s.bottom_margin = Inches(0.9)

    def _base_style(self) -> None:
        normal = self.d.styles["Normal"]
        normal.font.name = FONT
        normal.font.size = Pt(10.5)
        r_pr = normal.element.get_or_add_rPr()
        r_fonts = r_pr.find(qn("w:rFonts"))
        if r_fonts is None:
            r_fonts = OxmlElement("w:rFonts")
            r_pr.append(r_fonts)
        for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            r_fonts.set(qn(attr), FONT)
        pf = normal.paragraph_format
        pf.space_after = Pt(7)
        pf.line_spacing = 1.18

    # ------------------------------------------------------------------ blocks
    def heading(self, level: int, text: str) -> None:
        sizes = {1: 19, 2: 14.5, 3: 12, 4: 11}
        para = self.d.add_paragraph()
        para.paragraph_format.space_before = Pt(16 if level <= 2 else 11)
        para.paragraph_format.space_after = Pt(5)
        para.paragraph_format.keep_with_next = True
        # Map Markdown depth to Word depth 1:1 so Google Docs builds a
        # correctly nested outline (# = Heading 1, ## = Heading 2, ...).
        para.style = self.d.styles[f"Heading {min(level, 4)}"]
        run = para.add_run(text)
        _font(run, size=sizes.get(level, 11), bold=True,
              color=ACCENT if level <= 2 else INK)

    def paragraph(self, text: str) -> None:
        para = self.d.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        write_inline(para, text)

    def bullet(self, text: str, level: int = 0) -> None:
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.28 + 0.26 * level)
        para.paragraph_format.first_line_indent = Inches(-0.18)
        para.paragraph_format.space_after = Pt(3)
        _font(para.add_run("\u2022  " if level == 0 else "\u2013  "))
        write_inline(para, text)

    def numbered(self, marker: str, text: str) -> None:
        para = self.d.add_paragraph()
        para.paragraph_format.left_indent = Inches(0.32)
        para.paragraph_format.first_line_indent = Inches(-0.32)
        para.paragraph_format.space_after = Pt(3)
        _font(para.add_run(f"{marker}  "))
        write_inline(para, text)

    def quote(self, text: str) -> None:
        """Shaded single-cell table — survives conversion as a visible call-out."""
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        cell = table.cell(0, 0)
        cell.width = Inches(TEXT_WIDTH)
        _shade(cell, QUOTE_FILL)
        cell.paragraphs[0].text = ""
        para = cell.paragraphs[0]
        para.paragraph_format.space_before = Pt(4)
        para.paragraph_format.space_after = Pt(4)
        write_inline(para, text, size=10)
        self.d.add_paragraph().paragraph_format.space_after = Pt(2)

    def code(self, text: str) -> None:
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        cell = table.cell(0, 0)
        cell.width = Inches(TEXT_WIDTH)
        _shade(cell, CODE_FILL)
        cell.paragraphs[0].text = ""
        for i, line in enumerate(text.rstrip("\n").split("\n")):
            para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
            para.paragraph_format.space_after = Pt(0)
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.line_spacing = 1.0
            _font(para.add_run(line if line else " "), size=8.5, name=MONO)
        self.d.add_paragraph().paragraph_format.space_after = Pt(2)

    def table(self, header: list[str], rows: list[list[str]]) -> None:
        ncols = len(header)
        table = self.d.add_table(rows=1, cols=ncols)
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER

        for i, text in enumerate(header):
            cell = table.rows[0].cells[i]
            cell.text = ""
            para = cell.paragraphs[0]
            para.paragraph_format.space_after = Pt(1)
            _shade(cell, HEAD_FILL)
            write_inline(para, text, size=9.0)

        for row in rows:
            cells = table.add_row().cells
            for i in range(ncols):
                text = row[i] if i < len(row) else ""
                cells[i].text = ""
                para = cells[i].paragraphs[0]
                para.paragraph_format.space_after = Pt(1)
                write_inline(para, text, size=9.0)

        # Even columns, then let Word balance to content.
        width = Inches(TEXT_WIDTH / ncols)
        for row in table.rows:
            for cell in row.cells:
                cell.width = width
        self.d.add_paragraph().paragraph_format.space_after = Pt(2)

    def rule(self) -> None:
        para = self.d.add_paragraph()
        para.paragraph_format.space_before = Pt(4)
        para.paragraph_format.space_after = Pt(4)
        p_pr = para._p.get_or_add_pPr()
        borders = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:color"), "C9D2DB")
        borders.append(bottom)
        p_pr.append(borders)

    # ------------------------------------------------------------------- main
    def run(self, markdown: str) -> None:
        lines = markdown.split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            # fenced code
            if stripped.startswith("```"):
                i += 1
                buf = []
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    buf.append(lines[i])
                    i += 1
                i += 1
                self.code("\n".join(buf))
                continue

            # horizontal rule (must be checked before table: --- is also a separator)
            if re.fullmatch(r"-{3,}", stripped):
                self.rule()
                i += 1
                continue

            # heading
            m = re.match(r"(#{1,4})\s+(.*)$", stripped)
            if m:
                self.heading(len(m.group(1)), m.group(2).strip())
                i += 1
                continue

            # table: current line is a pipe row and the next is a separator
            if stripped.startswith("|") and i + 1 < len(lines) \
                    and is_separator(lines[i + 1]):
                header = parse_row(stripped)
                i += 2
                rows = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    rows.append(parse_row(lines[i]))
                    i += 1
                self.table(header, rows)
                continue

            # quote (consecutive > lines merge into one call-out)
            if stripped.startswith(">"):
                buf = []
                while i < len(lines) and lines[i].strip().startswith(">"):
                    buf.append(lines[i].strip().lstrip(">").strip())
                    i += 1
                self.quote(" ".join(b for b in buf if b))
                continue

            # bullets
            m = re.match(r"(\s*)-\s+(.*)$", line)
            if m:
                indent = len(m.group(1))
                self.bullet(m.group(2), level=1 if indent >= 2 else 0)
                i += 1
                continue

            # numbered
            m = re.match(r"(\s*)(\d+)\.\s+(.*)$", line)
            if m:
                self.numbered(f"{m.group(2)}.", m.group(3))
                i += 1
                continue

            # paragraph: gather wrapped lines until a blank or block start
            buf = [stripped]
            i += 1
            while i < len(lines):
                nxt = lines[i]
                ns = nxt.strip()
                if (not ns or ns.startswith(("#", "|", ">", "```"))
                        or re.match(r"(\s*)-\s+", nxt)
                        or re.match(r"(\s*)\d+\.\s+", nxt)
                        or re.fullmatch(r"-{3,}", ns)):
                    break
                buf.append(ns)
                i += 1
            self.paragraph(" ".join(buf))

    def save(self, path: Path) -> None:
        self.d.save(str(path))


def convert(src: Path, dst: Path) -> None:
    conv = Converter()
    conv.run(src.read_text(encoding="utf-8"))
    dst.parent.mkdir(parents=True, exist_ok=True)
    conv.save(dst)
    print(f"wrote {dst}  ({dst.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    convert(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
