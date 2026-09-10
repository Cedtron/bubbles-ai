"""
Renders the chat transcript into a plain tk.Text widget - no native
HTML rendering library involved, so nothing here can segfault due to
a Tcl/Tk ABI mismatch (unlike embedded HTML widgets, which can be
fragile across different Linux distros/Tk builds).

Styling (bubble colors, code blocks, sender labels, right/left
alignment) is done with Tkinter text tags instead of CSS.
"""

import re

_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")


def _strip_inline_markdown(text: str) -> str:
    text = _BOLD_RE.sub(r"\1", text)
    text = _INLINE_CODE_RE.sub(r"\1", text)
    return text

BG = "#14122b"
USER_BG = "#7c3aed"
ASSISTANT_BG = "#232043"
CODE_BG = "#100e24"
CODE_FG = "#a7f3d0"
TEXT = "#e6e6f0"
MUTED = "#8b87b0"

_CODE_BLOCK_RE = re.compile(r"```(\w*)\n?(.*?)```", re.DOTALL)


def setup_tags(text_widget):
    base_font = ("Segoe UI", 11)
    mono_font = ("Consolas", 10)
    small_font = ("Segoe UI", 9)

    text_widget.tag_configure(
        "user_sender", foreground=MUTED, font=small_font, justify="right",
        spacing1=10, lmargin1=40, rmargin=10,
    )
    text_widget.tag_configure(
        "assistant_sender", foreground=MUTED, font=small_font, justify="left",
        spacing1=10, lmargin1=10, rmargin=40,
    )

    text_widget.tag_configure(
        "user_text", background=USER_BG, foreground="#ffffff", font=base_font,
        justify="right", lmargin1=60, lmargin2=60, rmargin=10,
        spacing1=2, spacing3=2, wrap="word",
    )
    text_widget.tag_configure(
        "assistant_text", background=ASSISTANT_BG, foreground=TEXT, font=base_font,
        justify="left", lmargin1=10, lmargin2=10, rmargin=60,
        spacing1=2, spacing3=2, wrap="word",
    )

    text_widget.tag_configure(
        "user_code", background=CODE_BG, foreground=CODE_FG, font=mono_font,
        justify="right", lmargin1=60, lmargin2=60, rmargin=10, wrap="none",
    )
    text_widget.tag_configure(
        "assistant_code", background=CODE_BG, foreground=CODE_FG, font=mono_font,
        justify="left", lmargin1=10, lmargin2=10, rmargin=60, wrap="none",
    )

    text_widget.tag_configure(
        "thinking", foreground=MUTED, font=("Segoe UI", 10, "italic"),
        justify="left", spacing1=10, lmargin1=10,
    )
    text_widget.tag_configure(
        "empty_state", foreground=MUTED, font=("Segoe UI", 11), justify="center",
    )


def _insert_message(text_widget, role: str, content: str):
    sender_tag = "user_sender" if role == "user" else "assistant_sender"
    text_tag = "user_text" if role == "user" else "assistant_text"
    code_tag = "user_code" if role == "user" else "assistant_code"

    sender_label = "You" if role == "user" else "Bubbles AI"
    text_widget.insert("end", sender_label + "\n", sender_tag)

    pos = 0
    found_any = False
    for m in _CODE_BLOCK_RE.finditer(content):
        found_any = True
        before = content[pos:m.start()]
        if before.strip():
            text_widget.insert("end", _strip_inline_markdown(before.strip()) + "\n", text_tag)
        code = m.group(2).rstrip("\n")
        text_widget.insert("end", code + "\n", code_tag)
        pos = m.end()

    remainder = content[pos:]
    if remainder.strip() or not found_any:
        text_widget.insert("end", _strip_inline_markdown(remainder.strip()) + "\n", text_tag)

    text_widget.insert("end", "\n")


def render_messages(text_widget, messages: list, thinking: bool = False):
    text_widget.config(state="normal")
    text_widget.delete("1.0", "end")

    if not messages:
        text_widget.insert(
            "end", "\n\n🫧 Say hello to start chatting with Bubbles AI\n", "empty_state"
        )
    else:
        for m in messages:
            _insert_message(text_widget, m.get("role", "assistant"), m.get("content", ""))

    if thinking:
        text_widget.insert("end", "🫧 Bubbles AI is thinking…\n", "thinking")

    text_widget.config(state="disabled")
    text_widget.see("end")
