"""
Embedding generation, used by the indexer/retriever.

Uses OpenAI's embeddings API by default. Swap get_embedding's
implementation if you want a local/offline embedding model instead.
"""

from openai import OpenAI
from config import Config

client = OpenAI(api_key=Config.OPENAI_API_KEY)

EMBEDDING_MODEL = "text-embedding-3-small"


def get_embedding(text: str) -> list:
    text = text.replace("\n", " ").strip()
    if not text:
        return []

    response = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding


def get_embeddings(texts: list) -> list:
    """
    Batched version - cheaper than calling get_embedding in a loop.
    """
    cleaned = [t.replace("\n", " ").strip() for t in texts]
    non_empty = [t for t in cleaned if t]
    if not non_empty:
        return [[] for _ in texts]

    response = client.embeddings.create(model=EMBEDDING_MODEL, input=non_empty)
    return [item.embedding for item in response.data]
