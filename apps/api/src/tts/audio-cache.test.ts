import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey, isValidHash, resolveAudioPath } from "./audio-cache.js";
import { wavDurationSeconds } from "./wav.js";

test("cache key is a 64-char hex sha256", () => {
  const key = cacheKey({
    modelId: "m",
    voice: "af_heart",
    dtype: "q8",
    text: "hello",
  });
  assert.match(key, /^[a-f0-9]{64}$/);
});

test("cache key changes with voice, dtype and text — never stale audio", () => {
  const base = { modelId: "m", voice: "af_heart", dtype: "q8", text: "hello" };
  const key = cacheKey(base);
  assert.notEqual(key, cacheKey({ ...base, voice: "am_michael" }));
  assert.notEqual(key, cacheKey({ ...base, dtype: "fp32" }));
  assert.notEqual(key, cacheKey({ ...base, text: "hello!" }));
});

test("isValidHash accepts a real digest and rejects anything else", () => {
  assert.equal(isValidHash("a".repeat(64)), true);
  assert.equal(isValidHash("A".repeat(64)), false); // uppercase not allowed
  assert.equal(isValidHash("a".repeat(63)), false);
  assert.equal(isValidHash("../../etc/passwd"), false);
  assert.equal(isValidHash("a".repeat(64) + "/.."), false);
});

test("resolveAudioPath rejects traversal attempts", () => {
  assert.equal(resolveAudioPath("../secret"), null);
  assert.equal(resolveAudioPath("/etc/passwd"), null);
  const ok = resolveAudioPath("b".repeat(64));
  assert.ok(ok && ok.endsWith(`${"b".repeat(64)}.wav`));
});

test("wavDurationSeconds reads duration from a PCM header", () => {
  // 1 second of 16-bit mono at 8000 Hz => 8000 samples * 2 bytes = 16000 bytes.
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataBytes = sampleRate * channels * (bitsPerSample / 8); // 1s

  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // byte rate
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32); // block align
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);

  assert.equal(wavDurationSeconds(buf), 1);
});
