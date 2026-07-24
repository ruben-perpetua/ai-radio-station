"""
TTS Engine — Text-to-Speech
============================
Converts a radio script to an audio file.

Priority chain (first available wins):
  1. gTTS        — Google TTS, clear voice, requires internet
  2. pyttsx3     — system TTS engine, works fully offline
  3. macOS `say` — subprocess fallback on macOS

Output: MP3 or WAV saved to ./output/
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


OUTPUT_DIR = Path(__file__).parent / "output"


class TTSEngine:
    """
    Multi-backend text-to-speech converter.
    Auto-detects the best available backend.
    """

    def __init__(self, output_dir: Optional[str] = None):
        self._output_dir = Path(output_dir) if output_dir else OUTPUT_DIR
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._backend: Optional[str] = None   # resolved lazily

    def synthesize(self, text: str, filename: Optional[str] = None) -> str:
        """
        Convert `text` to speech and save to file.
        Returns the absolute path of the saved audio file.
        """
        if filename is None:
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"radio_episode_{stamp}"

        backend = self._detect_backend()
        print(f"  TTS backend: {backend}")

        if backend == "gtts":
            return self._gtts(text, filename)
        elif backend == "pyttsx3":
            return self._pyttsx3(text, filename)
        elif backend == "say":
            return self._say(text, filename)
        else:
            return self._text_fallback(text, filename)

    # ── Backend detection ─────────────────────────────────────────────────────

    def _detect_backend(self) -> str:
        if self._backend:
            return self._backend

        # 1. gTTS
        try:
            import gtts  # noqa: F401
            self._backend = "gtts"
            return self._backend
        except ImportError:
            pass

        # 2. pyttsx3
        try:
            import pyttsx3  # noqa: F401
            self._backend = "pyttsx3"
            return self._backend
        except ImportError:
            pass

        # 3. macOS `say`
        if sys.platform == "darwin" and _cmd_exists("say"):
            self._backend = "say"
            return self._backend

        # 4. plain text fallback
        self._backend = "text"
        return self._backend

    # ── Backends ──────────────────────────────────────────────────────────────

    def _gtts(self, text: str, filename: str) -> str:
        from gtts import gTTS
        out_path = str(self._output_dir / f"{filename}.mp3")
        tts = gTTS(text=text, lang="en", slow=False)
        tts.save(out_path)
        return out_path

    def _pyttsx3(self, text: str, filename: str) -> str:
        import pyttsx3
        out_path = str(self._output_dir / f"{filename}.wav")
        engine = pyttsx3.init()
        engine.setProperty("rate", 165)    # words per minute
        engine.setProperty("volume", 0.9)
        engine.save_to_file(text, out_path)
        engine.runAndWait()
        return out_path

    def _say(self, text: str, filename: str) -> str:
        """macOS `say` command — saves AIFF then converts to MP3 if ffmpeg exists."""
        aiff_path = str(self._output_dir / f"{filename}.aiff")
        subprocess.run(["say", "-o", aiff_path, text], check=True)

        mp3_path = str(self._output_dir / f"{filename}.mp3")
        if _cmd_exists("ffmpeg"):
            subprocess.run(
                ["ffmpeg", "-y", "-i", aiff_path, mp3_path],
                check=True, capture_output=True,
            )
            os.remove(aiff_path)
            return mp3_path
        return aiff_path

    def _text_fallback(self, text: str, filename: str) -> str:
        """No TTS available — save as plain text so the pipeline still completes."""
        print(
            "  ⚠  No TTS library detected. Install one:\n"
            "       pip install gTTS          # online, best quality\n"
            "       pip install pyttsx3       # offline\n"
            "     Saving script as plain text instead."
        )
        out_path = str(self._output_dir / f"{filename}.txt")
        Path(out_path).write_text(text, encoding="utf-8")
        return out_path


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cmd_exists(cmd: str) -> bool:
    return subprocess.run(
        ["which", cmd], capture_output=True
    ).returncode == 0
