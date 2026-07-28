"""
Personal AI Tech Radio — Main Pipeline
========================================
An AI-powered pipeline that automatically collects, summarises, and
vocalises the latest news in AI and React technologies, creating a
short audio broadcast — your daily "tech radio episode."

Demonstrates all 6 workshop modules end-to-end:
  Module 1 — Local LLMs       : Ollama inference (on-premises, no cloud)
  Module 2 — Fine-Tuning      : LoRA adapter training (run separately)
  Module 3 — Vector Database  : ChromaDB semantic store
  Module 4 — RAG              : Retrieval-Augmented Generation pipeline
  Module 5 — Agentic AI       : ReAct agent for autonomous news collection
  Module 6 — MCP              : Tool registry for agent-tool communication

Usage
-----
  python main.py                  # full pipeline (Ollama must be running)
  python main.py --mock           # demo mode (no Ollama required)
  python main.py --no-audio       # skip TTS (text script only)
  python main.py --reset-db       # clear vector store and re-index

Ollama quick-start
------------------
  brew install ollama
  ollama serve
  ollama pull llama3.2:1b         # ~800 MB, fast on CPU
"""

from __future__ import annotations

import argparse
import os
import sys
import textwrap
from datetime import datetime
from pathlib import Path

# ── Make sure we can import the ai_radio package regardless of cwd ────────────
sys.path.insert(0, str(Path(__file__).parent))

from ai_radio.config import load_config
from ai_radio.llm.factory import LLMClientFactory
from ai_radio.retrieval.vector_store import VectorStore
from ai_radio.retrieval.rag_engine import RAGEngine
from ai_radio.agents.radio_agent import RadioAgent
from ai_radio.agents.tool_registry import MCPRegistry
from ai_radio.audio.tts_engine import TTSEngine


# ── Visual helpers ────────────────────────────────────────────────────────────

W = 64

def banner(text: str) -> None:
    print(f"\n{'─' * W}")
    print(f"  {text}")
    print(f"{'─' * W}")

def section(module_num: str, title: str) -> None:
    print(f"\n\033[1;36m[{module_num}] {title}\033[0m")

def ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")

def warn(msg: str) -> None:
    print(f"  \033[33m⚠\033[0m {msg}")


# ── Argument parsing ──────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Personal AI Tech Radio POC")
    p.add_argument("--mock",     action="store_true", help="Force mock LLM (no Ollama needed)")
    p.add_argument("--no-audio", action="store_true", help="Skip TTS — output text only")
    p.add_argument("--reset-db", action="store_true", help="Clear the vector store before run")
    p.add_argument("--skip-fetch", action="store_true", help="Reuse the existing vector store — skip RSS fetch/scrape (fast iteration)")
    p.add_argument("--provider", choices=["ollama", "openai"], help="Override llm.provider from config.toml")
    p.add_argument("--model",    help="Override llm.model from config.toml")
    return p.parse_args()


