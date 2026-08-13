import assert from "node:assert/strict";
import { test } from "node:test";
import { loadShowById } from "./show-store.js";

// A committed fixture the CLI produced in Phase 5. Read-only; documents the
// merge contract the player depends on.
const FIXTURE_ID = "2026-08-11";

test("merges script text and audio manifest into flat ordered parts", async () => {
  const show = await loadShowById(FIXTURE_ID);
  assert.ok(show, "fixture show should load");
  // intro + five segments + outro.
  assert.equal(show.parts.length, 7);
  assert.equal(show.parts[0]?.kind, "intro");
  const lastPart = show.parts[show.parts.length - 1];
  assert.equal(lastPart?.kind, "outro");
  for (const part of show.parts) {
    assert.match(part.audioHash, /^[a-f0-9]{64}$/);
    assert.ok(part.durationSeconds > 0);
    assert.ok(part.voice.length > 0);
  }
  // Segments carry a headline and at least one source; intro/outro do not.
  const segments = show.parts.filter((p) => p.kind === "segment");
  assert.equal(segments.length, 5);
  for (const seg of segments) {
    assert.ok(seg.headline && seg.headline.length > 0);
    assert.ok(seg.sourceUrls.length > 0);
  }
});

test("rejects path-traversal ids before touching the filesystem", async () => {
  assert.equal(await loadShowById("../../etc/passwd"), null);
  assert.equal(await loadShowById("a/b"), null);
  assert.equal(await loadShowById("does-not-exist"), null);
});
