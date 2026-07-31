import type { ContentSource } from "./content-source.js";
import type { Document } from "../domain/types.js";
import { cleanText, documentId } from "../ingest/normalise.js";

interface GithubRepo {
  readonly full_name: string;
  readonly html_url: string;
  readonly description: string | null;
  readonly created_at: string;
  readonly stargazers_count: number;
  readonly owner: { readonly login?: string } | null;
}

interface GithubSearchResponse {
  readonly items: readonly GithubRepo[];
}

/** Trending new repositories — a change of pace from news. */
export class GithubSource implements ContentSource {
  readonly id = "github";

  constructor(private readonly token: string | undefined) {}

  async fetchItems(): Promise<readonly Document[]> {
    // Unauthenticated GitHub search is throttled hard; skip cleanly without one.
    if (!this.token) {
      console.warn("  [github] skipped: no GITHUB_TOKEN set");
      return [];
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const url =
      "https://api.github.com/search/repositories" +
      `?q=created:>${weekAgo}&sort=stars&order=desc&per_page=25`;

    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`GitHub responded ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GithubSearchResponse;
    const fetchedAt = new Date().toISOString();

    return data.items.map((repo) => ({
      id: documentId(repo.html_url),
      sourceId: this.id,
      title: repo.full_name,
      url: repo.html_url,
      ...(repo.owner?.login ? { author: repo.owner.login } : {}),
      publishedAt: repo.created_at,
      text: cleanText(repo.description ?? ""),
      score: repo.stargazers_count,
      fetchedAt,
    }));
  }
}
