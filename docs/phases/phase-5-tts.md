# Phase 5 — Text to Speech

## Goal

Speak the script with Kokoro running locally in Node, cache the audio by content hash, and
serve it over HTTP.

## Why now

The script exists and is validated. This is the phase where the project stops being a RAG
demo and becomes a radio station.

## Deliverables

- `TtsProvider` interface + Kokoro implementation
- Lazy, singleton model loading
- Per-segment synthesis with content-hash caching
- `GET /api/audio/:hash` serving WAV with correct headers
- Duration metadata attached to each segment
- A CLI to synthesise a script to disk

## Key interfaces

```ts
export interface SpeechResult {
  readonly wav: Uint8Array;
  readonly durationSeconds: number;
}

export interface TtsProvider {
  readonly modelId: string;
  synthesise(text: string, voice: string): Promise<SpeechResult>;
}
```

## Steps

### 1. Kokoro provider

```ts
// apps/api/src/tts/kokoro-tts.ts
import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
```

Loading:

```ts
const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
  dtype: "q8", // 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  device: "cpu", // 'cpu' in Node; 'wasm' | 'webgpu' in browsers
});

const audio = await tts.generate(text, { voice: "af_heart" });
```

Two things to get right immediately:

**Load lazily and exactly once.** The first `from_pretrained` downloads several hundred MB
of weights and takes a while; subsequent runs hit the local cache but model init is still
slow. Loading per request would be catastrophic.

```ts
let instance: Promise<KokoroTTS> | undefined;

function getModel(): Promise<KokoroTTS> {
  instance ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: "cpu",
  });
  return instance;
}
```

Caching the **promise**, not the resolved value, means concurrent first-callers share one
load rather than racing into several.

**Do not block server startup on it.** Trigger the load in the background at boot and let
the first request await the same promise. Otherwise `npm run dev:api` appears to hang.

### 2. Choose `dtype` by experiment

| dtype  | Size        | Speed   | Quality             |
| ------ | ----------- | ------- | ------------------- |
| `fp32` | Largest     | Slowest | Best                |
| `q8`   | ~4× smaller | Fast    | Very close to fp32  |
| `q4`   | Smallest    | Fastest | Noticeably degraded |

Start at `q8`. Generate the same paragraph at `q8` and `fp32` and listen to both back to
back — quantisation quality loss is a concept far better learned by ear than by reading a
table.

### 3. Voices

Kokoro ships roughly 28 English voices. Naming: first letter is accent (`a` American,
`b` British), second is gender (`f`/`m`).

| Voice        | Notes                                  |
| ------------ | -------------------------------------- |
| `af_heart`   | American female, highest rated overall |
| `af_bella`   | American female, strong quality grade  |
| `am_michael` | American male                          |
| `am_fenrir`  | American male                          |
| `bf_emma`    | British female                         |
| `bm_george`  | British male                           |

Make the voice configurable via `KOKORO_VOICE`. Generate the same sentence in five voices
and pick by ear — the quality grades in the model card do not fully predict what sounds
right for news delivery.

**Two-host option:** alternate `af_heart` and `am_michael` across segments. It is a
one-line change and makes a 2-minute show markedly more listenable. Store the voice on
each segment so the transcript UI can label speakers in Phase 6.

### 4. Synthesise per segment, not per show

Generate one WAV per segment plus intro and outro — seven files for a five-segment show.

Why per segment:

- **Caching works.** Regenerating a show where only two stories changed re-synthesises
  only two segments.
- **Phase 6 needs it.** Per-segment audio makes transcript highlighting and per-segment
  skip trivial. Deriving those from one monolithic file requires timing alignment you do
  not want to build.
- **Failures isolate.** One bad segment does not lose the whole show.
- **Progress is reportable.** "Segment 3 of 7" beats a spinner.

### 5. Content-hash cache

```ts
// apps/api/src/tts/audio-cache.ts
const key = createHash("sha256")
  .update(`${modelId}|${voice}|${dtype}|${text}`)
  .digest("hex");
// → data/audio/{key}.wav
```

