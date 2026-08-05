import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblePrompt, SYSTEM_INSTRUCTION } from "./prompt.js";
import type { RetrievedChunk } from "../domain/types.js";

function makeRetrieved(
  id: string,
  text: string,
  rank: number,
): RetrievedChunk {
  return {
    chunk: {
      id,
      documentId: "doc",
      index: rank,
      text,
      tokenEstimate: 1,
      metadata: {
        title: `Title ${rank}`,
        url: `https://example.com/${rank}`,
        sourceId: "hn",
        publishedAt: "2026-07-31T00:00:00.000Z",
      },
    },
    distance: 0.2,
    rank,
  };
}

test("empty chunks still yields the system instruction", () => {
  const p = assemblePrompt([]);
  assert.ok(p.full.startsWith(SYSTEM_INSTRUCTION));
  assert.equal(p.context, "");
  assert.equal(p.chars, p.full.length);
});

test("each chunk's text and url appear in the assembled context", () => {
  const chunks = [
    makeRetrieved("a", "first body", 0),
    makeRetrieved("b", "second body", 1),
  ];
  const p = assemblePrompt(chunks);

  assert.ok(p.context.includes("first body"));
  assert.ok(p.context.includes("second body"));
  assert.ok(p.context.includes("https://example.com/0"));
  assert.ok(p.context.includes("[1]"));
  assert.ok(p.context.includes("[2]"));
  assert.ok(p.context.includes("---"));
});

test("token estimate tracks character count", () => {
  const p = assemblePrompt([makeRetrieved("a", "x".repeat(400), 0)]);
  assert.equal(p.tokenEstimate, Math.ceil(p.chars / 4));
});
