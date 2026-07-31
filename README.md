# 🎙 Personal AI Tech Radio — POC

> **Workshop final project** — an AI pipeline that automatically collects, summarises,
> and **vocalises** the latest AI and React tech news as a short audio broadcast.
>
> Covers all 6 workshop modules end-to-end in a single runnable demo.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     main.py (orchestrator)               │
└────────────┬──────────────────────────────┬─────────────┘
             │                              │
    ┌────────▼────────┐            ┌────────▼────────┐
    │  Module 5       │            │  Module 4        │
    │  Agentic AI     │            │  RAG Engine      │
    │  (ReAct agent)  │            │  (retrieve+gen)  │
    └────────┬────────┘            └────────┬────────┘
             │                              │
    ┌────────▼────────┐            ┌────────▼────────┐
    │  Module 6       │            │  Module 3        │
    │  MCP Registry   │            │  Vector DB       │
    │  (tool hub)     │            │  (ChromaDB)      │
    └────────┬────────┘            └────────┬────────┘
             │                              │
    ┌────────▼────────┐            ┌────────▼────────┐
    │  RSS Feeds      │            │  Module 1        │
    │  (HuggingFace,  │            │  Local LLM       │
    │   Dev.to, etc.) │            │  (Ollama)        │
    └─────────────────┘            └─────────────────┘

    Module 2: Fine-Tuning (LoRA) — run separately as a standalone demo
```

---

## Module Mapping

| Module          | Technology                               | Role in this project                    |
| --------------- | ---------------------------------------- | --------------------------------------- |
| 1 — Local LLMs  | **Ollama** (`llama3.2:1b`)               | Script generation — fully on-premises   |
| 2 — Fine-Tuning | **PEFT + LoRA** on DistilGPT-2           | Adapts a model to radio-style output    |
| 3 — Vector DB   | **ChromaDB** + sentence-transformers     | Semantic storage of news articles       |
| 4 — RAG         | Multi-query retrieval + augmented prompt | Grounds the script in real articles     |
| 5 — Agentic AI  | **ReAct** agent loop                     | Autonomously collects and indexes news  |
| 6 — MCP         | **MCPRegistry** tool protocol            | Standardises agent ↔ tool communication |

---

## Quick Start

### Option A — One-command setup (macOS)

```bash
cd ai_tech_radio
bash setup.sh
```

### Option B — Manual setup

```bash
# 1. Create virtual environment
python3 -m venv .venv && source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Install and start Ollama
brew install ollama
ollama serve          # keep this running in a separate terminal
ollama pull llama3.2:1b

# 4. Run the pipeline
python main.py
```

### Option C — Demo mode (no Ollama required)

```bash
pip install -r requirements.txt
python main.py --mock
```

---

## Usage

```bash
python main.py                  # full pipeline (Ollama must be running)
python main.py --mock           # demo mode — uses a canned LLM response
python main.py --no-audio       # skip TTS, produce text script only
python main.py --reset-db       # clear the vector store and re-index
python main.py --model llama3.2 # use the 3B model for better quality
```

---

## Web UI (dashboard)

A small React + Vite dashboard lets you trigger a run and watch it live —
pipeline progress, streaming logs, the generated script, and an audio player.

```bash
# Terminal 1 — backend API (wraps run_pipeline())
source .venv/bin/activate
pip install flask
python webapp/app.py            # http://127.0.0.1:5050

# Terminal 2 — frontend
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Open http://localhost:5173, choose run options (mock LLM, skip fetch,
skip audio, reset DB), optionally override the LLM provider/model, and
click **Generate Episode**.

### RAG vs No-RAG comparison

Click **⚖ Compare RAG vs No-RAG** (instead of Generate) to see, side by
side, a script generated with retrieval-augmented context vs. one
generated purely from the LLM's own training knowledge — using the
existing vector store (no re-fetch). This makes the value of RAG
(grounded, current facts vs. generic/stale output) directly visible.

### Settings panel

The collapsible **⚙️ Settings** panel reads and writes `config.toml`
directly (`GET`/`POST /api/config`): LLM provider/model/temperature,
topics, RAG parameters (chunk size, overlap, n_results, etc.), audio
settings, and RSS feeds. Changes are saved to disk immediately and take
effect on the next run. The OpenAI API key is never read from or written
to this file — it always comes from the `OPENAI_API_KEY` environment
variable.

---

## Module 2 — Fine-Tuning Demo (standalone)

```bash
# Install fine-tuning deps first
pip install transformers torch peft datasets accelerate

# Run the LoRA fine-tuning demo on DistilGPT-2
python -m ai_radio.training.fine_tuning
```

This will:

1. Create a 15-example training corpus of radio-style scripts
2. Fine-tune DistilGPT-2 using **LoRA** (< 1% trainable parameters)
3. Print a **before vs after** comparison of the model's generation style
4. Save the adapter to `output/finetuned_model/`

---

## Output

After a successful run you will find:

```
output/
├── script.txt                      # generated radio script
├── radio_episode_YYYYMMDD_HHMMSS.mp3  # audio broadcast
└── finetuned_model/                # LoRA adapter (after fine_tuning.py)
chroma_data/                        # persistent vector store
```

---

## Project Structure

```
ai_tech_radio/
├── main.py                          # Pipeline orchestrator
├── ai_radio/                        # Application package
│   ├── llm/
│   │   └── client.py                # Module 1 — Ollama client
│   ├── retrieval/
│   │   ├── vector_store.py          # Module 3 — ChromaDB vector store
│   │   └── rag_engine.py            # Module 4 — RAG pipeline
│   ├── agents/
│   │   ├── radio_agent.py           # Module 5 — ReAct news agent
│   │   └── tool_registry.py         # Module 6 — MCP tool registry
│   ├── audio/
│   │   └── tts_engine.py            # Text-to-Speech (gTTS / pyttsx3 / say)
│   └── training/
│       └── fine_tuning.py           # Module 2 — LoRA fine-tuning demo
├── webapp/
│   └── app.py                       # Flask API wrapping run_pipeline()
├── frontend/                        # React + Vite dashboard
│   └── src/App.jsx
├── requirements.txt
└── setup.sh
```

---

## Demo Script (for presenter)

1. **Show the architecture diagram** — explain the 6 modules
2. `python main.py --mock --no-audio` — show all 6 modules initialising and the agent reasoning trace
3. `python main.py --mock` — let TTS convert the script and **play the audio**
4. **Show `output/script.txt`** — the RAG-grounded radio script
5. **Open `ai_radio/training/fine_tuning.py`** — walk through the LoRA config
6. (Optional) `python main.py --reset-db` — show live RSS fetch + real LLM if Ollama is running

---

## Dependencies

| Package                 | Purpose                          |
| ----------------------- | -------------------------------- |
| `chromadb`              | Vector store (Module 3)          |
| `sentence-transformers` | Text embeddings                  |
| `feedparser`            | RSS/Atom parsing                 |
| `requests`              | HTTP client for Ollama API       |
| `gTTS`                  | Google Text-to-Speech            |
| `pyttsx3`               | Offline TTS fallback             |
| `transformers` + `peft` | Fine-tuning (Module 2, optional) |
