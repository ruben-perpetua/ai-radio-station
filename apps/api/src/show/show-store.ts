import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Show, ShowAudioSegment, ShowSummary } from "../domain/types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Show artifacts written by the TTS CLI (Phase 5) / show build (Phase 7). */
export const SHOWS_ROOT = resolve(REPO_ROOT, "data", "shows");

// The on-disk artifact holds script and audio separately. We validate only the
// fields the player needs; unknown extras (e.g. `retrieval`) are ignored. An
// audio block is required — a script with no audio is not a playable show.
const segmentSchema = z.object({
  id: z.string(),
  headline: z.string(),
  text: z.string(),
  sourceUrls: z.array(z.string()),
});

const audioPartSchema = z.object({
  partId: z.string(),
  voice: z.string(),
  audioHash: z.string(),
  durationSeconds: z.number(),
});

const artifactSchema = z.object({
  script: z.object({
    showId: z.string(),
    createdAt: z.string(),
    intro: z.string(),
    segments: z.array(segmentSchema),
    outro: z.string(),
  }),
  audio: z.object({
    totalDurationSeconds: z.number(),
    parts: z.array(audioPartSchema),
  }),
});

type Artifact = z.infer<typeof artifactSchema>;

/**
 * Merge the script (text + sources) with the audio manifest (hash + duration +
 * voice) into one flat, ordered `parts` list: intro, each segment, then outro.
 *
 * Audio parts are keyed by `partId`, so we look each one up by the script part's
 * id. If a part has no audio the show is incomplete and we refuse it rather than
 * serving a segment the player cannot fetch.
 */
function toShow(artifact: Artifact): Show {
  const { script, audio } = artifact;
  const byPartId = new Map(audio.parts.map((p) => [p.partId, p]));

  function merge(
    id: string,
    kind: ShowAudioSegment["kind"],
    text: string,
    sourceUrls: readonly string[],
    headline?: string,
  ): ShowAudioSegment {
    const a = byPartId.get(id);
    if (!a) throw new Error(`show ${script.showId} is missing audio for part "${id}"`);
    return {
      id,
      kind,
      ...(headline !== undefined ? { headline } : {}),
      text,
      sourceUrls,
      audioHash: a.audioHash,
      durationSeconds: a.durationSeconds,
      voice: a.voice,
    };
  }

  const parts: ShowAudioSegment[] = [
    merge("intro", "intro", script.intro, []),
    ...script.segments.map((s) =>
      merge(s.id, "segment", s.text, s.sourceUrls, s.headline),
    ),
    merge("outro", "outro", script.outro, []),
  ];

  return {
    showId: script.showId,
    createdAt: script.createdAt,
    totalDurationSeconds: audio.totalDurationSeconds,
    parts,
  };
}

/** Parse a single artifact file into a playable Show, or null if it isn't one. */
async function loadFile(path: string): Promise<Show | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = artifactSchema.safeParse(json);
  if (!parsed.success) return null;
  return toShow(parsed.data);
}

async function listShowFiles(): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(SHOWS_ROOT);
  } catch {
    return []; // no shows directory yet
  }
  return names
    .filter((n) => n.endsWith(".json"))
    // Skip the bookkeeping files that live alongside artifacts: the aired-story
    // history and the in-progress build state are not playable shows.
    .filter((n) => n !== "history.json" && !n.endsWith(".state.json"))
    .map((n) => resolve(SHOWS_ROOT, n));
}

/** The most recently modified playable show, or null if none exists. */
export async function loadLatestShow(): Promise<Show | null> {
  const files = await listShowFiles();
  const withTimes = await Promise.all(
    files.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
  );
  // Newest first, so we return the first file that is actually playable.
  withTimes.sort((a, b) => b.mtime - a.mtime);
  for (const { path } of withTimes) {
    const show = await loadFile(path);
    if (show) return show;
  }
  return null;
}

// A show id may name a file (`2026-08-11`) or match the UUID inside one. Either
// way it becomes a filesystem path, so reject anything that could escape the
// shows directory before touching disk — a classic path-traversal defence.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/** Load a show by filename stem or by internal showId, or null if not found. */
export async function loadShowById(id: string): Promise<Show | null> {
  if (!SAFE_ID.test(id)) return null;

  const direct = resolve(SHOWS_ROOT, `${id}.json`);
  if (direct.startsWith(SHOWS_ROOT + sep)) {
    const show = await loadFile(direct);
    if (show) return show;
  }

  // Fall back to scanning for an artifact whose internal showId matches.
  for (const path of await listShowFiles()) {
    const show = await loadFile(path);
    if (show?.showId === id) return show;
  }
  return null;
}

/**
 * All playable shows as lightweight summaries, newest first. Powers the show
 * picker: the dedupe work is only visible if you can flip between episodes and
 * hear that consecutive shows cover different stories.
 */
export async function listShows(): Promise<ShowSummary[]> {
  const files = await listShowFiles();
  const withTimes = await Promise.all(
    files.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);

  const summaries: ShowSummary[] = [];
  for (const { path } of withTimes) {
    const show = await loadFile(path);
    if (!show) continue;
    summaries.push({
      showId: show.showId,
      createdAt: show.createdAt,
      totalDurationSeconds: show.totalDurationSeconds,
      headlines: show.parts
        .filter((p) => p.kind === "segment" && p.headline)
        .map((p) => p.headline!),
    });
  }
  return summaries;
}
