"""Build the CSST 102 final project documentation for TRANA.

Usage:
    python docs/thesis/build/build_documentation.py [--out PATH]

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

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "TRANA-CSST102-Final-Project-Documentation.docx"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    doc = Doc()

    build_front_matter(doc)
    build_section_1(doc)
    build_section_2(doc)
    build_section_3(doc)
    build_section_4(doc)
    build_section_5(doc)
    build_section_6(doc)
    build_section_7(doc)

    doc.footer("TRANA \u2014 CSST 102 Final Project Documentation")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(args.out))

    size_kb = args.out.stat().st_size / 1024
    print(f"wrote {args.out}  ({size_kb:.0f} KB)")
    print(f"tables: {doc.table_no}   figure placeholders: {doc.figure_no}")


if __name__ == "__main__":
    main()
