import type { Embedder } from "./embeddings.js";
import type { Store } from "./store.js";
import type { Bm25Index } from "./bm25.js";
import { fuseRankings } from "./rrf.js";
import type { SearchHit } from "./types.js";

export interface HybridSearchDeps {
  embedder: Pick<Embedder, "embed">;
  store: Pick<Store, "vectorSearch">;
  bm25: Pick<Bm25Index, "search">;
}

export function createHybridSearch({ embedder, store, bm25 }: HybridSearchDeps) {
  return async function hybridSearch(repoId: string, query: string, topK = 8): Promise<SearchHit[]> {
    const [queryVec] = await embedder.embed([query]);
    const vectorHits = await store.vectorSearch(repoId, queryVec, 20);
    const keywordHits = bm25.search(repoId, query, 20);
    return fuseRankings(
      [
        { source: "bm25", hits: keywordHits },
        { source: "vector", hits: vectorHits },
      ],
      topK
    );
  };
}

export type HybridSearch = ReturnType<typeof createHybridSearch>;
