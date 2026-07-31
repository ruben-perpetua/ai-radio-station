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

export type RssFeed = (typeof RSS_FEEDS)[number];

/** HN quality gate: 50 gives breadth, 150 gives only the genuinely big stories. */
export const HN_MIN_POINTS = 50;

/** How far back each run looks for fresh items. */
export const LOOKBACK_HOURS = 24;
