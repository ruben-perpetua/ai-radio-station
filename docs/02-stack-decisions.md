# 02 — Stack Decisions

ADR-style. Each decision records what was chosen, what else was considered, and why.
Open questions are listed at the end.

Versions below were verified on 2026-07-31. Re-check before installing.

---

## D1 — TypeScript, strict mode

**Decision:** TypeScript with `strict: true`, plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

**Rationale:** The pipeline passes structured data through many stages. Strict typing
catches shape mismatches at the seam rather than at 3am in a stack trace. No `any` —
use `unknown` with narrowing at boundaries.

---

## D2 — npm workspaces, two apps

**Decision:** npm workspaces with `apps/api` and `apps/web`. No shared `packages/*`.

**Alternatives:** pnpm (faster, stricter), Turborepo/Nx (build orchestration), single
package with two entry points.

**Rationale:** npm was requested. Two workspaces is the minimum that keeps server and
browser dependency trees separate — which matters, because `jsdom` and `kokoro-js` must
never end up in a browser bundle.

A shared `packages/types` is tempting for sharing `RadioScript` with the frontend. Resist
it until Phase 6. Until then the frontend can import types via a relative path or simply
declare its own. Adding a third workspace to share four interfaces is over-engineering.

---

## D3 — Node LTS, plain

**Decision:** Node LTS, pinned in `.nvmrc`. `tsx` for development, `tsc` for build.

**Alternatives:** Bun (faster, native TS), Deno, Node's native type stripping.

**Rationale:** Node was requested. Native type stripping is available in recent Node
versions but has caveats around enums and decorators; `tsx` for dev plus `tsc` for build
is the boring, well-documented path. Boring is correct for a learning project — you want
to be confused by RAG, not by your toolchain.

---

## D4 — No RAG framework

**Decision:** Hand-roll chunking, retrieval, and prompt assembly. No LangChain, no
LlamaIndex.

**Rationale:** This is the most important decision in the document.

A framework would let you build this in an afternoon with about six lines of code. You
would also learn approximately nothing, because every concept you set out to understand —
chunk boundaries, overlap, batching, distance metrics, prompt assembly, context budget —
would be hidden inside a `RetrievalQAChain`.

The hand-rolled versions are genuinely small:

| Component       | Realistic size |
| --------------- | -------------- |
| Chunker         | ~60 lines      |
| Retriever       | ~40 lines      |
| Prompt assembly | ~80 lines      |
| Chroma adapter  | ~90 lines      |

That is a few hundred lines total, all of it the part you actually want to understand.

**Revisit if:** you later want agentic multi-step retrieval or query rewriting chains.
By then you will understand what the framework is doing for you, which is the right time
to adopt one.

---

## D5 — Chroma as the vector store

**Decision:** Chroma via `chromadb` (JS client 3.5.0), running in Docker Compose.

**The catch, stated plainly:** the JS client is a **REST client only**. There is no
embedded/in-process mode as there is in Python. You must run a Chroma server. So your
"pure TypeScript" project has a Docker dependency.

**Alternatives:**

| Option         | Embedded?        | Trade-off                                                        |
| -------------- | ---------------- | ---------------------------------------------------------------- |
| **LanceDB**    | Yes, native Node | No server at all. Arguably the better _engineering_ choice here. |
| **sqlite-vec** | Yes              | Simplest possible thing that works; you write more SQL.          |
| **pgvector**   | No               | What you would most likely use at work. Heavier local setup.     |
| **Qdrant**     | No               | Excellent filtering, also a Docker dependency.                   |

**Rationale:** Chroma was requested, it is well documented, and its data model
(collections, documents, metadatas, embeddings) maps cleanly onto the mental model you
are trying to build. The `VectorStore` interface (see
[01-architecture.md](01-architecture.md)) means swapping it is a one-file exercise.

**Recommended exercise for Phase 8:** implement `LanceDbStore` against the same interface
and compare. Doing that swap teaches you more about vector stores than reading about
either one.

---

## D6 — OpenAI `text-embedding-3-small` for embeddings

**Decision:** OpenAI `text-embedding-3-small`, 1536 dimensions.

**Alternatives:** `text-embedding-3-large` (3072 dims, better, ~6.5× the cost),
local `nomic-embed-text` via Ollama, `Xenova/all-MiniLM-L6-v2` via transformers.js
(384 dims, runs in-process, free).

**Rationale:** OpenAI was requested for the LLM, and using the same provider for
embeddings keeps configuration simple. `-3-small` is very cheap: indexing ~2000 chunks of
~200 tokens costs a fraction of a cent. `-3-large` is not worth 6.5× for a news corpus.

**The dimension trap, and why it is worth hitting on purpose:** vectors from different
models are not comparable. If you index with a 1536-dim model and later query with a
384-dim one, Chroma will reject the query outright. Worse, if the dimensions happen to
_match_ across two different models, you get no error at all — just silently garbage
results, which is far harder to diagnose.

Mitigation, implemented in Phase 2: store `modelId` and `dimensions` in the collection
metadata and refuse to open a collection whose metadata does not match the active
provider.

---

## D7 — OpenAI for script generation

**Decision:** OpenAI chat model, configured via `OPENAI_CHAT_MODEL`, using structured
outputs (JSON schema) to produce a `RadioScript`.

