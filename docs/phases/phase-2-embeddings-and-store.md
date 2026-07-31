# Phase 2 — Embeddings and Vector Store

## Goal

Turn chunks into vectors with OpenAI, store them in Chroma behind a `VectorStore`
interface, and be able to run a similarity search from the command line.

## Why now

This is the heart of RAG. Both seams introduced here — `EmbeddingProvider` and
`VectorStore` — are what make every later swap experiment cheap.

## Deliverables

- `EmbeddingProvider` interface + OpenAI implementation with batching
- `VectorStore` interface + Chroma implementation
- Collection metadata guard against model/dimension mismatch
- `npm run index` CLI with cost and token reporting
- A CLI query command proving search works end to end

## Key interfaces

```ts
export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}

export interface VectorStore {
  ensureCollection(modelId: string, dimensions: number): Promise<void>;
  upsert(chunks: readonly Chunk[], vectors: readonly number[][]): Promise<void>;
  query(
    vector: readonly number[],
    topK: number,
  ): Promise<readonly RetrievedChunk[]>;
  count(): Promise<number>;
}
```

`query` takes a **vector**, not a string. This is a deliberate design choice: it forces
the caller to embed the query explicitly, which makes it structurally obvious that query
and document embeddings must come from the same model. A `query(text: string)` signature
would hide that, and hiding it is how people ship silently broken retrieval.

## Steps

### 1. OpenAI embedding provider

```ts
// apps/api/src/embeddings/openai-embeddings.ts
const MAX_BATCH = 100;
const MAX_INPUT_CHARS = 8000;
```

Implementation notes:

- **Batch.** The API accepts an array of inputs. Sending 892 chunks one at a time is 892
  round trips; sending them in batches of 100 is 9. This is the single biggest
  performance difference in the phase.
- **Preserve order.** The response array maps positionally to the input array. Do not
  reorder, and do not use `Promise.all` over individual items and assume ordering.
- **Retry on 429 and 5xx** with exponential backoff and jitter.
- **Truncate defensively** at `MAX_INPUT_CHARS`. Chunks should already be ~800 chars, but
  a bug upstream should degrade rather than throw.
- **Report usage.** Log `response.usage.total_tokens` per batch and accumulate.

```ts
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = env.OPENAI_EMBEDDING_MODEL;
  readonly dimensions = 1536;
  // ...
}
```

Hard-coding `1536` is acceptable because it is asserted against the actual response
length on the first call. Assert it — do not trust the constant.

### 2. Chroma store

```ts
// apps/api/src/store/chroma-store.ts
import { ChromaClient } from "chromadb";
```

Chroma will try to embed documents for you if you let it. **Do not let it.** Always pass
explicit `embeddings`, and configure the collection with a null/no-op embedding function.
Otherwise Chroma silently uses its own default model and your query vectors and document
vectors come from different models — which produces plausible-looking, completely wrong
results. This is the number one Chroma footgun.

Mapping between our domain and Chroma's API:

| Ours                                      | Chroma       |
| ----------------------------------------- | ------------ |
| `chunk.id`                                | `ids`        |
| `chunk.text`                              | `documents`  |
| vector                                    | `embeddings` |
| `chunk.metadata` + `documentId` + `index` | `metadatas`  |

Chroma metadata values must be primitives — string, number, or boolean. No nested
objects, no arrays. Flatten on write, rehydrate on read.

### 3. The dimension guard

The most valuable 20 lines in this phase.

```ts
async ensureCollection(modelId: string, dimensions: number): Promise<void> {
  const existing = await this.client.getOrCreateCollection({
    name: env.CHROMA_COLLECTION,
    metadata: { embeddingModel: modelId, dimensions },
  });

  const meta = existing.metadata;
  if (meta?.embeddingModel !== modelId || meta?.dimensions !== dimensions) {
    throw new Error(
      `Collection '${env.CHROMA_COLLECTION}' was built with ` +
      `${meta?.embeddingModel} (${meta?.dimensions}d) but the active provider is ` +
      `${modelId} (${dimensions}d). Delete the collection and re-index.`,
    );
  }
}
```

