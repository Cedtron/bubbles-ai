"""
Runs a Python snippet in its own subprocess (not in-process exec/eval),
so a crash or infinite loop in generated code can't take down the
agent itself. Still has no real sandboxing - only run trusted code
or code you're prepared to review before it runs.
"""

import subprocess
import sys
import tempfile
import os

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

DEFAULT_TIMEOUT = 15  # seconds


def run_python(code: str, timeout: int = DEFAULT_TIMEOUT, cwd: str = None) -> dict:
    logger.info("🐍 Running python snippet...")
    cwd = cwd or Config.WORKSPACE_DIR

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as tmp:
        tmp.write(code)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [sys.executable, tmp_path],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as e:
        logger.warning(f"Python snippet timed out after {timeout}s")
        return {
            "returncode": None,
            "stdout": e.stdout or "",
            "stderr": e.stderr or f"Timed out after {timeout}s",
            "timed_out": True,
        }
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
