"""PDF renderer for the CSST 102 documentation.

This does not re-implement the document. It replays the event log that
``docx_engine.Doc`` records while ``build_documentation`` runs, so the .docx and
the .pdf are guaranteed to be the same content, in the same order.

Written with reportlab platypus: flowing text, repeating table headers, real
page numbers in the footer, and clickable section bookmarks.
"""

from __future__ import annotations

import html
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# ---------------------------------------------------------------- palette
ACCENT = colors.HexColor("#1F4E79")
ACCENT_LIGHT = colors.HexColor("#2E75B6")
GREY = colors.HexColor("#595959")
RULE = colors.HexColor("#BFCBDA")
CODE_BG = colors.HexColor("#F4F6F8")
QUOTE_BG = colors.HexColor("#EAF1F8")
FIG_BG = colors.HexColor("#FBF4E4")
FIG_FG = colors.HexColor("#A06A00")
HDR_ROW = colors.HexColor("#DCE6F0")

# ---------------------------------------------------------------- page geometry
PAGE_W, PAGE_H = A4
MARGIN_L = MARGIN_R = 0.9 * inch
MARGIN_T = 0.8 * inch
MARGIN_B = 0.85 * inch
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R          # ≈ 6.47 in, matches the docx

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
if not FONT_DIR.exists():                          # fall back to reportlab's Vera
    FONT_DIR = Path(__file__).resolve().parent


def _try_register(name: str, path: Path) -> bool:
    """Register a TTF if the file is present. Missing faces fall back to a sibling."""
    if not path.exists():
        return False
    try:
        pdfmetrics.registerFont(TTFont(name, str(path)))
        return True
    except Exception:  # pragma: no cover - malformed font
        return False


def _register_fonts() -> tuple[str, str, str, str, str]:
    """DejaVu covers →, ≤, ≥, ×, ±, −, ² which Vera does not.

    The container ships only the upright and bold faces, so italic degrades to
    the upright rather than failing the build. That is a cosmetic loss on a
    handful of italic runs, not a content one.
    """
    dejavu = Path("/usr/share/fonts/truetype/dejavu")

    have_regular = _try_register("Body", dejavu / "DejaVuSans.ttf")
    have_bold = _try_register("Body-Bold", dejavu / "DejaVuSans-Bold.ttf")
    have_oblique = _try_register("Body-Oblique", dejavu / "DejaVuSans-Oblique.ttf")
    have_bold_oblique = _try_register(
        "Body-BoldOblique", dejavu / "DejaVuSans-BoldOblique.ttf"
    )

    if have_regular:
        body = "Body"
        bold = "Body-Bold" if have_bold else "Body"
        italic = "Body-Oblique" if have_oblique else body
        bolditalic = (
            "Body-BoldOblique" if have_bold_oblique
            else (bold if have_bold else body)
        )
        pdfmetrics.registerFontFamily(
            "Body", normal=body, bold=bold, italic=italic, boldItalic=bolditalic,
        )
    else:  # pragma: no cover - only on systems without DejaVu
        body, bold, italic, bolditalic = (
            "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
        )

    mono = "Mono" if _try_register("Mono", dejavu / "DejaVuSansMono.ttf") else "Courier"
    return body, bold, italic, bolditalic, mono


BODY, BOLD, ITALIC, BOLDITALIC, MONO = _register_fonts()

