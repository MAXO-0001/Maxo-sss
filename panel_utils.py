# -*- coding: utf-8 -*-
"""
تبدیل دو طرفه‌ی HTML ادیتور پنل وب (بولد / نقل‌قول) به متن خام + entities تلگرام،
و برعکس. آفست‌ها طبق استاندارد تلگرام بر مبنای واحدهای UTF-16 حساب می‌شوند
(دقیقاً مثل کاری که خود bot.py با tl_utils.add_surrogate انجام می‌دهد).
"""

import html as html_lib
from html.parser import HTMLParser

from telethon import utils as tl_utils
from telethon.tl.types import MessageEntityBold, MessageEntityBlockquote

_BOLD_TAGS = ("b", "strong")
_QUOTE_TAGS = ("blockquote",)
_BLOCK_TAGS = ("div", "p")


def _make_quote_entity(offset, length):
    try:
        return MessageEntityBlockquote(offset=offset, length=length, collapsed=False)
    except TypeError:
        return MessageEntityBlockquote(offset=offset, length=length)


class _EditorHTMLParser(HTMLParser):
    """Parses the contentEditable HTML produced by the panel's rich-text box."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.surrogate_parts = []
        self.offset = 0
        self.open_stack = []       # list of (tag, start_offset)
        self.entities = []
        self._seen_any_block = False

    def _advance(self, chunk):
        if not chunk:
            return
        surrogate_chunk = tl_utils.add_surrogate(chunk)
        self.surrogate_parts.append(surrogate_chunk)
        self.offset += len(surrogate_chunk)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "br":
            self._advance("\n")
            return
        if tag in _BLOCK_TAGS:
            if self._seen_any_block:
                self._advance("\n")
            self._seen_any_block = True
            return
        if tag in _BOLD_TAGS or tag in _QUOTE_TAGS:
            self.open_stack.append((tag, self.offset))

    def handle_startendtag(self, tag, attrs):
        if tag.lower() == "br":
            self._advance("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag not in (_BOLD_TAGS + _QUOTE_TAGS):
            return
        for i in range(len(self.open_stack) - 1, -1, -1):
            open_tag, start = self.open_stack[i]
            if open_tag == tag:
                del self.open_stack[i]
                length = self.offset - start
                if length > 0:
                    if tag in _BOLD_TAGS:
                        self.entities.append(MessageEntityBold(offset=start, length=length))
                    else:
                        self.entities.append(_make_quote_entity(start, length))
                break

    def handle_data(self, data):
        self._advance(data)


def html_to_text_entities(html_content):
    """HTML ادیتور -> (plain_text, [entities]) آماده برای فرستادن به تلگرام."""
    parser = _EditorHTMLParser()
    parser.feed(html_content or "")
    parser.close()
    surrogate_text = "".join(parser.surrogate_parts)
    plain_text = tl_utils.del_surrogate(surrogate_text)
    # ترتیب پایدار: اول بر اساس offset بعد طول (برای رندر تمیز موقع تبدیل برعکس)
    entities = sorted(parser.entities, key=lambda e: (e.offset, e.length))
    return plain_text.strip("\n"), entities


def entities_to_html(text, entities):
    """متن خام + entities تلگرام -> HTML قابل نمایش داخل ادیتور (برای ادیت مجدد)."""
    surrogate = tl_utils.add_surrogate(text or "")
    opens = {}
    closes = {}

    for e in entities or []:
        if isinstance(e, MessageEntityBold):
            tag = "b"
        elif isinstance(e, MessageEntityBlockquote):
            tag = "blockquote"
        else:
            continue
        opens.setdefault(e.offset, []).append(tag)
        closes.setdefault(e.offset + e.length, []).append(tag)

    out = []
    length = len(surrogate)
    for i in range(length):
        for tag in reversed(closes.get(i, [])):
            out.append(f"</{tag}>")
        for tag in opens.get(i, []):
            out.append(f"<{tag}>")
        ch = surrogate[i]
        if ch == "\n":
            out.append("<br>")
        else:
            out.append(html_lib.escape(ch))
    for tag in reversed(closes.get(length, [])):
        out.append(f"</{tag}>")

    return "".join(out)
