"""
Redis-backed cache - drop-in alternative to InMemoryCache for when
the agent runs as a longer-lived service or across multiple processes.
"""

import json

from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

try:
    import redis
    _HAS_REDIS = True
except ImportError:
    _HAS_REDIS = False
    logger.warning("redis package not installed - RedisCache will raise if used")


class RedisCache:
    def __init__(self, url: str = None, ttl_seconds: int = None):
        if not _HAS_REDIS:
            raise ImportError("redis package is required for RedisCache (pip install redis)")

        self.ttl_seconds = ttl_seconds or Config.CACHE_TTL_SECONDS
        self.client = redis.Redis.from_url(url or Config.REDIS_URL, decode_responses=True)

    def get(self, key: str):
        raw = self.client.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw

    def set(self, key: str, value, ttl_seconds: int = None):
        ttl = ttl_seconds if ttl_seconds is not None else self.ttl_seconds
        payload = value if isinstance(value, str) else json.dumps(value)
        self.client.set(key, payload, ex=ttl)

    def clear(self):
        self.client.flushdb()
