# Tech Radio — Documentation

A learning project: an AI-generated tech radio show. Ingest tech news, embed it into a
vector database, retrieve relevant material, have an LLM write a ~2 minute radio script,
speak it with a local TTS model, and play it in the browser alongside a retrieval
debugging panel.

## How to read these docs

Read the three top-level documents first, in order:

| Document                                       | What it answers                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [00-overview.md](00-overview.md)               | What are we building, and what are we deliberately _not_ building? |
| [01-architecture.md](01-architecture.md)       | How do the pieces fit together? What are the seams?                |
| [02-stack-decisions.md](02-stack-decisions.md) | Why these libraries, and what were the alternatives?               |

Then work the phases in order. Each phase is independently shippable and ends with
something you can run and see.

| Phase | Document                                                                         | Outcome                                  |
| ----- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| 0     | [phases/phase-0-foundations.md](phases/phase-0-foundations.md)                   | Repo, tooling, Chroma running            |
| 1     | [phases/phase-1-ingestion.md](phases/phase-1-ingestion.md)                       | Tech news on disk, chunked               |
| 2     | [phases/phase-2-embeddings-and-store.md](phases/phase-2-embeddings-and-store.md) | Chunks embedded and searchable           |
| 3     | [phases/phase-3-retrieval-debug-ui.md](phases/phase-3-retrieval-debug-ui.md)     | Type a query, see ranked chunks + scores |
| 4     | [phases/phase-4-script-generation.md](phases/phase-4-script-generation.md)       | A grounded ~2 minute radio script        |
| 5     | [phases/phase-5-tts.md](phases/phase-5-tts.md)                                   | The script as audio                      |
| 6     | [phases/phase-6-player-frontend.md](phases/phase-6-player-frontend.md)           | Press play, read along                   |
| 7     | [phases/phase-7-show-orchestration.md](phases/phase-7-show-orchestration.md)     | One command builds today's show          |
| 8     | [phases/phase-8-polish.md](phases/phase-8-polish.md)                             | Streaming, evals, swap experiments       |

## Phase document template

Every phase document uses the same sections, so you always know where to look:

- **Goal** — one sentence
- **Why now** — why this phase comes at this point in the sequence
- **Deliverables** — the concrete artifacts
- **Key interfaces** — the TypeScript seams introduced
- **Steps** — the ordered work
- **How to verify** — commands to run and what you should see
- **Learning checkpoints** — questions you should be able to answer when done
- **Risks and gotchas** — the things that will bite you
- **Done criteria** — the checklist

## Confirmed decisions

| Decision        | Choice                          |
| --------------- | ------------------------------- |
| Language        | TypeScript, `strict`            |
| Runtime         | Node (LTS)                      |
| Package manager | npm (workspaces)                |
| Vector database | Chroma, via Docker Compose      |
| Embeddings      | OpenAI `text-embedding-3-small` |
| Script LLM      | OpenAI                          |
| TTS             | Kokoro, local, via `kokoro-js`  |
| Frontend        | React + Vite                    |

Rationale and alternatives are in [02-stack-decisions.md](02-stack-decisions.md).
