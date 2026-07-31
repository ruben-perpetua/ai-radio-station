import type { ContentSource } from "./content-source.js";
import type { Document } from "../domain/types.js";
import { cleanText, documentId } from "../ingest/normalise.js";

interface AlgoliaHit {
  readonly objectID: string;
  readonly title: string | null;
  readonly url: string | null;
  readonly author: string | null;
  readonly points: number | null;
  readonly created_at: string | null;
  readonly story_text: string | null;
}

interface AlgoliaResponse {
  readonly hits: readonly AlgoliaHit[];
}

const ENDPOINT = "https://hn.algolia.com/api/v1/search_by_date";

/** The primary source: one request, server-side score/date filtering, no key. */
export class HackerNewsSource implements ContentSource {
  readonly id = "hn";

  constructor(private readonly minPoints: number) {}

  async fetchItems(since: Date): Promise<readonly Document[]> {
    const sinceUnix = Math.floor(since.getTime() / 1000);
    const url =
      `${ENDPOINT}?tags=story` +
      `&numericFilters=points>${this.minPoints},created_at_i>${sinceUnix}` +
      `&hitsPerPage=100`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`HN Algolia responded ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as AlgoliaResponse;
    const fetchedAt = new Date().toISOString();

    return data.hits
      .filter((hit) => hit.title)
      .map((hit) => this.toDocument(hit, fetchedAt));
  }

  private toDocument(hit: AlgoliaHit, fetchedAt: string): Document {
    // Link posts have no story_text; text posts have no url. Fall back to the
    // HN discussion page so every document has a resolvable, canonical URL.
    const discussionUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
    const url = hit.url ?? discussionUrl;
    const publishedAt = hit.created_at ?? fetchedAt;

    return {
      id: documentId(url),
      sourceId: this.id,
      title: cleanText(hit.title ?? ""),
      url,
      ...(hit.author ? { author: hit.author } : {}),
      publishedAt,
      text: cleanText(hit.story_text ?? ""),
      ...(hit.points !== null ? { score: hit.points } : {}),
      fetchedAt,
    };
  }
}
