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

from ..llm.client import LocalLLMClient
from .vector_store import VectorStore

# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an enthusiastic tech radio host for "AI Tech Radio."
Your job is to write engaging, concise radio scripts based on real news articles.
Rules:
- Sound conversational and energetic — you're on air!
- Cover both AI/ML and React/front-end news
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

QUERY_EXPANSION_PROMPT = """Generate 3 search queries (one per line, no numbering) to retrieve
relevant news articles for a tech radio show focused on AI and React development.
Keep each query under 10 words. Output only the queries."""


class RAGEngine:
    """
    Module 4: Retrieval-Augmented Generation engine.

    Retrieves semantically relevant articles from the vector store,
    assembles them into an augmented context window, and calls the
    local LLM to generate a grounded radio script.
    """

    def __init__(
        self,
        llm: LocalLLMClient,
        vector_store: VectorStore,
        n_results: int = 6,
    ):
        self.llm = llm
        self.vector_store = vector_store
        self.n_results = n_results

    # ── Public API ────────────────────────────────────────────────────────────

    def generate_radio_script(
        self,
        base_query: str = "latest AI machine learning React JavaScript news",
    ) -> str:
        """
        Full RAG pipeline: retrieve → augment → generate.

        Returns a radio-ready script string.
        """
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

        print("  > Step 4/4 — Generating script via Local LLM")
        prompt = SCRIPT_TEMPLATE.format(
            context=context,
            date=datetime.now().strftime("%B %d, %Y"),
        )
        script = self.llm.generate(prompt, system=SYSTEM_PROMPT, temperature=0.75)
        return script

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _expand_query(self, base_query: str) -> List[str]:
        """
        Query expansion: ask the LLM for related search terms to improve recall.
        Falls back to a fixed list when the LLM is in mock mode.
        """
        if self.llm._mock_mode:
            return [
                base_query,
                "large language models open-source fine-tuning",
                "React server components Next.js 2024",
            ]
        try:
            raw = self.llm.generate(
                QUERY_EXPANSION_PROMPT,
                temperature=0.3,
                max_tokens=80,
            )
            queries = [line.strip() for line in raw.splitlines() if line.strip()]
            return [base_query] + queries[:2]   # base + 2 expansions
        except Exception:
            return [base_query]

    def _retrieve(self, queries: List[str]) -> List[Dict]:
        """
        Multi-query retrieval: run each query and de-duplicate by URL.
        """
        seen_urls: set = set()
        results: List[Dict] = []
        for query in queries:
            for doc in self.vector_store.search(query, n_results=self.n_results):
                if doc["url"] not in seen_urls:
                    seen_urls.add(doc["url"])
                    results.append(doc)
        # Sort by similarity score descending and cap at n_results * 2
        results.sort(key=lambda d: d["similarity"], reverse=True)
        return results[: self.n_results * 2]

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
