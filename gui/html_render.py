"""
Turns the chat message list into a styled HTML document. Used for the
"View in Browser" button - opened in the user's real web browser
instead of an embedded HTML widget, which is far more reliable across
different systems (no native rendering library to crash).
"""

import html
import re

CSS = """
body {
    background: #14122b;
    color: #e6e6f0;
    font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif;
    margin: 0;
    padding: 16px 18px 90px 18px;
}
.msg-row { display: block; margin-bottom: 14px; overflow: hidden; }
.bubble {
    display: inline-block;
    max-width: 78%;
    padding: 10px 14px;
    border-radius: 16px;
    line-height: 1.45;
    font-size: 14px;
    word-wrap: break-word;
    white-space: pre-wrap;
}
.user-row { text-align: right; }
.user-bubble {
    background: #7c3aed;
    color: #ffffff;
    border-bottom-right-radius: 4px;
}
.assistant-row { text-align: left; }
.assistant-bubble {
    background: #232043;
    color: #ecebff;
    border: 1px solid #34305e;
    border-bottom-left-radius: 4px;
}
.sender {
    font-size: 11px;
    color: #8b87b0;
    margin: 0 4px 4px 4px;
}
.bubble pre {
    background: #100e24;
    border: 1px solid #322f57;
    border-radius: 10px;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: Consolas, Menlo, monospace;
    font-size: 13px;
    color: #a7f3d0;
    white-space: pre;
    margin: 8px 0;
}
.bubble code {
    background: #100e24;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: Consolas, Menlo, monospace;
    font-size: 13px;
    color: #a7f3d0;
}
.thinking {
    color: #8b87b0;
    font-style: italic;
    font-size: 13px;
    padding: 4px 4px 0 4px;
}
.empty-state {
    color: #6b6790;
    text-align: center;
    margin-top: 60px;
    font-size: 14px;
}
"""

_CODE_BLOCK_RE = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


def _render_content(text: str) -> str:
    """Minimal markdown-lite -> HTML: fenced code blocks, inline code, bold, newlines."""
    text = html.escape(text)

    def code_block(m):
        code = m.group(2)
        return f"<pre>{code}</pre>"

    text = _CODE_BLOCK_RE.sub(code_block, text)
    text = _INLINE_CODE_RE.sub(r"<code>\1</code>", text)
    text = _BOLD_RE.sub(r"<b>\1</b>", text)
    text = text.replace("\n", "<br>")
    # undo <br> inside <pre> blocks that got affected by inline replacements above
    text = re.sub(
        r"<pre>(.*?)</pre>",
        lambda m: "<pre>" + m.group(1).replace("<br>", "\n") + "</pre>",
        text,
        flags=re.DOTALL,
    )
    return text


def build_chat_html(messages: list, thinking: bool = False) -> str:
    if not messages:
        body = '<div class="empty-state">🫧 Say hello to start chatting with Bubbles AI</div>'
    else:
        rows = []
        for m in messages:
            role = m.get("role", "assistant")
            content = _render_content(m.get("content", ""))
            if role == "user":
                rows.append(
                    f'<div class="msg-row user-row">'
                    f'<div class="sender">You</div>'
                    f'<div class="bubble user-bubble">{content}</div></div>'
                )
            else:
                rows.append(
                    f'<div class="msg-row assistant-row">'
                    f'<div class="sender">Bubbles AI</div>'
                    f'<div class="bubble assistant-bubble">{content}</div></div>'
                )
        body = "\n".join(rows)

    thinking_html = '<div class="thinking">🫧 Bubbles AI is thinking…</div>' if thinking else ""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{CSS}</style></head>
<body>
{body}
{thinking_html}
</body></html>"""
