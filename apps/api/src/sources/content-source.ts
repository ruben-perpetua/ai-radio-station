import type { Document } from "../domain/types.js";

/**
 * A single origin of raw content (one API or one set of RSS feeds).
 * Everything that talks to the outside world for ingestion sits behind this seam,
 * so a source can be swapped or tested against a recorded fixture in isolation.
 */
export interface ContentSource {
  readonly id: string;
  fetchItems(since: Date): Promise<readonly Document[]>;
}
