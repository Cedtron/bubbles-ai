"""
Bubbles AI - desktop chat app.

Left sidebar: chat sessions, AI provider/brain settings (including
offline/local models), agent mode, tools, and a local API server
toggle so other tools (VS Code, curl, etc.) can talk to it.

Main pane: an HTML-rendered chat (via tkinterweb) + input box.
"""

import os
import sys
import threading
import queue
import tempfile
import webbrowser

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from router import ModelRouter
from config import Config
import config_store
import chat_sessions
from tools.registry import TOOL_REGISTRY
from local_server import LocalAPIServer
from gui import chat_text
from gui.html_render import build_chat_html
from utils.logger import get_logger

logger = get_logger(__name__)

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

BG = "#14122b"
BG_PANEL = "#1c1a3a"
BG_INPUT = "#232043"
ACCENT = "#8b5cf6"
ACCENT_2 = "#38bdf8"
TEXT = "#e6e6f0"
MUTED = "#8b87b0"

PROVIDERS = ["demo", "openai", "anthropic", "deepseek", "kimi", "omniroute", "ollama", "local"]
AGENT_MODES = ["auto", "coding", "debug", "planning", "research"]


class BubblesApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Bubbles AI")
        self.geometry("1180x760")
        self.minsize(900, 600)
        self.configure(bg=BG)
        self._set_icon()
        self._set_style()

        self.router = ModelRouter()
        self.result_queue = queue.Queue()

        self.messages = []            # [{"role": "user"|"assistant", "content": str}]
        self.current_session_id = None
        self.api_server = None

        self._build_layout()
        self._refresh_sessions_list()
        self._render_chat()

        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ------------------------------------------------------------------
    # Setup

    def _set_icon(self):
        try:
            icon_path = os.path.join(ASSETS_DIR, "logo.png")
            self._icon_img = tk.PhotoImage(file=icon_path)
            self.iconphoto(True, self._icon_img)
        except Exception as e:
            logger.warning(f"Could not set app icon: {e}")

    def _set_style(self):
        style = ttk.Style(self)
        # NOTE: `theme_use('clam')` has caused segmentation faults on
        # some Linux/Tk builds. Disable the explicit theme selection to
        # avoid crashes; the platform default will be used instead.
        try:
            #style.theme_use("clam")
            pass
        except tk.TclError:
            pass

        style.configure("TFrame", background=BG_PANEL)
        style.configure("Main.TFrame", background=BG)
        style.configure("TLabel", background=BG_PANEL, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("Heading.TLabel", background=BG_PANEL, foreground=TEXT,
                         font=("Segoe UI", 12, "bold"))
        style.configure("Muted.TLabel", background=BG_PANEL, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("TButton", background=ACCENT, foreground="white",
                         font=("Segoe UI", 10, "bold"), padding=6, borderwidth=0)
        style.map("TButton", background=[("active", "#7c4ded")])
        style.configure("Secondary.TButton", background="#33305c", foreground=TEXT,
                         font=("Segoe UI", 9), padding=5)
        style.map("Secondary.TButton", background=[("active", "#413c73")])
        style.configure("TCheckbutton", background=BG_PANEL, foreground=TEXT, font=("Segoe UI", 9))
        style.map("TCheckbutton", background=[("active", BG_PANEL)])
        style.configure("TCombobox", fieldbackground=BG_INPUT, background=BG_INPUT, foreground=TEXT)
        style.configure("TEntry", fieldbackground=BG_INPUT, foreground=TEXT)
        style.configure("TNotebook", background=BG_PANEL, borderwidth=0)
        style.configure("TNotebook.Tab", background=BG_PANEL, foreground=MUTED, padding=(10, 6))
        style.map("TNotebook.Tab", background=[("selected", BG_INPUT)],
                  foreground=[("selected", TEXT)])

    # ------------------------------------------------------------------
    # Layout

    def _build_layout(self):
        root = ttk.Frame(self, style="Main.TFrame")
        root.pack(fill="both", expand=True)

        sidebar = ttk.Frame(root, width=300, style="TFrame")
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)
        self._build_sidebar(sidebar)

        main = ttk.Frame(root, style="Main.TFrame")
        main.pack(side="left", fill="both", expand=True)
        self._build_main(main)

    def _build_sidebar(self, parent):
        header = ttk.Frame(parent, style="TFrame")
        header.pack(fill="x", padx=14, pady=(16, 8))
        try:
            logo_small = tk.PhotoImage(file=os.path.join(ASSETS_DIR, "logo.png")).subsample(10, 10)
            self._logo_small = logo_small
            tk.Label(header, image=logo_small, bg=BG_PANEL).pack(side="left")
        except Exception:
            pass
        ttk.Label(header, text=" Bubbles AI", style="Heading.TLabel").pack(side="left", padx=4)

        notebook = ttk.Notebook(parent)
        notebook.pack(fill="both", expand=True, padx=10, pady=6)

        chats_tab = ttk.Frame(notebook, style="TFrame")
        brain_tab = ttk.Frame(notebook, style="TFrame")
        tools_tab = ttk.Frame(notebook, style="TFrame")
        api_tab = ttk.Frame(notebook, style="TFrame")

        notebook.add(chats_tab, text="Chats")
        notebook.add(brain_tab, text="AI Brain")
        notebook.add(tools_tab, text="Tools")
        notebook.add(api_tab, text="API")

        self._build_chats_tab(chats_tab)
        self._build_brain_tab(brain_tab)
        self._build_tools_tab(tools_tab)
        self._build_api_tab(api_tab)

    # --- Chats tab ---------------------------------------------------

    def _build_chats_tab(self, parent):
        btn_row = ttk.Frame(parent, style="TFrame")
        btn_row.pack(fill="x", pady=(8, 6))
        ttk.Button(btn_row, text="+ New Chat", command=self._new_chat).pack(side="left", expand=True, fill="x", padx=(0, 4))
        ttk.Button(btn_row, text="💾 Save", style="Secondary.TButton", command=self._save_chat).pack(side="left", expand=True, fill="x")

        ttk.Label(parent, text="Saved chats", style="Muted.TLabel").pack(anchor="w", pady=(6, 2))

        list_frame = ttk.Frame(parent, style="TFrame")
        list_frame.pack(fill="both", expand=True)

        self.sessions_listbox = tk.Listbox(
            list_frame, bg=BG_INPUT, fg=TEXT, selectbackground=ACCENT,
            borderwidth=0, highlightthickness=0, activestyle="none", font=("Segoe UI", 10),
        )
        self.sessions_listbox.pack(fill="both", expand=True, side="left")
        self.sessions_listbox.bind("<<ListboxSelect>>", self._on_session_selected)

        scroll = ttk.Scrollbar(list_frame, command=self.sessions_listbox.yview)
        scroll.pack(side="right", fill="y")
        self.sessions_listbox.config(yscrollcommand=scroll.set)

        ttk.Button(parent, text="🗑 Delete selected", style="Secondary.TButton",
                   command=self._delete_selected_session).pack(fill="x", pady=6)

    # --- AI Brain tab --------------------------------------------------

    def _build_brain_tab(self, parent):
        canvas_frame = ttk.Frame(parent, style="TFrame")
        canvas_frame.pack(fill="both", expand=True)

        ttk.Label(canvas_frame, text="Active provider", style="TLabel").pack(anchor="w", pady=(10, 2))
        self.provider_var = tk.StringVar(value=Config.DEFAULT_PROVIDER)
        provider_combo = ttk.Combobox(canvas_frame, textvariable=self.provider_var,
                                       values=PROVIDERS, state="readonly")
        provider_combo.pack(fill="x")

        ttk.Label(canvas_frame, text="Fallback order (comma-separated)", style="Muted.TLabel").pack(anchor="w", pady=(10, 2))
        self.fallback_var = tk.StringVar(value=",".join(Config.PROVIDER_FALLBACK_ORDER))
        ttk.Entry(canvas_frame, textvariable=self.fallback_var).pack(fill="x")

        self._section_label(canvas_frame, "Cloud API keys")
        self.openai_key_var = self._key_row(canvas_frame, "OpenAI", Config.OPENAI_API_KEY)
        self.anthropic_key_var = self._key_row(canvas_frame, "Anthropic", Config.ANTHROPIC_API_KEY)
        self.deepseek_key_var = self._key_row(canvas_frame, "DeepSeek", Config.DEEPSEEK_API_KEY)
        self.kimi_key_var = self._key_row(canvas_frame, "Kimi", Config.KIMI_API_KEY)

        self._section_label(canvas_frame, "OmniRoute (local gateway)")
        self.omniroute_url_var = self._text_row(canvas_frame, "Base URL", Config.OMNIROUTE_BASE_URL)
        self.omniroute_key_var = self._key_row(canvas_frame, "API key (optional)", Config.OMNIROUTE_API_KEY)

        self._section_label(canvas_frame, "Ollama (local server)")
        self.ollama_url_var = self._text_row(canvas_frame, "Base URL", Config.OLLAMA_BASE_URL)
        self.ollama_model_var = self._text_row(canvas_frame, "Model name", Config.OLLAMA_MODEL)

        self._section_label(canvas_frame, "Offline model file (.gguf)")
        ttk.Label(canvas_frame, text="A model you downloaded, e.g. from Hugging Face",
                  style="Muted.TLabel").pack(anchor="w")
        path_row = ttk.Frame(canvas_frame, style="TFrame")
        path_row.pack(fill="x", pady=(2, 8))
        self.local_model_path_var = tk.StringVar(value=Config.LOCAL_MODEL_PATH)
        ttk.Entry(path_row, textvariable=self.local_model_path_var).pack(side="left", fill="x", expand=True)
        ttk.Button(path_row, text="Browse…", style="Secondary.TButton",
                   command=self._browse_model_file).pack(side="left", padx=(6, 0))

        ttk.Button(canvas_frame, text="💾 Save AI Brain Settings",
                   command=self._save_brain_settings).pack(fill="x", pady=(10, 4))

        self._section_label(canvas_frame, "Agent mode")
        self.agent_mode_var = tk.StringVar(value="auto")
        ttk.Combobox(canvas_frame, textvariable=self.agent_mode_var,
                     values=AGENT_MODES, state="readonly").pack(fill="x", pady=(0, 10))

    def _section_label(self, parent, text):
        ttk.Label(parent, text=text, style="Heading.TLabel").pack(anchor="w", pady=(16, 4))

    def _key_row(self, parent, label, value):
        ttk.Label(parent, text=label, style="Muted.TLabel").pack(anchor="w", pady=(6, 1))
        var = tk.StringVar(value=value or "")
        ttk.Entry(parent, textvariable=var, show="•").pack(fill="x")
        return var

    def _text_row(self, parent, label, value):
        ttk.Label(parent, text=label, style="Muted.TLabel").pack(anchor="w", pady=(6, 1))
        var = tk.StringVar(value=value or "")
        ttk.Entry(parent, textvariable=var).pack(fill="x")
        return var

    def _browse_model_file(self):
        path = filedialog.askopenfilename(
            title="Choose a local model file",
            filetypes=[("GGUF model files", "*.gguf"), ("All files", "*.*")],
        )
        if path:
            self.local_model_path_var.set(path)

    def _save_brain_settings(self):
        fallback = [p.strip() for p in self.fallback_var.get().split(",") if p.strip()]
        os.environ["PROVIDER_FALLBACK_ORDER"] = ",".join(fallback)
        Config.PROVIDER_FALLBACK_ORDER = fallback

        config_store.save_settings({
            "DEFAULT_PROVIDER": self.provider_var.get(),
            "OPENAI_API_KEY": self.openai_key_var.get(),
            "ANTHROPIC_API_KEY": self.anthropic_key_var.get(),
            "DEEPSEEK_API_KEY": self.deepseek_key_var.get(),
            "KIMI_API_KEY": self.kimi_key_var.get(),
            "OMNIROUTE_BASE_URL": self.omniroute_url_var.get(),
            "OMNIROUTE_API_KEY": self.omniroute_key_var.get(),
            "OLLAMA_BASE_URL": self.ollama_url_var.get(),
            "OLLAMA_MODEL": self.ollama_model_var.get(),
            "LOCAL_MODEL_PATH": self.local_model_path_var.get(),
        })
        Config.LOCAL_MODEL_PATH = self.local_model_path_var.get()
        messagebox.showinfo("Bubbles AI", "Settings saved. New messages will use the updated setup.")

    # --- Tools tab -----------------------------------------------------

    def _build_tools_tab(self, parent):
        ttk.Label(parent, text="Let the AI use these tools while answering:",
                  style="Muted.TLabel").pack(anchor="w", pady=(10, 6))

        self.tool_vars = {}
        for name, meta in TOOL_REGISTRY.items():
            var = tk.BooleanVar(value=False)
            self.tool_vars[name] = var
            row = ttk.Frame(parent, style="TFrame")
            row.pack(fill="x", pady=2)
            ttk.Checkbutton(row, text=name, variable=var).pack(anchor="w")
            ttk.Label(row, text=meta["description"], style="Muted.TLabel",
                      wraplength=250).pack(anchor="w", padx=20)

    def _enabled_tools(self):
        return [name for name, var in self.tool_vars.items() if var.get()]

    # --- External access tab -------------------------------------------

    def _build_api_tab(self, parent):
        ttk.Label(
            parent,
            text="Run a local OpenAI-compatible endpoint so other tools "
                 "(VS Code extensions, scripts, curl, etc.) can talk to Bubbles AI.",
            style="Muted.TLabel", wraplength=250,
        ).pack(anchor="w", pady=(10, 10))

        self.api_enabled_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(parent, text="Enable local API server",
                         variable=self.api_enabled_var,
                         command=self._toggle_api_server).pack(anchor="w")

        port_row = ttk.Frame(parent, style="TFrame")
        port_row.pack(fill="x", pady=8)
        ttk.Label(port_row, text="Port:", style="TLabel").pack(side="left")
        self.api_port_var = tk.StringVar(value="8787")
        ttk.Entry(port_row, textvariable=self.api_port_var, width=8).pack(side="left", padx=6)

        self.api_status_label = ttk.Label(parent, text="● Stopped", style="Muted.TLabel")
        self.api_status_label.pack(anchor="w", pady=(6, 2))

        self.api_url_var = tk.StringVar(value="")
        ttk.Entry(parent, textvariable=self.api_url_var, state="readonly").pack(fill="x")
        ttk.Button(parent, text="Copy endpoint URL", style="Secondary.TButton",
                   command=self._copy_endpoint).pack(fill="x", pady=6)

        ttk.Label(
            parent,
            text='In VS Code, point a custom "OpenAI base URL" setting at the '
                 "endpoint above (any API key text works).",
            style="Muted.TLabel", wraplength=250,
        ).pack(anchor="w", pady=(10, 0))

    def _toggle_api_server(self):
        if self.api_enabled_var.get():
            try:
                port = int(self.api_port_var.get())
            except ValueError:
                messagebox.showerror("Bubbles AI", "Port must be a number.")
                self.api_enabled_var.set(False)
                return

            self.api_server = LocalAPIServer(self.router, port=port)
            try:
                self.api_server.start()
            except Exception as e:
                messagebox.showerror("Bubbles AI", f"Could not start server: {e}")
                self.api_enabled_var.set(False)
                return

            self.api_status_label.config(text="● Running")
            self.api_url_var.set(self.api_server.endpoint_url)
        else:
            if self.api_server:
                self.api_server.stop()
            self.api_status_label.config(text="● Stopped")
            self.api_url_var.set("")

    def _copy_endpoint(self):
        url = self.api_url_var.get()
        if not url:
            return
        self.clipboard_clear()
        self.clipboard_append(url)

    # --- Main chat area --------------------------------------------------

    def _build_main(self, parent):
        chat_container = tk.Frame(parent, bg=BG, highlightthickness=0)
        chat_container.pack(fill="both", expand=True, padx=(6, 12), pady=(12, 6))

        toolbar = ttk.Frame(chat_container, style="Main.TFrame")
        toolbar.pack(fill="x", pady=(0, 6))
        ttk.Button(toolbar, text="🌐 View in Browser", style="Secondary.TButton",
                   command=self._open_in_browser).pack(side="right")

        text_frame = tk.Frame(chat_container, bg=BG)
        text_frame.pack(fill="both", expand=True)

        self.chat_text = tk.Text(
            text_frame, bg=BG, fg=TEXT, wrap="word", relief="flat",
            borderwidth=0, highlightthickness=0, padx=14, pady=10,
            font=("Segoe UI", 11), state="disabled", cursor="arrow",
        )
        self.chat_text.pack(side="left", fill="both", expand=True)
        chat_text.setup_tags(self.chat_text)

        chat_scroll = ttk.Scrollbar(text_frame, command=self.chat_text.yview)
        chat_scroll.pack(side="right", fill="y")
        self.chat_text.config(yscrollcommand=chat_scroll.set)

        input_row = ttk.Frame(parent, style="Main.TFrame")
        input_row.pack(fill="x", padx=(6, 12), pady=(0, 12))

        self.input_box = tk.Text(input_row, height=3, bg=BG_INPUT, fg=TEXT,
                                  insertbackground=TEXT, wrap="word",
                                  font=("Segoe UI", 11), relief="flat", padx=10, pady=8)
        self.input_box.pack(side="left", fill="both", expand=True)
        self.input_box.bind("<Return>", self._on_enter_pressed)
        self.input_box.bind("<Shift-Return>", lambda e: None)

        self.send_button = ttk.Button(input_row, text="Send  ➤", command=self._send)
        self.send_button.pack(side="left", padx=(8, 0), fill="y")

    def _open_in_browser(self):
        html_doc = build_chat_html(self.messages)
        fd, path = tempfile.mkstemp(suffix=".html", prefix="bubbles_ai_chat_")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(html_doc)
        webbrowser.open(f"file://{path}")

    def _on_enter_pressed(self, event):
        self._send()
        return "break"  # prevent newline

    # ------------------------------------------------------------------
    # Chat logic

    def _render_chat(self, thinking: bool = False):
        chat_text.render_messages(self.chat_text, self.messages, thinking=thinking)

    def _send(self):
        text = self.input_box.get("1.0", "end").strip()
        if not text:
            return

        self.input_box.delete("1.0", "end")
        self.messages.append({"role": "user", "content": text})
        self._render_chat(thinking=True)

        self.send_button.config(state="disabled")

        enabled_tools = self._enabled_tools()
        agent_mode = self.agent_mode_var.get()

        thread = threading.Thread(
            target=self._worker, args=(text, enabled_tools, agent_mode), daemon=True
        )
        thread.start()
        self.after(150, self._poll_result)

    def _worker(self, text, enabled_tools, agent_mode):
        try:
            response = self.router.handle_request(
                text, enabled_tools=enabled_tools, agent_override=agent_mode
            )
        except Exception as e:
            logger.error(f"Chat error: {e}")
            response = f"❌ Something went wrong: {e}"
        self.result_queue.put(response)

    def _poll_result(self):
        try:
            response = self.result_queue.get_nowait()
        except queue.Empty:
            self.after(150, self._poll_result)
            return

        self.messages.append({"role": "assistant", "content": response})
        self._render_chat(thinking=False)
        self.send_button.config(state="normal")
        self._auto_save_session()

    # ------------------------------------------------------------------
    # Session management

    def _refresh_sessions_list(self):
        self.sessions_listbox.delete(0, "end")
        self._session_ids = []
        for s in chat_sessions.list_sessions():
            self.sessions_listbox.insert("end", s["title"])
            self._session_ids.append(s["id"])

    def _new_chat(self):
        self.messages = []
        self.current_session_id = None
        self._render_chat()

    def _save_chat(self):
        if not self.messages:
            return
        if not self.current_session_id:
            self.current_session_id = chat_sessions.new_session_id(
                chat_sessions.auto_title(self.messages)
            )
        chat_sessions.save_session(
            self.current_session_id, chat_sessions.auto_title(self.messages), self.messages
        )
        self._refresh_sessions_list()

    def _auto_save_session(self):
        if not self.messages:
            return
        if not self.current_session_id:
            self.current_session_id = chat_sessions.new_session_id(
                chat_sessions.auto_title(self.messages)
            )
        chat_sessions.save_session(
            self.current_session_id, chat_sessions.auto_title(self.messages), self.messages
        )
        self._refresh_sessions_list()

    def _on_session_selected(self, event):
        selection = self.sessions_listbox.curselection()
        if not selection:
            return
        idx = selection[0]
        session_id = self._session_ids[idx]
        data = chat_sessions.load_session(session_id)
        self.messages = data.get("messages", [])
        self.current_session_id = session_id
        self._render_chat()

    def _delete_selected_session(self):
        selection = self.sessions_listbox.curselection()
        if not selection:
            return
        idx = selection[0]
        session_id = self._session_ids[idx]
        chat_sessions.delete_session(session_id)
        if session_id == self.current_session_id:
            self._new_chat()
        self._refresh_sessions_list()

    # ------------------------------------------------------------------

    def _on_close(self):
        if self.api_server and self.api_server.is_running:
            self.api_server.stop()
        self.destroy()


def main():
    app = BubblesApp()
    app.mainloop()


if __name__ == "__main__":
    main()
