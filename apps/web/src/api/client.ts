// Response shapes mirror the API's search route. Kept local to the web app so
// the browser bundle never depends on server-only modules (and never the
// OpenAI key). These must stay in sync with apps/api/src/http/routes/search.ts.

export interface ChunkMetadata {
  readonly title: string;
  readonly url: string;
  readonly sourceId: string;
  readonly publishedAt: string;
  readonly score?: number;
}

export interface Chunk {
  readonly id: string;
  readonly documentId: string;
  readonly index: number;
  readonly text: string;
  readonly tokenEstimate: number;
  readonly metadata: ChunkMetadata;
}

export interface RetrievedChunk {
  readonly chunk: Chunk;
  readonly distance: number;
  readonly rank: number;
}

export interface AssembledPrompt {
  readonly system: string;
  readonly context: string;
  readonly full: string;
  readonly chars: number;
  readonly tokenEstimate: number;
}

export interface SearchResponse {
  readonly query: string;
  readonly embeddingModel: string;
  readonly dimensions: number;
  readonly embedMs: number;
  readonly searchMs: number;
  readonly totalIndexed: number;
  readonly results: readonly RetrievedChunk[];
  readonly prompt: AssembledPrompt;
}

export interface Stats {
  readonly collection: string;
  readonly totalChunks: number;
  readonly embeddingModel: string;
  readonly dimensions: number;
  readonly distanceMetric: string;
}

export interface SearchParams {
  readonly query: string;
  readonly topK: number;
  readonly maxDistance?: number;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as Stats;
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as SearchResponse;
}
