"""PDF renderer for the template-format documentation.

Replays the event log recorded by ``template_engine.TemplateDoc`` so the .pdf
mirrors the .docx. The PDF is a review/printing convenience; the .docx is the
submission artifact, because only it carries the school's page header.

Layout deliberately mirrors the template rather than the earlier long-form
document: A4 with 1" margins, Arial-equivalent typography, peach section bars.
"""

from __future__ import annotations

import html
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as RLImage
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

BAR_FILL = colors.HexColor("#F7CAAC")
INK = colors.HexColor("#0D0D0D")
GREY = colors.HexColor("#444444")
CODE_BG = colors.HexColor("#F4F6F8")
FIG_BG = colors.HexColor("#FBF4E4")
FIG_FG = colors.HexColor("#A06A00")

PAGE_W, PAGE_H = A4
MARGIN = 1.0 * inch
CONTENT_W = PAGE_W - 2 * MARGIN
# The school header (seal + four lines) lives in the top margin band. reportlab
# cannot grow a margin the way Word does, so the body frame starts below it.
HEADER_BAND = 0.95 * inch
BODY_TOP = MARGIN + HEADER_BAND

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def _register() -> tuple[str, str, str]:
    """DejaVu covers the arrows, degree and maths glyphs the text uses."""
    regular = FONT_DIR / "DejaVuSans.ttf"
    bold = FONT_DIR / "DejaVuSans-Bold.ttf"
    mono = FONT_DIR / "DejaVuSansMono.ttf"
    if not regular.exists():  # pragma: no cover - fallback only
        return "Helvetica", "Helvetica-Bold", "Courier"

    pdfmetrics.registerFont(TTFont("Body", str(regular)))
    pdfmetrics.registerFont(TTFont("Body-Bold", str(bold) if bold.exists() else str(regular)))
    with_bold = "Body-Bold" if bold.exists() else "Body"
    pdfmetrics.registerFontFamily("Body", normal="Body", bold=with_bold,
                                  italic="Body", boldItalic=with_bold)
    if mono.exists():
        pdfmetrics.registerFont(TTFont("Mono", str(mono)))
        mono_name = "Mono"
    else:  # pragma: no cover
        mono_name = "Courier"
    return "Body", with_bold, mono_name


BODY, BOLD, MONO = _register()

S = {
    "body": ParagraphStyle("body", fontName=BODY, fontSize=10.0, leading=14.4,
                           alignment=TA_LEFT, spaceAfter=7, textColor=INK),
    "body_left": ParagraphStyle("body_left", parent=None, fontName=BODY,
                                fontSize=10.0, leading=14.4, alignment=TA_LEFT,
                                spaceAfter=7, textColor=INK),
    "sub": ParagraphStyle("sub", fontName=BOLD, fontSize=10.5, leading=14.0,
                          spaceBefore=10, spaceAfter=3, textColor=INK),
    "cell": ParagraphStyle("cell", fontName=BODY, fontSize=8.6, leading=11.2,
                           textColor=INK),
    "cell_head": ParagraphStyle("cell_head", fontName=BOLD, fontSize=8.6,
                                leading=11.2, textColor=INK),
    "code": ParagraphStyle("code", fontName=MONO, fontSize=7.6, leading=9.6,
                           textColor=INK),
    "caption": ParagraphStyle("caption", fontName=BOLD, fontSize=8.6,
                              leading=11.0, spaceBefore=8, spaceAfter=3,
                              textColor=GREY),
    "fig_cap": ParagraphStyle("fig_cap", fontName=BOLD, fontSize=8.6,
                              leading=11.0, alignment=TA_CENTER,
                              spaceBefore=3, spaceAfter=9, textColor=GREY),
    "fig_head": ParagraphStyle("fig_head", fontName=BOLD, fontSize=9.5,
                               leading=12.0, alignment=TA_CENTER,
                               textColor=FIG_FG),
    "fig_hint": ParagraphStyle("fig_hint", fontName=BODY, fontSize=8.2,
                               leading=11.0, alignment=TA_CENTER, textColor=GREY),
}


def _esc(text: str) -> str:
    return html.escape(str(text)).replace("\n", "<br/>")


