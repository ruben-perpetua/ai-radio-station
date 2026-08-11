export interface SpeechResult {
  readonly wav: Uint8Array;
  readonly durationSeconds: number;
}

/**
 * The fifth core seam: everything about "how do we turn text into audio" lives
 * behind this one interface. Kokoro is today's implementation; an OpenAI-TTS or
 * Piper provider could be swapped in without the show orchestration, cache, or
 * HTTP layer changing.
 *
 * `voice` is a parameter rather than provider state on purpose — one loaded
 * model serves every voice, and a two-host show asks the same provider for two
 * different voices between segments.
 */
export interface TtsProvider {
  readonly modelId: string;
  synthesise(text: string, voice: string): Promise<SpeechResult>;
}