**Note on model selection:** the model id is intentionally **not** hard-coded in this
document. OpenAI's lineup changes frequently, and pinning a name here would just make
these docs wrong in six months. Pick a current small/cheap chat model that supports
structured outputs, put it in `.env`, and check the model list at implementation time.

**Rationale:** Requested. Structured output matters more than the specific model —
getting `RadioScript` back as validated JSON, rather than parsing prose with a regex, is
what makes Phase 6's transcript-and-highlight UI feasible.

**Keep behind `ScriptWriter`** so an Ollama implementation can be dropped in later for
offline work.

---

## D8 — Kokoro for TTS, running locally

**Decision:** `kokoro-js` 1.2.1, model `onnx-community/Kokoro-82M-v1.0-ONNX`, running in
the Node API process with `device: "cpu"`.

```ts
const tts = await KokoroTTS.from_pretrained(
  "onnx-community/Kokoro-82M-v1.0-ONNX",
  {
    dtype: "q8",
    device: "cpu",
  },
);
const audio = await tts.generate(text, { voice: "af_heart" });
```

**Alternatives:** OpenAI TTS (better prosody, costs money, needs network), Piper (fast,
more setup), XTTS / F5-TTS (voice cloning, heavyweight, Python).

**Rationale:**

- 82M parameters — genuinely small, runs on CPU without a GPU.
- Apache-2.0 licensed weights.
- ~28 voices across American and British English (`af_heart`, `am_michael`,
  `bf_emma`, `bm_george`, and others). Multiple voices means you can give the show a
  co-host later at zero extra cost.
- No API key, no per-request cost, works on a plane.
- Has a streaming API (`TextSplitterStream`) for Phase 8.

**On the "5.6 GPT Luna" idea from the original brief:** I could not verify that any such
model exists, so nothing in this plan depends on it. If you find the docs for what you
had in mind, it slots in as another `TtsProvider` implementation without touching
anything else.

**Expected trade-off:** first run downloads model weights (a few hundred MB, cached
afterwards). Synthesis on CPU runs at roughly real-time or better for short segments, so
a 2-minute show takes on the order of a minute to generate. Cache the output.

---

## D9 — Hono for the API

**Decision:** Hono with `@hono/node-server`.

**Alternatives:** Fastify (mature, plugin ecosystem, excellent validation story),
Express (ubiquitous, dated types), bare `node:http`.

**Rationale:** Hono has the best TypeScript inference of the three, a tiny dependency
footprint, and first-class SSE helpers — which Phase 8 wants for streaming script tokens.
Fastify is an equally defensible choice; if you already know it, use it and change
nothing else.

---

## D10 — Vite + React for the web app

**Decision:** Vite + React + TypeScript. Plain hooks and `fetch` for state. No router
initially.

**Alternatives:** Next.js (heavier, its server layer duplicates our API), TanStack Query
(worth adding in Phase 6 if request state gets fiddly).

**Rationale:** There are two screens. A framework with file-based routing, SSR, and a
server runtime would add more concepts than it removes. Vite starts instantly and gets
out of the way.

---

## D11 — `node:test` as the test runner

**Decision:** Node's built-in test runner with `node:assert/strict`.

**Alternatives:** Vitest (better DX, watch mode, works for both workspaces), Jest.

**Rationale:** Zero dependencies, and the API is small enough to learn in ten minutes.
The units that most need tests — the chunker, prompt assembly, ranking — are pure
functions with no framework requirements.

**Revisit at Phase 6:** the web workspace will want Vitest plus Testing Library. Using
`node:test` in the API and Vitest in the web app is a perfectly reasonable split.

---

## D12 — Supporting libraries

| Purpose              | Package                          | Notes                                   |
| -------------------- | -------------------------------- | --------------------------------------- |
| Validation           | `zod`                            | Env, HTTP bodies, LLM structured output |
| RSS parsing          | `rss-parser`                     | Simplest option; handles RSS and Atom   |
| Full-text extraction | `@mozilla/readability` + `jsdom` | Optional, Phase 1 final step            |
| OpenAI               | `openai`                         | Official SDK                            |
| Chroma               | `chromadb`                       | 3.5.0, REST client                      |
| TTS                  | `kokoro-js`                      | 1.2.1                                   |
| Dev runner           | `tsx`                            | TypeScript execution for dev and CLIs   |

Deliberately **not** included: a logging framework (`console` plus a tiny wrapper is
enough), an ORM (files on disk are enough), a state management library.

---

## Open questions

Resolve these as you reach the relevant phase; none blocks Phase 0.

1. **Which chat model exactly?** Check OpenAI's current model list in Phase 4 and pick a
   cheap one supporting structured outputs.
2. **One voice or two?** A two-host format (alternating `af_heart` and `am_michael`) is a
   small change in Phase 5 and makes the output noticeably more listenable.
3. **How is the show seeded?** Fixed topic queries ("AI", "programming languages",
   "security"), or cluster the day's documents and let topics emerge? Fixed queries in
   Phase 4; clustering is a good Phase 8 experiment.
4. **Full-text extraction on or off by default?** Off for the first run; turn it on once
   the pipeline is proven end to end.
5. **How much history to keep?** Retaining 7–30 days makes "this week in tech" episodes
   possible and gives retrieval a meaningfully larger corpus to rank within.
