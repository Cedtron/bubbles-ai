# Bubbles AI — Documentation

This is a from-scratch map of the project: what each file does, how a
message actually flows through the system, and where to look when you
want to change or add something. Written to be read top to bottom once,
then used as a reference after that.

---

## 1. What this is

Bubbles AI is a desktop AI agent app with:
- A chat UI that talks to whichever AI provider you've configured (OpenAI,
  Anthropic, Google, DeepSeek, Kimi, Amazon Bedrock/Nova, a local Ollama
  server, a local `.gguf` file, OmniRoute, or a zero-config Demo mode).
- Tool-calling: the AI can read/write files, run shell commands, search
  the web, and edit images — inside a sandboxed "workspace" folder you
  choose.
- A dedicated Image Editor page (crop, resize, filters, watermark — both
  by hand and by asking the AI to do it).
- Saved, searchable chat sessions.
- A built-in OpenAI-compatible API server, so other tools (VS Code, curl,
  scripts) can talk to it too.

It runs as a local Flask web server, opened either in a lightweight
native window (via `pywebview`) or in your regular browser as a fallback.

---

## 2. Running it

```bash
pip install -r requirements.txt
python3 main.py
```

That's the one real entry point. (`app.py` is a secondary terminal/CLI
mode — see §7. Everything under `gui/` is an old, deprecated attempt —
see §8.)

---

## 3. The big picture

```
 Browser / pywebview window
        │  (HTML/CSS/JS)
        ▼
 frontend/  ──────────────►  backend/server.py  (Flask — the only HTTP layer)
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
              router.py      chat_sessions.py   backend/image_tools.py
                    │           config_store.py
                    ▼
              agents/*.py  (think → call a provider → maybe use tools → answer)
                    │
                    ▼
              providers/*.py  (the actual API calls out to OpenAI/Anthropic/etc)
                    │
                    ▼
              tools/registry.py  (file/terminal/git/search/image tools the AI can call)
```

Everything under `frontend/` is static HTML/CSS/JS served by Flask — no
build step, no framework, no bundler. Everything else is plain Python.

---

## 4. Entry points

| File | What it is |
|---|---|
| **`main.py`** | **The real entry point.** Starts the Flask server in a background thread, waits for it to come up, then tries to open a native app window via `pywebview` (frameless, with the custom title bar — see `WindowApi`). If `pywebview` or its OS webview component isn't available, it automatically opens your default browser instead and keeps the terminal alive. |
| `app.py` | A secondary, terminal-only chat mode (no web UI at all) — type messages straight into the console. Uses the same `router.py` underneath. Handy for quick testing without a browser. |
| `main_gui.py` | A deprecated stub. It used to launch a Tkinter desktop UI (see §8); that UI segfaulted on some Linux setups, so it was replaced by the web-based `main.py`. This file just prints a message telling you to run `main.py`. |

---

## 5. Backend (`backend/`)

| File | What it does |
|---|---|
| **`backend/server.py`** | The entire HTTP API. Builds the Flask app (`create_app()`), serves the frontend's static files, and defines every route (chat, sessions, settings, tools, terminal, image editing, file upload, and the OpenAI-compatible `/v1/...` endpoints for external tools). This is the one file that ties the whole backend together — see §6 for the full route list. |
| **`backend/image_tools.py`** | All image editing, using Pillow. Keeps images in an in-memory dict (`_STORE`) keyed by a generated id, each with an `original` (for Reset) and `current` (working) copy. Also tracks which image is "active" (`_ACTIVE_ID`) and which were touched during the current chat turn (`_TOUCHED`) — that second one is how the AI can say "edit this image" without an explicit id, and how the chat UI knows to show a thumbnail after the AI edits something. |

---

## 6. API routes (all defined in `backend/server.py`)

**Chat**
- `POST /api/chat` — send a message; runs it through `router.py`, returns the reply plus any `updated_images` the AI touched via tools.

**Sessions**
- `GET /api/sessions` — list saved chats
- `GET /api/sessions/search?q=...` — search saved chats by title
- `POST /api/sessions` — save/update a chat
- `GET /api/sessions/<id>` — load one
- `DELETE /api/sessions/<id>` — delete one

**Settings**
- `GET /api/settings` — current config (provider keys, workspace dir, etc)
- `POST /api/settings` — save settings (writes to `.env` and applies live — no restart needed)

**Tools**
- `GET /api/tools` — list available AI tools (from `tools/registry.py`)

