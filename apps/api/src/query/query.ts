import { OpenAiEmbeddingProvider } from "../embeddings/openai-embeddings.js";
import { ChromaStore } from "../store/chroma-store.js";

const TOP_K = 5;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text.padEnd(width, " ");
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

async function main(): Promise<void> {
  const query = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .join(" ")
    .trim();

  if (!query) {
    console.error('usage: npm run query -- "your search text"');
    process.exit(1);
  }

  const provider = new OpenAiEmbeddingProvider();
  const store = new ChromaStore();
  await store.ensureCollection(provider.modelId, provider.dimensions);

  const started = performance.now();
  const [vector] = await provider.embed([query]);
  const elapsed = Math.round(performance.now() - started);

  console.log(`query: "${query}"`);
  console.log(`embedded in ${elapsed}ms (${provider.dimensions} dims)\n`);

  if (!vector) {
    console.log("no embedding produced");
    return;
  }

  const results = await store.query(vector, TOP_K);
  if (results.length === 0) {
    console.log("collection is empty — run `npm run index` first");
    return;
  }

  console.log(
    `  ${pad("rank", 6)}${pad("distance", 10)}${pad("source", 16)}title`,
  );
  for (const { chunk, distance, rank } of results) {
    console.log(
      `  ${pad(String(rank), 6)}` +
        `${pad(distance.toFixed(3), 10)}` +
        `${pad(truncate(chunk.metadata.sourceId, 15), 16)}` +
        truncate(chunk.metadata.title, 50),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
