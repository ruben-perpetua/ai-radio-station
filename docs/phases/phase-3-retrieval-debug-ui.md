# Phase 3 — Retrieval API and Debug UI

## Goal

A `POST /api/search` endpoint and a React panel that shows exactly what the vector
database returns for any query — ranked chunks, distances, metadata, and the prompt that
would be assembled from them.

## Why now

Deliberately placed **before** the LLM. Two reasons:

1. You get a visual, interactive tool for tuning chunking and retrieval while the system
   is still simple enough to hold in your head.
2. When the LLM arrives in Phase 4 and produces something disappointing, you will already
   have the instrument that tells you whether the fault is retrieval or generation. Nearly
   always, it is retrieval.

This is the highest-leverage phase in the project.

## Deliverables

- `Retriever` composing embedding + store + optional distance filtering
- `POST /api/search` with zod-validated input
- React debug panel: query box, top-k control, results list
- Per-result display of distance, source, chunk index, token estimate
- A collapsible "assembled prompt" preview
- Collection stats display

## Key interfaces

```ts
export interface SearchOptions {
  readonly topK: number;
  readonly maxDistance?: number;
}

export interface SearchResult {
  readonly query: string;
  readonly embeddingModel: string;
  readonly dimensions: number;
  readonly embedMs: number;
  readonly searchMs: number;
  readonly totalIndexed: number;
  readonly results: readonly RetrievedChunk[];
}

export interface Retriever {
  search(query: string, options: SearchOptions): Promise<SearchResult>;
}
```

The timing and model fields exist purely for the debug panel. They cost nothing and turn
the UI from "a list of text" into an instrument.

## Steps

### 1. The retriever

```ts
// apps/api/src/retrieval/retriever.ts
export class DefaultRetriever implements Retriever {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly store: VectorStore,
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult> {
    // 1. embed the query (time it)
    // 2. store.query(vector, topK) (time it)
    // 3. optionally drop results above maxDistance
    // 4. assemble metadata for the response
  }
}
```

Keep `maxDistance` **optional and off by default** in the panel. You want to see the bad
results — the whole point is developing intuition about where the useful signal stops.

### 2. The search route

```ts
// apps/api/src/http/routes/search.ts
const searchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(50).default(10),
  maxDistance: z.number().min(0).max(2).optional(),
});
```

Validate at the boundary, always. `topK` is clamped at 50 so nobody can request 100,000
results and exhaust memory. `query` is length-capped because it becomes an embedding API
call — an unbounded string is an unbounded bill.

Return HTTP 400 with the zod error on validation failure, never a 500.

### 3. Also expose collection stats

```
GET /api/stats
→ { collection, totalChunks, embeddingModel, dimensions, distanceMetric }
```

The panel shows this in a header strip. Knowing "I am searching 892 chunks embedded with
text-embedding-3-small at 1536 dimensions" while reading results is exactly the context
that makes the numbers meaningful.

### 4. The debug panel

`apps/web/src/components/DebugPanel.tsx`.

Layout, top to bottom:

```
┌──────────────────────────────────────────────────────────────┐
│ tech-radio · 892 chunks · text-embedding-3-small · 1536d     │
├──────────────────────────────────────────────────────────────┤
│ [ query text box                                  ] [Search] │
│ top-k: [10]   max distance: [ off ]                          │
├──────────────────────────────────────────────────────────────┤
│ embedded 180ms · searched 24ms · 10 results                  │
├──────────────────────────────────────────────────────────────┤
│ #0  ▓▓▓▓▓▓▓▓░░  0.184   hn · chunk 2/7                       │
│     Anthropic ships agentic workflows                        │
│     "…the new API allows developers to compose…"             │
│     ~153 tokens · 2026-07-31 · [open source ↗]               │
├──────────────────────────────────────────────────────────────┤
│ #1  ▓▓▓▓▓▓░░░░  0.221   rss:simonw · chunk 0/4               │
│     ...                                                       │
├──────────────────────────────────────────────────────────────┤
│ ▸ Assembled prompt preview (2,847 chars, ~712 tokens)        │
└──────────────────────────────────────────────────────────────┘
```

