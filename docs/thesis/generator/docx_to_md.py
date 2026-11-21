"""Regenerate the Markdown mirror from the built .docx.

``TRANA-CSST102-Template-Format.md`` used to be written by hand alongside the
.docx, so the two drifted as soon as the document changed. This script derives
the Markdown from the .docx instead, which makes the rendered file
authoritative and the mirror reproducible.

It understands the three constructs the template build emits: shaded 1x1
section bars, bold sub-headings, and pipe tables.

Run after ``build_template_doc.py``::

    python docs/thesis/generator/docx_to_md.py
"""

from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

THESIS_DIR = Path(__file__).resolve().parents[1]
SRC = THESIS_DIR / "TRANA-CSST102-Template-Format.docx"
OUT = THESIS_DIR / "TRANA-CSST102-Template-Format.md"

#: A section bar reads "3. MACHINE LEARNING MODEL DEVELOPMENT".
SECTION_BAR = re.compile(r"^\d\.\s+[A-Z][A-Z\s&,.\-]+$")


def _is_shaded_bar(table: Table) -> bool:
    """Section bars are single-cell tables with a background fill."""
    if len(table.rows) != 1 or len(table.columns) != 1:
        return False
    properties = table.rows[0].cells[0]._tc.tcPr
    return properties is not None and properties.find(qn("w:shd")) is not None


def _is_bold_only(paragraph: Paragraph) -> bool:
    runs = [run for run in paragraph.runs if run.text.strip()]
    return bool(runs) and all(run.bold for run in runs)


def _is_list_item(paragraph: Paragraph) -> bool:
    properties = paragraph._p.find(qn("w:pPr"))
    return properties is not None and properties.find(qn("w:numPr")) is not None


def convert(source: Path = SRC, out: Path = OUT) -> Path:
    document = Document(str(source))
    lines: list[str] = []

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:tbl"):
            table = Table(child, document)
            text = table.rows[0].cells[0].text.strip() if table.rows else ""

            if _is_shaded_bar(table) and SECTION_BAR.match(text):
                lines += ["", f"## {text}", ""]
                continue

            rows = [
                [cell.text.strip().replace("\n", " ") for cell in row.cells]
                for row in table.rows
            ]
            if not rows:
                continue
            lines += ["", "| " + " | ".join(rows[0]) + " |"]
            lines.append("|" + "|".join(["---"] * len(rows[0])) + "|")
            lines += ["| " + " | ".join(row) + " |" for row in rows[1:]]
            lines.append("")

        elif child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            text = paragraph.text.strip()
            if not text:
                lines.append("")
            elif _is_bold_only(paragraph) and len(text) < 90 and not text.endswith((".", ":", ",")):
                lines += ["", f"### {text}", ""]
            elif _is_list_item(paragraph):
                lines.append(f"- {text}")
            else:
                lines += [text, ""]

    collapsed: list[str] = []
    for line in lines:
        if line == "" and collapsed and collapsed[-1] == "":
            continue
        collapsed.append(line)

    out.write_text("\n".join(collapsed).strip() + "\n")
    return out


if __name__ == "__main__":
    written = convert()
    print(f"wrote {written} ({len(written.read_text().splitlines())} lines)")
