"""
Chat session persistence for the GUI - lets the user save the current
conversation, switch between saved ones, and start new ones. Each
session is one JSON file under Config.MEMORY_DIR/chat_sessions/.
"""

import json
import os
import re
import time
import uuid

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

SESSIONS_DIR = os.path.join(Config.MEMORY_DIR, "chat_sessions")


def _ensure_dir():
    os.makedirs(SESSIONS_DIR, exist_ok=True)


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\-_]+", "-", text.strip().lower()).strip("-")
    return slug[:60] or "chat"


def _path_for(session_id: str) -> str:
    return os.path.join(SESSIONS_DIR, f"{session_id}.json")


def new_session_id(title_hint: str = "") -> str:
    base = _slugify(title_hint) if title_hint else "chat"
    unique = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
    return f"{base}-{unique}"


def save_session(session_id: str, title: str, messages: list):
    """
    `messages` is a list of {"role": "user"|"assistant", "content": str}.
    """
    _ensure_dir()
    data = {
        "id": session_id,
        "title": title or "Untitled chat",
        "updated_at": time.time(),
        "messages": messages,
    }
    with open(_path_for(session_id), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.info(f"💾 Saved chat session: {session_id} ({len(messages)} messages)")


def load_session(session_id: str) -> dict:
    with open(_path_for(session_id), "r", encoding="utf-8") as f:
        return json.load(f)


def delete_session(session_id: str):
    path = _path_for(session_id)
    if os.path.exists(path):
        os.remove(path)
        logger.info(f"🗑️ Deleted chat session: {session_id}")


def list_sessions() -> list:
    """
    Returns [{"id":..., "title":..., "updated_at":...}, ...] sorted by
    most-recently-updated first.
    """
    _ensure_dir()
    sessions = []
    for name in os.listdir(SESSIONS_DIR):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(SESSIONS_DIR, name), "r", encoding="utf-8") as f:
                data = json.load(f)
            sessions.append({
                "id": data.get("id", name[:-5]),
                "title": data.get("title", "Untitled chat"),
                "updated_at": data.get("updated_at", 0),
            })
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Skipping unreadable session file {name}: {e}")

    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return sessions


def auto_title(messages: list) -> str:
    """Derives a short title from the first user message."""
    for m in messages:
        if m.get("role") == "user" and m.get("content"):
            text = m["content"].strip().replace("\n", " ")
            return (text[:40] + "…") if len(text) > 40 else text
    return "New chat"


def search_sessions(query: str, limit: int = 50) -> list:
    """
    Searches saved chats by title AND message content (case-insensitive).
    Returns [{"id", "title", "updated_at", "snippet"}, ...] sorted by
    most-recently-updated first. `snippet` is a short excerpt around
    the first match, for display in the search results list.
    """
    _ensure_dir()
    query = (query or "").strip().lower()
    if not query:
        return []

    matches = []
    for name in os.listdir(SESSIONS_DIR):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(SESSIONS_DIR, name), "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        title = data.get("title", "Untitled chat")
        messages = data.get("messages", [])
        snippet = None

        if query in title.lower():
            snippet = title
        else:
            for m in messages:
                content = m.get("content", "")
                idx = content.lower().find(query)
                if idx != -1:
                    start = max(0, idx - 30)
                    end = min(len(content), idx + len(query) + 30)
                    snippet = ("…" if start > 0 else "") + content[start:end].replace("\n", " ") + ("…" if end < len(content) else "")
                    break

        if snippet is not None:
            matches.append({
                "id": data.get("id", name[:-5]),
                "title": title,
                "updated_at": data.get("updated_at", 0),
                "snippet": snippet,
            })

    matches.sort(key=lambda s: s["updated_at"], reverse=True)
    return matches[:limit]