# ── Main pipeline ─────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    config = load_config()

    if args.provider:
        config.llm.provider = args.provider
    if args.model:
        config.llm.model = args.model

    # ─────────────────────────────────────────────────────────────────────────
    print(f"\n{'=' * W}")
    print("  🎙   Personal AI Tech Radio  —  POC")
    print(f"{'=' * W}")
    print(f"  Workshop: All 6 modules demonstrated end-to-end")
    print(f"  Date    : {datetime.now().strftime('%B %d, %Y  %H:%M')}")
    print(f"{'=' * W}")

    # ─────────────────────────────────────────────────────────────────────────
    # Module 6 — MCP Tool Registry
    # ─────────────────────────────────────────────────────────────────────────
    section("Module 6", "MCP — Initialising Tool Registry")
    registry = MCPRegistry(server_name="ai-tech-radio")
    ok(f"MCPRegistry created: {registry}")

    # ─────────────────────────────────────────────────────────────────────────
    # Module 1 — LLM (multi-provider: Ollama or OpenAI, per config.toml)
    # ─────────────────────────────────────────────────────────────────────────
    section("Module 1", f"LLM ({config.llm.provider}) — Connecting")
    llm = LLMClientFactory.from_config(config.llm)
    if args.mock:
        llm._mock_mode = True
        warn("Mock mode forced via --mock flag.")
    else:
        llm.ensure_available()

    if not llm._mock_mode:
        models = llm.list_models()
        ok(f"{config.llm.provider} live  |  model: {config.llm.model}  |  installed: {models}")
    else:
        warn("Running in MOCK mode — script will use a canned template.")

    # ─────────────────────────────────────────────────────────────────────────
    # Module 3 — Vector Database
    # ─────────────────────────────────────────────────────────────────────────
    section("Module 3", "Vector Database — Initialising ChromaDB")
    vector_store = VectorStore(chunk_size=config.rag.chunk_size, overlap=config.rag.overlap)

    if args.reset_db:
        vector_store.reset()
        warn("Vector store cleared (--reset-db).")

    stats = vector_store.get_stats()
    ok(
        f"ChromaDB ready  |  collection: tech_news  |  "
        f"docs: {stats.get('total_documents', 0)}"
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Modules 5 + 6 — Agentic News Collection via MCP Tools
    # ─────────────────────────────────────────────────────────────────────────
    section("Modules 5 + 6", "Agentic AI — Launching ReAct News Collector")

    if args.skip_fetch and stats.get("total_documents", 0) > 0:
        warn("--skip-fetch: reusing existing vector store, RSS collection skipped.")
        articles: list = []
    else:
        if args.skip_fetch:
            warn("--skip-fetch requested but vector store is empty — fetching anyway.")
        print(
            "  The agent will autonomously decide which RSS feeds to query,\n"
            "  fetch articles, and index them — using MCP-registered tools."
        )
        print()

        agent = RadioAgent(
            registry=registry,
            vector_store=vector_store,
            llm=llm,
            feeds=[{"url": f.url, "source": f.source} for f in config.feeds] or None,
            max_articles_per_feed=config.rag.articles_per_feed,
        )
        articles = agent.collect_and_index_news()

        print()
        ok(f"Agent finished  |  {len(articles)} articles collected")
        mcp_stats = registry.get_stats()
        ok(
            f"MCP calls: {mcp_stats['total_calls']}  |  "
            f"success rate: {mcp_stats['success_rate']:.0%}  |  "
            f"avg latency: {mcp_stats['avg_duration_ms']:.0f} ms"
        )
        ok(f"Tools used: {mcp_stats['tools_used']}")

    final_stats = vector_store.get_stats()
    ok(
        f"Vector store: {final_stats['total_documents']} docs  |  "
        f"sources: {list(final_stats.get('sources', {}).keys())}"
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Modules 4 + 1 — RAG Pipeline → Script Generation
    # ─────────────────────────────────────────────────────────────────────────
    section("Modules 4 + 1", "RAG — Retrieving context → Generating radio script")
    rag = RAGEngine(
        llm=llm,
        vector_store=vector_store,
        topics=config.topics.focus,
        n_queries=config.rag.n_queries,
        n_results=config.rag.n_results,
        max_chunks_per_article=config.rag.max_chunks_per_article,
    )
    script = rag.generate_radio_script()

    # Save script to disk
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)
    script_path = output_dir / "script.txt"
    script_path.write_text(script, encoding="utf-8")
    ok(f"Script generated  |  {len(script)} chars  |  saved: {script_path}")

    # ─────────────────────────────────────────────────────────────────────────
    # Module 2 — Fine-Tuning (status / pointer)
    # ─────────────────────────────────────────────────────────────────────────
    section("Module 2", "Fine-Tuning — LoRA adapter status")
    adapter_path = Path(__file__).parent / "output" / "finetuned_model"
    if adapter_path.exists():
        ok(f"Trained LoRA adapter found at: {adapter_path}")
    else:
        warn(
            "No trained adapter yet.\n"
            "     Run the fine-tuning demo separately:\n"
            "       python -m ai_radio.training.fine_tuning\n"
            "     This fine-tunes DistilGPT-2 on 15 radio-style examples\n"
            "     using LoRA (< 1% trainable params) — takes ~30s on CPU."
        )

    # ─────────────────────────────────────────────────────────────────────────
    # TTS — Convert script to audio
    # ─────────────────────────────────────────────────────────────────────────
    if not args.no_audio:
        section("TTS", "Text-to-Speech — Converting script to audio")
        tts = TTSEngine()
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        audio_path = tts.synthesize(script, filename=f"radio_episode_{stamp}")
        ok(f"Audio saved: {audio_path}")

        # Auto-play on macOS
        if sys.platform == "darwin" and audio_path.endswith((".mp3", ".aiff", ".wav")):
            import subprocess
            print(f"  Playing audio...")
            subprocess.Popen(["afplay", audio_path])
    else:
        warn("TTS skipped (--no-audio).")

    # ─────────────────────────────────────────────────────────────────────────
    # Summary
    # ─────────────────────────────────────────────────────────────────────────
    print(f"\n{'=' * W}")
    print("  ✅  Radio episode generated successfully!")
    print(f"{'=' * W}")
    print(f"  Script  : output/script.txt")
    if not args.no_audio:
        print(f"  Audio   : output/radio_episode_*.mp3")
    print()
    print("  Modules demonstrated:")
    print(f"    ✓ Module 1 — LLM ({config.llm.provider} — {config.llm.model})")
    print("    ✓ Module 2 — Fine-Tuning (LoRA config ready, run ai_radio.training.fine_tuning)")
    print("    ✓ Module 3 — Vector Database (ChromaDB semantic store)")
    print("    ✓ Module 4 — RAG (retrieval-augmented script generation)")
    print("    ✓ Module 5 — Agentic AI (ReAct news collection agent)")
    print("    ✓ Module 6 — MCP (tool registry + agent-tool protocol)")
    print(f"{'=' * W}\n")

    # ─────────────────────────────────────────────────────────────────────────
    # Print script preview
    # ─────────────────────────────────────────────────────────────────────────
    banner("GENERATED RADIO SCRIPT")
    wrapped = textwrap.fill(script, width=W - 2, initial_indent="  ", subsequent_indent="  ")
    print(wrapped)
    print(f"{'─' * W}\n")


if __name__ == "__main__":
    main()