def _bar(number: int, title: str) -> Table:
    para = Paragraph(f"<b>{number}. {_esc(title)}</b>",
                     ParagraphStyle("bar", fontName=BOLD, fontSize=14, leading=18,
                                    textColor=INK))
    table = Table([[para]], colWidths=[CONTENT_W])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BAR_FILL),
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#BFBFBF")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def _grid(header: list[str], rows: list[list[str]], widths: list[float] | None,
          font_size: float) -> Table:
    head = S["cell_head"] if font_size >= 8.0 else ParagraphStyle(
        "cell_head_s", parent=S["cell_head"], fontSize=font_size, leading=font_size * 1.3)
    body = S["cell"] if font_size >= 8.0 else ParagraphStyle(
        "cell_s", parent=S["cell"], fontSize=font_size, leading=font_size * 1.3)

    data = [[Paragraph(_esc(h), head) for h in header]]
    data += [[Paragraph(_esc(c), body) for c in row] for row in rows]

    if widths:
        total = sum(widths)
        col_widths = [w * CONTENT_W / total for w in widths]
    else:
        col_widths = [CONTENT_W / len(header)] * len(header)

    table = Table(data, colWidths=col_widths, repeatRows=1, hAlign="CENTER")
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#7F7F7F")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


class Renderer:
    def __init__(self, events: list[dict]) -> None:
        self.events = events
        self.story: list = []
        self.table_no = 0
        self.fig_no = 0

    def render(self) -> list:
        for ev in self.events:
            handler = getattr(self, "_" + ev["kind"], None)
            if handler:
                handler(ev)
        return self.story

    # ------------------------------------------------------------------ blocks
    def _bar(self, ev: dict) -> None:
        self.story.append(CondPageBreak(90))
        self.story.append(Spacer(1, 12))
        self.story.append(_bar(ev["number"], ev["title"]))
        self.story.append(Spacer(1, 8))

    def _sub(self, ev: dict) -> None:
        self.story.append(CondPageBreak(48))
        self.story.append(Paragraph(_esc(ev["text"]), S["sub"]))

    def _p(self, ev: dict) -> None:
        style = S["body_left"] if ev.get("align") in ("left", "center") else S["body"]
        if ev.get("indent"):
            style = ParagraphStyle(f"p{id(ev)}", parent=style,
                                   leftIndent=ev["indent"] * inch)
        self.story.append(Paragraph(_esc(ev["text"]), style))

    def _rich(self, ev: dict) -> None:
        parts = []
        for text, st in ev["parts"]:
            t = _esc(text)
            if "b" in st:
                t = f"<b>{t}</b>"
            if "i" in st:
                t = f"<i>{t}</i>"
            parts.append(t)
        self.story.append(Paragraph("".join(parts), S["body"]))

    def _bullet(self, ev: dict) -> None:
        level = ev.get("level", 0)
        indent = 0.30 + 0.25 * level
        style = ParagraphStyle(
            f"b{id(ev)}", parent=S["body"], leftIndent=indent * inch,
            bulletIndent=(indent - 0.18) * inch, spaceAfter=4,
        )
        mark = "\u2022" if level == 0 else "\u2013"
        self.story.append(Paragraph(_esc(ev["text"]), style, bulletText=mark))

    def _numbered(self, ev: dict) -> None:
        style = ParagraphStyle(f"n{id(ev)}", parent=S["body"], leftIndent=0.33 * inch,
                               bulletIndent=0.10 * inch, spaceAfter=4)
        self.story.append(Paragraph(_esc(ev["text"]), style,
                                    bulletText=ev.get("marker", "")))

    def _table(self, ev: dict) -> None:
        if ev.get("caption"):
            self.table_no += 1
            self.story.append(Paragraph(
                f"Table {self.table_no}. {_esc(ev['caption'])}", S["caption"]))
        flow = _grid(ev["header"], ev["rows"], ev.get("widths"),
                     ev.get("font_size", 9.0))
        self.story.append(KeepTogether([flow]) if len(ev["rows"]) <= 6 else flow)
        self.story.append(Spacer(1, 8))

    def _kv(self, ev: dict) -> None:
        data = []
        for label, value in ev["rows"]:
            data.append([
                Paragraph(f"<b>{_esc(label)}</b>" if label else "", S["body"]),
                Paragraph(_esc(value), S["body"]),
            ])
        table = Table(data, colWidths=[2.05 * inch, CONTENT_W - 2.05 * inch])
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        self.story.append(table)
        self.story.append(Spacer(1, 8))

    def _code(self, ev: dict) -> None:
        if ev.get("caption"):
            self.story.append(Paragraph(_esc(ev["caption"]), S["caption"]))
        lines = ev["text"].rstrip("\n").split("\n")
        paras = [Paragraph(_esc(line) if line.strip() else "&nbsp;", S["code"])
                 for line in lines]
        table = Table([[paras]], colWidths=[CONTENT_W])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#C9D2DB")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        self.story.append(KeepTogether([table]) if len(lines) <= 14 else table)
        self.story.append(Spacer(1, 8))

    def _figure(self, ev: dict) -> None:
        self.fig_no += 1
        box = Table([[
            [Paragraph("[ INSERT SCREENSHOT HERE ]", S["fig_head"]),
             Spacer(1, 4),
             Paragraph(_esc(ev["instruction"]), S["fig_hint"])]
        ]], colWidths=[CONTENT_W], rowHeights=[1.7 * inch])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), FIG_BG),
            ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#D8C48A")),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        cap = Paragraph(f"Figure {self.fig_no}. {_esc(ev['caption'])}", S["fig_cap"])
        self.story.append(KeepTogether([box, cap]))

    def _spacer(self, ev: dict) -> None:
        self.story.append(Spacer(1, ev.get("points", 8) * 0.7))

    def _page_break(self, ev: dict) -> None:
        self.story.append(PageBreak())


