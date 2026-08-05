/**
 * Turns text into vectors. The one seam through which the system talks to an
 * embedding model, so OpenAI can be swapped for a local model without touching
 * the indexer or retriever.
 *
 * `modelId` and `dimensions` are exposed on purpose: the vector store uses them
 * to detect a mismatch against an existing collection and fail loudly rather
 * than silently comparing vectors from two different models.
 */
export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  /**
   * Embed a batch of texts. The returned array maps positionally to the input:
   * `result[i]` is the vector for `texts[i]`. Order must be preserved.
   */
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}
