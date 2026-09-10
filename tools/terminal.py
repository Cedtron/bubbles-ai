"""
Shell command execution tool for the local agent.

This runs commands on the same machine as the agent, with the same
privileges as the user running it - there is no sandboxing here.
Only use this for commands you trust; the agent should not run
shell commands from untrusted input without confirmation.
"""

import subprocess

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

DEFAULT_TIMEOUT = 30  # seconds


def run_command(command: str, cwd: str = None, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """
    Runs a shell command and captures stdout/stderr/exit code.
    Defaults to running inside Config.WORKSPACE_DIR. Returns a dict
    rather than raising, so agents can inspect failures.
    """
    cwd = cwd or Config.WORKSPACE_DIR
    logger.info(f"🖥️  Running command in {cwd}: {command}")

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "command": command,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as e:
        logger.warning(f"Command timed out after {timeout}s: {command}")
        return {
            "command": command,
            "returncode": None,
            "stdout": e.stdout or "",
            "stderr": e.stderr or f"Timed out after {timeout}s",
            "timed_out": True,
        }
