"""
Provider factory - turns a provider name (string) into a provider
instance. Agents call get_provider() instead of importing a specific
provider class directly, so the default provider can be swapped via
config/env without touching agent code.

Also provides generate_with_fallback(), which tries a list of
providers in order and moves on to the next one if a call fails
(quota exceeded, rate limited, auth error, etc) instead of just
dying on the first failure.
"""

import activity_log
from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

_PROVIDER_CACHE = {}

# Which Config attribute holds the API key for each provider.
# Nova has none here - it authenticates via AWS credentials instead.
_KEY_ATTR = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "kimi": "KIMI_API_KEY",
}


def is_configured(name: str) -> bool:
    """
    Returns True if we have an API key on hand for this provider
    (or the provider doesn't need one, like Nova/AWS creds).
    """
    name = name.lower()
    key_attr = _KEY_ATTR.get(name)
    if key_attr is None:
        return True
    return bool(getattr(Config, key_attr, None))


def reset_provider_cache():
    """
    Drops all cached provider instances so the next get_provider() call
    rebuilds them from current Config values. Call this after changing
    API keys/URLs at runtime (e.g. from the Settings panel).
    """
    _PROVIDER_CACHE.clear()
    logger.info("🔄 Provider cache cleared")


def get_provider(name: str = None):
    """
    Returns a (cached) provider instance for the given name.
    Falls back to Config.DEFAULT_PROVIDER if name is None.
    """
    name = (name or Config.DEFAULT_PROVIDER).lower()

    if name in _PROVIDER_CACHE:
        return _PROVIDER_CACHE[name]

    if name == "openai":
        from providers.openai_provider import OpenAIProvider
        provider = OpenAIProvider()
    elif name == "anthropic":
        from providers.anthropic_provider import AnthropicProvider
        provider = AnthropicProvider()
    elif name == "deepseek":
        from providers.deepseek_provider import DeepSeekProvider
        provider = DeepSeekProvider()
    elif name == "kimi":
        from providers.kimi_provider import KimiProvider
        provider = KimiProvider()
    elif name == "nova":
        from providers.nova_provider import NovaProvider
        provider = NovaProvider()
    elif name == "google":
        from providers.google_provider import GoogleProvider
        provider = GoogleProvider()
    elif name == "omniroute":
        from providers.omniroute_provider import OmniRouteProvider
        provider = OmniRouteProvider()
    elif name == "local":
        from providers.local_provider import LocalProvider
        provider = LocalProvider()
    elif name == "ollama":
        from providers.ollama_provider import OllamaProvider
        provider = OllamaProvider()
    elif name == "demo":
        from providers.demo_provider import DemoProvider
        provider = DemoProvider()
    else:
        raise ValueError(f"Unknown provider: {name}")

    provider.name = name
    logger.info(f"🔌 Loaded provider: {name}")
    _PROVIDER_CACHE[name] = provider
    return provider


def _fallback_chain(preferred: str = None) -> list:
    """
    Builds the ordered list of provider names to try: the preferred/
    default provider first, then Config.PROVIDER_FALLBACK_ORDER
    (skipping duplicates), filtered down to providers we actually
    have credentials for.
    """
    preferred = (preferred or Config.DEFAULT_PROVIDER).lower()
    chain = [preferred] + [p for p in Config.PROVIDER_FALLBACK_ORDER if p != preferred]

    configured = [p for p in chain if is_configured(p)]
    skipped = [p for p in chain if p not in configured]
    if skipped:
        logger.info(f"⏭️  Skipping providers with no API key configured: {skipped}")

    return configured or chain  # if none are "configured", try anyway and let it fail loudly


def generate_with_fallback(prompt: str, system: str = None, preferred: str = None):
    """
    Tries providers in order until one succeeds. Returns
    (provider_instance, response_text). Raises the last error if every
    provider in the chain fails.
    """
    chain = _fallback_chain(preferred)
    last_error = None

    for name in chain:
        try:
            provider = get_provider(name)
            logger.info(f"⚡ Trying provider: {name}")
            activity_log.log("provider", f"trying {name}…")
            response = provider.generate(prompt, system=system)
            activity_log.log("provider", f"{name} responded")
            return provider, response
        except Exception as e:
            logger.warning(f"⚠️  Provider '{name}' failed: {e}")
            activity_log.log("provider", f"{name} failed: {e}")
            last_error = e
            continue

    activity_log.log("provider", f"all providers failed: {chain}")
    raise RuntimeError(f"All providers failed ({chain}). Last error: {last_error}")
