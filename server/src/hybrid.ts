import { embed } from "./embeddings.js";
import { vectorSearch } from "./store.js";
import { bm25Search } from "./bm25.js";
import { fuseRankings } from "./rrf.js";
import type { SearchHit } from "./types.js";

export async function hybridSearch(repoId: string, query: string, topK = 8): Promise<SearchHit[]> {
  const [queryVec] = await embed([query]);
  const vectorHits = await vectorSearch(repoId, queryVec, 20);
  const keywordHits = bm25Search(repoId, query, 20);
  return fuseRankings(
    [
      { source: "bm25", hits: keywordHits },
      { source: "vector", hits: vectorHits },
    ],
    topK
  );
}