import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { env } from "../config/env.js";
import {
  HN_MIN_POINTS,
  LOOKBACK_HOURS,
  RSS_FEEDS,
} from "../config/sources.js";
import type { ContentSource } from "../sources/content-source.js";
import { HackerNewsSource } from "../sources/hn-source.js";
import { RssSource } from "../sources/rss-source.js";
import { DevtoSource } from "../sources/devto-source.js";
import { GithubSource } from "../sources/github-source.js";
import type { Document } from "../domain/types.js";
import { deduplicate } from "./normalise.js";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "./chunker.js";
import { ArticleExtractor } from "./extract.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RAW_ROOT = resolve(REPO_ROOT, "data", "raw");

/** Below this many characters a document is worth trying to enrich via extraction. */
const THIN_TEXT_CHARS = 400;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function label(text: string): string {
  return text.padEnd(15, " ");
}

async function runSource(source: ContentSource, since: Date): Promise<Document[]> {
  try {
    const docs = await source.fetchItems(since);
    return [...docs];
  } catch (err) {
    console.warn(`[${source.id}] failed: ${(err as Error).message}`);
    return [];
  }
}

async function enrich(docs: readonly Document[]): Promise<Document[]> {
  const extractor = new ArticleExtractor();
  const out: Document[] = [];
  let enriched = 0;
  for (const doc of docs) {
    if (doc.text.length >= THIN_TEXT_CHARS) {
      out.push(doc);
      continue;
    }
    try {
      const full = await extractor.extract(doc.url);
      if (full && full.length > doc.text.length) {
        out.push({ ...doc, text: full });
        enriched++;
        continue;
      }
    } catch (err) {
      console.warn(`  [extract] ${doc.url}: ${(err as Error).message}`);
    }
    out.push(doc);
  }
  console.log(`${label("extracted")}full text for ${enriched} thin documents`);
  return out;
}

async function persist(docs: readonly Document[], dayDir: string): Promise<number> {
  await mkdir(dayDir, { recursive: true });
  let written = 0;
  for (const doc of docs) {
    const file = resolve(dayDir, `${doc.id}.json`);
    if (existsSync(file)) continue; // never re-fetch/overwrite an existing doc
    await writeFile(file, JSON.stringify(doc, null, 2), "utf8");
    written++;
  }
  return written;
}

async function chunkStats(dayDir: string): Promise<void> {
  const files = (await readdir(dayDir)).filter((f) => f.endsWith(".json"));
  let docCount = 0;
  let chunkCount = 0;
  let totalChars = 0;
  let min = Infinity;
  let max = 0;

  for (const file of files) {
    const doc = JSON.parse(
      await readFile(resolve(dayDir, file), "utf8"),
    ) as Document;
    docCount++;
    for (const chunk of chunkDocument(doc, DEFAULT_CHUNK_OPTIONS)) {
      chunkCount++;
      const len = chunk.text.length;
      totalChars += len;
      min = Math.min(min, len);
      max = Math.max(max, len);
    }
  }

  console.log(`${label("chunked")}${docCount} documents -> ${chunkCount} chunks`);
  if (chunkCount > 0) {
    const avg = Math.round(totalChars / chunkCount);
    console.log(`  avg chunk      ${avg} chars (~${Math.round(avg / 4)} tokens)`);
    console.log(`  min / max      ${min} / ${max} chars`);
  }
}

async function main(): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const hn = new HackerNewsSource(HN_MIN_POINTS);
  const rss = new RssSource(RSS_FEEDS);
  const devto = new DevtoSource();
  const github = new GithubSource(env.GITHUB_TOKEN);

  const hnDocs = await runSource(hn, since);
  console.log(`${label(`[${hn.id}]`)}fetched ${hnDocs.length} items`);

  const rssDocs = await runSource(rss, since);
  console.log(
    `${label(`[${rss.id}]`)}fetched ${rssDocs.length} items across ${RSS_FEEDS.length} feeds`,
  );

  const devtoDocs = await runSource(devto, since);
  console.log(`${label(`[${devto.id}]`)}fetched ${devtoDocs.length} items`);

  const githubDocs = await runSource(github, since);
  console.log(`${label(`[${github.id}]`)}fetched ${githubDocs.length} items`);

  let all = [...hnDocs, ...rssDocs, ...devtoDocs, ...githubDocs];

  if (env.ENABLE_FULL_TEXT_EXTRACTION) {
    all = await enrich(all);
  }

  const deduped = deduplicate(all);
  console.log(
    `${label("deduplicated")}${all.length} -> ${deduped.length} documents`,
  );

  const dayDir = resolve(RAW_ROOT, today());
  const written = await persist(deduped, dayDir);
  console.log(
    `${label("wrote")}${written} documents to data/raw/${today()}`,
  );

  await chunkStats(dayDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
