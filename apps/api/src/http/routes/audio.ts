import { Hono } from "hono";
import { isValidHash, readAudio } from "../../tts/audio-cache.js";

const CACHE_HEADERS: Record<string, string> = {
  "Content-Type": "audio/wav",
  // Browsers issue Range requests to seek an <audio> element; advertise support
  // so the scrubber works instead of re-downloading from the start each seek.
  "Accept-Ranges": "bytes",
  // Content-addressed files never change, so they can be cached forever.
  "Cache-Control": "public, max-age=31536000, immutable",
};

/** Parse a single-range `bytes=start-end` header, clamped to the file size. */
function parseRange(
  header: string,
  total: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  const start = rawStart ? Number(rawStart) : 0;
  const end = rawEnd ? Number(rawEnd) : total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start > end || end >= total || start < 0) return null;
  return { start, end };
}

export function createAudioRoutes(): Hono {
  const api = new Hono();

  api.get("/audio/:hash", async (c) => {
    const hash = c.req.param("hash");

    // Validate the shape *before* any filesystem access. A hash that is not 64
    // hex chars cannot name a real cache file and, crucially, cannot contain
    // `.` or `/`, so path traversal is impossible.
    if (!isValidHash(hash)) {
      return c.json({ error: "Malformed audio hash" }, 400);
    }

    const buf = await readAudio(hash);
    // A well-formed hash with no file is a genuine 404, not a bad request.
    if (!buf) {
      return c.json({ error: "Audio not found" }, 404);
    }

    // Normalise to a plain ArrayBuffer-backed view so it satisfies BodyInit.
    const bytes = new Uint8Array(buf);
    const total = bytes.length;
    const rangeHeader = c.req.header("Range");
    if (rangeHeader) {
      const range = parseRange(rangeHeader, total);
      if (!range) {
        return new Response(null, {
          status: 416, // Range Not Satisfiable
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      const chunk = bytes.subarray(range.start, range.end + 1);
      return new Response(chunk, {
        status: 206, // Partial Content
        headers: {
          ...CACHE_HEADERS,
          "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
          "Content-Length": String(chunk.length),
        },
      });
    }

    return new Response(bytes, {
      status: 200,
      headers: { ...CACHE_HEADERS, "Content-Length": String(total) },
    });
  });

  return api;
}
