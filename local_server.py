"""
A tiny OpenAI-compatible HTTP server, run in a background thread from
the GUI, so other tools (VS Code extensions like Continue/Cody-style
custom endpoints, curl, scripts, etc.) can talk to Bubbles AI as if it
were "just another OpenAI-compatible API" - it internally routes the
request through the same ModelRouter/agents/providers as the chat
window, including any local/offline model you've configured.

Point a tool's "custom OpenAI base URL" at:
    http://127.0.0.1:<port>/v1
(API key can be anything - it's not checked.)
"""

import threading
import time

from flask import Flask, jsonify, request

from router import ModelRouter
from utils.logger import get_logger

logger = get_logger(__name__)


class LocalAPIServer:
    def __init__(self, router: ModelRouter, host: str = "127.0.0.1", port: int = 8787):
        self.router = router
        self.host = host
        self.port = port
        self._thread = None
        self._server = None

        self.app = Flask("bubbles_ai_local_server")
        self._register_routes()

    # ------------------------------------

    def _register_routes(self):
        app = self.app

        @app.route("/v1/models", methods=["GET"])
        def list_models():
            return jsonify({
                "object": "list",
                "data": [{"id": "bubbles-ai", "object": "model", "owned_by": "bubbles-ai"}],
            })

        @app.route("/v1/chat/completions", methods=["POST"])
        def chat_completions():
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
                answer = self.router.handle_request(user_text)
            except Exception as e:
                logger.error(f"Local API server error: {e}")
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

    # ------------------------------------

    def start(self):
        if self._thread and self._thread.is_alive():
            return

        from werkzeug.serving import make_server
        self._server = make_server(self.host, self.port, self.app)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        logger.info(f"🌐 Local API server running at http://{self.host}:{self.port}/v1")

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._thread.join(timeout=3)
            logger.info("🌐 Local API server stopped")
            self._server = None
            self._thread = None

    @property
    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    @property
    def endpoint_url(self) -> str:
        return f"http://{self.host}:{self.port}/v1"
