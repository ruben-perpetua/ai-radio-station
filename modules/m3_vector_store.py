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
        Embed and store a list of article dicts.

        Each dict must have at least: title, summary, url, source.
        Returns the number of newly added articles.
        """
        if not articles:
            return 0

        # Deduplicate against existing IDs
        existing_ids = set(self._collection.get()["ids"])

        docs, metas, ids = [], [], []
        for art in articles:
            art_id = _make_id(art["url"])
            if art_id in existing_ids:
                continue
            docs.append(f"{art['title']}. {art.get('summary', '')}")
            metas.append({
                "title": art["title"][:500],
                "url": art["url"][:500],
                "source": art.get("source", "unknown"),
                "published": art.get("published", ""),
            })
            ids.append(art_id)

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
