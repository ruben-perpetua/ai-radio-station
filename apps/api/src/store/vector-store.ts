import type { Chunk, RetrievedChunk } from "../domain/types.js";

/**
 * Stores and searches vectors. The seam that hides Chroma (or any future vector
 * database) from the rest of the system.
 *
 * `query` takes a **vector**, not a string. Embedding the query is the caller's
 * job. This keeps the store dumb and makes it structurally obvious that query
 * and document vectors must come from the same model — a `query(text)` signature
 * would hide that, and hiding it is how people ship silently broken retrieval.
 */
export interface VectorStore {
  /**
   * Create the collection if absent and assert it was built with this exact
   * model and dimension count. Throws on mismatch — see the dimension guard.
   */
  ensureCollection(modelId: string, dimensions: number): Promise<void>;
  upsert(chunks: readonly Chunk[], vectors: readonly number[][]): Promise<void>;
  query(
    vector: readonly number[],
    topK: number,
  ): Promise<readonly RetrievedChunk[]>;
  count(): Promise<number>;
}
