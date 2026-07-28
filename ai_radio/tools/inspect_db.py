"""
DB Inspector
=============
CLI tool for inspecting the ChromaDB vector store — total chunks, chunks
per article, source breakdown, and live semantic search.

Usage
-----
    python -m ai_radio.tools.inspect_db
    python -m ai_radio.tools.inspect_db --search "React hooks"
    python -m ai_radio.tools.inspect_db --clear
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from ai_radio.config import load_config
from ai_radio.retrieval.vector_store import VectorStore


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Inspect the AI Tech Radio vector store")
    p.add_argument("--search", metavar="QUERY", help="Run a live semantic search and print top 5 results")
    p.add_argument("--clear", action="store_true", help="Reset the vector store (deletes all documents)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config()
    store = VectorStore(chunk_size=config.rag.chunk_size, overlap=config.rag.overlap)

    if args.clear:
        store.reset()
        print("✓ Vector store cleared.")
        return

    if args.search:
        results = store.search(args.search, n_results=5)
        if not results:
            print("No results — the vector store is empty or has no matches.")
            return
        print(f"Top {len(results)} results for: {args.search!r}\n")
        for i, doc in enumerate(results, 1):
            print(f"[{i}] similarity={doc['similarity']:.3f}  source={doc['source']}")
            print(f"    title  : {doc['title'][:80]}")
            print(f"    url    : {doc['url']}")
            print(f"    content: {doc['content'][:150]}...")
            print()
        return

    # ── Default: summary stats ──────────────────────────────────────────────
    stats = store.get_stats()
    total = stats.get("total_documents", 0)
    print(f"Total chunks   : {total}")

    if total == 0:
        print("Vector store is empty. Run `python main.py` to populate it.")
        return

    print(f"Collection     : {stats.get('collection')}")
    print(f"Embedding model: {stats.get('embedding_model')}")

    sample = store._collection.get(limit=total, include=["metadatas"])
    per_article = Counter(m.get("url", "unknown") for m in sample["metadatas"])
    titles = {m.get("url"): m.get("title", "") for m in sample["metadatas"]}

    print(f"\nSources breakdown:")
    for source, count in sorted(stats.get("sources", {}).items(), key=lambda kv: -kv[1]):
        print(f"  {source:<20} {count} chunks")

    print(f"\nChunks per article ({len(per_article)} articles):")
    for url, count in sorted(per_article.items(), key=lambda kv: -kv[1])[:10]:
        title = titles.get(url, "")[:60]
        print(f"  {count:>2}  {title}")


if __name__ == "__main__":
    main()
