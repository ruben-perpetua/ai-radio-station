#!/usr/bin/env bash
# =============================================================================
# Personal AI Tech Radio — Setup Script
# =============================================================================
set -e

echo ""
echo "============================================================"
echo "  Personal AI Tech Radio — Environment Setup"
echo "============================================================"

# ── Python virtual environment ────────────────────────────────────────────────
echo ""
echo "[1/4] Creating Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate
echo "  ✓ Virtual env: .venv"

# ── Core Python dependencies ──────────────────────────────────────────────────
echo ""
echo "[2/4] Installing Python dependencies..."
pip install --upgrade pip -q
pip install -r requirements.txt
echo "  ✓ Core dependencies installed"

# ── Optional fine-tuning deps ─────────────────────────────────────────────────
echo ""
read -r -p "[3/4] Install fine-tuning deps (torch, peft, transformers)? [y/N] " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
    pip install transformers torch peft datasets accelerate
    echo "  ✓ Fine-tuning dependencies installed"
else
    echo "  ⚠  Skipped. Run later: pip install transformers torch peft datasets accelerate"
fi

# ── Ollama ────────────────────────────────────────────────────────────────────
echo ""
echo "[4/4] Checking Ollama..."
if command -v ollama &>/dev/null; then
    echo "  ✓ Ollama already installed"
else
    echo "  Installing Ollama..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ollama
    else
        curl -fsSL https://ollama.ai/install.sh | sh
    fi
fi

echo ""
echo "  Starting Ollama daemon in the background..."
ollama serve &>/dev/null &
sleep 2

echo "  Pulling llama3.2:1b model (~800 MB)..."
ollama pull llama3.2:1b

echo ""
echo "============================================================"
echo "  ✅  Setup complete!"
echo "============================================================"
echo ""
echo "  Run the POC:"
echo "    source .venv/bin/activate"
echo "    python main.py              # full pipeline"
echo "    python main.py --mock       # demo (no Ollama needed)"
echo "    python main.py --no-audio   # text output only"
echo ""
echo "  Run fine-tuning demo (Module 2):"
echo "    python -m modules.m2_fine_tune"
echo ""
