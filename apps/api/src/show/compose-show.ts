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
  /**
   * Document ids to drop from retrieval before ranking. Phase 7 uses this for
   * cross-episode dedupe — a story that already aired never reaches the writer.
   */
  readonly excludeDocumentIds?: ReadonlySet<string>;
}

export interface RetrievalOutcome {
  /** Deduped (one per document), distance-ranked, and capped to the budget. */
  readonly chunks: readonly RetrievedChunk[];
  /** Seeds that returned nothing under `maxDistance` — a health signal. */
  readonly emptySeeds: readonly string[];
  /** Distinct candidate documents dropped because they were excluded. */
  readonly documentsExcluded: number;
  readonly seedQueries: readonly string[];
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
 * Run the seed queries, drop excluded documents, keep the best chunk per
 * document, and return a diverse, ranked set — the raw material a writer needs.
 *
 * Dedupe is by `documentId`, not chunk id, and on purpose: two chunks from one
 * article are still one story, and if both survive the model will happily write
 * two segments about it. Keeping only the lowest-distance chunk per document
 * gives the writer distinct stories to choose from.
 *
 * Split out from `composeShow` so the show build can inspect and further filter
 * these chunks (near-duplicate detection, guardrails, meta) before spending a
 * paid completion on them.
 */
export async function retrieveForShow(
  retriever: Retriever,
  options: {
    readonly seedQueries?: readonly string[];
    readonly excludeDocumentIds?: ReadonlySet<string>;
  } = {},
): Promise<RetrievalOutcome> {
  const seedQueries = options.seedQueries ?? SEED_QUERIES;
  const exclude = options.excludeDocumentIds ?? new Set<string>();

  // Best (lowest-distance) chunk seen so far for each surviving document.
  const bestByDocument = new Map<string, RetrievedChunk>();
  // Distinct excluded documents we actually saw, for the meta block.
  const excludedSeen = new Set<string>();
  const emptySeeds: string[] = [];

  for (const seed of seedQueries) {
    const result = await retriever.search(seed, {
      topK: TOP_K_PER_SEED,
      maxDistance: MAX_DISTANCE,
    });

    if (result.results.length === 0) {
      emptySeeds.push(seed);
      continue;
    }

    for (const rc of result.results) {
      const docId = rc.chunk.documentId;
      if (exclude.has(docId)) {
        excludedSeen.add(docId);
        continue;
      }
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

  return {
    chunks,
    emptySeeds,
    documentsExcluded: excludedSeen.size,
    seedQueries,
  };
}

/**
 * Retrieve, then write. The HTTP `POST /api/show` route uses this directly; the
 * show build (Phase 7) calls `retrieveForShow` itself so it can apply
 * cross-episode dedupe and guardrails between the two steps.
 */
export async function composeShow(
  deps: ComposeShowDeps,
  options: ComposeShowOptions = {},
): Promise<ComposedShow> {
  const targetWords = options.targetWords ?? DEFAULT_TARGET_WORDS;

  const outcome = await retrieveForShow(deps.retriever, {
    ...(options.seedQueries ? { seedQueries: options.seedQueries } : {}),
    ...(options.excludeDocumentIds
      ? { excludeDocumentIds: options.excludeDocumentIds }
      : {}),
  });

  if (outcome.chunks.length === 0) {
    throw new Error(
      "no chunks passed retrieval — is the collection indexed and the distance filter sane?",
    );
  }

  const script = await deps.writer.write(outcome.chunks, targetWords);

  return {
    script,
    retrieval: {
      chunksUsed: outcome.chunks.length,
      documentsUsed: outcome.chunks.length,
      seedQueries: outcome.seedQueries,
    },
  };
}
