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
  { id: "rss:mit-technology-review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/" },
  { id: "rss:venturebeat-ai", url: "https://venturebeat.com/category/ai/feed/" },
  { id: "rss:arxiv-ai", url: "https://rss.arxiv.org/rss/cs.AI" },
  { id: "rss:arxiv-ml", url: "https://rss.arxiv.org/rss/cs.LG" },
  { id: "rss:huggingface", url: "https://huggingface.co/blog/feed.xml" },
] as const;

export type RssFeed = (typeof RSS_FEEDS)[number];

/** HN quality gate: 50 gives breadth, 150 gives only the genuinely big stories. */
export const HN_MIN_POINTS = 50;

/** How far back each run looks for fresh items. */
export const LOOKBACK_HOURS = 24;

/**
 * One query per topic, not one broad query. A single "tech news" search returns
 * five variations on whatever story dominates the index; retrieving per topic
 * forces spread so the show covers AI *and* security *and* hardware, etc.
 * The writer still picks the best segments — these only shape what it sees.
 */
// TEST QUERIES 1
// export const SEED_QUERIES = [
//   "artificial intelligence and machine learning",
//   "programming languages and developer tools",
//   "security vulnerabilities and privacy",
//   "startups, funding and the tech industry",
//   "open source projects and releases",
//   "hardware, chips and infrastructure",
//   "cloud infrastructure and DevOps",
//   "cryptocurrency and blockchain",
// ] as const;

// TEST QUERIES 2
// export const SEED_QUERIES = [
//   "AI models, LLMs and generative AI",
//   "AI agents and agentic systems",
//   "AI coding tools and developer assistants",
//   "AI research, machine learning and deep learning",
//   "AI startups, funding and acquisitions",
//   "programming languages, frameworks and developer tools",
//   "software engineering and developer productivity",
//   "open source software and major releases",
//   "GitHub, Git and developer ecosystem",
//   "cybersecurity vulnerabilities and exploits",
//   "application security, supply chain security and privacy",
//   "cloud computing, DevOps and platform engineering",
//   "GPUs, AI chips, semiconductors and data centers",
//   "databases, distributed systems and infrastructure",
//   "technology startups, venture capital and funding",
//   "Big Tech product launches and acquisitions",
//   "technology industry business and regulation",
//   "AI regulation, policy and antitrust",
//   "computer science research and new papers",
//   "AI benchmarks, evaluations and model performance",
// ] as const;

export const SEED_QUERIES = [
  // AI models
  "LLM AI models",
  "generative AI",
  "foundation models",
  "multimodal AI",

  // AI agents
  "AI agents",
  "agentic AI",
  "coding agents",
  "computer use AI",

  // AI development
  "AI coding tools",
  "AI developer tools",
  "AI APIs and SDKs",
  "inference and AI infrastructure",

  // AI research
  "machine learning research",
  "AI research",
  "AI benchmarks evaluations",
  "reasoning models",
  "AI training techniques",

  // Open source AI
  "open source AI models",
  "open source LLMs",
  "Hugging Face models",

  // AI companies
  "AI startups funding",
  "AI acquisitions",
  "OpenAI",
  "Anthropic",
  "Google DeepMind",
  "Meta AI",
  "Mistral AI",
  "xAI",

  // Developer ecosystem
  "programming languages",
  "developer tools",
  "software engineering",
  "open source software",
  "GitHub",

  // Infrastructure
  "GPUs AI chips",
  "semiconductors",
  "data centers",
  "cloud computing",
  "DevOps",

  // Security
  "cybersecurity vulnerabilities",
  "software supply chain security",
  "AI security",
  "prompt injection",
  "privacy",

  // Industry
  "technology startups funding",
  "Big Tech",
  "technology acquisitions",
  "AI regulation",
  "AI policy",
] as const;
