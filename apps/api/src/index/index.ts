import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Chunk, Document } from "../domain/types.js";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "../ingest/chunker.js";
import { OpenAiEmbeddingProvider } from "../embeddings/openai-embeddings.js";
import { ChromaStore } from "../store/chroma-store.js";
import { env } from "../config/env.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RAW_ROOT = resolve(REPO_ROOT, "data", "raw");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read `--date YYYY-MM-DD` / `--date=YYYY-MM-DD`, defaulting to today. */
function parseDate(argv: readonly string[]): string {
  const eq = argv.find((a) => a.startsWith("--date="));
  if (eq) return eq.slice("--date=".length);
  const flag = argv.indexOf("--date");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1] as string;
  return today();
}

async function loadChunks(dayDir: string): Promise<readonly Chunk[]> {
  const files = (await readdir(dayDir)).filter((f) => f.endsWith(".json"));
  const chunks: Chunk[] = [];
  let docs = 0;
  for (const file of files) {
    const doc = JSON.parse(
      await readFile(resolve(dayDir, file), "utf8"),
    ) as Document;
    docs++;
    chunks.push(...chunkDocument(doc, DEFAULT_CHUNK_OPTIONS));
  }
  console.log(`  ${chunks.length} chunks from ${docs} documents`);
  return chunks;
}

async function main(): Promise<void> {
  const date = parseDate(process.argv.slice(2));
  const dayDir = resolve(RAW_ROOT, date);

  console.log(`indexing data/raw/${date}`);
  if (!existsSync(dayDir)) {
    throw new Error(`No raw data for ${date}. Run \`npm run ingest\` first.`);
  }

  const chunks = await loadChunks(dayDir);
  if (chunks.length === 0) {
    console.log("nothing to index");
    return;
  }

  const provider = new OpenAiEmbeddingProvider();
  const store = new ChromaStore();

  // Assert the collection matches this model/dimension before spending tokens.
  await store.ensureCollection(provider.modelId, provider.dimensions);

  const vectors = await provider.embed(chunks.map((c) => c.text), (p) => {
    process.stdout.write(`\r  embedding: batch ${p.batch}/${p.batches}  `);
  });
  process.stdout.write("✓\n");

  console.log(
    `  tokens: ${provider.tokensUsed.toLocaleString("en-US")}   ` +
      `est. cost: $${provider.estimatedCostUsd.toFixed(4)}`,
  );

  process.stdout.write(`  upserting: ${chunks.length} chunks  `);
  await store.upsert(chunks, vectors);
  process.stdout.write("✓\n");

  const total = await store.count();
  console.log(`collection '${env.CHROMA_COLLECTION}' now contains ${total} vectors`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
