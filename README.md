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
