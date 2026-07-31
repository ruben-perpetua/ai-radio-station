# Phase 1 — Ingestion

## Goal

Pull tech news from public APIs and RSS feeds, normalise it into `Document`s, persist it
to disk, and split it into `Chunk`s.

## Why now

Everything downstream is a function of this corpus. Retrieval cannot be better than what
you indexed. Get real data on disk before touching embeddings, so that every later phase
is exercised against real, messy text rather than three hand-written fixtures.

## Deliverables

- `ContentSource` implementations: HN, RSS, Dev.to, GitHub
- Normalisation to `Document` with stable IDs and deduplication
- Documents persisted as JSON under `data/raw/{YYYY-MM-DD}/`
- A chunker with unit tests
- `npm run ingest` CLI printing a summary
- Optional, flag-gated full-text extraction

## Key interfaces

```ts
export interface ContentSource {
  readonly id: string;
  fetchItems(since: Date): Promise<readonly Document[]>;
}
```

## Steps

### 1. Source configuration

Keep sources in config, not code, so you can tune without editing modules.

```ts
// apps/api/src/config/sources.ts
export const RSS_FEEDS = [
  {
    id: "rss:arstechnica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  { id: "rss:theverge", url: "https://www.theverge.com/rss/index.xml" },
  { id: "rss:techcrunch", url: "https://techcrunch.com/feed/" },
  { id: "rss:hn", url: "https://hnrss.org/frontpage?points=100" },
  { id: "rss:lobsters", url: "https://lobste.rs/rss" },
  { id: "rss:changelog", url: "https://changelog.com/feed" },
  { id: "rss:simonw", url: "https://simonwillison.net/atom/everything/" },
  { id: "rss:githubblog", url: "https://github.blog/feed/" },
] as const;

export const HN_MIN_POINTS = 50;
export const LOOKBACK_HOURS = 24;
```

### 2. Hacker News source

The primary source. One request, server-side filtering, no key.

```
https://hn.algolia.com/api/v1/search_by_date
  ?tags=story
  &numericFilters=points>50,created_at_i>{unix}
  &hitsPerPage=100
```

Map each hit to a `Document`:

| Algolia field | `Document` field                                    |
| ------------- | --------------------------------------------------- |
| `objectID`    | used for the HN discussion URL                      |
| `title`       | `title`                                             |
| `url`         | `url` (fall back to the HN item URL for text posts) |
| `points`      | `score`                                             |
| `author`      | `author`                                            |
| `created_at`  | `publishedAt`                                       |
| `story_text`  | `text` (often empty for link posts)                 |

Note that link posts have **no body text** — just a title. That is exactly why Tier 3
extraction exists. Until you enable it, a link post contributes a single very short chunk.

Tune `HN_MIN_POINTS` deliberately: 50 gives breadth, 150 gives only the genuinely big
stories. Try both and look at what lands in the corpus.

### 3. RSS source

One implementation serving all eight feeds, parameterised by URL.

```ts
import Parser from "rss-parser";
```

Per-feed concerns you will hit immediately:

- Date fields vary: `isoDate`, `pubDate`, `published`, or absent. Normalise; default to
  fetch time when missing.
- Content fields vary: `contentSnippet`, `content`, `content:encoded`, `summary`.
  Prefer the longest available.
- Some feeds embed raw HTML in the summary. Strip tags before storing.
- A single feed failing must not abort the run. Wrap each feed and log failures.

### 4. Dev.to and GitHub sources

Both are straightforward JSON APIs. GitHub's search endpoint is rate limited hard when
unauthenticated — read `GITHUB_TOKEN` from env and send it when present, skip the source
with a warning when absent.

### 5. Normalisation and deduplication

```ts
function canonicalUrl(raw: string): string; // strip utm_*, fragments, trailing slash
function documentId(url: string): string; // sha256(canonicalUrl).slice(0, 16)
```

Deduplication matters more than it sounds. The same article routinely appears on HN, in
an Ars Technica feed, and on Lobsters within an hour. Without canonicalisation you index
it three times, and it then occupies three of your five show segments.

Dedupe by canonical URL, keeping the copy with the richest `text` and the highest `score`.

### 6. Persistence

Write one JSON file per document to `data/raw/{YYYY-MM-DD}/{documentId}.json`.

Persisting **before** chunking is deliberate. You will change chunk size and overlap
several times in Phase 2, and each change requires re-chunking every document. Re-reading
local JSON takes a second; re-fetching the internet takes minutes and burns goodwill with
the sources.

Skip any document whose file already exists.

### 7. The chunker

This is the most interesting code in the phase, and it is small.