# ---------------------------------------------------------------- styles
S = {
    "body": ParagraphStyle(
        "body", fontName=BODY, fontSize=9.7, leading=14.0, alignment=TA_JUSTIFY,
        spaceAfter=6, textColor=colors.HexColor("#111111"),
    ),
    "body_center": ParagraphStyle(
        "body_center", parent=None, fontName=BODY, fontSize=9.7, leading=14.0,
        alignment=TA_CENTER, spaceAfter=6,
    ),
    "h1": ParagraphStyle(
        "h1", fontName=BOLD, fontSize=15.5, leading=19, textColor=ACCENT,
        spaceBefore=2, spaceAfter=9,
    ),
    "h2": ParagraphStyle(
        "h2", fontName=BOLD, fontSize=12.5, leading=16, textColor=ACCENT_LIGHT,
        spaceBefore=13, spaceAfter=5,
    ),
    "h3": ParagraphStyle(
        "h3", fontName=BOLD, fontSize=10.7, leading=14, textColor=ACCENT_LIGHT,
        spaceBefore=10, spaceAfter=4,
    ),
    "h4": ParagraphStyle(
        "h4", fontName=BOLD, fontSize=9.9, leading=13, textColor=GREY,
        spaceBefore=8, spaceAfter=3,
    ),
    "bullet": ParagraphStyle(
        "bullet", fontName=BODY, fontSize=9.7, leading=13.6, alignment=TA_LEFT,
        spaceAfter=3.5, leftIndent=15, bulletIndent=4, bulletFontName=BODY,
        bulletFontSize=8.5,
    ),
    "bullet2": ParagraphStyle(
        "bullet2", fontName=BODY, fontSize=9.7, leading=13.6, alignment=TA_LEFT,
        spaceAfter=3.5, leftIndent=32, bulletIndent=20, bulletFontName=BODY,
        bulletFontSize=8.5,
    ),
    "numbered": ParagraphStyle(
        "numbered", fontName=BODY, fontSize=9.7, leading=13.6, alignment=TA_JUSTIFY,
        spaceAfter=4, leftIndent=22, bulletIndent=4, bulletFontName=BOLD,
        bulletFontSize=9.2, textColor=colors.HexColor("#111111"),
    ),
    "caption": ParagraphStyle(
        "caption", fontName=BOLD, fontSize=7.9, leading=10.5, textColor=GREY,
        spaceBefore=7, spaceAfter=3.5,
    ),
    "figcaption": ParagraphStyle(
        "figcaption", fontName=BOLD, fontSize=7.9, leading=10.5, textColor=GREY,
        alignment=TA_CENTER, spaceBefore=3, spaceAfter=11,
    ),
    "codecap": ParagraphStyle(
        "codecap", fontName=BOLD, fontSize=7.9, leading=10.5, textColor=GREY,
        spaceBefore=5, spaceAfter=2.5,
    ),
    "th": ParagraphStyle(
        "th", fontName=BOLD, fontSize=7.6, leading=9.6, textColor=colors.white,
    ),
    "th_r": ParagraphStyle(
        "th_r", fontName=BOLD, fontSize=7.6, leading=9.6, textColor=colors.white,
        alignment=TA_RIGHT,
    ),
    "td": ParagraphStyle("td", fontName=BODY, fontSize=7.7, leading=9.8),
    "td_r": ParagraphStyle("td_r", fontName=BODY, fontSize=7.7, leading=9.8, alignment=TA_RIGHT),
    "td_c": ParagraphStyle("td_c", fontName=BODY, fontSize=7.7, leading=9.8, alignment=TA_CENTER),
    "toc1": ParagraphStyle(
        "toc1", fontName=BOLD, fontSize=9.6, leading=13.5, textColor=ACCENT,
        spaceAfter=1.5, leftIndent=0,
    ),
    "toc2": ParagraphStyle(
        "toc2", fontName=BODY, fontSize=9.0, leading=12.5, leftIndent=17, spaceAfter=1,
    ),
    "kv_label": ParagraphStyle("kv_label", fontName=BOLD, fontSize=10.2, leading=13.5),
    "kv_value": ParagraphStyle("kv_value", fontName=BODY, fontSize=10.2, leading=13.5),
}


# ---------------------------------------------------------------- text helpers
def esc(text: str) -> str:
    """Escape for reportlab's mini-HTML, keeping our own markup intact."""
    return html.escape(str(text), quote=False)


def styled(parts: list[tuple[str, str]]) -> str:
    """[(text, 'b'|'i'|'bi'|'code'|'')] -> reportlab inline markup."""
    out = []
    for text, style in parts:
        body = esc(text)
        if style == "code":
            body = f'<font name="{MONO}" size="8.6">{body}</font>'
        if "b" in style and style != "code":
            body = f"<b>{body}</b>"
        if "i" in style and style != "code":
            body = f"<i>{body}</i>"
        out.append(body)
    return "".join(out)


def looks_numeric(text: str) -> bool:
    cleaned = (
        str(text).replace("%", "").replace(",", "").replace("\u00b1", "")
        .replace("\u2212", "-").strip()
    )
    if not cleaned or cleaned in {"-", "\u2014", "n/a"}:
        return False
    try:
        float(cleaned)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------- page furniture
