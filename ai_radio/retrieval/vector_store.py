"""
Module 3: Vector Database
==========================
Store and search high-dimensional embeddings to enable efficient
semantic retrieval of information based on meaning, not keywords.

Uses ChromaDB — an open-source, in-process vector store that:
  • Persists data to disk (./chroma_data/)
  • Embeds documents automatically via sentence-transformers
  • Supports metadata filtering and cosine similarity search
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

# ── Constants ─────────────────────────────────────────────────────────────────

PERSIST_DIR = str(Path(__file__).parent.parent / "chroma_data")
COLLECTION_NAME = "tech_news"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"   # 384-dim, fast, ~90 MB download


class VectorStore:
    """
    Module 3 implementation: semantic vector store backed by ChromaDB.

    Documents (news articles) are embedded with a sentence-transformer
    model and stored with metadata. At query time, the same embedding
    model converts the query text to a vector and cosine-similarity
    search returns the most relevant documents.
    """

    def __init__(
        self,
        persist_dir: str = PERSIST_DIR,
        collection_name: str = COLLECTION_NAME,
    ):
        os.makedirs(persist_dir, exist_ok=True)

        self._client = chromadb.PersistentClient(path=persist_dir)
        self._embed_fn = SentenceTransformerEmbeddingFunction(
            model_name=EMBEDDING_MODEL
        )
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            embedding_function=self._embed_fn,
            metadata={"hnsw:space": "cosine"},
        )

    # ── Write ─────────────────────────────────────────────────────────────────

    def add_articles(self, articles: List[Dict[str, Any]]) -> int:
        """
        Embed and store a list of article dicts with chunking.

        Each article is split into overlapping word-based chunks so that
        long content is semantically searchable at a fine-grained level.
        Each chunk gets its own embedding vector in ChromaDB.

        Each dict must have at least: title, url, source.
        Optionally: full_content (preferred), summary (fallback).
        Returns the total number of newly indexed chunks.
        """
        if not articles:
            return 0

        existing_ids = set(self._collection.get()["ids"])

        docs, metas, ids = [], [], []
        for art in articles:
            base_id = _make_id(art["url"])

            # Skip if this article was already indexed (check first chunk)
            if f"{base_id}_c0" in existing_ids or base_id in existing_ids:
                continue

            # Use full article content when available, else fall back to summary
            content = art.get("full_content") or art.get("summary", "")
            full_text = f"{art['title']}. {content}"

            # Split into overlapping chunks (150 words, 30-word overlap)
            chunks = _chunk_text(full_text, chunk_size=150, overlap=30)

            for i, chunk in enumerate(chunks):
                chunk_id = f"{base_id}_c{i}"
                docs.append(chunk)
                metas.append({
                    "title": art["title"][:500],
                    "url": art["url"][:500],
                    "source": art.get("source", "unknown"),
                    "published": art.get("published", ""),
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                })
                ids.append(chunk_id)

        if docs:
            self._collection.add(documents=docs, metadatas=metas, ids=ids)

        return len(docs)

    # ── Read ──────────────────────────────────────────────────────────────────

    def search(self, query: str, n_results: int = 5) -> List[Dict[str, Any]]:
        """
        Semantic search: returns the top-n documents most similar to the query.

        Example
        -------
        results = store.search("open-source LLM fine-tuning", n_results=3)
        """
        total = self._collection.count()
        if total == 0:
            return []

        results = self._collection.query(
            query_texts=[query],
            n_results=min(n_results, total),
            include=["documents", "metadatas", "distances"],
        )

        output = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            output.append({
                "content": doc,
                "title": meta.get("title", ""),
                "url": meta.get("url", ""),
                "source": meta.get("source", ""),
                "published": meta.get("published", ""),
                "similarity": round(1 - dist, 4),   # cosine distance → similarity
            })
        return output

    # ── Stats ─────────────────────────────────────────────────────────────────

    def count(self) -> int:
        return self._collection.count()

    def get_stats(self) -> Dict[str, Any]:
        total = self._collection.count()
        if total == 0:
            return {"total_documents": 0}

        sample = self._collection.get(limit=total, include=["metadatas"])
        sources = [m.get("source", "unknown") for m in sample["metadatas"]]
        source_counts: Dict[str, int] = {}
        for s in sources:
            source_counts[s] = source_counts.get(s, 0) + 1

        return {
            "total_documents": total,
            "collection": COLLECTION_NAME,
            "embedding_model": EMBEDDING_MODEL,
            "sources": source_counts,
        }

    def reset(self) -> None:
        """Clear all documents — useful between demo runs."""
        self._client.delete_collection(COLLECTION_NAME)
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self._embed_fn,
            metadata={"hnsw:space": "cosine"},
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_id(url: str) -> str:
    """Deterministic short ID derived from the article URL."""
    import hashlib
    return hashlib.md5(url.encode()).hexdigest()[:16]


def _chunk_text(text: str, chunk_size: int = 150, overlap: int = 30) -> List[str]:
    """
    Split text into overlapping word-based chunks.

    Why word-based (not character-based)?
    Because the embedding model (all-MiniLM-L6-v2) has a 256-token limit.
    ~150 words stays comfortably within that limit.

    Why overlapping?
    A sentence split across two chunk boundaries would lose context.
    Overlap of 30 words ensures every idea is fully represented in at
    least one chunk.

    Example with chunk_size=5, overlap=2:
      text:    [A B C D E F G H]
      chunk 1: [A B C D E]
      chunk 2:       [D E F G H]
    """
    words = text.split()
    if len(words) <= chunk_size:
        return [text]   # short enough — no splitting needed

    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += chunk_size - overlap   # step forward by (chunk_size - overlap)

    return chunks