**Terminal**
- `POST /api/terminal/run` — run a shell command directly (not through the AI), inside the workspace folder
- `GET /api/activity?since=<timestamp>` — the live feed of what the AI itself is doing (provider attempts, tool calls) — powers the Terminal tab's "Show agent activity"

**Files**
- `GET /api/workspace/files` — list files in the current workspace folder
- `POST /api/upload` — attach a file in chat. Text files get saved to the workspace with a text preview; **image files get routed into the image editor** instead (see `image_tools.load_image`) and become the AI's active image.

**Image editor**
- `POST /api/image/upload` — open an image (used by the Images page)
- `POST /api/image/<id>/op` — apply one operation (resize/rotate/flip/grayscale/contrast/crop/watermark/etc)
- `POST /api/image/<id>/reset` — revert to the original
- `GET /api/image/<id>/download?format=PNG` — download the current edited image

**External tool access**
- `GET /v1/models`, `POST /v1/chat/completions` — a standard OpenAI-compatible API, live the entire time Bubbles AI is running. Point VS Code or any tool that accepts a custom OpenAI base URL at `http://127.0.0.1:8420/v1`.

---

## 7. Core Python modules (project root)

| File | What it does |
|---|---|
| **`router.py`** | Picks which agent handles a message. Supports manual overrides (`/debug ...`, `/plan ...`), auto-detection by keyword, or an explicit `agent_override` from the UI's dropdown. Hands off to the chosen agent's `.run()`. |
| **`config.py`** | The single source of truth for every setting — API keys, model names, workspace dir, fallback order, etc. Reads from `.env` / environment variables at import time, with sensible defaults. |
| **`config_store.py`** | Lets the Settings UI change `config.py` values **at runtime** (no restart) and persists them back to `.env`. Also clears cached provider instances so a new API key takes effect on the very next message. |
| **`chat_sessions.py`** | Saves/loads/searches/deletes chat sessions as JSON files under `.agent_memory/chat_sessions/`. Session ids include a millisecond timestamp + random suffix specifically so two chats created in rapid succession can never collide (this was a real bug, fixed). |
| **`activity_log.py`** | A small rolling in-memory log (last 500 entries) of what the agent is doing — which provider it's trying, which tools it's calling. Powers the Terminal tab's live activity feed. |
| **`models.py`** | Shared dataclasses (`Message`, `AgentResponse`) and a `PROVIDER_MODELS` reference table. Not currently wired into the active request path — available if you want typed structures later. |
| **`local_server.py`** | An early, standalone version of the OpenAI-compatible API server. **Superseded** by the `/v1/...` routes now living directly in `backend/server.py`. Only kept because the deprecated `gui/app.py` still imports it. |

---

## 8. Agents (`agents/`)

| File | What it does |
|---|---|
| **`agents/base_agent.py`** | The shared brain for every agent. Loads a system prompt, optionally gathers extra context, calls a provider (with automatic fallback across providers — see §9), and — if any tools are enabled — runs a small loop: the model can emit a fenced <code>&#96;&#96;&#96;tool</code> block, the tool actually executes, the result is fed back, and the model gets another turn (up to 4 rounds) before giving its final answer. |
| `agents/coding_agent.py` | `BaseAgent` + `prompts/coding.txt` |
| `agents/debug_agent.py` | `BaseAgent` + `prompts/debugging.txt` |
| `agents/planning_agent.py` | `BaseAgent` + `prompts/planning.txt` |
| `agents/research_agent.py` | `BaseAgent` + `prompts/research.txt`, plus overrides `gather_context()` to pull in live web search results before answering |

Each concrete agent is intentionally tiny — nearly all the logic lives in `base_agent.py`.

---

## 9. Providers (`providers/`)

Every provider implements the same tiny interface: `__init__(self)` reads its config, `generate(self, prompt, system=None) -> str` makes the actual call.