```ts
// apps/api/src/ingest/chunker.ts
export interface ChunkOptions {
  readonly targetChars: number; // start at 800
  readonly overlapChars: number; // start at 150
  readonly minChars: number; // start at 100
}

export function chunkDocument(
  doc: Document,
  options: ChunkOptions,
): readonly Chunk[];
```

Algorithm:

1. Split the text on paragraph boundaries (`\n\n`).
2. Accumulate paragraphs into a buffer until adding the next would exceed `targetChars`.
3. Emit the buffer as a chunk.
4. Seed the next buffer with the trailing `overlapChars` of the previous one.
5. If a single paragraph exceeds `targetChars`, split it on sentence boundaries.
6. Discard trailing chunks shorter than `minChars`, except when the document produces
   exactly one chunk.
7. **Prefix every chunk with the document title.**

Step 7 is a trick worth understanding. A chunk from the middle of an article often has no
internal signal about its subject — pronouns and continuations only. Prefixing the title
gives the embedding topical anchoring and measurably improves retrieval. Try it both ways
in Phase 3 and watch the scores change.

Unit tests in `chunker.test.ts` — this is a pure function, so test it properly:

- empty text produces no chunks
- text shorter than `targetChars` produces exactly one chunk
- consecutive chunks actually overlap
- an oversized single paragraph is split
- chunk `index` values are sequential from 0
- the title prefix is present on every chunk

### 8. Full-text extraction (optional, flag-gated)

Only when `ENABLE_FULL_TEXT_EXTRACTION=true`.

```ts
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
```

Every one of the following is required, not optional:

```ts
// apps/api/src/ingest/extract.ts
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const PER_HOST_DELAY_MS = 1_000;
```

- **Scheme allowlist** — `https:` only. Reject `http:`, `file:`, `data:`, everything else.
- **Private IP rejection** — resolve the hostname and reject loopback, private, and
  link-local ranges. Re-check after every redirect.
- **robots.txt** — fetch once per host, cache it, honour `Disallow`.
- **User-Agent** — identify the project honestly with a contact URL.
- **Rate limit** — at least 1 second between requests to the same host.
- **Size and time caps** — abort past `MAX_BYTES` or `TIMEOUT_MS`.
- **Cache** — never re-fetch a URL already on disk.

The scheme allowlist and private-IP rejection are SSRF defences, and they are not
theoretical: feed content is attacker-influenceable. A malicious feed entry pointing at
`http://169.254.169.254/` is the textbook cloud-metadata attack. Even locally, build the
habit.

## How to verify

```bash
npm run ingest
```

Expected output:

```
[hn]            fetched  63 items
[rss:...]       fetched  48 items across 8 feeds
[devto]         fetched  30 items
[github]        fetched  25 items
deduplicated   166 -> 141 documents
wrote          141 documents to data/raw/2026-07-31
chunked        141 documents -> 892 chunks
  avg chunk      612 chars (~153 tokens)
  min / max      104 / 800 chars
```

Then read some actual output:

```bash
ls data/raw/$(date +%F) | head
cat data/raw/$(date +%F)/$(ls data/raw/$(date +%F) | head -1) | jq .
```

Do not skip this. Open five random documents and read them. You will discover HTML
entities, truncated summaries, and at least one feed doing something strange. Better to
learn that now than to see it in a script the TTS is reading aloud.

## Learning checkpoints

- Why persist raw documents before chunking?
- Why does chunk overlap exist? What breaks with zero overlap?
- Why prefix each chunk with the document title?
- What happens to retrieval if the same article is indexed three times?
- Why is `https:`-only a security control rather than a style preference?

## Risks and gotchas

| Risk                                        | Mitigation                                     |
| ------------------------------------------- | ---------------------------------------------- |
| One feed 500s and kills the run             | Wrap each source; log and continue             |
| Same story from 3 sources                   | Canonical URL dedupe                           |
| HN link posts have no body                  | Enable extraction, or accept title-only chunks |
| HTML entities read aloud as "amp semicolon" | Decode and strip during normalisation          |
| GitHub rate limit without a token           | Skip the source with a warning                 |
| Feed date formats are inconsistent          | Normalise; default to fetch time               |

## Done criteria

- [ ] `npm run ingest` completes with all four source types
- [ ] 100+ deduplicated documents on disk for today
- [ ] Re-running skips already-fetched documents
- [ ] Chunker tests pass, including the overlap test
- [ ] Summary statistics printed for chunk count and size distribution
- [ ] You have manually read five documents and are satisfied with the text quality
- [ ] Extraction, if enabled, honours robots.txt and rejects non-https URLs
