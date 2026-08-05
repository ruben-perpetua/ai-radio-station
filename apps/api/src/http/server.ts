import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "../config/env.js";
import { OpenAiEmbeddingProvider } from "../embeddings/openai-embeddings.js";
import { DefaultRetriever } from "../retrieval/retriever.js";
import { ChromaStore } from "../store/chroma-store.js";
import { createApiRoutes } from "./routes/search.js";

async function main(): Promise<void> {
  const provider = new OpenAiEmbeddingProvider();
  const store = new ChromaStore();

  // Fail fast at startup if the collection's model/dimensions don't match this
  // provider, rather than surfacing meaningless distances on the first query.
  await store.ensureCollection(provider.modelId, provider.dimensions);

  const retriever = new DefaultRetriever(provider, store);

  const app = new Hono();
  app.route("/api", createApiRoutes({ retriever, provider, store }));

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
