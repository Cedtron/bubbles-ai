import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # API KEYS
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    KIMI_API_KEY = os.getenv("KIMI_API_KEY")

    # DEFAULTS
    DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "openai")
    DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gpt-4o-mini")

    # If the default provider errors out (quota, rate limit, auth, etc),
    # try these next, in order. Set PROVIDER_FALLBACK_ORDER in .env to
    # override, e.g. "openai,anthropic,deepseek". Set to "" to disable
    # fallback entirely and only ever use DEFAULT_PROVIDER.
    PROVIDER_FALLBACK_ORDER = [
        p.strip() for p in os.getenv(
            "PROVIDER_FALLBACK_ORDER", "omniroute,openai,anthropic,deepseek,kimi,demo"
        ).split(",") if p.strip()
    ]

    # AGENT SETTINGS
    MAX_TOKENS = int(os.getenv("MAX_TOKENS", 2000))
    TEMPERATURE = float(os.getenv("TEMPERATURE", 0.7))

    # PER-PROVIDER MODELS
    ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    KIMI_MODEL = os.getenv("KIMI_MODEL", "moonshot-v1-8k")
    NOVA_MODEL = os.getenv("NOVA_MODEL", "amazon.nova-lite-v1:0")

    # OPENAI-COMPATIBLE BASE URLS
    DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    KIMI_BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")

    # OMNIROUTE (self-hosted local AI gateway - github.com/diegosouzapw/OmniRoute)
    # Routes to whichever provider it has configured internally, with its
    # own fallback. Usually no real API key needed for a local instance.
    OMNIROUTE_API_KEY = os.getenv("OMNIROUTE_API_KEY", "")
    OMNIROUTE_BASE_URL = os.getenv("OMNIROUTE_BASE_URL", "http://localhost:20128/v1")
    OMNIROUTE_MODEL = os.getenv("OMNIROUTE_MODEL", "auto")

    # OFFLINE / LOCAL MODELS
    # Option A: a .gguf file loaded directly with llama-cpp-python
    LOCAL_MODEL_PATH = os.getenv("LOCAL_MODEL_PATH", "")
    LOCAL_MODEL_CTX = int(os.getenv("LOCAL_MODEL_CTX", 4096))
    LOCAL_MODEL_THREADS = int(os.getenv("LOCAL_MODEL_THREADS", os.cpu_count() or 4))

    # Option B: a model already loaded into a local Ollama server
    OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

    # Google AI (Gemini)
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
    GOOGLE_MODEL = os.getenv("GOOGLE_MODEL", "gemini-2.0-flash")

    # AWS (for Nova via Bedrock)
    AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")

    # CACHE
    CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", 300))
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # MEMORY
    MEMORY_DIR = os.getenv("MEMORY_DIR", ".agent_memory")
    MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", 20))

    # WORKSPACE - the folder file/terminal/git tools operate in. Defaults
    # to wherever the app was launched from; change it from the Settings
    # page to point the agent at a specific project folder.
    WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", os.getcwd())