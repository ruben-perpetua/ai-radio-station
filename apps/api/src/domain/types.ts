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
