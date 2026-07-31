"""
Personal AI Tech Radio — Web API
=================================
A tiny Flask API that wraps `main.run_pipeline()` so a browser-based
frontend (see ../frontend) can trigger a run, watch it progress via
live logs, and then view the generated script + play the audio.

Everything runs in a single background job (no concurrency, no queue —
this is a demo tool, not a production service).

Run:
    python webapp/app.py
"""

from __future__ import annotations

import io
import sys
import threading
import traceback
from contextlib import redirect_stdout
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import run_pipeline, run_compare  # noqa: E402
from ai_radio.config import AppConfig, AudioConfig, FeedConfig, LLMConfig, RagConfig, TopicsConfig, load_config, save_config  # noqa: E402

ROOT_DIR = Path(__file__).parent.parent
OUTPUT_DIR = ROOT_DIR / "output"

app = Flask(__name__)

# ── Job state (single global job — good enough for a local demo) ─────────────

_lock = threading.Lock()
_state = {
    "running": False,
    "mode": "generate",   # "generate" | "compare"
    "logs": [],       # list[str] — lines captured from stdout
    "script": None,
    "rag_script": None,
    "no_rag_script": None,
    "audio_file": None,
    "error": None,
}


class _LogStream(io.TextIOBase):
    """A file-like object that appends every write() to the shared log list."""

    def write(self, s: str) -> int:
        if s and s.strip("\n"):
            with _lock:
                for line in s.splitlines():
                    if line.strip():
                        _state["logs"].append(_strip_ansi(line))
        return len(s)


def _strip_ansi(text: str) -> str:
    import re
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


def _run_job(options: dict) -> None:
    with _lock:
        _state["running"] = True
        _state["mode"] = "generate"
        _state["logs"] = []
        _state["script"] = None
        _state["rag_script"] = None
        _state["no_rag_script"] = None
        _state["audio_file"] = None
        _state["error"] = None

    no_audio = options.get("no_audio", False)
    stream = _LogStream()
    try:
        with redirect_stdout(stream):
            script = run_pipeline(
                mock=options.get("mock", False),
                no_audio=no_audio,
                reset_db=options.get("reset_db", False),
                skip_fetch=options.get("skip_fetch", False),
                provider=options.get("provider") or None,
                model=options.get("model") or None,
            )
        with _lock:
            _state["script"] = script
            _state["audio_file"] = None if no_audio else _latest_audio_file()
    except Exception:
        with _lock:
            _state["error"] = traceback.format_exc()
    finally:
        with _lock:
            _state["running"] = False


def _compare_job(options: dict) -> None:
    with _lock:
        _state["running"] = True
        _state["mode"] = "compare"
        _state["logs"] = []
        _state["script"] = None
        _state["rag_script"] = None
        _state["no_rag_script"] = None
        _state["audio_file"] = None
        _state["error"] = None

    stream = _LogStream()
    try:
        with redirect_stdout(stream):
            result = run_compare(
                mock=options.get("mock", False),
                provider=options.get("provider") or None,
                model=options.get("model") or None,
            )
        with _lock:
            _state["rag_script"] = result["rag_script"]
            _state["no_rag_script"] = result["no_rag_script"]
    except Exception:
        with _lock:
            _state["error"] = traceback.format_exc()
    finally:
        with _lock:
            _state["running"] = False


def _latest_audio_file() -> str | None:
    if not OUTPUT_DIR.exists():
        return None
    candidates = sorted(
        [p for p in OUTPUT_DIR.glob("radio_episode_*.mp3")] +
        [p for p in OUTPUT_DIR.glob("radio_episode_*.wav")] +
        [p for p in OUTPUT_DIR.glob("radio_episode_*.aiff")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0].name if candidates else None


# ── Routes ─────────────────────────────────────────────────────────────────

@app.post("/api/run")
def start_run():
    with _lock:
        if _state["running"]:
            return jsonify({"error": "A run is already in progress."}), 409

    options = request.get_json(silent=True) or {}
    thread = threading.Thread(target=_run_job, args=(options,), daemon=True)
    thread.start()
    return jsonify({"started": True})


@app.post("/api/compare")
def start_compare():
    with _lock:
        if _state["running"]:
            return jsonify({"error": "A run is already in progress."}), 409

    options = request.get_json(silent=True) or {}
    thread = threading.Thread(target=_compare_job, args=(options,), daemon=True)
    thread.start()
    return jsonify({"started": True})


@app.get("/api/status")
def status():
    with _lock:
        return jsonify({
            "running": _state["running"],
            "mode": _state["mode"],
            "logs": _state["logs"],
            "script": _state["script"],
            "rag_script": _state["rag_script"],
            "no_rag_script": _state["no_rag_script"],
            "audio_url": f"/api/audio/{_state['audio_file']}" if _state["audio_file"] else None,
            "error": _state["error"],
        })


@app.get("/api/audio/<path:filename>")
def get_audio(filename: str):
    return send_from_directory(OUTPUT_DIR, filename)


@app.get("/api/config")
def get_config():
    config = load_config()
    return jsonify({
        "llm": {"provider": config.llm.provider, "model": config.llm.model, "temperature": config.llm.temperature},
        "topics": {"focus": config.topics.focus},
        "feeds": [{"url": f.url, "source": f.source} for f in config.feeds],
        "rag": {
            "n_queries": config.rag.n_queries,
            "n_results": config.rag.n_results,
            "chunk_size": config.rag.chunk_size,
            "overlap": config.rag.overlap,
            "max_chunks_per_article": config.rag.max_chunks_per_article,
            "articles_per_feed": config.rag.articles_per_feed,
        },
        "audio": {"language": config.audio.language, "tts_backend": config.audio.tts_backend},
    })


@app.post("/api/config")
def update_config():
    data = request.get_json(silent=True) or {}
    try:
        llm_data = data.get("llm", {})
        topics_data = data.get("topics", {})
        feeds_data = data.get("feeds", [])
        rag_data = data.get("rag", {})
        audio_data = data.get("audio", {})

        config = AppConfig(
            llm=LLMConfig(
                provider=llm_data["provider"],
                model=llm_data["model"],
                temperature=float(llm_data["temperature"]),
            ),
            topics=TopicsConfig(focus=list(topics_data["focus"])),
            feeds=[FeedConfig(url=f["url"], source=f["source"]) for f in feeds_data],
            rag=RagConfig(
                n_queries=int(rag_data["n_queries"]),
                n_results=int(rag_data["n_results"]),
                chunk_size=int(rag_data["chunk_size"]),
                overlap=int(rag_data["overlap"]),
                max_chunks_per_article=int(rag_data["max_chunks_per_article"]),
                articles_per_feed=int(rag_data["articles_per_feed"]),
            ),
            audio=AudioConfig(language=audio_data["language"], tts_backend=audio_data["tts_backend"]),
        )
        save_config(config)
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid config payload: {exc}"}), 400

    return jsonify({"saved": True})


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True, use_reloader=False)
