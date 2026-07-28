"""
Module 1: Multi-Provider LLM — OpenAI Provider
=================================================
Same interface as OllamaClient (`generate()`, `chat()`), backed by the
official `openai` Python library. Enables swapping to a remote GPT model
by changing `provider = "openai"` in `config.toml` — no other code changes.

The API key is NEVER read from `config.toml`. Set it via the
`OPENAI_API_KEY` environment variable before running:

    export OPENAI_API_KEY="sk-..."
"""

from __future__ import annotations

import time
from typing import List, Optional

from .base import LLMClient, MOCK_SCRIPT

DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIClient(LLMClient):
    """Thin wrapper around the OpenAI Chat Completions API."""

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_key: Optional[str] = None,
    ):
        self.model = model
        self.api_key = api_key
        self._mock_mode = False
        self._client = None   # lazily constructed — avoids import cost when unused

    # ── Health ────────────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """Returns True if an API key is configured and the `openai` package is installed."""
        if not self.api_key:
            return False
        try:
            import openai  # noqa: F401
            return True
        except ImportError:
            return False

    def ensure_available(self) -> "OpenAIClient":
        if not self.api_key:
            print(
                "  ⚠  OPENAI_API_KEY not set — running in MOCK MODE.\n"
                "     To enable real inference:\n"
                "       export OPENAI_API_KEY=\"sk-...\""
            )
            self._mock_mode = True
        elif not self.is_available():
            print(
                "  ⚠  `openai` package not installed — running in MOCK MODE.\n"
                "     To enable real inference:\n"
                "       pip install openai"
            )
            self._mock_mode = True
        return self

    def list_models(self) -> List[str]:
        return [self.model]

    # ── Inference ─────────────────────────────────────────────────────────────

    def _get_client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(api_key=self.api_key)
        return self._client

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """Single-turn text generation, implemented via the chat endpoint."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return self.chat(messages, temperature=temperature)

    def chat(
        self,
        messages: List[dict],
        temperature: float = 0.7,
    ) -> str:
        """Multi-turn chat completion."""
        if self._mock_mode:
            time.sleep(0.3)
            return MOCK_SCRIPT

        client = self._get_client()
        resp = client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
        )
        return resp.choices[0].message.content.strip()
