"""
Summarizes chat history so long conversations don't blow the context
window. Uses the configured LLM provider when available, falling
back to a naive truncation if that fails.
"""

from utils.logger import get_logger

logger = get_logger(__name__)

SUMMARY_SYSTEM_PROMPT = (
    "Summarize the following conversation concisely, preserving any "
    "decisions made, open questions, and important technical details. "
    "Write it as plain notes, not a transcript."
)


def summarize_history(history: list, provider=None, max_chars: int = 4000) -> str:
    """
    `history` is a list of {"role": ..., "content": ...} dicts.
    """
    if not history:
        return ""

    transcript = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history)

    if provider is None:
        return _naive_summary(transcript, max_chars)

    try:
        return provider.generate(transcript, system=SUMMARY_SYSTEM_PROMPT)
    except Exception as e:
        logger.warning(f"LLM summarization failed, falling back to naive summary: {e}")
        return _naive_summary(transcript, max_chars)


def _naive_summary(transcript: str, max_chars: int) -> str:
    if len(transcript) <= max_chars:
        return transcript
    return transcript[:max_chars] + "\n... [older history truncated]"
