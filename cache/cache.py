"""
Simple in-memory TTL cache. Used to avoid re-calling an LLM provider
for an identical prompt within a short window (handy while iterating
on prompts during development).
"""

import time
import hashlib

from config import Config


def make_key(*parts) -> str:
    raw = "||".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class InMemoryCache:
    def __init__(self, ttl_seconds: int = None):
        self.ttl_seconds = ttl_seconds or Config.CACHE_TTL_SECONDS
        self._store = {}  # key -> (value, expires_at)

    def get(self, key: str):
        entry = self._store.get(key)
        if not entry:
            return None

        value, expires_at = entry
        if time.time() > expires_at:
            del self._store[key]
            return None

        return value

    def set(self, key: str, value, ttl_seconds: int = None):
        ttl = ttl_seconds if ttl_seconds is not None else self.ttl_seconds
        self._store[key] = (value, time.time() + ttl)

    def clear(self):
        self._store.clear()
