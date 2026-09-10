"""
Safe-ish file writing tool for agents.
Same workspace-folder sandboxing as file_reader, plus optional
backups before overwriting an existing file.
"""

import os
import shutil

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


def write_file(path: str, content: str, backup: bool = True) -> str:
    """
    Writes `content` to `path` (relative to the workspace folder),
    creating any missing parent directories.
    """
    full_path = _resolve_safe(path)
    os.makedirs(os.path.dirname(full_path) or ".", exist_ok=True)

    if backup and os.path.exists(full_path):
        backup_path = full_path + ".bak"
        shutil.copy2(full_path, backup_path)
        logger.info(f"📄 Backed up existing file to {backup_path}")

    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"✅ Wrote {len(content)} chars to {path}")
    return full_path


def append_file(path: str, content: str) -> str:
    full_path = _resolve_safe(path)
    os.makedirs(os.path.dirname(full_path) or ".", exist_ok=True)

    with open(full_path, "a", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"✅ Appended {len(content)} chars to {path}")
    return full_path
