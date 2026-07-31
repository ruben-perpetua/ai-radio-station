# Phase 8 — Polish, Streaming, Evals and Experiments

## Goal

Turn a working project into one you have actually _learned_ from: measure retrieval
quality, swap providers to see what changes, and add streaming so the show starts playing
before it finishes generating.

## Why now

Everything works. This phase is where the learning compounds — the experiments here are
only meaningful because you have a real system with real numbers to compare against.

Unlike phases 0–7, this one is a **menu, not a sequence**. Pick what interests you.

---

## Track A — Retrieval evaluation

The most valuable track. Until now, "is retrieval good?" has been answered by eyeballing
the debug panel. Make it a number.

### A1. Build a golden set

Write 20–30 queries against a **frozen** snapshot of your corpus, each with the document
IDs you judge relevant.

```ts
// apps/api/src/retrieval/eval/golden-set.ts
export interface GoldenQuery {
  readonly query: string;
  readonly relevantDocumentIds: readonly string[];
  readonly note?: string;
}
```

Freezing the corpus matters — otherwise tomorrow's ingestion changes your baseline and
every comparison is meaningless. Copy a day of `data/raw` to `data/eval-corpus/` and index
it into a separate collection.

Hand-labelling 25 queries takes maybe an hour. It is the single highest-value hour in the
project: it converts "this feels better" into evidence.

### A2. Metrics

```ts
export interface EvalResult {
  readonly recallAtK: number; // fraction of relevant docs found in top-k
  readonly precisionAtK: number; // fraction of top-k that are relevant
  readonly mrr: number; // mean reciprocal rank of the first relevant hit
  readonly meanDistance: number;
}
```

**Recall@k** is the one that matters most for RAG. If the relevant chunk is not in the
top-k, the LLM cannot possibly use it — no prompt engineering recovers from that.

### A3. Run the matrix

```bash
npm run eval -- --chunk-size 400,800,1500 --overlap 0,150,300 --top-k 5,10,20
```

Print a table. You will very likely find that one configuration is meaningfully better,
and that it is not the one you guessed. Record the result in
[02-stack-decisions.md](../02-stack-decisions.md) as a new decision with evidence.

---

## Track B — Provider swaps

Each swap is a new implementation of an existing interface. If any swap requires touching
business logic, the interface was wrong — fix the interface.

### B1. Local embeddings

Implement `EmbeddingProvider` with `@huggingface/transformers` (4.2.0) and
`Xenova/all-MiniLM-L6-v2` — 384 dimensions, runs in-process, free.

```ts
import { pipeline } from "@huggingface/transformers";
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2",
);
```

Then run Track A's eval against both and compare. Expect the local model to be somewhat
worse but not catastrophically so, and dramatically faster (no network round trip) and
free. Quantifying that trade-off yourself is worth far more than any blog post claiming to
have done it.

You will need a separate collection — the dimension guard from Phase 2 will (correctly)
refuse to let you mix them. That guard firing is the moment its value becomes obvious.

### B2. LanceDB instead of Chroma

Implement `VectorStore` against LanceDB — embedded, no server, no Docker.

Compare: setup complexity, query latency, and how much code each adapter needs. Then
decide honestly which you would choose for the next project.

### B3. Local script LLM via Ollama

Implement `ScriptWriter` against a local model. The interesting question is whether a
small local model can follow the structured-output and grounding constraints as reliably
as the hosted one. Measure it: run 10 shows through each and count zod validation
failures.

### B4. Hybrid retrieval

Add BM25 keyword search alongside vector search and fuse the rankings (reciprocal rank
fusion is about 15 lines). Dense retrieval is poor at exact identifiers — product names,
version numbers, error codes. Hybrid fixes that. Run the eval and confirm.

---

## Track C — Streaming

Currently the user waits for the entire show to generate. Make it start sooner.

### C1. Stream the script

`ScriptWriter` gains a streaming variant, delivered over SSE. The transcript appears
progressively. Hono has first-class SSE support.

### C2. Stream the audio

Kokoro's `TextSplitterStream` synthesises incrementally:

```ts
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

const splitter = new TextSplitterStream();
const stream = tts.stream(splitter);

for await (const { text, phonemes, audio } of stream) {
  // emit each chunk as it is produced
}
```

### C3. Join the two

Feed script tokens into the splitter as they arrive from the LLM, and play audio chunks as
they are synthesised. Time-to-first-audio drops from ~90 seconds to a few seconds.

This is genuinely the most technically interesting thing in the project — a three-stage
pipeline (LLM → TTS → playback) all streaming concurrently. Attempt it only after
everything else is solid, because debugging a broken streaming pipeline on top of a broken
non-streaming one is miserable.

**Caveat:** streaming and content-hash caching conflict. Keep the batch path for cached
shows and use streaming only for live generation.

---

## Track D — Quality of the show itself

### D1. Two hosts

Alternate voices across segments (Phase 5 groundwork). Add short handoffs — "and in other
news" — between hosts.

### D2. Better show structure

- Lead with the highest-scoring story rather than seed-query order.
- Add a one-line "coming up" teaser after the intro.
- Group related stories into a themed block.

### D3. Audio production

- Insert ~400ms of silence between segments (generate a silent WAV, concatenate).
- Add a short intro sting. Check the licence on anything you use.
- Normalise loudness across segments.

### D4. Prompt iteration

With the eval harness from Track A, you can now A/B prompt variants properly: generate 10
shows per variant, and score them on word-count adherence, hallucination rate (spot-check
against sources), and your own subjective read.

---

## Track E — Robustness

### E1. Tests

- Integration test for the full pipeline with fixture data and stubbed providers.
- A snapshot test on prompt assembly.
- Web tests with Vitest + Testing Library for the player hook — particularly the
  scrub-to-part-index conversion, which is easy to get subtly wrong.

### E2. Observability

A small structured logger with correlation IDs per show build. Record per-stage duration
and token counts to a JSONL file, and add a `npm run stats` command to summarise cost over
time.

### E3. Error recovery

- Circuit breaker on OpenAI failures.
- Graceful degradation: if TTS fails, still serve the text-only show.
- Health endpoint reporting Chroma connectivity and model load state.

---

## Suggested order

If you want a path rather than a menu:

1. **A1–A3** — build the eval harness. Everything else becomes measurable.
2. **B1** — local embeddings, measured against the harness.
3. **D1 + D3** — cheap changes, large improvement in how the show _feels_.
4. **B4** — hybrid retrieval, measured.
5. **C1–C3** — streaming, once everything else is stable.

## Done criteria

There is no completion criterion for this phase. Reasonable stopping points:

- [ ] An eval harness exists and you know your recall@10
- [ ] You have swapped at least one provider and measured the difference
- [ ] The show sounds good enough that you would send someone the link
- [ ] You can explain, from your own measurements rather than from reading, what chunk size
      and top-k are right for this corpus and why
