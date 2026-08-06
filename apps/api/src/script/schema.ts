import { z } from "zod";

/**
 * The schema we hand to OpenAI's structured-output mode. Deliberately loose:
 * strict structured outputs reject many JSON-Schema constraint keywords
 * (minLength, minItems, format, ...), so asking for them here fails the request.
 * We only pin the *shape* here and enforce the real rules in `radioScriptSchema`
 * after the response comes back.
 */
export const scriptGenerationSchema = z.object({
  intro: z.string(),
  segments: z.array(
    z.object({
      headline: z.string(),
      text: z.string(),
      sourceUrls: z.array(z.string()),
    }),
  ),
  outro: z.string(),
});

/**
 * The real contract. We parse the model's response through this even though it
 * was generated under a JSON schema — belt and braces. It enforces exactly five
 * non-empty segments, at least one valid source URL per segment, and non-empty
 * intro/outro. Anything that does not fit is rejected, not repaired.
 */
export const radioScriptSchema = z.object({
  intro: z.string().min(1),
  segments: z
    .array(
      z.object({
        headline: z.string().min(1),
        text: z.string().min(1),
        sourceUrls: z.array(z.string().url()).min(1),
      }),
    )
    .length(5),
  outro: z.string().min(1),
});

export type ValidatedScript = z.infer<typeof radioScriptSchema>;