Include model, voice, and dtype in the hash. Changing voice must produce a different key,
otherwise you get stale audio in the old voice and a genuinely confusing debugging session.

Hash-derived filenames are also the path-traversal defence: no user-supplied string ever
reaches the filesystem. Validate the requested hash against `/^[a-f0-9]{64}$/` before
touching disk, and resolve the final path to confirm it is still inside the cache
directory.

### 6. Duration

You need duration for the player's progress UI. Either compute it from the WAV header
(`dataChunkBytes / (sampleRate * channels * bytesPerSample)`) or read it from the sample
count Kokoro returns. Store it in the show artifact so the frontend does not have to load
every file to know the total runtime.

### 7. Audio route

```
GET /api/audio/:hash
```

- Validate the hash format before any filesystem access.
- `Content-Type: audio/wav`
- `Accept-Ranges: bytes` and honour `Range` requests — browsers use range requests to
  seek, and without support the scrubber will misbehave.
- `Cache-Control: public, max-age=31536000, immutable` — content-addressed files never
  change.
- 404 for a well-formed hash that is not on disk; 400 for a malformed one.

### 8. CLI

```bash
npm run tts -- data/shows/2026-07-31.json
```

```
synthesising show 2026-07-31 · voice af_heart · q8
  intro       [====] 6.2s   cached
  segment 1   [====] 21.4s  generated in 18.1s
  segment 2   [====] 19.8s  cached
  ...
  outro       [====] 5.9s   generated in 5.2s
total runtime 2:18 · 7 files · data/audio/
```

Printing total runtime here directly closes the loop on the 2-minute requirement. If it
comes in under 2:00, raise `targetWords` in Phase 4 and regenerate.

## How to verify

```bash
npm run tts -- data/shows/$(date +%F).json
afplay data/audio/<hash>.wav      # macOS
```

Listen critically for the things TTS gets wrong:

| Problem                                | Fix                                                 |
| -------------------------------------- | --------------------------------------------------- |
| "GPT4" as "gee pee tee four"           | Phase 4 prompt: write "GPT-4"                       |
| "2026" as "two thousand twenty six"    | Prompt: spell out as words                          |
| "%" or "$" read as symbols or skipped  | Prompt: expand to words                             |
| URLs read aloud character by character | Never put URLs in `text`; they live in `sourceUrls` |
| Wrong sentence intonation              | Ensure sentences end with punctuation               |
| Segments run together                  | Insert ~400ms silence between segments in Phase 6   |

Most of these are fixed in the **Phase 4 prompt**, not here. Expect to iterate back into
Phase 4 after your first listen. That round trip is normal and is the main reason these
two phases are adjacent.

## Learning checkpoints

- Why cache the model-loading promise instead of the resolved model?
- Why does the cache key include voice and dtype as well as text?
- Why per-segment rather than whole-show synthesis?
- What did you actually hear between `q8` and `fp32`?
- Why does `Range` request support matter for an audio element?

## Risks and gotchas

| Risk                                         | Mitigation                                       |
| -------------------------------------------- | ------------------------------------------------ |
| First run appears to hang on weight download | Log download progress; warm in background        |
| Model reloaded per request                   | Cached singleton promise                         |
| Stale audio after a voice change             | Voice included in the cache key                  |
| Path traversal via `:hash`                   | Strict hex validation + resolved-path check      |
| Seeking broken in the player                 | Implement `Range` support                        |
| CPU synthesis slower than expected           | Try `q8`; accept ~1× real-time; cache everything |
| Show comes in under 2 minutes                | Raise `targetWords`, regenerate                  |

## Done criteria

- [ ] Kokoro loads once and is reused across requests
- [ ] Each segment synthesises to a content-hash-named WAV
- [ ] Re-running is a cache hit for unchanged segments
- [ ] `GET /api/audio/:hash` serves WAV, supports `Range`, rejects malformed hashes
- [ ] Total runtime of a generated show is **at least 2:00**
- [ ] You have listened to a full show and fixed pronunciation issues in the Phase 4 prompt
- [ ] Duration is recorded per segment in the show artifact
