"""
Module 5: Agentic AI
=====================
Orchestrate autonomous, goal-driven AI agents that collaborate,
make decisions, and execute complex workflows end-to-end.

This module implements a RadioAgent that follows the ReAct pattern
(Reason → Act → Observe → Repeat).  The agent is given a high-level
goal and autonomously decides which MCP tools to call, in what order,
to accomplish it.

ReAct loop (simplified)
------------------------
  THOUGHT : "I need news from HuggingFace."
  ACTION  : fetch_rss_feed(url=...)
  OBSERVE : 10 articles returned
  THOUGHT : "I should also get React news."
  ACTION  : fetch_rss_feed(url=...)
  OBSERVE : 8 articles returned
  THOUGHT : "All feeds fetched — indexing now."
  ACTION  : store_articles(articles=[...])
  OBSERVE : 18 articles indexed
  FINAL   : Goal achieved.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

import feedparser

from .m6_mcp_registry import MCPRegistry
from .m3_vector_store import VectorStore

# ── RSS sources ───────────────────────────────────────────────────────────────

RSS_FEEDS: List[Dict[str, str]] = [
    {"url": "https://huggingface.co/blog/feed.xml",            "source": "HuggingFace"},
    {"url": "https://dev.to/feed/tag/machinelearning",         "source": "Dev.to/ML"},
    {"url": "https://dev.to/feed/tag/ai",                     "source": "Dev.to/AI"},
    {"url": "https://dev.to/feed/tag/react",                  "source": "Dev.to/React"},
    {"url": "https://feeds.feedburner.com/TheHackersNews",     "source": "HackersNews"},
    {"url": "https://www.artificialintelligence-news.com/feed/","source": "AI-News"},
]

MAX_ARTICLES_PER_FEED = 6


class RadioAgent:
    """
    Module 5: Goal-driven agent for news collection and indexing.

    The agent registers its capabilities as MCP tools (Module 6),
    then executes a ReAct-style reasoning loop to accomplish the goal
    "Collect the latest AI and React news and index it for retrieval."

    If an LLM client is provided, the agent uses it to reason about
    which feeds to prioritise and whether the collected data is sufficient.
    When no LLM is available it falls back to a deterministic execution
    plan — the pipeline still demonstrates all architectural layers.
    """

    def __init__(
        self,
        registry: MCPRegistry,
        vector_store: VectorStore,
        llm=None,   # Optional[LocalLLMClient]
    ):
        self.registry = registry
        self.vector_store = vector_store
        self.llm = llm
        self._reasoning_trace: List[str] = []
        self._register_tools()

    # ── MCP tool registration (Module 6 integration) ──────────────────────────

    def _register_tools(self) -> None:
        """Register every agent capability as a discoverable MCP tool."""

        @self.registry.tool(
            name="fetch_rss_feed",
            description="Fetch the latest articles from an RSS/Atom feed URL.",
            parameters={
                "url": {"type": "string", "description": "RSS feed URL"},
                "source": {"type": "string", "description": "Human-readable source name"},
                "max_items": {"type": "integer", "description": "Max articles to return", "default": 6},
            },
            returns="List[Article]  — each has title, summary, url, published, source",
            tags=["news", "collection"],
        )
        def fetch_rss_feed(url: str, source: str = "unknown", max_items: int = MAX_ARTICLES_PER_FEED):
            return _fetch_rss(url, source, max_items)

        @self.registry.tool(
            name="store_articles",
            description="Embed and persist articles into the vector store.",
            parameters={
                "articles": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "List of article dicts returned by fetch_rss_feed",
                }
            },
            returns="int  — number of newly indexed documents",
            tags=["indexing", "vector-store"],
        )
        def store_articles(articles: list) -> int:
            return self.vector_store.add_articles(articles)

        @self.registry.tool(
            name="search_knowledge",
            description="Semantic search over the indexed article collection.",
            parameters={
                "query": {"type": "string"},
                "n_results": {"type": "integer", "default": 5},
            },
            returns="List[Document]",
            tags=["retrieval"],
        )
        def search_knowledge(query: str, n_results: int = 5):
            return self.vector_store.search(query, n_results)

        @self.registry.tool(
            name="get_collection_stats",
            description="Returns statistics about the current knowledge base.",
            parameters={},
            returns="Dict with total_documents, sources breakdown",
            tags=["observability"],
        )
        def get_collection_stats():
            return self.vector_store.get_stats()

    # ── Agent entry point ─────────────────────────────────────────────────────

    def collect_and_index_news(self) -> List[Dict[str, Any]]:
        """
        Main agent method.

        Runs the ReAct loop to collect, evaluate, and index tech news.
        Returns the list of all collected articles.
        """
        self._think("Goal: Collect the latest AI and React news and index for retrieval.")
        self._think(f"Available tools: {[s.name for s in self.registry.list_tools()]}")

        all_articles: List[Dict[str, Any]] = []

        # ── Phase 1: Collect from all feeds ───────────────────────────────────
        self._think("Phase 1 — Iterating through RSS feeds.")
        for feed in RSS_FEEDS:
            self._think(f"Fetching feed: {feed['source']} ({feed['url']})")
            try:
                articles = self.registry.execute(
                    "fetch_rss_feed",
                    url=feed["url"],
                    source=feed["source"],
                )
                self._observe(f"{feed['source']}: {len(articles)} articles fetched.")
                all_articles.extend(articles)
                time.sleep(0.2)   # polite delay
            except Exception as exc:
                self._observe(f"{feed['source']}: FAILED — {exc}")

        self._think(f"Total articles collected: {len(all_articles)}")

        # ── Phase 2: Evaluate sufficiency (LLM reasoning if available) ────────
        if self.llm and not self.llm._mock_mode and len(all_articles) > 0:
            self._think("Asking LLM whether the collected corpus is sufficient...")
            decision = self._llm_decide(all_articles)
            self._observe(f"LLM decision: {decision}")

        # ── Phase 3: Index into vector store ──────────────────────────────────
        if all_articles:
            self._think("Phase 3 — Indexing articles into the vector store.")
            n_new = self.registry.execute("store_articles", articles=all_articles)
            self._observe(f"Indexed {n_new} new articles.")
        else:
            self._observe("No articles to index — check network connectivity.")

        # ── Phase 4: Verify ───────────────────────────────────────────────────
        stats = self.registry.execute("get_collection_stats")
        self._observe(f"Knowledge base now contains {stats.get('total_documents', 0)} documents.")
        self._think("Goal achieved — knowledge base ready for RAG retrieval.")

        return all_articles

    # ── Reasoning utilities ───────────────────────────────────────────────────

    def _think(self, thought: str) -> None:
        msg = f"  [THOUGHT] {thought}"
        self._reasoning_trace.append(msg)
        print(msg)

    def _observe(self, observation: str) -> None:
        msg = f"  [OBSERVE] {observation}"
        self._reasoning_trace.append(msg)
        print(msg)

    def _llm_decide(self, articles: List[Dict]) -> str:
        """Ask the LLM whether we have enough variety in the corpus."""
        sources = list({a["source"] for a in articles})
        prompt = (
            f"You are evaluating an AI news corpus for a tech radio show.\n"
            f"Collected articles: {len(articles)}\n"
            f"Sources: {', '.join(sources)}\n\n"
            f"In ONE sentence, is this corpus diverse enough for a 2-minute radio segment? "
            f"Reply 'SUFFICIENT' or 'NEED_MORE' and briefly explain why."
        )
        try:
            return self.llm.generate(prompt, temperature=0.3, max_tokens=60)
        except Exception:
            return "SUFFICIENT (LLM unavailable for evaluation)"

    def get_trace(self) -> List[str]:
        return list(self._reasoning_trace)


# ── RSS helpers ───────────────────────────────────────────────────────────────

def _fetch_rss(url: str, source: str, max_items: int) -> List[Dict[str, Any]]:
    """
    Parses an RSS/Atom feed and returns normalised article dicts.
    Gracefully handles feeds with missing fields.
    """
    feed = feedparser.parse(url)
    articles = []
    for entry in feed.entries[:max_items]:
        summary = getattr(entry, "summary", "") or ""
        # Strip HTML tags from summary
        summary = re.sub(r"<[^>]+>", " ", summary).strip()
        summary = re.sub(r"\s+", " ", summary)[:400]

        articles.append({
            "title": getattr(entry, "title", "No title"),
            "summary": summary,
            "url": getattr(entry, "link", url),
            "published": getattr(entry, "published", ""),
            "source": source,
        })
    return articles