Details that matter:

- **Visual distance bar.** A number is abstract; a bar is instantly comparable. Map
  distance to a filled proportion, inverted, so longer means closer.
- **Colour by band.** Green under 0.3, amber 0.3–0.5, grey above. Nothing teaches the
  distance scale faster than seeing the colour change as you rephrase a query.
- **`chunk 2/7`.** Shows both position and how the parent document was split. When you
  see every top result is `chunk 0/N`, that tells you something real about your chunker.
- **Full text on click.** Show a truncated preview, expand on click. You will want the
  full chunk when a result is surprising.
- **Source link.** Opens the original article. Use `rel="noopener noreferrer"`.

### 5. The assembled prompt preview

A collapsible section rendering exactly what Phase 4 will send to the LLM: the system
instruction, the delimited retrieved chunks, and the character/token count.

Build this now, before the LLM exists. Two payoffs:

- You immediately see how much of the context budget retrieval consumes.
- When Phase 4's output is wrong, you can look at the literal input that produced it
  rather than guessing.

Keep the assembly logic in `apps/api/src/script/prompt.ts` and expose it via the search
response, so the panel and the real script writer can never drift apart.

### 6. Escape rendering

Retrieved text is untrusted web content. React escapes by default — so simply never reach
for `dangerouslySetInnerHTML`. Render chunk text as a plain string.

## How to verify

```bash
npm run dev:api
npm run dev:web
```

Open the panel and work through this list, watching the distances:

| Query                                      | What you are checking                    |
| ------------------------------------------ | ---------------------------------------- |
| A phrase you know is in a specific article | Near-exact match, distance < 0.2         |
| A broad topic: "AI safety"                 | Several plausible hits, 0.2–0.4          |
| A synonym never literally present          | Semantic matching actually working       |
| "banana bread recipe"                      | High distances — this is the noise floor |
| A single word: "rust"                      | Ambiguity — language or metal?           |
| A full question sentence                   | Compare against the keyword version      |

The single-word "rust" query is worth dwelling on. Embeddings have no idea which sense
you mean, and you will get both. That is a real, permanent limitation of dense retrieval,
and seeing it firsthand is worth more than reading about it.

## Learning checkpoints

- What is the typical distance of a genuinely good match in _your_ corpus?
- Where does the noise floor start?
- Do longer queries retrieve better or worse than keyword-style ones? Why?
- Are top results clustered in `chunk 0` of documents? What does that imply?
- How much does removing the title prefix from chunks change the results?

## Experiments to run now

This phase exists to be experimented in. With the panel open, change one thing at a time,
re-index, and compare:

1. **Chunk size** — re-index at 400, 800, and 1500 chars. Which retrieves better? Smaller
   chunks are more precise but lose context; larger ones are the reverse.
2. **Overlap** — try 0 vs 150. Look for facts split across a boundary.
3. **Title prefix on/off** — the difference is usually larger than expected.
4. **top-k** — at what k do results stop being useful? That number is your Phase 4 budget.

Record what you find. These numbers are the actual output of the phase.

## Risks and gotchas

| Risk                                    | Mitigation                                        |
| --------------------------------------- | ------------------------------------------------- |
| Panel becomes an unused toy             | Use it for the experiments above before moving on |
| Prompt preview drifts from real prompt  | Share one module between panel and writer         |
| Rendering untrusted HTML                | Plain text only; no `dangerouslySetInnerHTML`     |
| Unbounded `topK` or query length        | zod clamps at the boundary                        |
| Re-indexing between experiments is slow | Raw docs are on disk; only re-chunk and re-embed  |

## Done criteria

- [ ] `POST /api/search` returns ranked results with distances and timings
- [ ] Invalid input returns 400 with a useful message, not 500
- [ ] `GET /api/stats` reports collection size, model, and dimensions
- [ ] The panel renders results with visual distance bars and colour bands
- [ ] The assembled prompt preview works and shares code with `prompt.ts`
- [ ] You have run all six verification queries
- [ ] You have completed at least two of the four experiments and written down the result
