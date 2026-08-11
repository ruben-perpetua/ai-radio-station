/**
 * Read the playback duration of a PCM WAV from its header, so a cache hit can
 * report duration without re-synthesising. This is the same arithmetic the
 * phase doc spells out: dataBytes / (sampleRate * channels * bytesPerSample).
 *
 * We walk the RIFF sub-chunks rather than assuming fixed offsets, because a WAV
 * may carry extra chunks (LIST/fact) before `data`.
 */
export function wavDurationSeconds(buf: Buffer): number {
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a RIFF/WAVE file");
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataBytes = size;
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  const frameBytes = (bitsPerSample / 8) * channels;
  if (frameBytes === 0 || sampleRate === 0) {
    throw new Error("WAV missing a usable fmt chunk");
  }
  return dataBytes / (sampleRate * frameBytes);
}
