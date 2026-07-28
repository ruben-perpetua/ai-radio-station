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
        chunk_size: int = 150,
        overlap: int = 30,
    ):
        os.makedirs(persist_dir, exist_ok=True)

        self.chunk_size = chunk_size
        self.overlap = overlap

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
        seen_in_batch = set()   # guards against the same URL appearing twice in one batch

        docs, metas, ids = [], [], []
        for art in articles:
            base_id = _make_id(art["url"])

            # Skip if this article was already indexed (check first chunk),
            # or if it's a duplicate URL within this same batch.
            if f"{base_id}_c0" in existing_ids or base_id in existing_ids:
                continue
            if base_id in seen_in_batch:
                continue
            seen_in_batch.add(base_id)

            # Use full article content when available, else fall back to summary
            content = art.get("full_content") or art.get("summary", "")
            full_text = f"{art['title']}. {content}"

            # Split into overlapping chunks, breaking at sentence boundaries
            chunks = _chunk_text(full_text, chunk_size=self.chunk_size, overlap=self.overlap)

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
    Split text into overlapping chunks, preferring sentence boundaries.

    Why sentence-aware (not just word-count)?
    A plain word-count split can cut a sentence in half across two chunks,
    which hurts embedding quality. This accumulates whole sentences (via
    nltk's `sent_tokenize`) until the word budget is hit, then starts a
    new chunk carrying `overlap` words forward for context continuity.
    Falls back to plain word-count chunking if nltk is unavailable.

    Why overlapping?
    An idea split across two chunk boundaries would lose context — overlap
    ensures every idea is fully represented in at least one chunk.
    """
    words = text.split()
    if len(words) <= chunk_size:
        return [text]   # short enough — no splitting needed

    sentences = _sentence_split(text)
    if not sentences:
        return _chunk_words(words, chunk_size, overlap)

    chunks: List[str] = []
    current: List[str] = []

    for sentence in sentences:
        sent_words = sentence.split()
        if current and len(current) + len(sent_words) > chunk_size:
            chunks.append(" ".join(current))
            current = current[-overlap:] if overlap else []
        current.extend(sent_words)

    if current:
        chunks.append(" ".join(current))

    return chunks if chunks else [text]


def _sentence_split(text: str) -> Optional[List[str]]:
    """Attempts sentence tokenization via nltk; downloads data on first use."""
    try:
        import nltk
        try:
            return nltk.sent_tokenize(text)
        except LookupError:
            nltk.download("punkt_tab", quiet=True)
            return nltk.sent_tokenize(text)
    except Exception:
        return None


def _chunk_words(words: List[str], chunk_size: int, overlap: int) -> List[str]:
    """Fallback: plain word-count chunking (used if nltk is unavailable).

    Example with chunk_size=5, overlap=2:
      text:    [A B C D E F G H]
      chunk 1: [A B C D E]
      chunk 2:       [D E F G H]
    """
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += chunk_size - overlap   # step forward by (chunk_size - overlap)

    return chunks
