"""
Builds a simple in-memory vector index over a set of text chunks.
No external vector DB required - fine for small/medium codebases or
docs. Swap for FAISS/Chroma/pgvector if you need to scale this up.
"""

import os
import json

from rag.embeddings import get_embeddings
from utils.logger import get_logger

logger = get_logger(__name__)


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list:
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return [c for c in chunks if c.strip()]


class Indexer:
    def __init__(self):
        self.entries = []  # list of {"text": ..., "source": ..., "embedding": [...]}

    def index_text(self, text: str, source: str = "unknown"):
        chunks = chunk_text(text)
        if not chunks:
            return

        embeddings = get_embeddings(chunks)
        for chunk, embedding in zip(chunks, embeddings):
            self.entries.append({"text": chunk, "source": source, "embedding": embedding})

        logger.info(f"📚 Indexed {len(chunks)} chunks from {source}")

    def index_directory(self, path: str, extensions=(".py", ".md", ".txt")):
        for root, _, files in os.walk(path):
            for name in files:
                if name.endswith(extensions):
                    full_path = os.path.join(root, name)
                    try:
                        with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                            self.index_text(f.read(), source=full_path)
                    except OSError as e:
                        logger.warning(f"Skipping {full_path}: {e}")

    def save(self, path: str):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.entries, f)
        logger.info(f"💾 Saved index ({len(self.entries)} entries) to {path}")

    def load(self, path: str):
        with open(path, "r", encoding="utf-8") as f:
            self.entries = json.load(f)
        logger.info(f"📂 Loaded index ({len(self.entries)} entries) from {path}")
