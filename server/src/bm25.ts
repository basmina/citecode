import MiniSearch from "minisearch";
import type { StoredChunk } from "./types.js";

function codeTokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    out.push(word.toLowerCase());
    const parts = word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/);
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase());
  }
  return out;
}

export function createBm25Index() {
  const indexes = new Map<string, MiniSearch<StoredChunk>>();
  const chunkMaps = new Map<string, Map<number, StoredChunk>>();

  function build(repoId: string, chunks: StoredChunk[]) {
    const ms = new MiniSearch<StoredChunk>({
      fields: ["content", "filePath"],
      idField: "id",
      tokenize: codeTokenize,
    });
    ms.addAll(chunks);
    indexes.set(repoId, ms);
    chunkMaps.set(repoId, new Map(chunks.map((c) => [c.id, c])));
  }

  function search(repoId: string, query: string, limit: number): StoredChunk[] {
    const ms = indexes.get(repoId);
    const map = chunkMaps.get(repoId);
    if (!ms || !map) return [];
    return ms
      .search(query, { prefix: true, combineWith: "OR" })
      .slice(0, limit)
      .map((r) => map.get(r.id as number)!)
      .filter(Boolean);
  }

  const has = (repoId: string) => indexes.has(repoId);

  return { build, search, has };
}

export type Bm25Index = ReturnType<typeof createBm25Index>;
