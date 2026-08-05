import type { EmbeddingProvider } from "../embeddings/embedding-provider.js";
import type { RetrievedChunk } from "../domain/types.js";
import type { VectorStore } from "../store/vector-store.js";

export interface SearchOptions {
  readonly topK: number;
  // Off by default on purpose: seeing the bad results is how you learn where
  // the useful signal stops. Only filter when explicitly asked to.
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

/**
 * Composes the embedding provider and vector store into a single query
 * operation. The timing and model fields are captured here, not to optimise
 * anything, but so the debug panel can show what actually happened.
 */
export interface Retriever {
  search(query: string, options: SearchOptions): Promise<SearchResult>;
}

export class DefaultRetriever implements Retriever {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly store: VectorStore,
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult> {
    // 1. Embed the query with the same provider used at index time. Timed
    //    separately because a slow embed and a slow search are different bugs.
    const embedStart = performance.now();
    const [vector] = await this.embeddings.embed([query]);
    const embedMs = Math.round(performance.now() - embedStart);
    if (!vector) {
      throw new Error("embedding provider returned no vector for the query");
    }

    // 2. Ask the store for the nearest topK vectors.
    const searchStart = performance.now();
    const raw = await this.store.query(vector, options.topK);
    const searchMs = Math.round(performance.now() - searchStart);

    // 3. Optional distance cut. When applied we re-rank so `rank` stays a dense
    //    0-based sequence rather than leaving gaps from the dropped rows.
    const kept =
      options.maxDistance === undefined
        ? raw
        : raw
            .filter((r) => r.distance <= options.maxDistance!)
            .map((r, rank) => ({ ...r, rank }));

    // 4. Assemble the metadata the panel needs to make the numbers meaningful.
    return {
      query,
      embeddingModel: this.embeddings.modelId,
      dimensions: this.embeddings.dimensions,
      embedMs,
      searchMs,
      totalIndexed: await this.store.count(),
      results: kept,
    };
  }
}