SEAL = Path(__file__).resolve().parent / "lspu_seal.jpeg"
SCHOOL_LINES = (
    ("Republic of the Philippines", 8.0, False),
    ("Laguna State Polytechnic University", 10.0, True),
    ("Province of Laguna", 8.0, False),
    ("College of Computer Studies", 9.0, True),
)


def _page_decor(canvas, doc) -> None:
    """Reproduce the template's page header: seal at left, school block centred."""
    canvas.saveState()
    seal_size = 0.72 * inch
    seal_top = PAGE_H - 0.28 * inch
    if SEAL.exists():
        try:
            canvas.drawImage(str(SEAL), MARGIN, seal_top - seal_size,
                             width=seal_size, height=seal_size,
                             preserveAspectRatio=True, anchor="nw", mask="auto")
        except Exception:  # pragma: no cover - never fail a build over the seal
            pass

    # Centre the school block in the space to the right of the seal, as the
    # template does, rather than across the full page width.
    text_left = MARGIN + seal_size + 0.12 * inch
    centre_x = text_left + (PAGE_W - MARGIN - text_left) / 2
    y = seal_top - 0.06 * inch
    for text, size, bold in SCHOOL_LINES:
        y -= size
        canvas.setFont(BOLD if bold else BODY, size)
        canvas.setFillColor(INK)
        canvas.drawCentredString(centre_x, y, text)
        y -= 2.4

    rule_y = PAGE_H - MARGIN - HEADER_BAND + 0.10 * inch
    canvas.setStrokeColor(colors.HexColor("#BFBFBF"))
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, rule_y, PAGE_W - MARGIN, rule_y)

    canvas.setFont(BODY, 8)
    canvas.setFillColor(GREY)
    canvas.drawCentredString(PAGE_W / 2, 0.55 * inch, str(canvas.getPageNumber()))
    canvas.restoreState()


def build_pdf(events: list[dict], out_path: str) -> int:
    renderer = Renderer(events)
    story = renderer.render()

    doc = BaseDocTemplate(
        out_path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=BODY_TOP, bottomMargin=MARGIN,
        title="TRANA \u2014 CSST 102 Final Project Documentation",
        author="TRANA",
    )
    frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - BODY_TOP - MARGIN,
                  id="body")
    doc.addPageTemplates([PageTemplate(id="body", frames=[frame], onPage=_page_decor)])
    doc.build(story)
    return doc.page
