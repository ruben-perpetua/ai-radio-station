import { KokoroTTS } from "kokoro-js";
import { env } from "../config/env.js";
import type { SpeechResult, TtsProvider } from "./tts-provider.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * We cache the *promise*, not the resolved model. The first call kicks off a
 * multi-hundred-megabyte weight download + model init that takes a while; if a
 * second caller arrives before the first finishes, awaiting the same in-flight
 * promise makes them share that one load instead of racing into two downloads.
 * `??=` assigns only on the first call, so every later call returns the settled
 * promise instantly.
 */
let instance: Promise<KokoroTTS> | undefined;

function getModel(): Promise<KokoroTTS> {
  instance ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: env.KOKORO_DTYPE,
    device: "cpu", // 'cpu' is the only real option in Node; wasm/webgpu are browser
    progress_callback: (p: { status?: string; progress?: number }) => {
      // Surface the download so the first run doesn't look like a hang.
      if (p.status === "progress" && typeof p.progress === "number") {
        process.stderr.write(
          `\r  loading model… ${p.progress.toFixed(0)}%   `,
        );
      }
    },
  });
  return instance;
}

/**
 * Start loading in the background without awaiting it. Call this at boot so the
 * first real request awaits an already-in-flight (or finished) load rather than
 * triggering the download itself and appearing to hang.
 */
export function warmModel(): void {
  void getModel();
}

export class KokoroTtsProvider implements TtsProvider {
  readonly modelId = MODEL_ID;

  async synthesise(text: string, voice: string): Promise<SpeechResult> {
    const tts = await getModel();
    // kokoro-js validates the voice id itself and throws on an unknown one,
    // which is the boundary error we want — a typo'd KOKORO_VOICE should fail
    // loudly, not silently fall back.
    const audio = await tts.generate(text, { voice: voice as never });

    // Duration straight from the sample count — no need to parse the WAV header
    // back out. seconds = samples / sampleRate.
    const durationSeconds = audio.audio.length / audio.sampling_rate;

    return {
      wav: new Uint8Array(audio.toWav()),
      durationSeconds,
    };
  }
}
