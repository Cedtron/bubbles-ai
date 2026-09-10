"""
Runtime settings management for the GUI: lets the user edit API keys,
the default provider, and the fallback order from the Settings panel,
persists them to .env, and applies them to the live Config object +
clears cached provider instances so the change takes effect on the
very next message (no restart needed).
"""

import os

from config import Config
from providers import reset_provider_cache
from utils.logger import get_logger

logger = get_logger(__name__)

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

# Config attribute name -> .env key name, for everything the Settings
# panel is allowed to edit.
EDITABLE_FIELDS = {
    "OPENAI_API_KEY": "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY": "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY": "DEEPSEEK_API_KEY",
    "KIMI_API_KEY": "KIMI_API_KEY",
    "OMNIROUTE_API_KEY": "OMNIROUTE_API_KEY",
    "OMNIROUTE_BASE_URL": "OMNIROUTE_BASE_URL",
    "LOCAL_MODEL_PATH": "LOCAL_MODEL_PATH",
    "OLLAMA_BASE_URL": "OLLAMA_BASE_URL",
    "OLLAMA_MODEL": "OLLAMA_MODEL",
    "AWS_ACCESS_KEY_ID": "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY": "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION": "AWS_REGION",
    "NOVA_MODEL": "NOVA_MODEL",
    "GOOGLE_API_KEY": "GOOGLE_API_KEY",
    "GOOGLE_MODEL": "GOOGLE_MODEL",
    "WORKSPACE_DIR": "WORKSPACE_DIR",
    "DEFAULT_PROVIDER": "DEFAULT_PROVIDER",
    "DEFAULT_MODEL": "DEFAULT_MODEL",
}


def get_current_values() -> dict:
    return {attr: getattr(Config, attr, "") or "" for attr in EDITABLE_FIELDS}


def save_settings(values: dict):
    """
    `values` maps Config attribute names (see EDITABLE_FIELDS) to their
    new string values. Applies them in-memory immediately and persists
    to .env for next launch.
    """
    # 1. Apply to the live Config object + os.environ (so anything that
    #    re-reads os.environ later also sees the update)
    for attr, value in values.items():
        if attr not in EDITABLE_FIELDS:
            continue
        setattr(Config, attr, value)
        os.environ[EDITABLE_FIELDS[attr]] = value

    # 2. Drop cached provider instances so they get rebuilt with the
    #    new keys/URLs next time they're used
    reset_provider_cache()

    # 3. Persist to .env
    _write_env(values)

    logger.info("⚙️  Settings saved and applied")


def _write_env(values: dict):
    lines = []
    seen_keys = set()

    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            existing_lines = f.readlines()
    else:
        existing_lines = []

    value_by_env_key = {EDITABLE_FIELDS[attr]: v for attr, v in values.items() if attr in EDITABLE_FIELDS}

    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            lines.append(line.rstrip("\n"))
            continue

        key = stripped.split("=", 1)[0].strip()
        if key in value_by_env_key:
            lines.append(f"{key}={value_by_env_key[key]}")
            seen_keys.add(key)
        else:
            lines.append(line.rstrip("\n"))

    # Append any new keys that weren't already in the file
    for key, value in value_by_env_key.items():
        if key not in seen_keys:
            lines.append(f"{key}={value}")

    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
