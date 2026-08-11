import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Content-addressed WAVs live here; filenames are the sha256 of their inputs. */
export const AUDIO_ROOT = resolve(REPO_ROOT, "data", "audio");

/** A well-formed cache key: exactly 64 lowercase hex chars (a sha256 digest). */
const HASH_PATTERN = /^[a-f0-9]{64}$/;

/**
 * The cache key is derived from everything that changes the audio: the model,
 * the voice, the quantisation, and the text. Leave any of these out and a voice
 * or dtype change silently returns stale audio in the old voice — a genuinely
 * confusing bug to chase. Including them all makes the filename a faithful
 * fingerprint of exactly how the bytes were produced.
 */
export function cacheKey(input: {
  readonly modelId: string;
  readonly voice: string;
  readonly dtype: string;
  readonly text: string;
}): string {
  return createHash("sha256")
    .update(`${input.modelId}|${input.voice}|${input.dtype}|${input.text}`)
    .digest("hex");
}

export function isValidHash(hash: string): boolean {
  return HASH_PATTERN.test(hash);
}

/**
 * Resolve a hash to its on-disk path, or return null if the hash is malformed
 * or would escape the cache directory.
 *
 * The hex validation already forbids `.` and `/`, so path traversal is
 * impossible before we ever touch the filesystem. The resolved-path check is
 * belt-and-braces: even if the pattern were ever loosened, a path that lands
 * outside AUDIO_ROOT is rejected rather than read.
 */
export function resolveAudioPath(hash: string): string | null {
  if (!isValidHash(hash)) return null;
  const path = resolve(AUDIO_ROOT, `${hash}.wav`);
  if (!path.startsWith(AUDIO_ROOT + sep)) return null;
  return path;
}

export function isCached(hash: string): boolean {
  const path = resolveAudioPath(hash);
  return path !== null && existsSync(path);
}

export async function writeAudio(hash: string, wav: Uint8Array): Promise<void> {
  const path = resolveAudioPath(hash);
  if (!path) throw new Error(`refusing to write malformed audio hash: ${hash}`);
  await mkdir(AUDIO_ROOT, { recursive: true });
  await writeFile(path, wav);
}

export async function readAudio(hash: string): Promise<Buffer | null> {
  const path = resolveAudioPath(hash);
  if (!path || !existsSync(path)) return null;
  return readFile(path);
}
