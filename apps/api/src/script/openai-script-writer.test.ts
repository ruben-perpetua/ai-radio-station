import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import type { RetrievedChunk } from "../domain/types.js";

// The writer imports config/env, which parses process.env at load. Provide the
// required vars before the dynamic import so the module doesn't throw on load.
process.env.OPENAI_API_KEY ??= "test-key";
process.env.OPENAI_CHAT_MODEL ??= "gpt-test";

const { OpenAiScriptWriter } = await import("./openai-script-writer.js");

function words(n: number): string {
  return Array.from({ length: n }, () => "news").join(" ");
}

function chunk(url: string, rank: number): RetrievedChunk {
  return {
    chunk: {
      id: `c${rank}`,
      documentId: `doc${rank}`,
      index: rank,
      text: `body ${rank}`,
      tokenEstimate: 1,
      metadata: {
        title: `Title ${rank}`,
        url,
        sourceId: "hn",
        publishedAt: "2026-07-31T00:00:00.000Z",
      },
    },
    distance: 0.2,
    rank,
  };
}

/** A parsed structured-output payload with five segments. */
function scriptPayload(sourceUrlsPerSegment: string[][]): unknown {
  return {
    intro: words(35),
    segments: sourceUrlsPerSegment.map((urls, i) => ({
      headline: `Headline ${i}`,
      text: words(55),
      sourceUrls: urls,
    })),
    outro: words(35),
  };
}

/** A fake OpenAI client whose parse() always returns the given payload. */
function fakeClient(payload: unknown): OpenAI {
  const client = {
    beta: {
      chat: {
        completions: {
          parse: async () => ({
            choices: [{ message: { parsed: payload, refusal: null } }],
          }),
        },
      },
    },
  };
  return client as unknown as OpenAI;
}

const RETRIEVED = [chunk("https://example.com/0", 0), chunk("https://example.com/1", 1)];

test("accepts a grounded script and counts words server-side", async () => {
  const payload = scriptPayload([
    ["https://example.com/0"],
    ["https://example.com/1"],
    ["https://example.com/0"],
    ["https://example.com/1"],
    ["https://example.com/0"],
  ]);
  const writer = new OpenAiScriptWriter(fakeClient(payload));

  const script = await writer.write(RETRIEVED, 360);

  assert.equal(script.segments.length, 5);
  // 35 intro + 5*55 segment text + 35 outro = 345, computed here, not trusted.
  assert.equal(script.wordCount, 345);
  assert.ok(script.showId.length > 0);
  assert.ok(script.createdAt.length > 0);
});

test("rejects a script citing a URL outside the retrieved set", async () => {
  // Simulates a prompt-injection outcome: a segment cites a source that was
  // never retrieved. This must be rejected, never spoken.
  const payload = scriptPayload([
    ["https://example.com/0"],
    ["https://example.com/1"],
    ["https://evil.example/injected"],
    ["https://example.com/0"],
    ["https://example.com/1"],
  ]);
  const writer = new OpenAiScriptWriter(fakeClient(payload));

  await assert.rejects(
    () => writer.write(RETRIEVED, 360),
    /not in the retrieved set/,
  );
});

test("rejects a payload with the wrong segment count", async () => {
  const payload = {
    intro: words(35),
    segments: [
      { headline: "one", text: words(55), sourceUrls: ["https://example.com/0"] },
    ],
    outro: words(35),
  };
  const writer = new OpenAiScriptWriter(fakeClient(payload));

  await assert.rejects(
    () => writer.write(RETRIEVED, 360),
    /schema validation/,
  );
});
