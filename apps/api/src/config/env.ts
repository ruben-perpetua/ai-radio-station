import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_CHAT_MODEL: z.string().min(1),
  CHROMA_URL: z.string().url().default("http://localhost:8000"),
  CHROMA_COLLECTION: z.string().default("tech-radio"),
  KOKORO_VOICE: z.string().default("af_heart"),
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
