"""
Short-term, in-memory conversation history for the current session.
Not persisted to disk - see project_memory.py for that.
"""

from config import Config


class ChatMemory:
    def __init__(self, max_messages: int = None):
        self.max_messages = max_messages or Config.MAX_HISTORY_MESSAGES
        self.messages = []  # list of {"role": ..., "content": ...}

    def add(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})

        if len(self.messages) > self.max_messages:
            # Drop oldest messages first, keep the window bounded
            self.messages = self.messages[-self.max_messages:]

    def add_user(self, content: str):
        self.add("user", content)

    def add_assistant(self, content: str):
        self.add("assistant", content)

    def get_history(self):
        return list(self.messages)

    def as_text(self) -> str:
        lines = [f"{m['role'].upper()}: {m['content']}" for m in self.messages]
        return "\n".join(lines)

    def clear(self):
        self.messages = []
