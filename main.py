"""
Bubbles AI - main entry point.

Starts the Flask backend, then tries to open it in a lightweight
native app window via pywebview (uses the OS's built-in web renderer:
WebView2 on Windows, WebKitGTK on Linux, WKWebView on Mac - not a
bundled/compiled engine, so nothing to segfault the way an embedded
Tk widget toolkit can).

If pywebview or its OS-level webview component isn't available,
this automatically falls back to just opening the page in your
default browser - Bubbles AI still works exactly the same either way,
you just get browser chrome (tabs/address bar) instead of a bare
window.
"""

import os
import sys
import threading
import time
import webbrowser

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.server import create_app
from utils.logger import get_logger

logger = get_logger(__name__)

HOST = "127.0.0.1"
PORT = int(os.getenv("BUBBLES_UI_PORT", 8420))
URL = f"http://{HOST}:{PORT}"


class WindowApi:
    """
    Exposed to the frontend as window.pywebview.api - lets our custom
    HTML title bar (see frontend/index.html #titlebar) actually control
    the native window, since a frameless window has no OS title bar
    for the user to click.
    """

    def __init__(self):
        self.window = None
        self._maximized = False

    def minimize(self):
        if self.window:
            self.window.minimize()

    def toggle_maximize(self):
        if not self.window:
            return
        if self._maximized:
            self.window.restore()
        else:
            self.window.maximize()
        self._maximized = not self._maximized

    def close(self):
        if self.window:
            self.window.destroy()


def _run_flask():
    app = create_app()
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)


def _wait_for_server(timeout=10):
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(URL, timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    server_thread = threading.Thread(target=_run_flask, daemon=True)
    server_thread.start()

    if not _wait_for_server():
        logger.error("Backend server didn't start in time.")
        return

    logger.info(f"🫧 Bubbles AI running at {URL}")

    try:
        import webview
        api = WindowApi()
        window = webview.create_window(
            "Bubbles AI", URL, width=1200, height=800, min_size=(900, 600),
            frameless=True, easy_drag=False, js_api=api,
        )
        api.window = window
        webview.start()
    except Exception as e:
        logger.warning(f"Native app window unavailable ({e}) - opening in your default browser instead.")
        webbrowser.open(URL)
        print(f"\nBubbles AI is running at {URL}")
        print("Leave this terminal open while you use it. Press Ctrl+C to stop.\n")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping Bubbles AI.")


if __name__ == "__main__":
    main()
