"""
Bubbles AI backend - a Flask app that serves the web frontend and
exposes a small REST API for it: chat, sessions, settings, and tools.

Also exposes an OpenAI-compatible /v1/chat/completions endpoint on
this SAME server, so external tools (VS Code extensions, curl,
scripts) can talk to Bubbles AI too - no separate server needed.

Deliberately framework-light and Tk-free: this replaced an earlier
Tkinter desktop UI that segfaulted on some Linux setups (a Tcl/Tk
native-library issue). A browser-rendered frontend can't segfault the
Python process the way an embedded native widget toolkit can.
"""

import os
import time

import requests
from flask import Flask, jsonify, request, send_from_directory, Response
from werkzeug.utils import secure_filename

import activity_log
from router import ModelRouter
from config import Config
import config_store
import chat_sessions
from tools.registry import TOOL_REGISTRY
from tools.terminal import run_command
from tools.file_reader import list_files, read_file
from tools.file_writer import write_file
from backend import image_tools
from utils.logger import get_logger

logger = get_logger(__name__)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

PROVIDERS = ["demo", "openai", "anthropic", "google", "deepseek", "kimi", "omniroute", "ollama", "local", "nova"]
AGENT_MODES = ["auto", "coding", "debug", "planning", "research"]


def create_app():
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
    router = ModelRouter()

    # ------------------------------------------------------------------
    # Frontend

    @app.route("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    # ------------------------------------------------------------------
    # Chat

    @app.route("/api/chat", methods=["POST"])
    def chat():
        payload = request.get_json(force=True, silent=True) or {}
        text = (payload.get("message") or "").strip()
        enabled_tools = payload.get("enabled_tools") or []
        agent_mode = payload.get("agent_mode") or "auto"

        if not text:
            return jsonify({"error": "Empty message"}), 400

        image_tools.pop_touched()  # clear anything stale from before this turn

        try:
            reply = router.handle_request(text, enabled_tools=enabled_tools, agent_override=agent_mode)
        except Exception as e:
            logger.error(f"Chat error: {e}")
            reply = f"❌ Something went wrong: {e}"

        updated_images = []
        for image_id in image_tools.pop_touched():
            try:
                updated_images.append(image_tools.get_state(image_id))
            except KeyError:
                pass

        return jsonify({"reply": reply, "updated_images": updated_images})

    # ------------------------------------------------------------------
    # Sessions

    @app.route("/api/sessions", methods=["GET"])
    def list_sessions():
        return jsonify(chat_sessions.list_sessions())

    @app.route("/api/sessions/search", methods=["GET"])
    def search_sessions():
        query = request.args.get("q", "")
        return jsonify(chat_sessions.search_sessions(query))

    @app.route("/api/sessions", methods=["POST"])
    def save_session():
        payload = request.get_json(force=True, silent=True) or {}
        messages = payload.get("messages") or []
        session_id = payload.get("id")

        if not messages:
            return jsonify({"error": "No messages to save"}), 400

        if not session_id:
            session_id = chat_sessions.new_session_id(chat_sessions.auto_title(messages))

        title = chat_sessions.auto_title(messages)
        chat_sessions.save_session(session_id, title, messages)
        return jsonify({"id": session_id, "title": title})

    @app.route("/api/sessions/<session_id>", methods=["GET"])
    def load_session(session_id):
        try:
            return jsonify(chat_sessions.load_session(session_id))
        except FileNotFoundError:
            return jsonify({"error": "Session not found"}), 404

    @app.route("/api/sessions/<session_id>", methods=["DELETE"])
    def delete_session(session_id):
        chat_sessions.delete_session(session_id)
        return jsonify({"ok": True})

    # ------------------------------------------------------------------
    # Settings / AI Brain

    @app.route("/api/settings", methods=["GET"])
    def get_settings():
        values = config_store.get_current_values()
        values["providers"] = PROVIDERS
        values["agent_modes"] = AGENT_MODES
        values["fallback_order"] = Config.PROVIDER_FALLBACK_ORDER
        return jsonify(values)

    @app.route("/api/settings", methods=["POST"])
    def save_settings():
        payload = request.get_json(force=True, silent=True) or {}

        fallback_order = payload.pop("fallback_order", None)
        if fallback_order is not None:
            if isinstance(fallback_order, str):
                fallback_order = [p.strip() for p in fallback_order.split(",") if p.strip()]
            Config.PROVIDER_FALLBACK_ORDER = fallback_order
            os.environ["PROVIDER_FALLBACK_ORDER"] = ",".join(fallback_order)

        payload.pop("providers", None)
        payload.pop("agent_modes", None)

        config_store.save_settings(payload)
        return jsonify({"ok": True})

    # ------------------------------------------------------------------
    # Tools

    @app.route("/api/tools", methods=["GET"])
    def list_tools():
        return jsonify([
            {"name": name, "description": meta["description"]}
            for name, meta in TOOL_REGISTRY.items()
        ])

    # ------------------------------------------------------------------
    # External tool access - OpenAI-compatible endpoint, always live
    # while Bubbles AI is running (used by VS Code etc).

    @app.route("/v1/models", methods=["GET"])
    def openai_models():
        return jsonify({
            "object": "list",
            "data": [{"id": "bubbles-ai", "object": "model", "owned_by": "bubbles-ai"}],
        })

    @app.route("/v1/chat/completions", methods=["POST"])
    def openai_chat_completions():
        payload = request.get_json(force=True, silent=True) or {}
        messages = payload.get("messages", [])

        user_text = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_text = m.get("content", "")
                break

        if not user_text:
            return jsonify({"error": {"message": "No user message found in request."}}), 400

        try:
            answer = router.handle_request(user_text)
        except Exception as e:
            logger.error(f"External API error: {e}")
            return jsonify({"error": {"message": str(e)}}), 500

        return jsonify({
            "id": "bubbles-ai-response",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": payload.get("model", "bubbles-ai"),
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": answer},
                "finish_reason": "stop",
            }],
        })

    # ------------------------------------------------------------------
    # Terminal tab - direct command execution (not through the AI),
    # and the live activity feed showing what the agent itself is doing.

    @app.route("/api/terminal/run", methods=["POST"])
    def terminal_run():
        payload = request.get_json(force=True, silent=True) or {}
        command = (payload.get("command") or "").strip()
        if not command:
            return jsonify({"error": "Empty command"}), 400

        activity_log.log("terminal", f"$ {command}")
        result = run_command(command)
        activity_log.log("terminal", f"exit {result.get('returncode')}")
        return jsonify(result)

    @app.route("/api/activity", methods=["GET"])
    def get_activity():
        since = request.args.get("since", default=0, type=float)
        return jsonify(activity_log.get_since(since))

    # ------------------------------------------------------------------
    # Connection testing - for local/self-hosted providers (OmniRoute,
    # Ollama) where "is this even running?" is the first thing to check.
    # Cloud providers aren't tested here - that would mean spending a
    # real request just to check a key.

    @app.route("/api/test-connection", methods=["POST"])
    def test_connection():
        payload = request.get_json(force=True, silent=True) or {}
        base_url = (payload.get("url") or "").strip().rstrip("/")

        if not base_url:
            return jsonify({"ok": False, "message": "No URL set."})

        probe_url = f"{base_url}/models"
        try:
            resp = requests.get(probe_url, timeout=4)
        except requests.exceptions.ConnectionError:
            return jsonify({"ok": False, "message": f"Nothing responding at {base_url} - is it running?"})
        except requests.exceptions.Timeout:
            return jsonify({"ok": False, "message": f"{base_url} timed out after 4s."})
        except Exception as e:
            return jsonify({"ok": False, "message": str(e)})

        if resp.status_code == 200:
            model_count = None
            try:
                data = resp.json()
                model_count = len(data.get("data", [])) if isinstance(data, dict) else None
            except Exception:
                pass
            extra = f" ({model_count} model(s) listed)" if model_count is not None else ""
            return jsonify({"ok": True, "message": f"Connected{extra}."})

        return jsonify({"ok": False, "message": f"Got HTTP {resp.status_code} from {probe_url}."})

    # ------------------------------------------------------------------
    # Workspace - the folder the agent's file/terminal/git tools work in

    @app.route("/api/workspace/files", methods=["GET"])
    def workspace_files():
        try:
            files = list_files(".", recursive=False)
            return jsonify({"path": Config.WORKSPACE_DIR, "files": files})
        except Exception as e:
            return jsonify({"path": Config.WORKSPACE_DIR, "files": [], "error": str(e)}), 200

    # ------------------------------------------------------------------
    # Code editor - its own page, browsing/editing files in the workspace

    @app.route("/api/code/list", methods=["GET"])
    def code_list():
        try:
            files = list_files(".", recursive=True)
        except Exception as e:
            return jsonify({"path": Config.WORKSPACE_DIR, "files": [], "error": str(e)}), 200
        return jsonify({"path": Config.WORKSPACE_DIR, "files": files})

    @app.route("/api/code/file", methods=["GET"])
    def code_read():
        path = request.args.get("path", "")
        if not path:
            return jsonify({"error": "path is required"}), 400
        try:
            content = read_file(path)
        except FileNotFoundError:
            return jsonify({"error": f"Not found: {path}"}), 404
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        return jsonify({"path": path, "content": content})

    @app.route("/api/code/file", methods=["POST"])
    def code_save():
        payload = request.get_json(force=True, silent=True) or {}
        path = payload.get("path", "")
        content = payload.get("content", "")
        if not path:
            return jsonify({"error": "path is required"}), 400
        try:
            write_file(path, content, backup=False)
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except Exception as e:
            return jsonify({"error": str(e)}), 400
        activity_log.log("system", f"code editor saved: {path}")
        return jsonify({"ok": True, "path": path})

    @app.route("/api/upload", methods=["POST"])
    def upload_file():
        """
        Text files get saved into the workspace folder (for read_file etc)
        with a text preview. Image files get opened in the image editor
        store instead, becoming the active image the AI can edit via the
        image_edit tool - and what's shown in the Images tab.
        """
        if "file" not in request.files:
            return jsonify({"error": "No file in request"}), 400

        f = request.files["file"]
        filename = secure_filename(f.filename or "upload.txt")
        if not filename:
            return jsonify({"error": "Invalid filename"}), 400

        IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")
        if filename.lower().endswith(IMAGE_EXTENSIONS):
            try:
                state = image_tools.load_image(f.read())
            except Exception as e:
                return jsonify({"error": f"Could not read image: {e}"}), 400
            activity_log.log("system", f"image attached in chat: {filename} ({state['id']})")
            return jsonify({
                "filename": filename,
                "type": "image",
                "id": state["id"],
                "width": state["width"],
                "height": state["height"],
                "preview": state["preview"],
            })

        os.makedirs(Config.WORKSPACE_DIR, exist_ok=True)
        dest = os.path.join(Config.WORKSPACE_DIR, filename)
        f.save(dest)
        activity_log.log("system", f"file uploaded: {filename}")

        preview = ""
        try:
            with open(dest, "r", encoding="utf-8", errors="replace") as fh:
                preview = fh.read(4000)
        except Exception:
            preview = "(binary file - not shown as text)"

        return jsonify({"filename": filename, "path": dest, "preview": preview})

    # ------------------------------------------------------------------
    # Image editor

    @app.route("/api/image/upload", methods=["POST"])
    def image_upload():
        if "file" not in request.files:
            return jsonify({"error": "No file in request"}), 400
        f = request.files["file"]
        try:
            state = image_tools.load_image(f.read())
        except Exception as e:
            return jsonify({"error": f"Could not read image: {e}"}), 400
        activity_log.log("system", f"image opened: {state['id']} ({state['width']}x{state['height']})")
        return jsonify(state)

    @app.route("/api/image/<image_id>/op", methods=["POST"])
    def image_op(image_id):
        payload = request.get_json(force=True, silent=True) or {}
        op = payload.get("op")
        params = payload.get("params", {})
        try:
            state = image_tools.apply_op(image_id, op, params)
        except KeyError:
            return jsonify({"error": "Unknown image id - upload it again"}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(state)

    @app.route("/api/image/<image_id>/reset", methods=["POST"])
    def image_reset(image_id):
        try:
            state = image_tools.reset(image_id)
        except KeyError:
            return jsonify({"error": "Unknown image id"}), 404
        return jsonify(state)

    @app.route("/api/image/<image_id>/download", methods=["GET"])
    def image_download(image_id):
        fmt = request.args.get("format", "PNG")
        try:
            data = image_tools.export_bytes(image_id, fmt)
        except KeyError:
            return jsonify({"error": "Unknown image id"}), 404
        mime = "image/jpeg" if fmt.upper() in ("JPEG", "JPG") else "image/png"
        return Response(data, mimetype=mime, headers={
            "Content-Disposition": f"attachment; filename=bubbles-edit.{fmt.lower()}"
        })

    return app
