import { ChromaClient, type Collection, type Metadata } from "chromadb";
import { env } from "../config/env.js";
import type { Chunk, ChunkMetadata, RetrievedChunk } from "../domain/types.js";
import type { VectorStore } from "./vector-store.js";

/** Same estimate the chunker uses; recomputed on read since it isn't stored. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Flatten a chunk's identity + metadata into Chroma-safe primitives. Chroma
 * rejects nested objects and arrays in metadata, so everything must be a
 * string, number, or boolean on the way in.
 */
function toChromaMetadata(chunk: Chunk): Metadata {
  const m = chunk.metadata;
  const meta: Record<string, string | number | boolean> = {
    documentId: chunk.documentId,
    index: chunk.index,
    title: m.title,
    url: m.url,
    sourceId: m.sourceId,
    publishedAt: m.publishedAt,
  };
  if (m.score !== undefined) meta.score = m.score;
  return meta;
}

/** Rebuild a domain RetrievedChunk from Chroma's flat row. */
function toRetrievedChunk(
  id: string,
  document: string,
  metadata: Metadata,
  distance: number,
  rank: number,
): RetrievedChunk {
  const score = typeof metadata.score === "number" ? metadata.score : undefined;
  const chunkMetadata: ChunkMetadata = {
    title: String(metadata.title ?? ""),
    url: String(metadata.url ?? ""),
    sourceId: String(metadata.sourceId ?? ""),
    publishedAt: String(metadata.publishedAt ?? ""),
    ...(score !== undefined ? { score } : {}),
  };
  return {
    chunk: {
      id,
      documentId: String(metadata.documentId ?? ""),
      index: Number(metadata.index ?? 0),
      text: document,
      tokenEstimate: estimateTokens(document),
      metadata: chunkMetadata,
    },
    distance,
    rank,
  };
}

/** Parse CHROMA_URL into the host/port/ssl the v3 client expects. */
function createClient(): ChromaClient {
  const url = new URL(env.CHROMA_URL);
  return new ChromaClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    ssl: url.protocol === "https:",
  });
}

export class ChromaStore implements VectorStore {
  private readonly client: ChromaClient;
  private collection: Collection | undefined;
  private maxBatch: number | undefined;

  constructor(client?: ChromaClient) {
    this.client = client ?? createClient();
  }

  async ensureCollection(modelId: string, dimensions: number): Promise<void> {
    const collection = await this.client.getOrCreateCollection({
      name: env.CHROMA_COLLECTION,
      // Cosine is the right metric for OpenAI's normalised vectors; set it at
      // creation because it cannot be changed afterwards.
      configuration: { hnsw: { space: "cosine" } },
      metadata: { embeddingModel: modelId, dimensions },
      // Never let Chroma pick its own default embedding model: we always pass
      // explicit vectors, and a hidden model would silently mismatch them.
      embeddingFunction: null,
    });

    // The dimension guard. getOrCreateCollection returns the *stored* metadata
    // for a pre-existing collection, so a model/dimension change surfaces here
    // as a loud error instead of quietly meaningless distances.
    const meta = collection.metadata;
    if (meta?.embeddingModel !== modelId || meta?.dimensions !== dimensions) {
      throw new Error(
        `Collection '${env.CHROMA_COLLECTION}' was built with ` +
          `${String(meta?.embeddingModel)} (${String(meta?.dimensions)}d) but the ` +
          `active provider is ${modelId} (${dimensions}d). ` +
          `Delete the collection and re-index.`,
      );
    }

    this.collection = collection;
  }

  async upsert(
    chunks: readonly Chunk[],
    vectors: readonly number[][],
  ): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new Error(
        `upsert size mismatch: ${chunks.length} chunks vs ${vectors.length} vectors.`,
      );
    }
    if (chunks.length === 0) return;

    const collection = await this.getCollection();
    const batchSize = await this.getMaxBatch();

    for (let i = 0; i < chunks.length; i += batchSize) {
      const slice = chunks.slice(i, i + batchSize);
      const vectorSlice = vectors.slice(i, i + batchSize);
      await collection.upsert({
        ids: slice.map((c) => c.id),
        embeddings: vectorSlice.map((v) => [...v]),
        documents: slice.map((c) => c.text),
        metadatas: slice.map(toChromaMetadata),
      });
    }
  }

  async query(
    vector: readonly number[],
    topK: number,
  ): Promise<readonly RetrievedChunk[]> {
    const collection = await this.getCollection();
    const result = await collection.query({
      queryEmbeddings: [[...vector]],
      nResults: topK,
      include: ["distances", "documents", "metadatas"],
    });

    // We sent one query vector, so read the first (and only) row of each column.
    const ids = result.ids[0] ?? [];
    const distances = result.distances[0] ?? [];
    const documents = result.documents[0] ?? [];
    const metadatas = result.metadatas[0] ?? [];

    return ids.map((id, rank) =>
      toRetrievedChunk(
        id,
        documents[rank] ?? "",
        metadatas[rank] ?? {},
        distances[rank] ?? Number.NaN,
        rank,
      ),
    );
  }

  async count(): Promise<number> {
    const collection = await this.getCollection();
    return collection.count();
  }

  private async getCollection(): Promise<Collection> {
    if (!this.collection) {
      this.collection = await this.client.getCollection({
        name: env.CHROMA_COLLECTION,
      });
    }
    return this.collection;
  }

  private async getMaxBatch(): Promise<number> {
    if (this.maxBatch === undefined) {
      this.maxBatch = await this.client.getMaxBatchSize();
    }
    return this.maxBatch;
  }
}
