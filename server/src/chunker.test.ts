import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker.js";

const hundredLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");

describe("chunkFile", () => {
  it("returns one chunk for a small file", () => {
    const chunks = chunkFile("a.ts", "a\nb\nc");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ filePath: "a.ts", startLine: 1, endLine: 3 });
  });

  it("uses 1-based line numbers with the configured overlap", () => {
    const chunks = chunkFile("a.ts", hundredLines, 30, 6);
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([
      [1, 30],
      [25, 54],
      [49, 78],
      [73, 100],
    ]);
  });

  it("keeps content aligned with its line range", () => {
    const chunks = chunkFile("a.ts", hundredLines, 30, 6);
    expect(chunks[1].content.split("\n")[0]).toBe("line 25");
  });

  it("covers every line of the file", () => {
    const covered = new Set<number>();
    for (const c of chunkFile("a.ts", hundredLines, 30, 6)) {
      for (let n = c.startLine; n <= c.endLine; n++) covered.add(n);
    }
    expect(covered.size).toBe(100);
  });

  it("skips blank content", () => {
    expect(chunkFile("a.ts", "\n\n\n")).toEqual([]);
    expect(chunkFile("a.ts", "")).toEqual([]);
  });
});