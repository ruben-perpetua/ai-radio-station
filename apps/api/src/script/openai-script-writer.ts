import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import type { RadioScript, RadioSegment, RetrievedChunk } from "../domain/types.js";
import { buildUserPrompt, SYSTEM_INSTRUCTION } from "./prompt.js";
import { radioScriptSchema, scriptGenerationSchema, type ValidatedScript } from "./schema.js";
import type { ScriptWriter } from "./script-writer.js";

/** Accept a little drift around the target; only rewrite outside this band. */
const MIN_WORDS = 300;
const MAX_WORDS = 450;

/** One generation plus at most one corrective retry. A third call is not worth it. */
const MAX_ATTEMPTS = 2;

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Count spoken words over intro + each segment's body + outro. */
function countWords(script: ValidatedScript): number {
  const spoken = [
    script.intro,
    ...script.segments.map((s) => s.text),
    script.outro,
  ].join(" ");
  return spoken.split(/\s+/).filter(Boolean).length;
}

/**
 * Every cited URL must appear in the retrieved set. A URL that does not is the
 * clearest signal that the model either hallucinated or was steered by injected
 * content — so this is a security control, not a formatting nicety.
 */
function citedUrlsOutside(
  script: ValidatedScript,
  allowed: ReadonlySet<string>,
): string[] {
  const outside = new Set<string>();
  for (const segment of script.segments) {
    for (const url of segment.sourceUrls) {
      if (!allowed.has(url)) outside.add(url);
    }
  }
  return [...outside];
}

export class OpenAiScriptWriter implements ScriptWriter {
  private readonly client: OpenAI;
  private readonly model = env.OPENAI_CHAT_MODEL;

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async write(
    chunks: readonly RetrievedChunk[],
    targetWords: number,
  ): Promise<RadioScript> {
    if (chunks.length === 0) {
      throw new Error("cannot write a show from zero retrieved chunks");
    }

    const allowedUrls = new Set(chunks.map((c) => c.chunk.metadata.url));
    const date = new Date().toISOString().slice(0, 10);

    const messages: MessageParam[] = [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: buildUserPrompt(chunks, targetWords, date) },
    ];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await this.generate(messages);

      // Belt and braces: re-parse even though the API used a JSON schema. This
      // catches an empty segment, the wrong segment count, or a malformed URL.
      const validation = radioScriptSchema.safeParse(raw);
      if (!validation.success) {
        if (attempt < MAX_ATTEMPTS) {
          messages.push({
            role: "user",
            content:
              "That response was not valid. Return exactly five segments, each " +
              "with a non-empty headline, non-empty text, and at least one valid " +
              "source URL taken from the retrieved articles.",
          });
          continue;
        }
        throw new Error(
          `script failed schema validation: ${validation.error.message}`,
        );
      }

      const script = validation.data;
      const badUrls = citedUrlsOutside(script, allowedUrls);
      const wordCount = countWords(script);
      const budgetOk = wordCount >= MIN_WORDS && wordCount <= MAX_WORDS;

      if (badUrls.length === 0 && budgetOk) {
        return this.finalize(script, wordCount);
      }

      if (attempt < MAX_ATTEMPTS) {
        messages.push({ role: "user", content: this.feedback(badUrls, wordCount, targetWords) });
        continue;
      }

      // Final attempt still imperfect. A URL outside the retrieved set is an
      // integrity failure and must never be served — reject hard.
      if (badUrls.length > 0) {
        throw new Error(
          `rejected script: cited URLs not in the retrieved set: ${badUrls.join(", ")}`,
        );
      }

      // Only the word budget is off. A slightly long or short show is not worth
      // a third paid call — accept it and log.
      console.warn(
        `show word count ${wordCount} outside ${MIN_WORDS}-${MAX_WORDS}; accepting.`,
      );
      return this.finalize(script, wordCount);
    }

    // The loop always returns or throws; this satisfies the type checker.
    throw new Error("script generation exhausted its attempts");
  }

  private feedback(badUrls: string[], wordCount: number, target: number): string {
    const parts: string[] = [];
    if (badUrls.length > 0) {
      parts.push(
        `These source URLs are not in the retrieved articles and must not be used: ` +
          `${badUrls.join(", ")}. Only cite URLs that appear in the data block.`,
      );
    }
    if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
      parts.push(
        `That was ${wordCount} words. Rewrite at ${target} words total, ` +
          `cutting or expanding detail rather than changing the number of segments.`,
      );
    }
    return parts.join(" ");
  }

  private async generate(messages: readonly MessageParam[]): Promise<unknown> {
    const completion = await this.client.beta.chat.completions.parse({
      model: this.model,
      messages: [...messages],
      response_format: zodResponseFormat(scriptGenerationSchema, "radio_script"),
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("model returned no choices");
    if (choice.message.refusal) {
      throw new Error(`model refused to write the script: ${choice.message.refusal}`);
    }
    // `parsed` is null if the model failed to satisfy the schema; the caller's
    // zod re-parse turns that into a retry rather than a crash.
    return choice.message.parsed;
  }

  private finalize(script: ValidatedScript, wordCount: number): RadioScript {
    const showId = randomUUID();
    const segments: RadioSegment[] = script.segments.map((s, i) => ({
      id: `${showId}-s${i + 1}`,
      headline: s.headline,
      text: s.text,
      sourceUrls: s.sourceUrls,
    }));
    return {
      showId,
      createdAt: new Date().toISOString(),
      intro: script.intro,
      segments,
      outro: script.outro,
      wordCount,
    };
  }
}
