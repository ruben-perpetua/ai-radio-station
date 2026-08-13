import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { env } from "../config/env.js";
import type {
  AiredStory,
  BuildStage,
  Chunk,
  Document,
  RadioScript,
  ShowAudio,
  ShowBuildArtifact,
  ShowBuildMeta,
  ShowBuildState,
} from "../domain/types.js";
import { OpenAiEmbeddingProvider } from "../embeddings/openai-embeddings.js";
import { ChromaStore } from "../store/chroma-store.js";
import { DefaultRetriever } from "../retrieval/retriever.js";
import { OpenAiScriptWriter } from "../script/openai-script-writer.js";
import { KokoroTtsProvider } from "../tts/kokoro-tts.js";
import { retrieveForShow } from "./compose-show.js";
import { synthesiseShow } from "../tts/synthesise-show.js";
import {
  addToHistory,
  excludedDocumentIds,
  loadHistory,
  nearDuplicateDocumentIds,
  saveHistory,
  SHOWS_ROOT,
} from "./show-history.js";
import type { ContentSource } from "../sources/content-source.js";
import { HackerNewsSource } from "../sources/hn-source.js";
import { RssSource } from "../sources/rss-source.js";
import { DevtoSource } from "../sources/devto-source.js";
import { GithubSource } from "../sources/github-source.js";
import { deduplicate } from "../ingest/normalise.js";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "../ingest/chunker.js";
import { ArticleExtractor } from "../ingest/extract.js";
import { HN_MIN_POINTS, LOOKBACK_HOURS, RSS_FEEDS, SEED_QUERIES } from "../config/sources.js";
import { DEFAULT_TARGET_WORDS } from "../script/prompt.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RAW_ROOT = resolve(REPO_ROOT, "data", "raw");

/** Ordered pipeline stages; a build resumes from the last one it completed. */
const STAGES: readonly BuildStage[] = [
  "ingested",
  "indexed",
  "scripted",
  "synthesised",
  "complete",
];

/** Below this many distinct stories the show is not worth airing. */
const MIN_DOCUMENTS = 3;
/** A show shorter than this is almost certainly a generation failure. */
const MIN_DURATION_SECONDS = 90;

interface Cli {
  readonly skipIngest: boolean;
  readonly dryRun: boolean;
  readonly buildId: string;
}

/**
 * showId is a fixed UTC calendar date, never local time. Two people in
 * different timezones building "today's show" must produce the same id, and
 * yesterday's raw folder must be found by the same string that wrote it.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCli(argv: readonly string[]): Cli {
  const args = [...argv];
  const skipIngest = args.includes("--skip-ingest");
  const dryRun = args.includes("--dry-run");

  // Accept both `--date=2026-07-30` and `--date 2026-07-30`.
  let date: string | undefined;
  const eq = args.find((a) => a.startsWith("--date="));
  if (eq) date = eq.slice("--date=".length);
  const flagIdx = args.indexOf("--date");
  if (flagIdx !== -1 && args[flagIdx + 1] && !args[flagIdx + 1]!.startsWith("--")) {
    date = args[flagIdx + 1];
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`--date must be YYYY-MM-DD, got "${date}"`);
  }

  return { skipIngest, dryRun, buildId: date ?? todayUtc() };
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function statePath(buildId: string): string {
  return resolve(SHOWS_ROOT, `${buildId}.state.json`);
}

function artifactPath(buildId: string): string {
  return resolve(SHOWS_ROOT, `${buildId}.json`);
}

async function readState(buildId: string): Promise<ShowBuildState | null> {
  const path = statePath(buildId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as ShowBuildState;
  } catch {
    return null; // A corrupt state file just means we start over.
  }
}

async function writeState(state: ShowBuildState): Promise<void> {
  await mkdir(SHOWS_ROOT, { recursive: true });
  await writeFile(statePath(state.showId), JSON.stringify(state, null, 2), "utf8");
}

/** True when the recorded state has already passed `stage`. */
function reached(state: ShowBuildState | null, stage: BuildStage): boolean {
  if (!state) return false;
  return STAGES.indexOf(state.stage) >= STAGES.indexOf(stage);
}

async function readRawDocuments(buildId: string): Promise<Document[]> {
  const dayDir = resolve(RAW_ROOT, buildId);
  if (!existsSync(dayDir)) return [];
  const files = (await readdir(dayDir)).filter((f) => f.endsWith(".json"));
  const docs: Document[] = [];
  for (const file of files) {
    docs.push(JSON.parse(await readFile(resolve(dayDir, file), "utf8")) as Document);
  }
  return docs;
}

