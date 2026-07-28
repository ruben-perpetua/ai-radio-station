"""
Configuration Layer
====================
Loads `config.toml` (project root) into a typed `AppConfig` dataclass.
This is the single source of truth for tunable settings — LLM provider,
topics, RSS feeds, RAG parameters, and audio settings. No secrets live
here: the OpenAI API key is read from the `OPENAI_API_KEY` environment
variable only (optionally loaded from a local `.env` file via
python-dotenv), so it never ends up committed to a config file.

Usage
-----
    from ai_radio.config import load_config
    config = load_config()
    print(config.llm.provider, config.topics.focus)
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "config.toml"
DEFAULT_ENV_PATH = Path(__file__).parent.parent / ".env"

# Load .env (if present) into os.environ before any config is read. Real
# environment variables (e.g. exported in the shell) always take precedence
# and are never overridden by .env.
load_dotenv(dotenv_path=DEFAULT_ENV_PATH, override=False)


@dataclass
class LLMConfig:
    provider: str = "ollama"          # "ollama" | "openai"
    model: str = "llama3.2:1b"
    temperature: float = 0.75
    api_key: Optional[str] = None     # populated from OPENAI_API_KEY, never from file


@dataclass
class TopicsConfig:
    focus: List[str] = field(
        default_factory=lambda: ["AI", "machine learning", "React", "JavaScript"]
    )


@dataclass
class FeedConfig:
    url: str
    source: str


@dataclass
class RagConfig:
    n_queries: int = 5
    n_results: int = 20
    chunk_size: int = 150
    overlap: int = 30
    max_chunks_per_article: int = 2
    articles_per_feed: int = 6


@dataclass
class AudioConfig:
    language: str = "en"
    tts_backend: str = "auto"


@dataclass
class AppConfig:
    llm: LLMConfig = field(default_factory=LLMConfig)
    topics: TopicsConfig = field(default_factory=TopicsConfig)
    feeds: List[FeedConfig] = field(default_factory=list)
    rag: RagConfig = field(default_factory=RagConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)


def load_config(path: Path | str = DEFAULT_CONFIG_PATH) -> AppConfig:
    """
    Load and validate `config.toml` into a typed `AppConfig`.

    If the file is missing, falls back to built-in defaults (with a
    printed warning) so the pipeline keeps working without configuration.
    The OpenAI API key is always sourced from the `OPENAI_API_KEY`
    environment variable, regardless of what (if anything) is in the file.
    """
    path = Path(path)
    if not path.exists():
        print(f"  \033[33m⚠\033[0m config.toml not found at {path} — using built-in defaults.")
        data = {}
    else:
        with open(path, "rb") as f:
            data = tomllib.load(f)

    llm_data = data.get("llm", {})
    llm = LLMConfig(
        provider=llm_data.get("provider", "ollama"),
        model=llm_data.get("model", "llama3.2:1b"),
        temperature=llm_data.get("temperature", 0.75),
        api_key=os.environ.get("OPENAI_API_KEY"),
    )

    topics = TopicsConfig(focus=data.get("topics", {}).get("focus", TopicsConfig().focus))

    feeds = [FeedConfig(url=f["url"], source=f["source"]) for f in data.get("feeds", [])]

    rag_data = data.get("rag", {})
    defaults = RagConfig()
    rag = RagConfig(
        n_queries=rag_data.get("n_queries", defaults.n_queries),
        n_results=rag_data.get("n_results", defaults.n_results),
        chunk_size=rag_data.get("chunk_size", defaults.chunk_size),
        overlap=rag_data.get("overlap", defaults.overlap),
        max_chunks_per_article=rag_data.get("max_chunks_per_article", defaults.max_chunks_per_article),
        articles_per_feed=rag_data.get("articles_per_feed", defaults.articles_per_feed),
    )

    audio_data = data.get("audio", {})
    audio = AudioConfig(
        language=audio_data.get("language", "en"),
        tts_backend=audio_data.get("tts_backend", "auto"),
    )

    if llm.provider == "openai" and not llm.api_key:
        print(
            "  \033[33m⚠\033[0m llm.provider is 'openai' but OPENAI_API_KEY is not set. "
            "Set it in your shell environment before running."
        )

    return AppConfig(llm=llm, topics=topics, feeds=feeds, rag=rag, audio=audio)
