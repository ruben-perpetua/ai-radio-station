import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../config/env.js";
import type { EmbeddingProvider } from "../../embeddings/embedding-provider.js";
import type { Retriever } from "../../retrieval/retriever.js";
import { assemblePrompt } from "../../script/prompt.js";
import type { ScriptWriter } from "../../script/script-writer.js";
import { composeShow } from "../../show/compose-show.js";
import type { VectorStore } from "../../store/vector-store.js";

export interface ApiDeps {
  readonly retriever: Retriever;
  readonly provider: EmbeddingProvider;
  readonly store: VectorStore;
  readonly writer: ScriptWriter;
}

// Validate at the boundary, always. topK is clamped so nobody can request
// 100,000 results and exhaust memory; query is length-capped because it becomes
// a paid embedding call — an unbounded string is an unbounded bill.
const searchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(50).default(10),
  maxDistance: z.number().min(0).max(2).optional(),
});

// The show route accepts optional overrides. Seed queries are capped in count
// and length because each one is a paid embedding + vector search; targetWords
// is bounded to the range the writer actually enforces.
const showRequestSchema = z.object({
  seedQueries: z.array(z.string().min(1).max(200)).min(1).max(12).optional(),
  targetWords: z.number().int().min(200).max(600).optional(),
});

export function createApiRoutes(deps: ApiDeps): Hono {
  const api = new Hono();

  api.get("/health", (c) => c.json({ ok: true }));

  api.get("/stats", async (c) => {
    return c.json({
      collection: env.CHROMA_COLLECTION,
      totalChunks: await deps.store.count(),
      embeddingModel: deps.provider.modelId,
      dimensions: deps.provider.dimensions,
      distanceMetric: "cosine",
    });
  });

  api.post("/search", async (c) => {
    // Bad JSON is a client error, not a server crash — surface it as 400.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = searchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request", issues: parsed.error.issues },
        400,
      );
    }

    const { query, topK, maxDistance } = parsed.data;
    const result = await deps.retriever.search(query, {
      topK,
      // exactOptionalPropertyTypes: omit the key entirely when absent rather
      // than passing `maxDistance: undefined`.
      ...(maxDistance !== undefined ? { maxDistance } : {}),
    });

    // Attach the assembled prompt so the panel previews the exact text Phase 4
    // will send. Built from the same module the writer will use — no drift.
    const prompt = assemblePrompt(result.results);
    return c.json({ ...result, prompt });
  });

  api.post("/show", async (c) => {
    // An empty body is valid — it means "use the defaults". Only reject a body
    // that is present but not JSON.
    let body: unknown = {};
    const rawBody = await c.req.text();
    if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return c.json({ error: "Request body must be valid JSON" }, 400);
      }
    }

    const parsed = showRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request", issues: parsed.error.issues },
        400,
      );
    }

    try {
      const show = await composeShow(
        { retriever: deps.retriever, writer: deps.writer },
        {
          ...(parsed.data.seedQueries ? { seedQueries: parsed.data.seedQueries } : {}),
          ...(parsed.data.targetWords !== undefined
            ? { targetWords: parsed.data.targetWords }
            : {}),
        },
      );
      return c.json(show);
    } catch (err) {
      // A rejected script (bad URLs, empty retrieval, validation) is a failed
      // generation, not a client error — surface it as 502 with the reason.
      const message = err instanceof Error ? err.message : "unknown error";
      return c.json({ error: "Show generation failed", detail: message }, 502);
    }
  });

  return api;
}
