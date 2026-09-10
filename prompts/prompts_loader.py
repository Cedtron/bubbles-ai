import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_prompt(filename: str) -> str:
    path = os.path.join(BASE_DIR, filename)

    if not os.path.exists(path):
        raise FileNotFoundError(f"Prompt not found: {filename}")

    with open(path, "r", encoding="utf-8") as f:
        return f.read()