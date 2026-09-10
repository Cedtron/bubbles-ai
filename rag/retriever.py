"""
Retrieves the most relevant indexed chunks for a query, using cosine
similarity over the embeddings produced by Indexer.
"""

import math

from rag.embeddings import get_embedding
from utils.logger import get_logger

logger = get_logger(__name__)


def _cosine_similarity(a: list, b: list) -> float:
    if not a or not b:
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot / (norm_a * norm_b)


class Retriever:
    def __init__(self, indexer):
        """
        `indexer` is a rag.indexer.Indexer instance (already populated).
        """
        self.indexer = indexer

    def query(self, text: str, top_k: int = 5) -> list:
        if not self.indexer.entries:
            logger.warning("Retriever queried against an empty index")
            return []

        query_embedding = get_embedding(text)

        scored = [
            (_cosine_similarity(query_embedding, entry["embedding"]), entry)
            for entry in self.indexer.entries
        ]
        scored.sort(key=lambda pair: pair[0], reverse=True)

        return [
            {"text": entry["text"], "source": entry["source"], "score": score}
            for score, entry in scored[:top_k]
        ]
