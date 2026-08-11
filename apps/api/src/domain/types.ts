export interface Document {
  readonly id: string; // stable hash of canonical URL
  readonly sourceId: string; // 'hn' | 'rss:arstechnica' | ...
  readonly title: string;
  readonly url: string;
  readonly author?: string;
  readonly publishedAt: string; // ISO 8601
  readonly text: string; // summary or extracted full text
  readonly score?: number; // HN points, GitHub stars, etc.
  readonly fetchedAt: string; // ISO 8601
}

export interface ChunkMetadata {
  readonly title: string;
  readonly url: string;
  readonly sourceId: string;
  readonly publishedAt: string;
  readonly score?: number;
}

export interface Chunk {
  readonly id: string; // `${documentId}:${index}`
  readonly documentId: string;
  readonly index: number; // position within the document
  readonly text: string;
  readonly tokenEstimate: number;
  readonly metadata: ChunkMetadata;
}

export interface RetrievedChunk {
  readonly chunk: Chunk;
  readonly distance: number; // Chroma returns distance: lower is closer
  readonly rank: number; // 0-based position in the result list
}

export interface RadioSegment {
  readonly id: string;
  readonly headline: string;
  readonly text: string;
  readonly sourceUrls: readonly string[]; // must trace back to retrieved chunks
}

export interface RadioScript {
  readonly showId: string;
  readonly createdAt: string; // ISO 8601
  readonly intro: string;
  readonly segments: readonly RadioSegment[];
  readonly outro: string;
  readonly wordCount: number; // counted server-side, never model self-report
}

export interface SegmentAudio {
  readonly partId: string; // 'intro' | 'outro' | segment.id
  readonly voice: string; // which host spoke it — Phase 6 labels the transcript
  readonly audioHash: string; // sha256 hex; also the id in GET /api/audio/:hash
  readonly durationSeconds: number;
}

export interface ShowAudio {
  readonly modelId: string;
  readonly dtype: string;
  readonly totalDurationSeconds: number;
  readonly parts: readonly SegmentAudio[]; // intro, five segments, outro (in order)
}
