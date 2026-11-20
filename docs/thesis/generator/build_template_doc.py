"""Build the CSST 102 documentation in the official school template format.

Usage:
    python docs/thesis/generator/build_template_doc.py [--template PATH]
                                                       [--out PATH]
                                                       [--pdf PATH]
                                                       [--only docx|pdf]

The output follows ``CSST 102(IS) - Documentation Template.docx`` exactly: the
same seven numbered sections, the same sub-headings, the same six tables, and
the same closing line. The document is created by cloning that template, so the
LSPU seal in the page header and the page geometry are inherited rather than
reproduced.

Numbers come from the committed reports under ``ml/evaluation/reports`` and the
model card. See ``template_content.py`` for the per-figure provenance notes.

The ``.docx`` and the ``.pdf`` are rendered from one pass: ``TemplateDoc``
records an ordered event log while writing the .docx, and ``template_pdf``
replays it, so the two files cannot drift apart.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from template_content import build  # noqa: E402
from template_engine import TemplateDoc  # noqa: E402

THESIS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_TEMPLATE = REPO_ROOT / "google_drive" / "CSST 102(IS) - Documentation Template.docx"
DEFAULT_DOCX = THESIS_DIR / "TRANA-CSST102-Template-Format.docx"
DEFAULT_PDF = THESIS_DIR / "TRANA-CSST102-Template-Format.pdf"


def _announce(doc: TemplateDoc) -> None:
    origin = "cloned from the official template" if doc.cloned else (
        "assembled from the committed seal image (template file not found)"
    )
    print(f"  header/geometry: {origin}")


def build_docx(template: Path | None, out: Path) -> list[dict]:
    doc = TemplateDoc(template)
    build(doc)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  tables: {doc.table_no}   figures: {doc.figure_no}   "
          f"events: {len(doc.events)}")
    _announce(doc)
    return doc.events


def build_pdf(events: list[dict], out: Path) -> None:
    from template_pdf import build_pdf as _build_pdf

    out.parent.mkdir(parents=True, exist_ok=True)
    pages = _build_pdf(events, str(out))
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)   pages: {pages}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE,
                        help="path to the official .docx template")
    parser.add_argument("--out", type=Path, default=DEFAULT_DOCX)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--only", choices=("docx", "pdf"), default=None)
    args = parser.parse_args()

    template = args.template if args.template.exists() else None
    events: list[dict] = []

    if args.only in (None, "docx"):
        events = build_docx(template, args.out)
    elif args.only == "pdf":
        recorder = TemplateDoc(template)
        build(recorder)
        events = recorder.events

    if args.only in (None, "pdf"):
        build_pdf(events, args.pdf)


if __name__ == "__main__":
    main()
