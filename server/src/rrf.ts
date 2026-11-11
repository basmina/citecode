import type { SearchHit, StoredChunk } from "./types.js";

export const RRF_K = 60;

export interface RankedList {
  source: "bm25" | "vector";
  hits: StoredChunk[];
}

export function fuseRankings(lists: RankedList[], topK: number, k = RRF_K): SearchHit[] {
  const merged = new Map<number, SearchHit>();
  for (const { source, hits } of lists) {
    hits.forEach((chunk, rank) => {
      const entry = merged.get(chunk.id) ?? { ...chunk, score: 0, sources: [] };
      entry.score += 1 / (k + rank + 1);
      if (!entry.sources.includes(source)) entry.sources.push(source);
      merged.set(chunk.id, entry);
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}