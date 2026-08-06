import type { RadioScript, RetrievedChunk } from "../domain/types.js";

/**
 * Turns retrieved chunks into a finished radio script. The fourth core seam:
 * the whole "how do we talk to the writing model" concern lives behind this one
 * interface, so OpenAI can later be swapped for a local model without the show
 * composition or HTTP layer changing.
 *
 * The writer receives the chunks (not a pre-built prompt) because it owns two
 * responsibilities that need them directly: grounding the copy, and rejecting
 * any output that cites a URL outside this retrieved set.
 */
export interface ScriptWriter {
  write(
    chunks: readonly RetrievedChunk[],
    targetWords: number,
  ): Promise<RadioScript>;
}
