import { describe, it, expect, vi, beforeEach } from "vitest";

import { createCitationVerifier } from "./verify.js";

const getFileLines = vi.fn();
const verifyCitations = createCitationVerifier({
  store: { getFileLines },
  logger: { warn: vi.fn() },
});

beforeEach(() => {
  getFileLines.mockReset();
});

describe("verifyCitations", () => {
  it("flags missing files and ranges past the end of a file, and ignores duplicates", async () => {
    getFileLines.mockImplementation(async (_repo: string, path: string) =>
      path === "a.ts" ? { from: 1, to: 10, total: 20, lines: [] } : null
    );

    const out = await verifyCitations("repo", "See [a.ts:1-10], [b.ts:1-5], [a.ts:30-40] and [a.ts:1-10] again.");

    expect(out).toEqual([
      { path: "a.ts", start: 1, end: 10, valid: true },
      { path: "b.ts", start: 1, end: 5, valid: false },
      { path: "a.ts", start: 30, end: 40, valid: false },
    ]);
  });

  it("returns no citations for an answer without any", async () => {
    expect(await verifyCitations("repo", "Not found in this repo.")).toEqual([]);
    expect(getFileLines).not.toHaveBeenCalled();
  });

  it("returns an empty list instead of throwing if the lookup fails", async () => {
    getFileLines.mockRejectedValue(new Error("db down"));
    expect(await verifyCitations("repo", "See [a.ts:1-5].")).toEqual([]);
  });
});