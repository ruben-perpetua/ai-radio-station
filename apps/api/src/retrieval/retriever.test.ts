import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultRetriever } from "./retriever.js";
import type { EmbeddingProvider } from "../embeddings/embedding-provider.js";
import type { VectorStore } from "../store/vector-store.js";
import type { Chunk, RetrievedChunk } from "../domain/types.js";

function makeChunk(id: string, text = "body"): Chunk {
  return {
    id,
    documentId: "doc",
    index: 0,
    text,
    tokenEstimate: 1,
    metadata: {
      title: "Title",
      url: "https://example.com",
      sourceId: "test",
      publishedAt: "2026-07-31T00:00:00.000Z",
    },
  };
}

function makeRetrieved(id: string, distance: number, rank: number): RetrievedChunk {
  return { chunk: makeChunk(id), distance, rank };
}

const provider: EmbeddingProvider = {
  modelId: "fake-model",
  dimensions: 3,
  embed: async (texts) => texts.map(() => [0, 0, 0]),
};

function makeStore(rows: readonly RetrievedChunk[]): VectorStore {
  return {
    ensureCollection: async () => {},
    upsert: async () => {},
    query: async () => rows,
    count: async () => 42,
  };
}

test("search reports model, dimensions, count and timings", async () => {
  const store = makeStore([makeRetrieved("a", 0.1, 0)]);
  const retriever = new DefaultRetriever(provider, store);

  const result = await retriever.search("hi", { topK: 5 });

  assert.equal(result.embeddingModel, "fake-model");
  assert.equal(result.dimensions, 3);
  assert.equal(result.totalIndexed, 42);
  assert.equal(result.results.length, 1);
  assert.ok(result.embedMs >= 0);
  assert.ok(result.searchMs >= 0);
});

test("maxDistance drops far results and re-ranks densely", async () => {
  const store = makeStore([
    makeRetrieved("a", 0.1, 0),
    makeRetrieved("b", 0.4, 1),
    makeRetrieved("c", 0.9, 2),
  ]);
  const retriever = new DefaultRetriever(provider, store);

  const result = await retriever.search("hi", { topK: 5, maxDistance: 0.5 });

  assert.deepEqual(
    result.results.map((r) => r.chunk.id),
    ["a", "b"],
  );
  assert.deepEqual(
    result.results.map((r) => r.rank),
    [0, 1],
  );
});

test("no maxDistance keeps every result", async () => {
  const store = makeStore([
    makeRetrieved("a", 0.1, 0),
    makeRetrieved("b", 1.9, 1),
  ]);
  const retriever = new DefaultRetriever(provider, store);

  const result = await retriever.search("hi", { topK: 5 });
  assert.equal(result.results.length, 2);
});
