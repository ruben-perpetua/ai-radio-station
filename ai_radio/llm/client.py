"""
Module 1: Local LLMs
=====================
Run large language models entirely on-premises via Ollama.
Ensures data sovereignty — no prompts or completions leave the machine.

Quick setup
-----------
  brew install ollama          # macOS
  ollama serve                 # start the daemon
  ollama pull llama3.2:1b      # lightweight model (~800 MB)
  ollama pull llama3.2         # 3-B model (~2 GB) — better quality

The client falls back to a canned response when Ollama is not running
so the rest of the pipeline can still be demoed in offline mode.
"""

from __future__ import annotations

import json
import time
from typing import List, Optional

import requests

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3.2:1b"    # change to "llama3.2" for 3-B quality

# ─── Fallback script used when Ollama is not available ────────────────────────
_MOCK_SCRIPT = """
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


class LocalLLMClient:
    """
    HTTP client for the Ollama API.

    All inference is local — this is the Module 1 implementation:
    on-premises, full control, zero cloud dependency.
    """

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        base_url: str = OLLAMA_BASE_URL,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._mock_mode = False

    # ── Health ────────────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """Returns True if the Ollama daemon is reachable."""
        try:
            resp = requests.get(f"{self.base_url}/api/tags", timeout=3)
            return resp.status_code == 200
        except Exception:
            return False

    def ensure_available(self) -> "LocalLLMClient":
        """
        Checks connectivity. Switches to mock mode if Ollama is offline
        so the demo can still run end-to-end.
        """
        if not self.is_available():
            print(
                "  ⚠  Ollama not detected — running in MOCK MODE.\n"
                "     To enable real inference:\n"
                "       brew install ollama && ollama serve\n"
                f"       ollama pull {self.model}"
            )
            self._mock_mode = True
        return self

    def list_models(self) -> List[str]:
        try:
            resp = requests.get(f"{self.base_url}/api/tags", timeout=5)
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []

    # ── Inference ─────────────────────────────────────────────────────────────

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """Single-turn text generation."""
        if self._mock_mode:
            time.sleep(0.3)   # simulate latency
            return _MOCK_SCRIPT

        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        if system:
            payload["system"] = system

        resp = requests.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=180,
        )
        resp.raise_for_status()
        return resp.json()["response"].strip()

    def chat(
        self,
        messages: List[dict],
        temperature: float = 0.7,
    ) -> str:
        """Multi-turn chat completion."""
        if self._mock_mode:
            time.sleep(0.3)
            return _MOCK_SCRIPT

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        resp = requests.post(
            f"{self.base_url}/api/chat",
            json=payload,
            timeout=180,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()

    def __repr__(self) -> str:
        mode = "mock" if self._mock_mode else "live"
        return f"LocalLLMClient(model={self.model!r}, mode={mode})"