| File | Backing service |
|---|---|
| `openai_provider.py` | OpenAI |
| `anthropic_provider.py` | Anthropic (Claude) |
| `google_provider.py` | Google AI (Gemini) — plain REST call, no extra SDK |
| `deepseek_provider.py` | DeepSeek (OpenAI-compatible API) |
| `kimi_provider.py` | Moonshot AI / Kimi (OpenAI-compatible API) |
| `nova_provider.py` | Amazon Bedrock / Nova, via `boto3`. Uses explicit AWS keys from Settings if set, otherwise boto3's default credential chain |
| `ollama_provider.py` | A local Ollama server (OpenAI-compatible API) — the easy path for offline Hugging Face models |
| `local_provider.py` | A `.gguf` model file loaded directly with `llama-cpp-python` — fully offline, no server. (Not in `requirements.txt` by default since it compiles from source; see the comment there.) |
| `omniroute_provider.py` | A local OmniRoute gateway — itself a multi-provider router with its own fallback, treated here as just another OpenAI-compatible endpoint |
| `demo_provider.py` | Zero-config, always succeeds, gives a canned reply. Exists purely so the app is testable with no setup at all |
| **`providers/__init__.py`** | The factory (`get_provider(name)`) and, more importantly, **`generate_with_fallback()`** — tries your default provider, and on failure (quota, auth, network, whatever) automatically moves to the next one in `Config.PROVIDER_FALLBACK_ORDER`, skipping any provider with no key configured, ending on `demo` as the last resort so you always get *something* |

---

## 10. Tools (`tools/`)

These are the things the AI can actually *do*, not just talk about.

| File | What it does |
|---|---|
| **`tools/registry.py`** | The catalog. Maps a tool name → a Python function + a description string the model sees. Also owns the tool-calling protocol: `build_tool_prompt()` (tells the model what's available and how to call it), `parse_tool_call()` (extracts a <code>&#96;&#96;&#96;tool</code> block from the model's response), `execute_tool()` (runs it, with tools not in the enabled list rejected). |
| `tools/file_reader.py` | `read_file`, `list_files` — sandboxed to `Config.WORKSPACE_DIR`, can't read outside it |
| `tools/file_writer.py` | `write_file`, `append_file` — same sandboxing, takes a backup before overwriting |
| `tools/terminal.py` | `run_command()` — runs a shell command via `subprocess`, defaults to `Config.WORKSPACE_DIR`, has a timeout |
| `tools/python_runner.py` | Runs a Python snippet in its own subprocess (not `exec()` in-process), so it can't crash the app |
| `tools/git.py` | Thin wrappers around `git status`/`diff`/`add`/`commit`/`log`, all via `terminal.run_command` |
| `tools/search.py` | `web_search()` — scrapes DuckDuckGo's HTML endpoint, no API key needed |
| `tools/browser.py` | `fetch_page()` — fetches a URL and extracts readable text (not a full browser, just `requests` + `BeautifulSoup`) |

Registered tool names (what shows up in the Tools tab): `read_file`, `list_files`, `write_file`, `run_command`, `run_python`, `git_status`, `git_diff`, `web_search`, `fetch_page`, `image_list`, `image_edit`.

The last two call straight into `backend/image_tools.py` — that's how the AI edits images (see §5): `image_edit` defaults to whichever image is currently "active" if you don't give it an id, so a plain "make this grayscale" after attaching an image just works.

---

## 11. Prompts (`prompts/`)

Plain text system prompts, one per agent — `coding.txt`, `debugging.txt`, `planning.txt`, `research.txt`. `prompts_loader.py` just reads them off disk by filename.

---

## 12. Utilities (`utils/`)

| File | What it does |
|---|---|
| `utils/logger.py` | One shared, consistently formatted logger for the whole app |
| `utils/tokenizer.py` | Token counting via `tiktoken`, with a rough `len(text)/4` fallback if `tiktoken` can't reach its data file (offline, blocked network, etc) — this used to crash the app in sandboxed environments; now it just degrades gracefully |
| `utils/cost.py` | A rough per-request USD cost estimate, logged after each provider call |

---

## 13. Frontend (`frontend/`)

No framework, no build step — plain files served directly by Flask.

