# 00 — Overview

## The concept

A radio station with no humans in it. Every day the system:

1. Pulls fresh tech news from public APIs and RSS feeds.
2. Splits the articles into chunks and stores them in a vector database.
3. Retrieves the most relevant chunks for the day's show.
4. Asks an LLM to write a short radio script grounded in those chunks.
5. Speaks the script with a local text-to-speech model.
6. Plays the audio in the browser with the transcript and source links visible.

Alongside all of that sits a **retrieval debug panel**: a text box where you type any
query and see exactly what comes back from the vector database, with similarity scores.
This is a first-class feature, not an afterthought — see "Why the debug panel matters".

## Goals

This is a learning project. The goals are ordered by importance:

1. **Understand RAG end to end** — chunking, embeddings, vector search, ranking, and
   how retrieval quality determines output quality.
2. **Build intuition for similarity scores** — what a "good" match looks like numerically.
3. **Practise clean TypeScript architecture** — swappable providers behind narrow interfaces.
4. **Run models locally** — know what a local TTS model costs you in latency and quality.
5. **Ship something that is genuinely fun to demo.**

## Non-goals

Explicitly out of scope, so we do not accidentally drift into them:

- Multi-user accounts, auth, or persistence beyond local files.
- Production deployment, scaling, or high availability.
- Voice cloning or custom voice training.
- A RAG framework (LangChain, LlamaIndex). See
  [02-stack-decisions.md](02-stack-decisions.md) for why we hand-roll instead.
- Mobile apps, native apps, or offline-first behaviour.
- Real-time / live streaming radio. Shows are built, then played.

## The 2-minute constraint, quantified

Conversational radio delivery runs about **150–160 words per minute**. So:

| Target                         | Words |
| ------------------------------ | ----- |
| 2:00 minimum                   | ~300  |
| 2:20 comfortable target        | ~360  |
| Hard ceiling (keeps it snappy) | ~450  |

We will target **360 words**, giving margin above the 2-minute floor.

Broken into a show structure:

| Part           | Count | Words each | Subtotal |
| -------------- | ----- | ---------- | -------- |
| Intro          | 1     | ~35        | 35       |
| Story segments | 5     | ~55        | 275      |
| Outro          | 1     | ~35        | 35       |
| **Total**      |       |            | **~345** |

The important consequence: **the bottleneck is not word count, it is having 5–6 distinct,
fresh, interesting stories per show.** Our ingestion strategy is sized for story variety,
not raw text volume.

## Content sources

### Tier 1 — official APIs, no key, no scraping

These form the spine of the corpus.

**Hacker News via the Algolia Search API** — the primary source.

```
https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points>50,created_at_i>{yesterday_unix}&hitsPerPage=100
```

- Free, no API key, no auth.
- Returns `title`, `url`, `points`, `num_comments`, `author`, `created_at`, `objectID`.
- The `points>50` filter is your quality gate — tune it. Higher = fewer, better stories.
- Yields roughly **40–80 stories per day**. Already more than enough for 5 segments.

Why Algolia rather than the Firebase API (`hacker-news.firebaseio.com`)? Firebase gives
you 500 story IDs and forces one HTTP request per item, with no date or score filtering.
Algolia does the filtering server-side in a single request. Use Firebase only if you
later want comment threads.

**Dev.to** — official, free, no key.

```
https://dev.to/api/articles?top=1&per_page=50
```

Good for practitioner-flavoured content that balances HN's news bias.

**GitHub Search API** — official, token recommended for rate limits.

```
https://api.github.com/search/repositories?q=created:>{7_days_ago}&sort=stars&order=desc&per_page=25
```

Gives you a "new and trending projects" segment, which is a nice change of pace from
news. Unauthenticated is 10 req/min; a personal access token raises it to 30 req/min.

### Tier 2 — publisher RSS/Atom feeds

Publisher-provided, intended for exactly this use. Start with these eight:

| Publisher              | Feed                                              |
| ---------------------- | ------------------------------------------------- |
| Ars Technica           | `https://feeds.arstechnica.com/arstechnica/index` |
| The Verge              | `https://www.theverge.com/rss/index.xml`          |
| TechCrunch             | `https://techcrunch.com/feed/`                    |
| Hacker News front page | `https://hnrss.org/frontpage?points=100`          |
| Lobsters               | `https://lobste.rs/rss`                           |
| The Changelog          | `https://changelog.com/feed`                      |
| Simon Willison         | `https://simonwillison.net/atom/everything/`      |
| GitHub Blog            | `https://github.blog/feed/`                       |

Keep the list in a config file, not in code, so you can tune it without a rebuild.

**The catch:** most feeds give you a _summary_, typically 20–60 words, not the full
article. That is often enough for a 55-word radio segment — but it is thin material for
demonstrating retrieval. Which leads to Tier 3.

### Tier 3 — full-text extraction (optional, be careful)

To get real article bodies you fetch the page and extract the readable content with
`@mozilla/readability` + `jsdom`.

This is genuinely useful for the project, because **a corpus of 60-word summaries barely
exercises chunking at all** — you need multi-paragraph documents before chunk size,
overlap, and ranking become interesting.

Do it politely and defensively:

- Check and honour `robots.txt` before fetching.
- Send an honest `User-Agent` identifying the project.
- Rate limit to roughly 1 request per second per host.
- Cache aggressively on disk; never re-fetch a URL you already have.
- Cap response size (e.g. 2 MB) and set a request timeout.
- HTTPS only; reject redirects to private IP ranges.
- Personal, local, non-redistributed use only.

The last four bullets are not just etiquette — they are SSRF and resource-exhaustion
defences. See [01-architecture.md](01-architecture.md) for the security seam.

**Recommendation:** ship Phase 1 with Tier 1 + Tier 2 only. Add Tier 3 as the last step
of Phase 1 once the pipeline works, and gate it behind a config flag.

### Expected corpus size

| Source          | Items/day | Avg words after extraction          |
| --------------- | --------- | ----------------------------------- |
| HN (points>50)  | 40–80     | 400–1200                            |
| RSS feeds (8)   | 30–60     | 60 (summary) / 500–1500 (extracted) |
| Dev.to          | 20–50     | 500–2000                            |
| GitHub trending | 25        | 50–200                              |

Roughly **115–215 documents/day**, producing **500–2000 chunks**. Against a need for
~20 retrieved chunks per show, that is a very comfortable margin — and a large enough
corpus that retrieval quality actually matters, which is the point.

## Why the debug panel matters

When a RAG system produces a bad answer, the instinct is to blame the LLM and start
rewriting prompts. That instinct is usually wrong. **Most RAG failures are retrieval
failures**: the right chunk was never in the context window, so no prompt could have
saved it.

The debug panel makes retrieval visible. For any query it shows:

- the ranked chunks actually returned
- the **similarity score** for each one
- source URL, chunk index, and token count
- the embedding dimension count
- the **fully assembled prompt** that would be sent to the LLM

Building this in Phase 3 — before the LLM exists — means you tune chunking and retrieval
while the system is still simple enough to reason about.

## Glossary

| Term                      | Meaning here                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| **Document**              | One normalised article or post from a source.                                 |
| **Chunk**                 | A slice of a document, sized to be embedded and retrieved independently.      |
| **Embedding**             | A fixed-length vector of floats representing text meaning.                    |
| **Dimension**             | The length of that vector. `text-embedding-3-small` is 1536.                  |
| **Collection**            | A named set of vectors in Chroma. All must share one dimension.               |
| **Top-k**                 | How many nearest chunks a query returns.                                      |
| **Distance / similarity** | How close two vectors are. Chroma returns _distance_ — lower is more similar. |
| **Grounding**             | Constraining the LLM to only state things supported by retrieved chunks.      |
| **Segment**               | One story within a show.                                                      |
| **Show**                  | A complete script plus its audio: intro, segments, outro.                     |
