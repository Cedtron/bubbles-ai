"""
Safe-ish file reading tool for agents.
Restricts access to Config.WORKSPACE_DIR so the agent can't wander
off and read arbitrary system files - set the workspace folder from
the Settings page to point it at a specific project.
"""

import os

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)


def _workspace_root() -> str:
    return os.path.abspath(Config.WORKSPACE_DIR or os.getcwd())


def _resolve_safe(path: str) -> str:
    root = _workspace_root()
    full_path = os.path.abspath(os.path.join(root, path))
    if not (full_path == root or full_path.startswith(root + os.sep)):
        raise PermissionError(f"Access outside the workspace folder is not allowed: {path}")
    return full_path


def read_file(path: str, max_chars: int = 20000) -> str:
    """
    Reads a text file relative to the workspace folder.
    Truncates very large files so they don't blow the context window.
    """
    full_path = _resolve_safe(path)

    if not os.path.exists(full_path):
        raise FileNotFoundError(f"File not found: {path}")

    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    if len(content) > max_chars:
        logger.warning(f"Truncating {path} ({len(content)} -> {max_chars} chars)")
        content = content[:max_chars] + "\n... [truncated]"

    return content


def list_files(path: str = ".", recursive: bool = False):
    """
    Lists files under a directory (relative to the workspace folder).
    """
    full_path = _resolve_safe(path)
    root = _workspace_root()

    if not recursive:
        return sorted(os.listdir(full_path))

    matches = []
    for r, _, files in os.walk(full_path):
        for name in files:
            rel = os.path.relpath(os.path.join(r, name), root)
            matches.append(rel)
    return sorted(matches)