class Doc(BaseDocTemplate):
    """Two page templates: the cover (no footer rule) and the body."""

    def __init__(self, path: str, footer_text: str, **kw: Any) -> None:
        self.footer_text = footer_text
        super().__init__(
            path, pagesize=A4,
            leftMargin=MARGIN_L, rightMargin=MARGIN_R,
            topMargin=MARGIN_T, bottomMargin=MARGIN_B,
            title="TRANA \u2014 CSST 102 Final Project Documentation",
            author="TRANA",
            subject="CSST 102 \u2013 Basic Machine Learning, Final Project Documentation",
            **kw,
        )
        frame = Frame(
            MARGIN_L, MARGIN_B, CONTENT_W, PAGE_H - MARGIN_T - MARGIN_B,
            id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        )
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame], onPage=self._cover_page),
            PageTemplate(id="body", frames=[frame], onPage=self._body_page),
        ])

    def _cover_page(self, canvas: Any, _doc: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(ACCENT)
        canvas.setLineWidth(2.2)
        canvas.line(MARGIN_L, PAGE_H - 0.52 * inch, PAGE_W - MARGIN_R, PAGE_H - 0.52 * inch)
        canvas.line(MARGIN_L, 0.45 * inch, PAGE_W - MARGIN_R, 0.45 * inch)
        canvas.restoreState()

    def _body_page(self, canvas: Any, _doc: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        y = PAGE_H - MARGIN_T + 20
        canvas.line(MARGIN_L, y, PAGE_W - MARGIN_R, y)

        canvas.setFont(BODY, 7.2)
        canvas.setFillColor(GREY)
        canvas.drawString(MARGIN_L, PAGE_H - MARGIN_T + 26, "TRANA \u2014 CSST 102 Final Project Documentation")
        canvas.drawRightString(PAGE_W - MARGIN_R, PAGE_H - MARGIN_T + 26, "2026")

        canvas.line(MARGIN_L, MARGIN_B - 16, PAGE_W - MARGIN_R, MARGIN_B - 16)
        canvas.setFont(BODY, 8.2)
        canvas.drawString(MARGIN_L, MARGIN_B - 28, self.footer_text)
        canvas.drawRightString(
            PAGE_W - MARGIN_R, MARGIN_B - 28, f"Page {canvas.getPageNumber()}"
        )
        canvas.restoreState()


# ---------------------------------------------------------------- renderer
class PdfRenderer:
    def __init__(self, events: list[dict]) -> None:
        self.events = events
        self.story: list[Any] = []
        self.table_no = 0
        self.fig_no = 0
        self._numbered_no = 0
        self._on_cover = True

    # -------------------------------------------------------------- dispatch
    def render(self) -> list[Any]:
        for i, ev in enumerate(self.events):
            handler = getattr(self, "_" + ev["kind"], None)
            if handler is not None:
                handler(ev, i)
        return self.story

    # -------------------------------------------------------------- handlers
    def _page_break(self, ev: dict, _i: int) -> None:
        if self._on_cover:
            self.story.append(NextPageTemplate("body"))
            self._on_cover = False
        self.story.append(PageBreak())

    def _spacer(self, ev: dict, _i: int) -> None:
        self.story.append(Spacer(1, ev.get("points", 12)))

    def _heading(self, ev: dict, i: int) -> None:
        level = ev["level"]
        text = ev["text"]
        style = S[f"h{level}"]
        # A sub-heading should not be orphaned at the foot of a page.
        self.story.append(CondPageBreak(70 if level <= 2 else 46))
        self._numbered_no = 0  # numbering restarts at each heading
        self.story.append(Paragraph(esc(text), style))
        if level == 1:
            self.story.append(
                HRFlowable(width="100%", thickness=1.1, color=ACCENT,
                           spaceBefore=0, spaceAfter=9)
            )
            if self._on_cover:
                self.story.append(NextPageTemplate("body"))
                self._on_cover = False

    def _p(self, ev: dict, _i: int) -> None:
        text = ev["text"]
        if not text.strip():
            self.story.append(Spacer(1, 6))
            return
        align = ev.get("align")
        style = S["body_center"] if align == "center" else S["body"]
        style = ParagraphStyle(f"body_{id(ev)}", parent=style,
                               allowWidows=0, allowOrphans=0)
        if ev.get("size") or ev.get("bold") or ev.get("italic"):
            style = ParagraphStyle(
                f"p_{id(ev)}", parent=style,
                fontName=BOLD if ev.get("bold") else (ITALIC if ev.get("italic") else BODY),
                fontSize=ev.get("size") or 9.7,
                leading=(ev.get("size") or 9.7) * 1.42,
                alignment=TA_CENTER if align == "center" else TA_JUSTIFY,
            )
        self.story.append(Paragraph(esc(text), style))

    def _rich(self, ev: dict, _i: int) -> None:
        style = S["body_center"] if ev.get("align") == "center" else S["body"]
        self.story.append(Paragraph(styled(ev["parts"]), style))

    def _bullet(self, ev: dict, _i: int) -> None:
        style = S["bullet2"] if ev.get("level") else S["bullet"]
        lead = ev.get("bold_lead") or ""
        body = f"<b>{esc(lead)}</b>" if lead else ""
        body += esc(ev["text"])
        self.story.append(Paragraph(body, style, bulletText="\u2022"))

    def _numbered(self, ev: dict, _i: int) -> None:
        self._numbered_no += 1
        lead = ev.get("bold_lead") or ""
        body = f"<b>{esc(lead)}</b>" if lead else ""
        body += esc(ev["text"])
        self.story.append(Paragraph(body, S["numbered"], bulletText=f"{self._numbered_no}."))

    def _toc(self, ev: dict, _i: int) -> None:
        for text, level in ev["entries"]:
            self.story.append(
                Paragraph(esc(text), S["toc1"] if level == 1 else S["toc2"])
            )
        self.story.append(Spacer(1, 6))

    def _kv(self, ev: dict, _i: int) -> None:
        data = [
            [Paragraph(esc(label), S["kv_label"]), Paragraph(esc(value), S["kv_value"])]
            for label, value in ev["rows"]
        ]
        t = Table(data, colWidths=[ev["label_width"] * inch, ev["value_width"] * inch])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        self.story.append(t)
        self.story.append(Spacer(1, 8))

    def _code(self, ev: dict, _i: int) -> None:
        caption = ev.get("caption")
        lines = ev["text"].rstrip("\n").split("\n")
        code_style = ParagraphStyle(
            "code", fontName=MONO, fontSize=7.4, leading=9.9,
            textColor=colors.HexColor("#1B1B1B"),
        )
        body = "<br/>".join(esc(line) if line else "&nbsp;" for line in lines)
        inner = Table([[Paragraph(body, code_style)]], colWidths=[CONTENT_W])
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
            ("BOX", (0, 0), (-1, -1), 0.6, RULE),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        chunk: list[Any] = []
        if caption:
            chunk.append(Paragraph(esc(caption), S["codecap"]))
        chunk.append(inner)
        chunk.append(Spacer(1, 9))
        self.story.append(KeepTogether(chunk) if len(lines) < 26 else inner)

    def _quote(self, ev: dict, _i: int) -> None:
        label_style = ParagraphStyle(
            "quote_label", fontName=BOLD, fontSize=8.8, leading=11.5, textColor=ACCENT,
            spaceAfter=2.5,
        )
        body_style = ParagraphStyle(
            "quote_body", fontName=BODY, fontSize=9.1, leading=12.8, alignment=TA_JUSTIFY,
        )
        cell = [
            Paragraph(esc(ev["label"]), label_style),
            Paragraph(esc(ev["text"]), body_style),
        ]
        t = Table([[cell]], colWidths=[CONTENT_W])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), QUOTE_BG),
            ("LINEBEFORE", (0, 0), (0, -1), 2.6, ACCENT),
            ("BOX", (0, 0), (-1, -1), 0.5, RULE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        self.story.append(KeepTogether([t, Spacer(1, 9)]))

    def _table(self, ev: dict, _i: int) -> None:
        header = ev["header"]
        rows = ev["rows"]
        numeric = ev.get("align_numeric", True)
        size = ev.get("font_size", 9.0)
        scale = 0.85 if size >= 8.5 else 0.78
        self.table_no += 1

        th = ParagraphStyle("thx", fontName=BOLD, fontSize=6.9 * scale + 0.9,
                            leading=8.9 * scale + 1.1, textColor=colors.white)
        thr = ParagraphStyle("thxr", parent=th, alignment=TA_RIGHT)
        td = ParagraphStyle("tdx", fontName=BODY, fontSize=6.9 * scale + 0.9,
                            leading=9.1 * scale + 1.1)
        tdr = ParagraphStyle("tdxr", parent=td, alignment=TA_RIGHT)

        def num_col(idx: int) -> bool:
            if not numeric or idx == 0:
                return False
            hits = sum(1 for r in rows if idx < len(r) and looks_numeric(r[idx]))
            return hits >= max(1, len(rows) * 0.6)

        right = {i for i in range(len(header)) if num_col(i)}

        data = [[Paragraph(esc(h), thr if i in right else th) for i, h in enumerate(header)]]
        for r in rows:
            data.append([
                Paragraph(esc(c), tdr if i in right else td) for i, c in enumerate(r)
            ])

        widths = ev.get("widths")
        if widths and len(widths) == len(header):
            total = sum(widths)
            widths = [w * 6.45 / total for w in widths] if total > 6.45 else widths
            col_widths = [w * inch for w in widths]
            # Table width can drift slightly from the frame; rescale to fit exactly.
            factor = CONTENT_W / sum(col_widths)
            col_widths = [w * factor for w in col_widths]
        else:
            col_widths = [CONTENT_W / len(header)] * len(header)

        def table_style(n_rows: int) -> TableStyle:
            rules = [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 3.2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3.2),
                ("TOPPADDING", (0, 0), (-1, -1), 2.6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.6),
            ]
            for r in range(1, n_rows):
                if r % 2 == 0:
                    rules.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#F7F9FC")))
            return TableStyle(rules)

        caption = ev.get("caption")
        cap = Paragraph(f"Table {self.table_no}. {esc(caption)}", S["caption"]) if caption else None

        # reportlab splits a too-tall table automatically but can leave a single
        # orphan row on the next page. Chunking by an estimated row height keeps
        # every continuation to a readable block, with the header repeated.
        for j, chunk in enumerate(self._chunk_rows(data, col_widths, ev)):
            piece = Table(chunk, colWidths=col_widths, repeatRows=1)
            piece.setStyle(table_style(len(chunk)))
            if j == 0 and cap is not None:
                self.story.append(KeepTogether([cap, Spacer(1, 1), piece]))
            else:
                self.story.append(piece)
            if j == 0 and len(chunk) < len(data):
                self.story.append(Paragraph(
                    f"<i>Table {self.table_no} continued</i>",
                    ParagraphStyle("cont", fontName=BODY, fontSize=7.2, leading=9,
                                   textColor=GREY, spaceBefore=2, spaceAfter=4),
                ))
        self.story.append(Spacer(1, 9))

    def _chunk_rows(self, data: list[list[Any]], col_widths: list[float],
                    ev: dict, budget: float = PAGE_H - MARGIN_T - MARGIN_B - 130) -> list[list]:
        """Split table rows into blocks that fit a page, never sizing a block below 2 rows."""
        # Measure real wrapped heights instead of guessing from character counts:
        # an underestimate makes reportlab clip tall cells.
        def row_height(row: list[Any]) -> float:
            tallest = 0.0
            for cell, w in zip(row, col_widths):
                _w, h = cell.wrap(w - 6.4, PAGE_H)
                tallest = max(tallest, h)
            return tallest + 6.5

        header, body = data[0], data[1:]
        used = row_height(header)
        chunk: list = [header]
        chunks: list = []
        for row in body:
            h = row_height(row)
            # keep >=3 data rows in the block if it has to break
            if used + h > budget and len(chunk) > 3:
                chunks.append(chunk)
                chunk = [header, row]
                used = row_height(header) + h
            else:
                chunk.append(row)
                used += h
        chunks.append(chunk)
        return chunks

    def _figure(self, ev: dict, _i: int) -> None:
        self.fig_no += 1
        label = ParagraphStyle(
            "figlabel", fontName=BOLD, fontSize=8.4, leading=11, textColor=FIG_FG,
            alignment=TA_CENTER, spaceAfter=3,
        )
        hint = ParagraphStyle(
            "fighint", fontName=ITALIC, fontSize=7.3, leading=9.8, textColor=GREY,
            alignment=TA_CENTER,
        )
        cell = [
            Paragraph("[ INSERT SCREENSHOT HERE ]", label),
            Paragraph(esc(ev["instruction"]), hint),
        ]
        t = Table([[cell]], colWidths=[CONTENT_W], rowHeights=[1.55 * inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), FIG_BG),
            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#E0C98A")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        cap = Paragraph(f"Figure {ev['number']}. {esc(ev['caption'])}", S["figcaption"])
        self.story.append(KeepTogether([t, cap]))


def build_pdf(events: list[dict], out_path: str) -> tuple[int, int]:
    renderer = PdfRenderer(events)
    story = renderer.render()
    doc = Doc(out_path, footer_text="TRANA \u2014 CSST 102 Final Project Documentation")
    doc.build(story)
    return renderer.table_no, renderer.fig_no
