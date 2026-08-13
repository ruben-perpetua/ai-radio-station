import assert from "node:assert/strict";
import { test } from "node:test";
import type { RetrievedChunk } from "../domain/types.js";
import type { Retriever, SearchResult } from "../retrieval/retriever.js";
import { retrieveForShow } from "./compose-show.js";

function rc(documentId: string, distance: number): RetrievedChunk {
  return {
    chunk: {
      id: `${documentId}:0`,
      documentId,
      index: 0,
      text: documentId,
      tokenEstimate: 1,
      metadata: {
        title: documentId,
        url: `https://example.com/${documentId}`,
        sourceId: "test",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    },
    distance,
    rank: 0,
  };
}

/** Returns whatever results are registered for each seed query. */
class FakeRetriever implements Retriever {
  constructor(private readonly bySeed: Record<string, readonly RetrievedChunk[]>) {}
  async search(query: string): Promise<SearchResult> {
    return {
      query,
      embeddingModel: "fake",
      dimensions: 1,
      embedMs: 0,
      searchMs: 0,
      totalIndexed: 0,
      results: this.bySeed[query] ?? [],
    };
  }
}

test("dedupes by documentId keeping the lowest distance, and ranks", async () => {
  const retriever = new FakeRetriever({
    ai: [rc("d1", 0.4), rc("d2", 0.2)],
    security: [rc("d1", 0.1), rc("d3", 0.3)], // d1 again, closer
  });
  const out = await retrieveForShow(retriever, { seedQueries: ["ai", "security"] });

  assert.equal(out.chunks.length, 3); // d1, d2, d3 — one per document
  const d1 = out.chunks.find((c) => c.chunk.documentId === "d1");
  assert.equal(d1?.distance, 0.1); // kept the closer of the two d1 hits
  // Ranked by ascending distance with a dense 0-based rank.
  assert.deepEqual(
    out.chunks.map((c) => c.rank),
    [0, 1, 2],
  );
  assert.equal(out.chunks[0]?.distance, 0.1);
});

test("excludes given documentIds and counts them", async () => {
  const retriever = new FakeRetriever({
    ai: [rc("aired", 0.2), rc("fresh", 0.3)],
  });
  const out = await retrieveForShow(retriever, {
    seedQueries: ["ai"],
    excludeDocumentIds: new Set(["aired"]),
  });

  assert.deepEqual(
    out.chunks.map((c) => c.chunk.documentId),
    ["fresh"],
  );
  assert.equal(out.documentsExcluded, 1);
});

test("records seeds that returned nothing", async () => {
  const retriever = new FakeRetriever({ ai: [rc("d1", 0.2)] });
  const out = await retrieveForShow(retriever, { seedQueries: ["ai", "empty"] });
  assert.deepEqual(out.emptySeeds, ["empty"]);
});

test("caps the document budget", async () => {
  const many = Array.from({ length: 20 }, (_, i) => rc(`d${i}`, i / 100));
  const retriever = new FakeRetriever({ ai: many });
  const out = await retrieveForShow(retriever, { seedQueries: ["ai"] });
  assert.equal(out.chunks.length, 12); // MAX_DOCUMENTS
});
