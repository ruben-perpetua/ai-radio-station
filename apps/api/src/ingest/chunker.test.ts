import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "./chunker.js";
import type { ChunkOptions } from "./chunker.js";
import type { Document } from "../domain/types.js";

function makeDoc(text: string, title = "Test Title"): Document {
  return {
    id: "abc123",
    sourceId: "test",
    title,
    url: "https://example.com/article",
    publishedAt: "2026-07-31T00:00:00.000Z",
    text,
    fetchedAt: "2026-07-31T00:00:00.000Z",
  };
}

const paragraph = (char: string, len: number): string => char.repeat(len);

test("empty text produces no chunks", () => {
  assert.deepEqual(chunkDocument(makeDoc(""), DEFAULT_CHUNK_OPTIONS), []);
  assert.deepEqual(chunkDocument(makeDoc("   \n\n  "), DEFAULT_CHUNK_OPTIONS), []);
});

test("text shorter than targetChars produces exactly one chunk", () => {
  const chunks = chunkDocument(makeDoc("A short body."), DEFAULT_CHUNK_OPTIONS);
  assert.equal(chunks.length, 1);
});

test("consecutive chunks actually overlap", () => {
  const options: ChunkOptions = {
    targetChars: 200,
    overlapChars: 50,
    minChars: 10,
  };
  const body = `${paragraph("a", 180)}\n\n${paragraph("b", 180)}`;
  const chunks = chunkDocument(makeDoc(body), options);
  assert.ok(chunks.length >= 2, "expected multiple chunks");

  // The tail of chunk 0's body must reappear at the head of chunk 1's body.
  const first = chunks[0]!.text;
  const tail = first.slice(-options.overlapChars);
  assert.ok(
    chunks[1]!.text.includes(tail),
    "chunk 1 should contain the overlap tail of chunk 0",
  );
});

test("an oversized single paragraph is split", () => {
  const options: ChunkOptions = {
    targetChars: 120,
    overlapChars: 20,
    minChars: 10,
  };
  const sentence = "This is a sentence that carries some weight. ";
  const body = sentence.repeat(8).trim(); // one paragraph, well over target
  const chunks = chunkDocument(makeDoc(body), options);
  assert.ok(chunks.length > 1, "oversized paragraph should yield >1 chunk");
});

test("chunk index values are sequential from 0", () => {
  const options: ChunkOptions = {
    targetChars: 150,
    overlapChars: 30,
    minChars: 10,
  };
  const body = Array.from({ length: 6 }, (_, i) => paragraph(String(i), 120)).join(
    "\n\n",
  );
  const chunks = chunkDocument(makeDoc(body), options);
  chunks.forEach((chunk, i) => assert.equal(chunk.index, i));
});

test("the title prefix is present on every chunk", () => {
  const options: ChunkOptions = {
    targetChars: 150,
    overlapChars: 30,
    minChars: 10,
  };
  const body = Array.from({ length: 4 }, (_, i) => paragraph(String(i), 140)).join(
    "\n\n",
  );
  const title = "Breaking Tech News";
  const chunks = chunkDocument(makeDoc(body, title), options);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.startsWith(`${title}\n\n`));
    assert.equal(chunk.metadata.title, title);
  }
});

test("chunk ids combine document id and index", () => {
  const chunks = chunkDocument(makeDoc("A short body."), DEFAULT_CHUNK_OPTIONS);
  assert.equal(chunks[0]!.id, "abc123:0");
  assert.equal(chunks[0]!.documentId, "abc123");
});
