export interface Chunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface StoredChunk extends Chunk {
  id: number;
}

export interface SearchHit extends StoredChunk {
  score: number;
  sources: ("bm25" | "vector")[];
}