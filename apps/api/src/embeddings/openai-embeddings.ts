import OpenAI from "openai";
import { env } from "../config/env.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

/** The API accepts an array of inputs; 100 per call turns N round trips into N/100. */
const MAX_BATCH = 100;
/** Chunks are ~800 chars; this only guards against an upstream bug, so degrade not throw. */
const MAX_INPUT_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

/** USD per input token for text-embedding-3-small ($0.02 per 1M tokens). */
const USD_PER_TOKEN = 0.02 / 1_000_000;

export interface EmbedProgress {
  readonly batch: number;
  readonly batches: number;
  readonly tokens: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 429 (rate limit), 5xx (server), and connection errors (no status) are worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = env.OPENAI_EMBEDDING_MODEL;
  // Asserted against the real response length on the first batch, not trusted blindly.
  readonly dimensions = 1536;

  private readonly client: OpenAI;
  private tokens = 0;

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  get tokensUsed(): number {
    return this.tokens;
  }

  get estimatedCostUsd(): number {
    return this.tokens * USD_PER_TOKEN;
  }

  async embed(
    texts: readonly string[],
    onProgress?: (progress: EmbedProgress) => void,
  ): Promise<readonly number[][]> {
    if (texts.length === 0) return [];

    const inputs = texts.map((t) =>
      t.length > MAX_INPUT_CHARS ? t.slice(0, MAX_INPUT_CHARS) : t,
    );

    const vectors: number[][] = [];
    const batches = Math.ceil(inputs.length / MAX_BATCH);

    for (let b = 0; b < batches; b++) {
      const slice = inputs.slice(b * MAX_BATCH, (b + 1) * MAX_BATCH);
      const response = await this.embedWithRetry(slice);

      // The response array maps positionally to the request, but sort by the
      // returned index defensively before relying on that ordering.
      const ordered = [...response.data].sort((a, z) => a.index - z.index);
      for (const item of ordered) {
        if (item.embedding.length !== this.dimensions) {
          throw new Error(
            `Embedding model '${this.modelId}' returned ${item.embedding.length} ` +
              `dimensions but ${this.dimensions} was expected.`,
          );
        }
        vectors.push(item.embedding);
      }

      this.tokens += response.usage.total_tokens;
      onProgress?.({ batch: b + 1, batches, tokens: this.tokens });
    }

    return vectors;
  }

  private async embedWithRetry(
    input: readonly string[],
  ): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.client.embeddings.create({
          model: this.modelId,
          input: [...input],
        });
      } catch (err) {
        attempt++;
        if (attempt > MAX_RETRIES || !isRetryable(err)) throw err;
        // Exponential backoff with jitter so a fleet of retries doesn't sync up.
        const delay =
          BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * BASE_DELAY_MS;
        await sleep(delay);
      }
    }
  }
}