Why this matters: if you index with a 1536-dimension model and query with a 384-dimension
one, Chroma rejects the query and you get a clear error. But if two _different_ models
happen to share a dimension count, there is no error at all — just quietly meaningless
distances. This guard converts an invisible failure into a loud one.

### 4. Distance metric

Chroma defaults to L2 (squared Euclidean). For normalised embeddings — which OpenAI's
are — cosine is the conventional choice and produces more interpretable numbers.

Set it explicitly at collection creation:

```ts
metadata: { 'hnsw:space': 'cosine', embeddingModel, dimensions }
```

With cosine distance in Chroma, expect roughly:

| Distance  | Interpretation      |
| --------- | ------------------- |
| 0.0 – 0.2 | Near-identical text |
| 0.2 – 0.4 | Strongly relevant   |
| 0.4 – 0.6 | Loosely related     |
| 0.6+      | Probably noise      |

Treat these as starting intuitions, not laws. Calibrate them against your own corpus in
Phase 3 — that calibration is a large part of what the debug panel is for.

### 5. The indexing CLI

`npm run index`:

1. Read documents from `data/raw` (accept a `--date` argument, default today).
2. Chunk them using the Phase 1 chunker.
3. `ensureCollection(provider.modelId, provider.dimensions)`.
4. Embed in batches of 100, with a progress line per batch.
5. Upsert into Chroma in batches.
6. Print a summary.

```
indexing data/raw/2026-07-31
  892 chunks from 141 documents
  embedding: batch 9/9  ✓
  tokens: 137,204   est. cost: $0.0027
  upserting: 892 chunks  ✓
collection 'tech-radio' now contains 892 vectors
```

Print the cost estimate. Seeing a real number, even a tiny one, builds the instinct that
embedding is metered — which stops you from putting `index` inside a file watcher.

Because chunk IDs are deterministic (`{documentId}:{index}`), upsert is idempotent.
Re-running is safe.

### 6. A CLI query command

Before building any UI, prove retrieval works from the terminal:

```bash
npm run query -- "what is happening with AI agents"
```

```
query: "what is happening with AI agents"
embedded in 180ms (1536 dims)

  rank  distance  source          title
  0     0.184     hn              Anthropic ships agentic workflows...
  1     0.221     rss:simonw      Notes on building agents
  2     0.267     devto           Practical agent patterns
  ...
```

Run at least ten queries before moving on. Try queries you know should hit, queries that
should miss, single words, and full sentences. You are calibrating your sense of what the
distance numbers mean. That intuition is the actual deliverable of this phase.

## How to verify

```bash
docker compose up -d
npm run index
npm run query -- "typescript"
npm run query -- "banana bread recipe"    # should return high distances
```

The banana bread query is the important one. Vector search **always returns k results** —
there is no notion of "no match". A nonsense query will still return your five nearest
chunks, at high distance. Understanding this is why relevance thresholds exist, and why
Phase 4 must filter by distance before feeding chunks to the LLM.

## Learning checkpoints

- Why does `VectorStore.query` take a vector rather than a string?
- What happens if document and query embeddings come from different models?
- Why does a nonsense query still return results?
- What is the practical difference between cosine and L2 distance here?
- Why is batching worth doing, in concrete terms?

## Risks and gotchas

| Risk                                              | Mitigation                                               |
| ------------------------------------------------- | -------------------------------------------------------- |
| Chroma silently embeds with its own default model | Always pass explicit embeddings; null embedding function |
| Model changed but collection reused               | Dimension guard throws                                   |
| Nested metadata rejected by Chroma                | Flatten to primitives                                    |
| Rate limits during a large index                  | Batch + exponential backoff                              |
| Re-indexing duplicates data                       | Deterministic chunk IDs make upsert idempotent           |
| Expecting "no results" for bad queries            | Understand top-k always returns k                        |

## Done criteria

- [ ] `npm run index` populates Chroma; `count()` matches the chunk count
- [ ] Re-running `index` is idempotent — count does not change
- [ ] The dimension guard throws when the embedding model is changed in `.env`
- [ ] `npm run query` returns ranked results with distances
- [ ] You have run 10+ queries and have a working sense of the distance scale
- [ ] Token usage and estimated cost are reported
