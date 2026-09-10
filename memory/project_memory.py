"""
Persistent, per-project memory - facts, decisions, and file notes
that should survive across CLI runs. Stored as a single JSON file
under Config.MEMORY_DIR.
"""

import json
import os

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)


class ProjectMemory:
    def __init__(self, project_name: str = "default"):
        self.project_name = project_name
        os.makedirs(Config.MEMORY_DIR, exist_ok=True)
        self.path = os.path.join(Config.MEMORY_DIR, f"{project_name}.json")
        self.data = self._load()

    def _load(self) -> dict:
        if not os.path.exists(self.path):
            return {"notes": [], "facts": {}}

        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Could not load project memory, starting fresh: {e}")
            return {"notes": [], "facts": {}}

    def _save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2)

    def add_note(self, note: str):
        self.data.setdefault("notes", []).append(note)
        self._save()

    def set_fact(self, key: str, value):
        self.data.setdefault("facts", {})[key] = value
        self._save()

    def get_fact(self, key: str, default=None):
        return self.data.get("facts", {}).get(key, default)

    def get_notes(self):
        return list(self.data.get("notes", []))

    def as_context(self) -> str:
        """
        Renders stored notes/facts as text the agent can drop into a
        prompt for continuity across sessions.
        """
        parts = []
        facts = self.data.get("facts", {})
        if facts:
            parts.append("Known facts:\n" + "\n".join(f"- {k}: {v}" for k, v in facts.items()))

        notes = self.data.get("notes", [])
        if notes:
            parts.append("Notes:\n" + "\n".join(f"- {n}" for n in notes))

        return "\n\n".join(parts)
