"""
Module 4: RAG — Retrieval-Augmented Generation
================================================
Combine information retrieval with language generation to produce
grounded, context-aware AI responses.

RAG pipeline
------------
  1. Query expansion   — enrich the user query for better recall
  2. Retrieval         — semantic search in the vector store (Module 3)
  3. Context assembly  — rank and format retrieved snippets
  4. Augmented prompt  — inject context into the LLM prompt
  5. Generation        — call the local LLM (Module 1) with the prompt
  6. Post-processing   — clean up the output for radio delivery

Why RAG?
--------
Grounding the LLM on actual retrieved articles prevents hallucination
and ensures the radio script reflects real, up-to-date news rather
than stale training-data knowledge.
"""

from __future__ import annotations

import textwrap
from datetime import datetime
from typing import Dict, List, Optional

from ..llm.base import LLMClient
from .vector_store import VectorStore

# ── Prompts ───────────────────────────────────────────────────────────────────

DEFAULT_TOPICS = ["AI", "machine learning", "React", "JavaScript"]

SYSTEM_PROMPT_TEMPLATE = """You are an enthusiastic tech radio host for "AI Tech Radio."
Your job is to write engaging, concise radio scripts based on real news articles.
Rules:
- Sound conversational and energetic — you're on air!
- Cover news from these topics: {topics}
- Keep it under 2 minutes of speaking time (~300 words)
- Begin with a catchy opening and end with a sign-off
- Do NOT fabricate news — only use information from the provided articles
- Reference sources naturally: "According to HuggingFace..." or "Dev.to reports..."
"""

SCRIPT_TEMPLATE = """You have been given the following real news articles retrieved from the web.
Use ONLY these articles as your source material.

=== RETRIEVED ARTICLES ===
{context}
=== END ARTICLES ===

Today's date: {date}

Write the radio script now. Start directly with the script — no preamble:"""

QUERY_EXPANSION_TEMPLATE = """Generate {n} search queries (one per line, no numbering) to retrieve
relevant news articles for a tech radio show focused on: {topics}.
Keep each query under 10 words. Output only the queries."""


class RAGEngine:
    """
    Module 4: Retrieval-Augmented Generation engine.

    Retrieves semantically relevant articles from the vector store,
    assembles them into an augmented context window, and calls the
    LLM to generate a grounded radio script. Topics, query count,
    result count, and per-article diversity are all configurable
    (see `config.toml` → `[topics]` / `[rag]`).
    """

    def __init__(
        self,
        llm: LLMClient,
        vector_store: VectorStore,
        topics: Optional[List[str]] = None,
        n_queries: int = 3,
        n_results: int = 12,
        max_chunks_per_article: int = 2,
    ):
        self.llm = llm
        self.vector_store = vector_store
        self.topics = topics or DEFAULT_TOPICS
        self.n_queries = max(1, n_queries)
        self.n_results = n_results
        self.max_chunks_per_article = max_chunks_per_article

    # ── Public API ────────────────────────────────────────────────────────────

    def generate_radio_script(
        self,
        base_query: Optional[str] = None,
    ) -> str:
        """
        Full RAG pipeline: retrieve → augment → generate.

        `base_query` defaults to a query built from the configured topics.
        Returns a radio-ready script string.
        """
        if base_query is None:
            base_query = "latest " + " ".join(self.topics) + " news"

        print("  > Step 1/4 — Query expansion")
        queries = self._expand_query(base_query)
        print(f"    Queries: {queries}")

        print("  > Step 2/4 — Semantic retrieval from vector store")
        docs = self._retrieve(queries)
        if not docs:
            print("    ⚠  No documents in vector store — using base query only.")
            docs = self.vector_store.search(base_query, n_results=self.n_results)

        print(f"    Retrieved {len(docs)} relevant articles")
        for doc in docs[:3]:
            print(f"    • [{doc['similarity']:.2f}] {doc['title'][:70]}...")

        print("  > Step 3/4 — Assembling augmented context")
        context = self._build_context(docs)

        print("  > Step 4/4 — Generating script via LLM")
        prompt = SCRIPT_TEMPLATE.format(
            context=context,
            date=datetime.now().strftime("%B %d, %Y"),
        )
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(topics=", ".join(self.topics))
        script = self.llm.generate(prompt, system=system_prompt, temperature=0.75)
        return script

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _expand_query(self, base_query: str) -> List[str]:
        """
        Query expansion: ask the LLM for related search terms to improve recall.
        Falls back to a fixed list (derived from configured topics) in mock mode.
        """
        if self.llm._mock_mode:
            fallback = [base_query]
            fallback += [f"latest {topic} news" for topic in self.topics]
            return fallback[: self.n_queries]
        try:
            raw = self.llm.generate(
                QUERY_EXPANSION_TEMPLATE.format(
                    n=self.n_queries - 1,
                    topics=", ".join(self.topics),
                ),
                temperature=0.3,
                max_tokens=120,
            )
            queries = [line.strip() for line in raw.splitlines() if line.strip()]
            return [base_query] + queries[: self.n_queries - 1]   # base + expansions
        except Exception:
            return [base_query]

    def _retrieve(self, queries: List[str]) -> List[Dict]:
        """
        Multi-query retrieval with per-article diversity capping.

        Runs each expanded query, de-duplicates identical chunks across
        queries, and caps how many chunks from any single article URL can
        appear in the results (`max_chunks_per_article`) — this prevents
        one long article from dominating the LLM context window.
        """
        seen_chunks: set = set()
        per_article_count: Dict[str, int] = {}
        results: List[Dict] = []

        for query in queries:
            for doc in self.vector_store.search(query, n_results=self.n_results):
                key = (doc["url"], doc["content"])
                if key in seen_chunks:
                    continue
                if per_article_count.get(doc["url"], 0) >= self.max_chunks_per_article:
                    continue
                seen_chunks.add(key)
                per_article_count[doc["url"]] = per_article_count.get(doc["url"], 0) + 1
                results.append(doc)

        results.sort(key=lambda d: d["similarity"], reverse=True)
        return results[: self.n_results]

    def _build_context(self, docs: List[Dict]) -> str:
        """
        Format retrieved documents into a structured context block.
        Each doc is truncated to keep the prompt within context limits.
        """
        blocks = []
        for i, doc in enumerate(docs, 1):
            content = textwrap.shorten(doc["content"], width=300, placeholder="...")
            block = (
                f"[Article {i}]\n"
                f"Title  : {doc['title']}\n"
                f"Source : {doc['source']}\n"
                f"Content: {content}"
            )
            blocks.append(block)
        return "\n\n".join(blocks)
