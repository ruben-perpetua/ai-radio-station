"""
LLM Provider Interface
=======================
Shared interface implemented by every provider client (Ollama, OpenAI, ...).
Keeping a common interface lets the rest of the pipeline (RAGEngine,
RadioAgent) depend on `LLMClient` rather than a concrete provider, so
switching providers is just a config change (see `factory.py`).

Mock mode
---------
Every client exposes a `_mock_mode` flag. When a provider is unreachable
(or mock mode is forced via `--mock`), `generate()`/`chat()` return a
canned script so the rest of the pipeline can still run end-to-end offline.
"""

from __future__ import annotations

from typing import List, Optional

MOCK_SCRIPT = """
Welcome to AI Tech Radio — your daily briefing on artificial intelligence
and front-end development, powered entirely by local AI running on your machine!

Today's headline: the open-source community continues to push the boundaries
of what's possible with small language models. Researchers have demonstrated
that carefully fine-tuned 1-billion-parameter models can match the reasoning
quality of much larger counterparts on domain-specific tasks.

On the React side, the ecosystem is embracing server components at a rapid
pace. Developers are reporting up to 40% reductions in bundle sizes after
migrating to the new App Router paradigm in Next.js 14.

That's all for today's AI Tech Radio digest. Stay curious, keep building,
and we'll see you next time!
""".strip()


class LLMClient:
    """Base interface for all LLM provider clients."""

    model: str
    _mock_mode: bool = False

    def is_available(self) -> bool:
        """Returns True if the provider is reachable / usable."""
        raise NotImplementedError

    def ensure_available(self) -> "LLMClient":
        """Checks connectivity; falls back to mock mode if unavailable."""
        if not self.is_available():
            print(f"  ⚠  {self.__class__.__name__} unavailable — running in MOCK MODE.")
            self._mock_mode = True
        return self

    def list_models(self) -> List[str]:
        return []

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        raise NotImplementedError

    def chat(self, messages: List[dict], temperature: float = 0.7) -> str:
        raise NotImplementedError

    def __repr__(self) -> str:
        mode = "mock" if self._mock_mode else "live"
        return f"{self.__class__.__name__}(model={self.model!r}, mode={mode})"
