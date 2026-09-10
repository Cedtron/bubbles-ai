"""
Token counting helpers.

Uses tiktoken when available (accurate for OpenAI-style models).
Falls back to a simple whitespace/char heuristic so the app still
works if tiktoken isn't installed or the model isn't recognized.
"""

from utils.logger import get_logger

logger = get_logger(__name__)

try:
    import tiktoken
    _HAS_TIKTOKEN = True
except ImportError:
    _HAS_TIKTOKEN = False
    logger.warning("tiktoken not installed - falling back to rough token estimates")


def count_tokens(text: str, model: str = "gpt-4o-mini") -> int:
    """
    Count tokens in `text`. Falls back to an approximation
    (~4 chars per token) if tiktoken isn't available, isn't able to
    reach its data file (offline/blocked network), or doesn't
    recognize the model.
    """
    if not text:
        return 0

    if _HAS_TIKTOKEN:
        try:
            try:
                encoding = tiktoken.encoding_for_model(model)
            except KeyError:
                encoding = tiktoken.get_encoding("cl100k_base")
            return len(encoding.encode(text))
        except Exception as e:
            logger.debug(f"tiktoken unavailable ({e}) - using rough token estimate")

    # Rough fallback heuristic
    return max(1, len(text) // 4)


def truncate_to_tokens(text: str, max_tokens: int, model: str = "gpt-4o-mini") -> str:
    """
    Truncate `text` so it fits within `max_tokens`.
    """
    if not text:
        return text

    if _HAS_TIKTOKEN:
        try:
            try:
                encoding = tiktoken.encoding_for_model(model)
            except KeyError:
                encoding = tiktoken.get_encoding("cl100k_base")
            tokens = encoding.encode(text)
            if len(tokens) <= max_tokens:
                return text
            return encoding.decode(tokens[:max_tokens])
        except Exception as e:
            logger.debug(f"tiktoken unavailable ({e}) - using rough truncation")

    # Fallback: approximate by characters
    approx_chars = max_tokens * 4
    return text[:approx_chars]
