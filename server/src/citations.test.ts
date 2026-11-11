import { describe, it, expect } from "vitest";
import { extractCitations } from "./citations.js";

describe("extractCitations", () => {
  it("parses a single citation", () => {
    expect(extractCitations("Auth is here [src/a.ts:1-5].")).toEqual([{ path: "src/a.ts", start: 1, end: 5 }]);
  });

  it("parses several citations in one bracket", () => {
    expect(extractCitations("See [README.md:25-54, README.md:49-74].")).toHaveLength(2);
  });

  it("parses several brackets", () => {
    expect(extractCitations("[a.ts:1-2] and [b.ts:3-4]").map((c) => c.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("treats a single line as a one-line range", () => {
    expect(extractCitations("[a.ts:7]")).toEqual([{ path: "a.ts", start: 7, end: 7 }]);
  });

  it("ignores text that is not a citation", () => {
    expect(extractCitations("array[index: 5] and [see docs]")).toEqual([]);
  });
});