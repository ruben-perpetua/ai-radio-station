import Parser from "rss-parser";
import type { ContentSource } from "./content-source.js";
import type { Document } from "../domain/types.js";
import type { RssFeed } from "../config/sources.js";
import { cleanText, documentId } from "../ingest/normalise.js";

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  ["content:encoded"]?: string;
};

/**
 * One implementation serving every feed, parameterised by URL. A single feed
 * failing (500, timeout, malformed XML) must never abort the run, so each feed
 * is wrapped independently and failures are logged and skipped.
 */
export class RssSource implements ContentSource {
  readonly id = "rss";
  private readonly parser: Parser<object, FeedItem>;

  constructor(private readonly feeds: readonly RssFeed[]) {
    this.parser = new Parser<object, FeedItem>({
      timeout: 15_000,
      customFields: { item: [["content:encoded", "content:encoded"]] },
    });
  }

  async fetchItems(since: Date): Promise<readonly Document[]> {
    const perFeed = await Promise.all(
      this.feeds.map((feed) => this.fetchFeed(feed, since)),
    );
    return perFeed.flat();
  }

  private async fetchFeed(
    feed: RssFeed,
    since: Date,
  ): Promise<readonly Document[]> {
    try {
      const parsed = await this.parser.parseURL(feed.url);
      const fetchedAt = new Date().toISOString();
      const docs: Document[] = [];

      for (const item of parsed.items ?? []) {
        const url = item.link ?? item.guid;
        if (!url || !item.title) continue;

        const published = this.publishedAt(item, fetchedAt);
        // Skip items clearly older than the lookback window; keep undated ones.
        if (published.dated && new Date(published.iso) < since) continue;

        docs.push({
          id: documentId(url),
          sourceId: feed.id,
          title: cleanText(item.title),
          url,
          ...(item.creator ?? item.author
            ? { author: (item.creator ?? item.author) as string }
            : {}),
          publishedAt: published.iso,
          text: this.bestContent(item),
          fetchedAt,
        });
      }
      return docs;
    } catch (err) {
      console.warn(`  [${feed.id}] skipped: ${(err as Error).message}`);
      return [];
    }
  }

  /** Date fields vary by feed; normalise and default to fetch time when absent. */
  private publishedAt(
    item: FeedItem,
    fetchedAt: string,
  ): { iso: string; dated: boolean } {
    const raw = item.isoDate ?? item.pubDate;
    if (!raw) return { iso: fetchedAt, dated: false };
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return { iso: fetchedAt, dated: false };
    return { iso: parsed.toISOString(), dated: true };
  }

  /** Content fields vary; prefer the longest cleaned candidate. */
  private bestContent(item: FeedItem): string {
    const candidates = [
      item["content:encoded"],
      item.content,
      item.summary,
      item.contentSnippet,
    ]
      .filter((c): c is string => typeof c === "string")
      .map(cleanText);
    return candidates.reduce((best, c) => (c.length > best.length ? c : best), "");
  }
}
