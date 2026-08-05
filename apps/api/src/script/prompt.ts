import type { RetrievedChunk } from "../domain/types.js";

/**
 * The instruction Phase 4 will send to the LLM. It lives here, not inline in
 * the script writer, so the debug panel's "assembled prompt" preview and the
 * real generator can never drift apart — they render from the same source.
 */
export const SYSTEM_INSTRUCTION = `You are the host of "Tech Radio", a short daily tech news show.
Write a spoken-word radio script of about two minutes, grounded strictly in the
retrieved sources below. Only state facts supported by those sources; if the
material is thin, say less rather than inventing detail. Write for the ear:
short sentences, natural transitions, no bullet points or markdown.`;

export interface AssembledPrompt {
  readonly system: string;
  readonly context: string;
  readonly full: string;
  readonly chars: number;
  readonly tokenEstimate: number;
}

/** Same 4-chars-per-token heuristic the chunker and store use. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Turn retrieved chunks into the exact text block that will be handed to the
 * LLM. Each source is numbered and delimited so the model can attribute claims,
 * and so a human reading the preview can see precisely what grounded the output.
 */
export function assemblePrompt(
  chunks: readonly RetrievedChunk[],
): AssembledPrompt {
  const context = chunks
    .map((r, i) => {
      const m = r.chunk.metadata;
      const header = `[${i + 1}] ${m.title} — ${m.sourceId} · ${m.publishedAt}`;
      return `${header}\n${m.url}\n\n${r.chunk.text}`;
    })
    .join("\n\n---\n\n");

  const full = `${SYSTEM_INSTRUCTION}\n\n=== RETRIEVED SOURCES ===\n\n${context}`;

  return {
    system: SYSTEM_INSTRUCTION,
    context,
    full,
    chars: full.length,
    tokenEstimate: estimateTokens(full),
  };
}
