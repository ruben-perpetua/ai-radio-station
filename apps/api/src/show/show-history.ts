import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AiredStory, Chunk, RetrievedChunk } from "../domain/types.js";
import type { EmbeddingProvider } from "../embeddings/embedding-provider.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const SHOWS_ROOT = resolve(REPO_ROOT, "data", "shows");
const HISTORY_FILE = resolve(SHOWS_ROOT, "history.json");

/** How many days to keep aired stories before pruning. */
const HISTORY_RETENTION_DAYS = 90;

const airedStorySchema = z.object({
  documentId: z.string(),
  canonicalUrl: z.string(),
  headline: z.string(),
  showId: z.string(),
  airedAt: z.string(),
});

const historySchema = z.array(airedStorySchema);

/**
 * Load the history file, pruning entries older than HISTORY_RETENTION_DAYS.
 */
export async function loadHistory(): Promise<AiredStory[]> {
  if (!existsSync(HISTORY_FILE)) {
    return [];
  }

  const content = await readFile(HISTORY_FILE, "utf8");
  const raw = JSON.parse(content);
  const stories = historySchema.parse(raw);

  // Prune old entries.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_RETENTION_DAYS);
  const cutoffTime = cutoff.toISOString();

  return stories.filter((s) => s.airedAt >= cutoffTime);
}

/**
 * Save the history file.
 */
export async function saveHistory(stories: readonly AiredStory[]): Promise<void> {
  await mkdir(SHOWS_ROOT, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(stories, null, 2), "utf8");
}

/**
 * Build a set of documentIds that have aired in the last N days and should be
 * excluded from the current show.
 */
export function excludedDocumentIds(history: readonly AiredStory[]): Set<string> {
  return new Set(history.map((s) => s.documentId));
}

/**
 * Near-duplicate detection across episodes.
 *
 * Exact `documentId` matching misses the common case where Ars Technica and The
 * Verge cover the same story under different URLs (hence different ids). The
 * embeddings catch that semantic overlap: we embed each candidate's headline and
 * each aired headline, and exclude any candidate whose closest aired story is
 * within `NEAR_DUP_THRESHOLD` cosine distance.
 *
 * Both sides are embedded in a single batch each — not per pair — so this costs
 * two embedding calls regardless of how many stories are involved.
 *
 * Returns the `documentId`s of candidates deemed too similar to a recent show.
 */
export async function nearDuplicateDocumentIds(
  candidates: readonly RetrievedChunk[],
  history: readonly AiredStory[],
  embeddings: EmbeddingProvider,
): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (candidates.length === 0 || history.length === 0) {
    return excluded;
  }

  /** ~0.15 cosine distance: same story, near-identical wording, different URL. */
  const NEAR_DUP_THRESHOLD = 0.15;

  const candidateTitles = candidates.map((c) => c.chunk.metadata.title);
  const airedHeadlines = history.map((s) => s.headline);

  // One batch per side; the provider chunks internally if needed.
  const [candidateVecs, airedVecs] = await Promise.all([
    embeddings.embed(candidateTitles),
    embeddings.embed(airedHeadlines),
  ]);

  for (let i = 0; i < candidates.length; i++) {
    const cv = candidateVecs[i];
    if (!cv) continue; // safety: skip if an embedding is missing
    for (const av of airedVecs) {
      if (!av) continue;
      if (cosineDistance(cv, av) < NEAR_DUP_THRESHOLD) {
        excluded.add(candidates[i]!.chunk.documentId);
        break; // one match is enough to exclude this candidate
      }
    }
  }

  return excluded;
}

/**
 * Cosine distance: 1 - dot product of normalized vectors.
 */
function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    aMag += ai * ai;
    bMag += bi * bi;
  }
  const magnitude = Math.sqrt(aMag) * Math.sqrt(bMag);
  if (magnitude === 0) return 1;
  return 1 - dot / magnitude;
}

/**
 * Add new stories to the history.
 */
export function addToHistory(
  existing: readonly AiredStory[],
  chunks: readonly Chunk[],
  showId: string,
  now: Date,
): AiredStory[] {
  const airedAt = now.toISOString();
  const newStories: AiredStory[] = [];
  const seenDocIds = new Set(existing.map((s) => s.documentId));

  for (const chunk of chunks) {
    if (!seenDocIds.has(chunk.documentId)) {
      newStories.push({
        documentId: chunk.documentId,
        canonicalUrl: chunk.metadata.url,
        headline: chunk.metadata.title,
        showId,
        airedAt,
      });
      seenDocIds.add(chunk.documentId);
    }
  }

  return [...existing, ...newStories];
}
