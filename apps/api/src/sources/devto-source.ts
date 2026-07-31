import type { ContentSource } from "./content-source.js";
import type { Document } from "../domain/types.js";
import { cleanText, documentId } from "../ingest/normalise.js";

interface DevtoArticle {
  readonly title: string;
  readonly url: string;
  readonly description: string | null;
  readonly published_at: string | null;
  readonly positive_reactions_count: number | null;
  readonly user: { readonly name?: string } | null;
}

const ENDPOINT = "https://dev.to/api/articles?top=1&per_page=50";

/** Practitioner-flavoured content that balances HN's news bias. No key needed. */
export class DevtoSource implements ContentSource {
  readonly id = "devto";

  async fetchItems(): Promise<readonly Document[]> {
    const res = await fetch(ENDPOINT, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Dev.to responded ${res.status} ${res.statusText}`);
    }

    const articles = (await res.json()) as readonly DevtoArticle[];
    const fetchedAt = new Date().toISOString();

    return articles
      .filter((a) => a.title && a.url)
      .map((a) => ({
        id: documentId(a.url),
        sourceId: this.id,
        title: cleanText(a.title),
        url: a.url,
        ...(a.user?.name ? { author: a.user.name } : {}),
        publishedAt: a.published_at ?? fetchedAt,
        text: cleanText(a.description ?? ""),
        ...(a.positive_reactions_count !== null
          ? { score: a.positive_reactions_count }
          : {}),
        fetchedAt,
      }));
  }
}
