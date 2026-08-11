import type { RadioScript, SegmentAudio, ShowAudio } from "../domain/types.js";
import { cacheKey, isCached, readAudio, writeAudio } from "./audio-cache.js";
import type { TtsProvider } from "./tts-provider.js";
import { wavDurationSeconds } from "./wav.js";

interface ShowPart {
  readonly partId: string;
  readonly text: string;
}

/** intro, then the five segments in order, then outro — the order we speak. */
function orderedParts(script: RadioScript): ShowPart[] {
  return [
    { partId: "intro", text: script.intro },
    ...script.segments.map((s) => ({ partId: s.id, text: s.text })),
    { partId: "outro", text: script.outro },
  ];
}

export interface SynthesisProgress {
  readonly partId: string;
  readonly index: number; // 0-based position in the ordered parts
  readonly total: number;
  readonly voice: string;
  readonly durationSeconds: number;
  readonly cached: boolean;
  readonly generationMs?: number; // absent on a cache hit
}

export interface SynthesiseShowOptions {
  readonly voiceA: string;
  readonly voiceB: string;
  readonly dtype: string;
  readonly onProgress?: (p: SynthesisProgress) => void;
}

/**
 * Synthesise one WAV per part (seven for a five-segment show), caching each by
 * content hash, and return a manifest the frontend can use without loading any
 * audio.
 *
 * Per-part rather than per-show is deliberate: caching then re-synthesises only
 * the parts whose text changed, a bad part fails in isolation, and Phase 6 gets
 * per-segment files for free (skip + transcript highlight need them).
 *
 * Voices alternate A/B across parts so the show sounds like two hosts. The voice
 * is part of the cache key *and* stored on each part, so switching hosts both
 * invalidates the cache correctly and lets the transcript label who spoke.
 */
export async function synthesiseShow(
  provider: TtsProvider,
  script: RadioScript,
  options: SynthesiseShowOptions,
): Promise<ShowAudio> {
  const parts = orderedParts(script);
  const manifest: SegmentAudio[] = [];

  for (const [index, part] of parts.entries()) {
    const voice = index % 2 === 0 ? options.voiceA : options.voiceB;
    const hash = cacheKey({
      modelId: provider.modelId,
      voice,
      dtype: options.dtype,
      text: part.text,
    });

    let durationSeconds: number;
    let generationMs: number | undefined;
    const cached = isCached(hash);

    if (cached) {
      // We stored only the WAV, not its duration — recover it from the header.
      const buf = await readAudio(hash);
      durationSeconds = wavDurationSeconds(buf!);
    } else {
      const start = performance.now();
      const speech = await provider.synthesise(part.text, voice);
      generationMs = Math.round(performance.now() - start);
      await writeAudio(hash, speech.wav);
      durationSeconds = speech.durationSeconds;
    }

    manifest.push({ partId: part.partId, voice, audioHash: hash, durationSeconds });
    options.onProgress?.({
      partId: part.partId,
      index,
      total: parts.length,
      voice,
      durationSeconds,
      cached,
      ...(generationMs !== undefined ? { generationMs } : {}),
    });
  }

  const totalDurationSeconds = manifest.reduce(
    (sum, p) => sum + p.durationSeconds,
    0,
  );

  return {
    modelId: provider.modelId,
    dtype: options.dtype,
    totalDurationSeconds,
    parts: manifest,
  };
}
