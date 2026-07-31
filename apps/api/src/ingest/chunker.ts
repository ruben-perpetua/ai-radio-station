import type { Chunk, ChunkMetadata, Document } from "../domain/types.js";

export interface ChunkOptions {
  readonly targetChars: number; // start at 800
  readonly overlapChars: number; // start at 150
  readonly minChars: number; // start at 100
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetChars: 800,
  overlapChars: 150,
  minChars: 100,
};

/** Rough token count: English averages ~4 characters per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split a paragraph into sentences, keeping terminal punctuation attached. */
function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+(?:["')\]]+)?|\S[^.!?]*$/g);
  return matches
    ? matches.map((s) => s.trim()).filter((s) => s.length > 0)
    : [paragraph];
}

/**
 * Break a document body into overlapping, embedding-sized chunks.
 *
 * Paragraphs are packed into a buffer up to `targetChars`; each new chunk is
 * seeded with the tail `overlapChars` of the previous one so an idea that
 * straddles a boundary is retrievable from either side. Oversized paragraphs
 * fall back to sentence (then hard) splitting. Every chunk is prefixed with the
 * title, which gives mid-article chunks the topical anchor their pronouns lack.
 */
export function chunkDocument(
  doc: Document,
  options: ChunkOptions,
): readonly Chunk[] {
  const { targetChars, overlapChars, minChars } = options;

  const body = doc.text.trim();
  if (body.length === 0) return [];

  // Atomic units: paragraphs, with oversized ones broken down so no single
  // unit can exceed the target on its own.
  const units: string[] = [];
  for (const paragraph of body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)) {
    if (paragraph.length <= targetChars) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length <= targetChars) {
        units.push(sentence);
      } else {
        for (let i = 0; i < sentence.length; i += targetChars) {
          units.push(sentence.slice(i, i + targetChars));
        }
      }
    }
  }

  const bodies: string[] = [];
  let buffer = "";
  for (const unit of units) {
    const candidate = buffer.length === 0 ? unit : `${buffer}\n\n${unit}`;
    if (candidate.length > targetChars && buffer.length > 0) {
      bodies.push(buffer);
      const overlap = buffer.slice(-overlapChars);
      buffer = `${overlap}\n\n${unit}`;
    } else {
      buffer = candidate;
    }
  }
  if (buffer.length > 0) bodies.push(buffer);

  // Drop runt trailing chunks, but never leave a document with zero chunks.
  while (
    bodies.length > 1 &&
    (bodies[bodies.length - 1] as string).length < minChars
  ) {
    bodies.pop();
  }

  const metadata: ChunkMetadata = {
    title: doc.title,
    url: doc.url,
    sourceId: doc.sourceId,
    publishedAt: doc.publishedAt,
    ...(doc.score !== undefined ? { score: doc.score } : {}),
  };

  return bodies.map((text, index) => {
    const withTitle = `${doc.title}\n\n${text}`;
    return {
      id: `${doc.id}:${index}`,
      documentId: doc.id,
      index,
      text: withTitle,
      tokenEstimate: estimateTokens(withTitle),
      metadata,
    };
  });
}
