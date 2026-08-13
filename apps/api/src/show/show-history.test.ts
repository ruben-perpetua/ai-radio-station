import assert from "node:assert/strict";
import { test } from "node:test";
import type { AiredStory, Chunk, RetrievedChunk } from "../domain/types.js";
import type { EmbeddingProvider } from "../embeddings/embedding-provider.js";
import {
  addToHistory,
  excludedDocumentIds,
  nearDuplicateDocumentIds,
} from "./show-history.js";

/**
 * A deterministic provider: each distinct string maps to its own orthonormal
 * basis vector. Identical strings share a vector (cosine distance 0); different
 * strings are orthogonal (cosine distance 1). That makes the near-dup threshold
 * behave as "exact headline match" here, which is exactly what we can assert on.
 */
class FakeEmbeddings implements EmbeddingProvider {
  readonly modelId = "fake";
  readonly dimensions = 32;
  private readonly index = new Map<string, number>();

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    return texts.map((t) => {
      let i = this.index.get(t);
      if (i === undefined) {
        i = this.index.size;
        this.index.set(t, i);
      }
      const v = new Array<number>(this.dimensions).fill(0);
      v[i % this.dimensions] = 1;
      return v;
    });
  }
}

function chunk(documentId: string, title: string, url: string): Chunk {
  return {
    id: `${documentId}:0`,
    documentId,
    index: 0,
    text: title,
    tokenEstimate: 1,
    metadata: { title, url, sourceId: "test", publishedAt: "2026-01-01T00:00:00Z" },
  };
}

function retrieved(documentId: string, title: string, url: string): RetrievedChunk {
  return { chunk: chunk(documentId, title, url), distance: 0.2, rank: 0 };
}

function aired(documentId: string, headline: string, url: string): AiredStory {
  return {
    documentId,
    canonicalUrl: url,
    headline,
    showId: "s1",
    airedAt: "2026-01-01T00:00:00Z",
  };
}

test("excludedDocumentIds collects every aired documentId", () => {
  const history = [aired("d1", "One", "u1"), aired("d2", "Two", "u2")];
  const set = excludedDocumentIds(history);
  assert.ok(set.has("d1") && set.has("d2"));
  assert.equal(set.size, 2);
});

test("addToHistory appends only new documents", () => {
  const existing = [aired("d1", "One", "u1")];
  const chunks = [chunk("d1", "One", "u1"), chunk("d2", "Two", "u2")];
  const next = addToHistory(existing, chunks, "s2", new Date("2026-02-02T00:00:00Z"));
  assert.equal(next.length, 2); // d1 already present, only d2 added
  const d2 = next.find((s) => s.documentId === "d2");
  assert.equal(d2?.showId, "s2");
  assert.equal(d2?.airedAt, "2026-02-02T00:00:00.000Z");
});

test("nearDuplicateDocumentIds excludes a same-headline story with a new URL", async () => {
  const embeddings = new FakeEmbeddings();
  const history = [aired("old-verge", "Big AI Model Released", "verge.com/x")];
  const candidates = [
    // Same story, different publisher/URL/documentId — must be caught.
    retrieved("new-ars", "Big AI Model Released", "arstechnica.com/y"),
    // Genuinely different story — must survive.
    retrieved("new-chip", "New Chip Beats Benchmarks", "anandtech.com/z"),
  ];
  const excluded = await nearDuplicateDocumentIds(candidates, history, embeddings);
  assert.ok(excluded.has("new-ars"));
  assert.ok(!excluded.has("new-chip"));
});

test("nearDuplicateDocumentIds is a no-op with empty history", async () => {
  const excluded = await nearDuplicateDocumentIds(
    [retrieved("d1", "Anything", "u1")],
    [],
    new FakeEmbeddings(),
  );
  assert.equal(excluded.size, 0);
});
