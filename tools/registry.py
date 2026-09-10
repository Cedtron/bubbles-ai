"""
Central registry of tools an agent can call, plus the small protocol
for letting the model request one: it emits a fenced block like

```tool
{"name": "run_command", "args": {"command": "ls -la"}}
```

and we parse that, run the matching function, and feed the result
back to the model. Only tools in the caller-supplied `enabled_tools`
list are ever executed, regardless of what the model asks for.
"""

import json
import re

import activity_log
from utils.logger import get_logger
from tools.file_reader import read_file, list_files
from tools.file_writer import write_file, append_file
from tools.terminal import run_command
from tools.python_runner import run_python
from tools import git as git_tool
from tools.search import web_search
from tools.browser import fetch_page
from backend import image_tools

logger = get_logger(__name__)

MAX_RESULT_CHARS = 4000


def _fmt_cmd_result(result: dict) -> str:
    parts = [f"exit code: {result.get('returncode')}"]
    if result.get("stdout"):
        parts.append(f"stdout:\n{result['stdout']}")
    if result.get("stderr"):
        parts.append(f"stderr:\n{result['stderr']}")
    return "\n".join(parts)


def _fmt_search_results(results: list) -> str:
    if not results:
        return "No results."
    return "\n".join(f"- {r['title']} ({r['url']}): {r['snippet']}" for r in results)


TOOL_REGISTRY = {
    "read_file": {
        "fn": lambda args: read_file(args["path"]),
        "description": 'Read a text file. args: {"path": "relative/path.py"}',
    },
    "list_files": {
        "fn": lambda args: "\n".join(list_files(args.get("path", "."), args.get("recursive", False))),
        "description": 'List files in a directory. args: {"path": ".", "recursive": false}',
    },
    "write_file": {
        "fn": lambda args: f"Wrote {args['path']}",
        "description": 'Write content to a file (creates/overwrites). args: {"path": "...", "content": "..."}',
    },
    "run_command": {
        "fn": lambda args: _fmt_cmd_result(run_command(args["command"])),
        "description": 'Run a shell command. args: {"command": "ls -la"}',
    },
    "run_python": {
        "fn": lambda args: _fmt_cmd_result(run_python(args["code"])),
        "description": 'Run a python snippet in a subprocess. args: {"code": "print(1+1)"}',
    },
    "git_status": {
        "fn": lambda args: _fmt_cmd_result(git_tool.status()),
        "description": 'Show `git status`. args: {}',
    },
    "git_diff": {
        "fn": lambda args: _fmt_cmd_result(git_tool.diff()),
        "description": 'Show `git diff`. args: {}',
    },
    "web_search": {
        "fn": lambda args: _fmt_search_results(web_search(args["query"])),
        "description": 'Search the web. args: {"query": "..."}',
    },
    "fetch_page": {
        "fn": lambda args: fetch_page(args["url"]).get("text", ""),
        "description": 'Fetch a webpage and return its readable text. args: {"url": "https://..."}',
    },
    "image_list": {
        "fn": lambda args: _fmt_image_list(),
        "description": 'List images open in this session (from the Images tab or attached in chat), '
                        'with their id, dimensions, and which one is active. args: {}',
    },
    "image_edit": {
        "fn": lambda args: _fmt_image_edit(args),
        "description": (
            'Edit an image using the same tools as the Images tab. If "id" is omitted, '
            'edits whichever image was most recently opened or edited. '
            'args: {"id": "<optional>", "op": "resize|rotate|flip|grayscale|brightness|contrast|'
            'saturation|blur|sharpen|crop|watermark", "params": {...}}. '
            'Examples: {"op":"grayscale","params":{}} · '
            '{"op":"resize","params":{"width":800,"height":600}} · '
            '{"op":"rotate","params":{"degrees":90}} · '
            '{"op":"watermark","params":{"text":"Draft","position":"bottom-right"}} · '
            '{"op":"crop","params":{"x":0,"y":0,"width":300,"height":200}}'
        ),
    },
}


def _fmt_image_list() -> str:
    images = image_tools.list_images()
    if not images:
        return "No images are open. Attach one in chat or open one in the Images tab first."
    lines = []
    for img in images:
        marker = " (active)" if img["active"] else ""
        lines.append(f"- {img['id']}: {img['width']}x{img['height']}{marker}")
    return "\n".join(lines)


def _fmt_image_edit(args: dict) -> str:
    image_id = args.get("id") or image_tools.get_active_id()
    if not image_id:
        return "No image is open. Ask the user to attach an image or open one in the Images tab first."

    op = args.get("op")
    params = args.get("params", {})
    if not op:
        return "Error: 'op' is required, e.g. \"grayscale\", \"resize\", \"rotate\"."

    try:
        state = image_tools.apply_op(image_id, op, params)
    except KeyError:
        return f"Error: no image with id '{image_id}' is open."
    except Exception as e:
        return f"Error applying '{op}': {e}"

    return f"Applied {op} to image {state['id']}. New size: {state['width']}x{state['height']}."

# write_file needs the real function (kept out of the lambda above so
# args validation errors are clearer)
TOOL_REGISTRY["write_file"]["fn"] = lambda args: (
    write_file(args["path"], args.get("content", "")) and f"Wrote {args['path']}"
)

_TOOL_BLOCK_RE = re.compile(r"```tool\s*(\{.*?\})\s*```", re.DOTALL)


def build_tool_prompt(enabled_tools: list) -> str:
    lines = [
        "You have access to the following tools. To use one, respond with "
        "ONLY a fenced block in this exact format (no other text in that reply):",
        "```tool",
        '{"name": "<tool_name>", "args": {...}}',
        "```",
        "If you don't need a tool, just answer normally.",
        "",
        "Available tools:",
    ]
    for name in enabled_tools:
        tool = TOOL_REGISTRY.get(name)
        if tool:
            lines.append(f"- {name}: {tool['description']}")

    return "\n".join(lines)


def parse_tool_call(response: str):
    match = _TOOL_BLOCK_RE.search(response or "")
    if not match:
        return None

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        logger.warning(f"Model emitted a malformed tool call: {e}")
        return None

    if "name" not in data:
        return None

    data.setdefault("args", {})
    return data


def execute_tool(call: dict, enabled_tools: list) -> str:
    name = call.get("name")
    args = call.get("args", {})

    if name not in enabled_tools:
        activity_log.log("tool", f"blocked (not enabled): {name}")
        return f"Error: tool '{name}' is not enabled."

    tool = TOOL_REGISTRY.get(name)
    if not tool:
        return f"Error: unknown tool '{name}'."

    activity_log.log("tool", f"{name}({args})")

    try:
        result = tool["fn"](args)
    except Exception as e:
        logger.warning(f"Tool '{name}' raised: {e}")
        activity_log.log("tool", f"{name} failed: {e}")
        return f"Error running tool '{name}': {e}"

    result = str(result)
    if len(result) > MAX_RESULT_CHARS:
        result = result[:MAX_RESULT_CHARS] + "\n... [truncated]"

    activity_log.log("tool", f"{name} -> {result[:200]}")

    return result
