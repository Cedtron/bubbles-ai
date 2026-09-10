"""
Thin wrapper around common git commands for agents.
"""

from tools.terminal import run_command


def status(cwd: str = None):
    return run_command("git status --short --branch", cwd=cwd)


def diff(cwd: str = None, staged: bool = False):
    cmd = "git diff --staged" if staged else "git diff"
    return run_command(cmd, cwd=cwd)


def add(paths: str = ".", cwd: str = None):
    return run_command(f"git add {paths}", cwd=cwd)


def commit(message: str, cwd: str = None):
    safe_message = message.replace('"', '\\"')
    return run_command(f'git commit -m "{safe_message}"', cwd=cwd)


def log(n: int = 10, cwd: str = None):
    return run_command(f"git log -n {n} --oneline", cwd=cwd)


def current_branch(cwd: str = None):
    return run_command("git rev-parse --abbrev-ref HEAD", cwd=cwd)
