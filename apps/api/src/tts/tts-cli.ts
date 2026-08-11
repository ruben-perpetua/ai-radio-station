import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { env } from "../config/env.js";
import type { RadioScript } from "../domain/types.js";
import { AUDIO_ROOT } from "./audio-cache.js";
import { KokoroTtsProvider } from "./kokoro-tts.js";
import { synthesiseShow, type SynthesisProgress } from "./synthesise-show.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The persisted show script. Stricter than the loose generation schema: this is
 * a trust boundary (a file off disk), so we re-validate the full shape before
 * paying to synthesise it. Unknown keys are stripped, not rejected, so the
 * retrieval metadata that /api/show also writes is tolerated.
 */
const persistedScriptSchema = z.object({
  showId: z.string().min(1),
  createdAt: z.string().min(1),
  intro: z.string().min(1),
  segments: z
    .array(
      z.object({
        id: z.string().min(1),
        headline: z.string().min(1),
        text: z.string().min(1),
        sourceUrls: z.array(z.string().url()).min(1),
      }),
    )
    .length(5),
  outro: z.string().min(1),
  wordCount: z.number(),
});

/** Accept either the /api/show response ({ script, ... }) or a bare script. */
const showFileSchema = z.union([
  z.object({ script: persistedScriptSchema }).passthrough(),
  persistedScriptSchema,
]);

function resolveInputPath(arg: string): string {
  const fromCwd = resolve(process.cwd(), arg);
  if (existsSync(fromCwd)) return fromCwd;
  // npm workspace scripts run in apps/api, but the doc's paths are repo-relative.
  const fromRoot = isAbsolute(arg) ? arg : resolve(REPO_ROOT, arg);
  return fromRoot;
}

function partLabel(p: SynthesisProgress): string {
  if (p.partId === "intro") return "intro";
  if (p.partId === "outro") return "outro";
  return `segment ${p.index}`; // parts are [intro, seg1..seg5, outro]
}

function formatClock(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npm run tts -- <path-to-show.json>");
    process.exit(1);
  }

  const inputPath = resolveInputPath(arg);
  if (!existsSync(inputPath)) {
    console.error(`show file not found: ${inputPath}`);
    process.exit(1);
  }

  const raw: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  const parsed = showFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("show file is not a valid script:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  const script: RadioScript =
    "script" in parsed.data ? parsed.data.script : parsed.data;

  const voiceA = env.KOKORO_VOICE;
  const voiceB = env.KOKORO_VOICE_B;
  const dtype = env.KOKORO_DTYPE;

  console.log(
    `synthesising show ${script.showId} · voices ${voiceA}/${voiceB} · ${dtype}`,
  );

  const provider = new KokoroTtsProvider();
  const audio = await synthesiseShow(provider, script, {
    voiceA,
    voiceB,
    dtype,
    onProgress: (p) => {
      const dur = `${p.durationSeconds.toFixed(1)}s`;
      const how = p.cached
        ? "cached"
        : `generated in ${((p.generationMs ?? 0) / 1000).toFixed(1)}s`;
      console.log(
        `  ${partLabel(p).padEnd(12)}${dur.padEnd(8)}${how}  ${p.voice}`,
      );
    },
  });

  // Write the manifest back into the artifact so the frontend knows every
  // audio hash and duration without touching a single WAV.
  const output =
    "script" in (raw as object) ? { ...(raw as object), audio } : { script, audio };
  await writeFile(inputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    `total runtime ${formatClock(audio.totalDurationSeconds)} · ${audio.parts.length} files · ${AUDIO_ROOT}`,
  );
  if (audio.totalDurationSeconds < 120) {
    console.warn(
      `⚠ show is under 2:00 — raise targetWords in Phase 4 and regenerate the script.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
