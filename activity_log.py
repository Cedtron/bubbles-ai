"""
A small in-memory rolling log of what the agent is doing - provider
attempts/fallbacks, tool calls and their results. Powers the
Terminal tab in the UI so you can actually see the agent working,
not just wait for a final answer.

Deliberately simple (deque + lock, no persistence) - this is a live
activity feed, not a durable audit log.
"""

import collections
import threading
import time

_LOCK = threading.Lock()
_LOG = collections.deque(maxlen=500)


def log(kind: str, message: str):
    """kind: 'provider' | 'tool' | 'chat' | 'system'"""
    with _LOCK:
        _LOG.append({"time": time.time(), "kind": kind, "message": message})


def get_since(since: float = 0) -> list:
    with _LOCK:
        return [e for e in _LOG if e["time"] > since]


def get_recent(limit: int = 200) -> list:
    with _LOCK:
        return list(_LOG)[-limit:]
