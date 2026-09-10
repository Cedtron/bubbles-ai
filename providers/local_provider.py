"""
Runs a GGUF model file directly (e.g. something you downloaded from
Hugging Face) using llama-cpp-python - fully offline, no server needed.

llama-cpp-python isn't in requirements.txt by default because it
compiles a C++ backend and can take a while to install. Install it
with:
    pip install llama-cpp-python
(For GPU acceleration, see their docs for CUDA/Metal/Vulkan build flags.)

The model is loaded once and cached for the life of the app - GGUF
files can be several GB, so we don't want to reload it per message.
"""

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

try:
    from llama_cpp import Llama
    _HAS_LLAMA_CPP = True
except ImportError:
    _HAS_LLAMA_CPP = False

_MODEL_CACHE = {}  # path -> Llama instance


def _get_model(path: str):
    if path in _MODEL_CACHE:
        return _MODEL_CACHE[path]

    logger.info(f"📦 Loading local model (this can take a moment): {path}")
    model = Llama(
        model_path=path,
        n_ctx=Config.LOCAL_MODEL_CTX,
        n_threads=Config.LOCAL_MODEL_THREADS,
        verbose=False,
    )
    _MODEL_CACHE[path] = model
    return model


class LocalProvider:
    def __init__(self):
        if not _HAS_LLAMA_CPP:
            raise ImportError(
                "llama-cpp-python is not installed. Run: pip install llama-cpp-python"
            )

        if not Config.LOCAL_MODEL_PATH:
            raise ValueError(
                "No local model file set. Set LOCAL_MODEL_PATH in Settings to a .gguf file."
            )

        self.model = Config.LOCAL_MODEL_PATH  # used for logging/cost display
        self._llama = _get_model(Config.LOCAL_MODEL_PATH)

    def generate(self, prompt: str, system: str = None) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        result = self._llama.create_chat_completion(
            messages=messages,
            temperature=Config.TEMPERATURE,
            max_tokens=Config.MAX_TOKENS,
        )

        return result["choices"][0]["message"]["content"]
