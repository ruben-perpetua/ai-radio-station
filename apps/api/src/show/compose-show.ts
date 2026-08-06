import { SEED_QUERIES } from "../config/sources.js";
import type { RadioScript, RetrievedChunk } from "../domain/types.js";
import type { Retriever } from "../retrieval/retriever.js";
import type { ScriptWriter } from "../script/script-writer.js";
import { DEFAULT_TARGET_WORDS } from "../script/prompt.js";

/** Per seed we pull a few candidates; dedupe then trims across seeds. */
const TOP_K_PER_SEED = 8;

/**
 * Cosine-distance cutoff, calibrated against the real index: the closest chunk
 * for each broad seed sits around 0.46–0.59, so a tighter bound (0.45) drops
 * everything. 0.6 admits the best document of every seed while still excluding
 * genuinely unrelated noise. The document cap below keeps quality after this.
 */
const MAX_DISTANCE = 0.6;

/** Enough distinct stories for the model to choose five good segments from. */
const MAX_DOCUMENTS = 12;

export interface ComposeShowDeps {
  readonly retriever: Retriever;
  readonly writer: ScriptWriter;
}

export interface ComposeShowOptions {
  readonly seedQueries?: readonly string[];
  readonly targetWords?: number;
}

export interface ComposedShow {
  readonly script: RadioScript;
  readonly retrieval: {
    readonly chunksUsed: number;
    readonly documentsUsed: number;
    readonly seedQueries: readonly string[];
  };
}

/**
 * Run the seed queries, keep the best chunk per document, and hand a diverse
 * set to the writer.
 *
 * Dedupe is by `documentId`, not chunk id, and on purpose: two chunks from one
 * article are still one story, and if both survive the model will happily write
 * two segments about it. Keeping only the lowest-distance chunk per document
 * gives the writer distinct stories to choose from.
 */
export async function composeShow(
  deps: ComposeShowDeps,
  options: ComposeShowOptions = {},
): Promise<ComposedShow> {
  const seedQueries = options.seedQueries ?? SEED_QUERIES;
  const targetWords = options.targetWords ?? DEFAULT_TARGET_WORDS;

  // Best (lowest-distance) chunk seen so far for each document.
  const bestByDocument = new Map<string, RetrievedChunk>();

  for (const seed of seedQueries) {
    const result = await deps.retriever.search(seed, {
      topK: TOP_K_PER_SEED,
      maxDistance: MAX_DISTANCE,
    });

    // An empty seed just contributes nothing — skip it rather than forcing a
    // weak segment onto the show.
    for (const rc of result.results) {
      const docId = rc.chunk.documentId;
      const existing = bestByDocument.get(docId);
      if (!existing || rc.distance < existing.distance) {
        bestByDocument.set(docId, rc);
      }
    }
  }

  // Rank the surviving stories by relevance and cap the context budget.
  const chunks = [...bestByDocument.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_DOCUMENTS)
    .map((rc, rank) => ({ ...rc, rank }));

  if (chunks.length === 0) {
    throw new Error(
      "no chunks passed retrieval — is the collection indexed and the distance filter sane?",
    );
  }

  const script = await deps.writer.write(chunks, targetWords);

  return {
    script,
    retrieval: {
      chunksUsed: chunks.length,
      documentsUsed: bestByDocument.size,
      seedQueries,
    },
  };
}
