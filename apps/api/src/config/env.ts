import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_CHAT_MODEL: z.string().min(1),
  CHROMA_URL: z.string().url().default("http://localhost:8000"),
  CHROMA_COLLECTION: z.string().default("tech-radio"),
  // Primary host. The second host makes a two-voice show; segments alternate
  // between the two so a 2-minute episode sounds like a conversation, not a
  // monologue. Both must be valid Kokoro voice ids.
  KOKORO_VOICE: z.string().default("af_heart"),
  KOKORO_VOICE_B: z.string().default("am_michael"),
  // Quantisation of the ONNX weights. q8 is ~4x smaller than fp32 and very
  // close in quality; drop to fp32 to hear the difference, or q4 for speed.
  KOKORO_DTYPE: z.enum(["fp32", "fp16", "q8", "q4", "q4f16"]).default("q8"),
  ENABLE_FULL_TEXT_EXTRACTION: z.coerce.boolean().default(false),
  // An empty value in .env means "no token"; treat it as absent.
  GITHUB_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
