import { describe, it, expect } from "vitest";
import { fuseRankings } from "./rrf.js";

const c = (id: number) => ({ id, filePath: `f${id}.ts`, startLine: 1, endLine: 5, content: "x" });

describe("fuseRankings", () => {
  const lists = [
    { source: "bm25" as const, hits: [c(1), c(2)] },
    { source: "vector" as const, hits: [c(3), c(1)] },
  ];

  it("ranks a chunk found by both searches above chunks found by one", () => {
    const out = fuseRankings(lists, 10);
    expect(out.map((h) => h.id)).toEqual([1, 3, 2]);
    expect(out[0].sources).toEqual(["bm25", "vector"]);
  });

  it("scores with 1 / (k + rank)", () => {
    expect(fuseRankings(lists, 10)[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it("labels the source of single-list hits", () => {
    const out = fuseRankings(lists, 10);
    expect(out.find((h) => h.id === 3)?.sources).toEqual(["vector"]);
    expect(out.find((h) => h.id === 2)?.sources).toEqual(["bm25"]);
  });

  it("deduplicates and respects topK", () => {
    expect(fuseRankings(lists, 10)).toHaveLength(3);
    expect(fuseRankings(lists, 2)).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(fuseRankings([], 5)).toEqual([]);
  });
});