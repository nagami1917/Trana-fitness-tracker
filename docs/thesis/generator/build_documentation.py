"""Build the CSST 102 final project documentation for TRANA.

Usage:
    python docs/thesis/generator/build_documentation.py [--out PATH] [--pdf PATH]
                                                        [--only docx|pdf]

The structure follows CSST 102(IS) - Documentation Template.docx exactly:
  1. Project Overview (Description, Objectives, Problem Definition)
  2. Dataset and Data Preprocessing
  3. Machine Learning Model Development
  4. Model Evaluation and Interpretation
  5. Web Application Development and Output
  6. Group Contributions
  7. Conclusion

Every figure quoted in the document is copied from a committed report or from a
source file in this repository. Nothing is estimated.

Both outputs are generated from a single pass: ``Doc`` records an ordered event
log while it writes the .docx, and ``pdf_engine`` replays that log. The two files
cannot drift apart.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docx_engine import Doc  # noqa: E402
from section_front import build_front_matter  # noqa: E402
from section1 import build_section_1  # noqa: E402
from section2 import build_section_2  # noqa: E402
from section3 import build_section_3  # noqa: E402
from section4 import build_section_4  # noqa: E402
from section5 import build_section_5  # noqa: E402
from section6 import build_section_6  # noqa: E402
from section7 import build_section_7  # noqa: E402

THESIS_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DOCX = THESIS_DIR / "TRANA-CSST102-Final-Project-Documentation.docx"
DEFAULT_PDF = THESIS_DIR / "TRANA-CSST102-Final-Project-Documentation.pdf"

FOOTER = "TRANA \u2014 CSST 102 Final Project Documentation"


def build_docx(out: Path) -> tuple[int, int, list[dict]]:
    doc = Doc()
    build_front_matter(doc)
    build_section_1(doc)
    build_section_2(doc)
    build_section_3(doc)
    build_section_4(doc)
    build_section_5(doc)
    build_section_6(doc)
    build_section_7(doc)
    doc.footer(FOOTER)

    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  tables: {doc.table_no}   figure placeholders: {doc.figure_no}"
          f"   recorded events: {len(doc.events)}")
    return doc.table_no, doc.figure_no, doc.events


def build_pdf(events: list[dict], out: Path) -> None:
    from pdf_engine import build_pdf as _build_pdf

    out.parent.mkdir(parents=True, exist_ok=True)
    tables, figures = _build_pdf(events, str(out))
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  tables: {tables}   figures: {figures}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_DOCX, help=".docx output path")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF, help=".pdf output path")
    parser.add_argument("--only", choices=("docx", "pdf"), default=None,
                        help="build a single format")
    args = parser.parse_args()

    events: list[dict] | None = None

    if args.only in (None, "docx"):
        _, _, events = build_docx(args.out)
    elif args.only == "pdf":
        # A throwaway docx pass is required to record the event log.
        events = Doc()
        build_front_matter(events)
        build_section_1(events)
        build_section_2(events)
        build_section_3(events)
        build_section_4(events)
        build_section_5(events)
        build_section_6(events)
        build_section_7(events)
        events = events.events

    if args.only in (None, "pdf"):
        assert events is not None
        build_pdf(events, args.pdf)


if __name__ == "__main__":
    main()