| File | What it does |
|---|---|
| **`frontend/index.html`** | The entire page structure: the vertical nav (Chats / AI Brain / Tools / Images / Terminal / API / Settings), every settings field, the chat view, and the Image Editor page. Also the custom frameless-window title bar (`#titlebar`, hidden unless running inside `pywebview`). |
| **`frontend/app.js`** | All the behavior. Roughly in order: tab switching, markdown-lite rendering (fenced code blocks, inline code, bold), chat rendering, file/image attachments, `sendMessage()` (see §14 for why it's careful about which chat a reply belongs to), session list/search/sync, AI Brain settings load/save, the Tools checklist, the Terminal tab (direct command execution + live agent activity feed), the API tab, the Settings tab (accent color + app icon, both persisted to `localStorage`), the full Image Editor (upload, all operations, drag-to-crop), and the title bar wiring. |
| **`frontend/style.css`** | All styling — dark theme, chat bubbles, the vertical nav, the Image Editor's two-panel layout, the title bar (themed by the accent color CSS variable), forms, everything. |
| `frontend/logo.png` | Copy of `assets/logo.png`, served as the app icon/favicon |

### A note on chat isolation

Each conversation is its own JS object (`{ sessionId, messages }`), and `sendMessage()` captures a reference to that object at the moment you hit Send — not a shared global. If you switch to a different chat (or start a new one) while a reply is still in flight, the reply keeps writing into the *original* object, never into whatever's on screen when it arrives. This was a real bug (chats bleeding into each other) and is now covered by an automated test that fires a slow request, switches chats mid-flight, and confirms no cross-contamination.

---

## 14. Assets (`assets/`)

`logo.png` / `logo.ico` — the bubble-mark logo, generated with Pillow (three overlapping gradient circles). Used as the window icon and in the sidebar header.

---

## 15. Scaffolding that exists but isn't wired in yet

These were built early on as part of the original project template and are complete/working in isolation, but nothing in the active app currently imports them:

| Folder | What it offers |
|---|---|
| `memory/` | `chat_memory.py` (in-session history), `project_memory.py` (persistent per-project notes as JSON), `summary.py` (conversation summarization) |
| `rag/` | `embeddings.py`, `indexer.py`, `retriever.py` — a simple in-memory vector search setup (OpenAI embeddings + cosine similarity) |
| `cache/` | `cache.py` (in-memory TTL cache), `redis_cache.py` (Redis-backed alternative) |

They're reasonable building blocks if you want to add long-term memory or document retrieval later — just not part of the current request path.

---

## 16. Deprecated: the old Tkinter UI (`gui/`)

Before the web UI, Bubbles AI had a native Tkinter desktop app. It's kept in the repo for reference only — **do not build on this**, it's not maintained.

| File | What it was |
|---|---|
| `gui/app.py` | The main Tkinter window (`BubblesApp`) |
| `gui/chat_text.py` | Chat rendering using plain `tk.Text` widgets with tags (a fix for an earlier crash — see below) |
| `gui/html_render.py` | Built a styled HTML document for a "View in Browser" button |

It went through two iterations: first using `tkinterweb` (an embedded HTML renderer) for the chat view, which **segfaulted** on some Linux Tcl/Tk builds; then a pure-Tkinter rewrite to remove that risk. It was ultimately replaced entirely by the current Flask + browser/`pywebview` architecture, which sidesteps the whole class of native-toolkit crashes.

---

## 17. Config reference (`.env`)

Every setting `config.py` reads, and what it's for:

```
# Cloud providers
OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, KIMI_API_KEY, GOOGLE_API_KEY
GOOGLE_MODEL=gemini-2.0-flash

# Amazon Bedrock / Nova
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, NOVA_MODEL

# Local / self-hosted
OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, OMNIROUTE_MODEL
OLLAMA_BASE_URL, OLLAMA_MODEL
LOCAL_MODEL_PATH, LOCAL_MODEL_CTX, LOCAL_MODEL_THREADS

# Behavior
DEFAULT_PROVIDER, DEFAULT_MODEL, PROVIDER_FALLBACK_ORDER
MAX_TOKENS, TEMPERATURE
WORKSPACE_DIR          # sandbox root for file/terminal/git tools
```

All of these are editable live from the AI Brain tab — changes save to `.env` and apply immediately, no restart.

---

## 18. Extending it

**Add a new provider:** copy `providers/demo_provider.py` as a template, implement `__init__` + `generate()`, register it in `providers/__init__.py`'s `get_provider()`, add it to `PROVIDERS` in `backend/server.py`, add any config fields to `config.py` + `config_store.py`, add the fields to the AI Brain tab in `index.html`/`app.js`.

**Add a new tool:** write a function, add an entry to `TOOL_REGISTRY` in `tools/registry.py` with a clear `description` (the model reads this to know how to call it). It'll automatically show up in the Tools tab — no frontend changes needed.

**Add a new page (like Images):** add a `tab-btn` in the nav, a `view-<name>` div in `#main` (see how `view-images` swaps in place of `view-chat`), wire the swap logic in `app.js`'s tab click handler, and any backend routes it needs in `backend/server.py`.