async function ingestDocuments(buildId: string): Promise<Document[]> {
  log("Ingesting from content sources…");
  const since = new Date();
  since.setHours(since.getHours() - LOOKBACK_HOURS);

  const sources: ContentSource[] = [
    new HackerNewsSource(HN_MIN_POINTS),
    new RssSource(RSS_FEEDS),
    new DevtoSource(),
    new GithubSource(env.GITHUB_TOKEN),
  ];

  let docs: Document[] = [];
  for (const source of sources) {
    try {
      docs.push(...(await source.fetchItems(since)));
    } catch (err) {
      log(`  [${source.id}] failed: ${(err as Error).message}`);
    }
  }

  docs = deduplicate(docs);

  if (env.ENABLE_FULL_TEXT_EXTRACTION) {
    const extractor = new ArticleExtractor();
    const enriched: Document[] = [];
    for (const doc of docs) {
      if (doc.text.length < 400) {
        try {
          const full = await extractor.extract(doc.url);
          enriched.push(full ? { ...doc, text: full } : doc);
        } catch {
          enriched.push(doc);
        }
      } else {
        enriched.push(doc);
      }
    }
    docs = enriched;
  }

  const dayDir = resolve(RAW_ROOT, buildId);
  await mkdir(dayDir, { recursive: true });
  for (const doc of docs) {
    await writeFile(resolve(dayDir, `${doc.id}.json`), JSON.stringify(doc, null, 2));
  }
  log(`Ingested ${docs.length} documents → data/raw/${buildId}`);
  return docs;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const cli = parseCli(process.argv.slice(2));
  await mkdir(SHOWS_ROOT, { recursive: true });

  let state = await readState(cli.buildId);
  if (state) {
    log(`Resuming build ${cli.buildId} from stage "${state.stage}".`);
  } else {
    state = { showId: cli.buildId, stage: "ingested", errors: [] };
  }

  // Shared clients: one embedding provider instance so token usage across
  // indexing, retrieval and near-dup detection lands in a single counter.
  const embeddings = new OpenAiEmbeddingProvider();
  const store = new ChromaStore();
  const retriever = new DefaultRetriever(embeddings, store);
  const writer = new OpenAiScriptWriter();

  // ---- Stage 1: ingest ----------------------------------------------------
  let documents: Document[] = [];
  if (!reached(state, "indexed")) {
    documents = cli.skipIngest
      ? await readRawDocuments(cli.buildId)
      : await ingestDocuments(cli.buildId);

    // Guardrail 1: nothing to work with.
    if (documents.length === 0) {
      throw new Error(
        cli.skipIngest
          ? `No raw documents at data/raw/${cli.buildId}. Run without --skip-ingest first.`
          : "Ingestion returned zero documents — every source failed or is empty.",
      );
    }
    state = { ...state, stage: "ingested" };
    await writeState(state);
  }

  // ---- Stage 2: index -----------------------------------------------------
  let documentsConsidered = state.meta?.documentsConsidered ?? documents.length;
  if (!reached(state, "indexed")) {
    const chunks: Chunk[] = [];
    for (const doc of documents) {
      chunks.push(...chunkDocument(doc, DEFAULT_CHUNK_OPTIONS));
    }
    log(`Indexing ${chunks.length} chunks from ${documents.length} documents…`);
    await store.ensureCollection(embeddings.modelId, embeddings.dimensions);
    const vectors = await embeddings.embed(chunks.map((c) => c.text));
    await store.upsert(chunks, vectors);

    documentsConsidered = documents.length;
    state = { ...state, stage: "indexed" };
    await writeState(state);
  } else {
    log("Index stage already complete — reusing the existing collection.");
  }

  // ---- Stage 3: retrieve, dedupe across episodes, write script -----------
  let script: RadioScript;
  let meta: ShowBuildMeta;
  let airedStories: readonly AiredStory[];
  if (!reached(state, "scripted")) {
    await store.ensureCollection(embeddings.modelId, embeddings.dimensions);

    const history = await loadHistory();
    const excludedByHistory = excludedDocumentIds(history);

    log(`Retrieving per seed, excluding ${excludedByHistory.size} aired documents…`);
    const outcome = await retrieveForShow(retriever, {
      seedQueries: SEED_QUERIES,
      excludeDocumentIds: excludedByHistory,
    });

    // Guardrail 2: every seed came back empty — the index is broken, not niche.
    if (outcome.emptySeeds.length === outcome.seedQueries.length) {
      throw new Error(
        "Every seed query returned nothing under the distance filter — is the collection indexed?",
      );
    }

    // Near-duplicate pass: the same story under a different URL/documentId.
    const nearDup = await nearDuplicateDocumentIds(outcome.chunks, history, embeddings);
    const finalChunks = outcome.chunks.filter((c) => !nearDup.has(c.chunk.documentId));
    const documentsExcludedAsAired = outcome.documentsExcluded + nearDup.size;
    if (nearDup.size > 0) log(`Excluded ${nearDup.size} near-duplicate stories.`);

    // Guardrail 3: too few distinct stories to make a real show.
    if (finalChunks.length < MIN_DOCUMENTS) {
      throw new Error(
        `Only ${finalChunks.length} usable documents after dedupe (need ${MIN_DOCUMENTS}). ` +
          "Ingest more sources, widen the distance filter, or prune history.",
      );
    }

    log(`Writing script from ${finalChunks.length} stories…`);
    // Guardrails 4 (zod twice) and 5 (URL outside the retrieved set) live inside
    // the writer, which throws rather than returning a tainted script.
    script = await writer.write(finalChunks, DEFAULT_TARGET_WORDS);

    // Record what the script actually cited, so only aired stories enter history.
    const byUrl = new Map(finalChunks.map((c) => [c.chunk.metadata.url, c]));
    const cited = new Map<string, AiredStory>();
    for (const segment of script.segments) {
      for (const url of segment.sourceUrls) {
        const rc = byUrl.get(url);
        if (rc && !cited.has(rc.chunk.documentId)) {
          cited.set(rc.chunk.documentId, {
            documentId: rc.chunk.documentId,
            canonicalUrl: rc.chunk.metadata.url,
            headline: rc.chunk.metadata.title,
            showId: script.showId,
            airedAt: new Date().toISOString(),
          });
        }
      }
    }
    airedStories = [...cited.values()];

    meta = {
      seedQueries: [...SEED_QUERIES],
      documentsConsidered,
      documentsExcludedAsAired,
      chunksRetrieved: finalChunks.length,
      embeddingTokens: embeddings.tokensUsed,
      chatTokens: writer.tokensUsed,
      buildDurationSeconds: 0, // filled in at completion
    };

    state = { ...state, stage: "scripted", script, meta, airedStories };
    await writeState(state);
    log(`Script ready: ${script.wordCount} words, ${script.segments.length} segments.`);
  } else {
    script = state.script!;
    meta = state.meta!;
    airedStories = state.airedStories ?? [];
    log("Script stage already complete — reusing the saved script.");
  }

  // --dry-run stops here: no audio, no artifact, no history mutation.
  if (cli.dryRun) {
    log("Dry run — skipping synthesis and artifact write.");
    console.log(JSON.stringify(script, null, 2));
    return;
  }

  // ---- Stage 4: synthesise audio -----------------------------------------
  let audio: ShowAudio;
  if (!reached(state, "synthesised")) {
    log("Synthesising audio (cached parts are reused)…");
    const tts = new KokoroTtsProvider();
    audio = await synthesiseShow(tts, script, {
      voiceA: env.KOKORO_VOICE,
      voiceB: env.KOKORO_VOICE_B,
      dtype: env.KOKORO_DTYPE,
      onProgress: (p) =>
        log(
          `  part ${p.index + 1}/${p.total} (${p.partId}) ${p.durationSeconds.toFixed(1)}s ` +
            `${p.cached ? "cached" : `synthesised in ${p.generationMs}ms`}`,
        ),
    });

    // Guardrail 6: a suspiciously short show — warn, do not abort.
    if (audio.totalDurationSeconds < MIN_DURATION_SECONDS) {
      log(
        `WARNING: show is only ${audio.totalDurationSeconds.toFixed(0)}s ` +
          `(< ${MIN_DURATION_SECONDS}s). Consider raising targetWords.`,
      );
    }
    state = { ...state, stage: "synthesised", audio };
    await writeState(state);
  } else {
    audio = state.audio!;
    log("Synthesis stage already complete — reusing existing audio.");
  }

  // ---- Stage 5: write artifact & update history --------------------------
  const finalMeta: ShowBuildMeta = {
    ...meta,
    buildDurationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  const artifact: ShowBuildArtifact = {
    showId: script.showId,
    createdAt: script.createdAt,
    script,
    audio,
    meta: finalMeta,
  };
  await writeFile(artifactPath(cli.buildId), JSON.stringify(artifact, null, 2), "utf8");

  const history = await loadHistory();
  await saveHistory(
    addToHistory(history, airedStoriesToChunks(airedStories), script.showId, new Date()),
  );

  state = { ...state, stage: "complete", audio, meta: finalMeta };
  await writeState(state);
  // The build is done; the state file has served its purpose.
  await rm(statePath(cli.buildId), { force: true });

  log(`Show built: ${artifactPath(cli.buildId)}`);
  log(
    `meta: ${finalMeta.chunksRetrieved} stories, ${finalMeta.documentsExcludedAsAired} excluded as aired, ` +
      `${audio.totalDurationSeconds.toFixed(0)}s, ${finalMeta.embeddingTokens} embed + ` +
      `${finalMeta.chatTokens} chat tokens, ${finalMeta.buildDurationSeconds}s.`,
  );
}

/**
 * `addToHistory` takes chunks, but on resume we only have the persisted
 * `AiredStory` rows. Adapt them to the minimal chunk shape it reads.
 */
function airedStoriesToChunks(stories: readonly AiredStory[]): Chunk[] {
  return stories.map((s) => ({
    id: `${s.documentId}:0`,
    documentId: s.documentId,
    index: 0,
    text: "",
    tokenEstimate: 0,
    metadata: {
      title: s.headline,
      url: s.canonicalUrl,
      sourceId: "",
      publishedAt: s.airedAt,
    },
  }));
}

main().catch((err) => {
  console.error("Build failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
