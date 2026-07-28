"""
LLM Client Factory
===================
Picks the correct provider client based on `AppConfig.llm`. This is the
single place that knows about all providers — everything else in the
pipeline depends on the `LLMClient` interface, not a concrete class.
"""

from __future__ import annotations

from ..config import LLMConfig
from .base import LLMClient
from .ollama_client import OllamaClient
from .openai_client import OpenAIClient


class LLMClientFactory:
    @staticmethod
    def from_config(cfg: LLMConfig) -> LLMClient:
        if cfg.provider == "openai":
            return OpenAIClient(model=cfg.model, api_key=cfg.api_key)
        if cfg.provider == "ollama":
            return OllamaClient(model=cfg.model)
        raise ValueError(f"Unknown LLM provider: {cfg.provider!r} (expected 'ollama' or 'openai')")
