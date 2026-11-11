import { describe, it, expect, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";

vi.mock("./embeddings.js", () => ({ embed: vi.fn() }));
vi.mock("./store.js", () => ({ replaceRepoChunks: vi.fn(), loadChunks: vi.fn() }));
vi.mock("./logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { extractFiles, ingestFromGithub, ingestFromZip, IngestError } from "./ingest.js";

const zipOf = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));

describe("extractFiles", () => {
  it("strips the top-level folder and keeps only indexable source files", () => {
    const files = extractFiles(
      zipOf({
        "repo-main/src/app.ts": "export const a = 1;",
        "repo-main/README.md": "# hi",
        "repo-main/.env": "SECRET=1",
        "repo-main/package-lock.json": "{}",
        "repo-main/node_modules/x/index.js": "x",
        "repo-main/logo.png": "png",
      })
    );
    expect(files.map((f) => f.path)).toEqual(["README.md", "src/app.ts"]);
  });

  it("drops path-traversal entries (zip-slip)", () => {
    const files = extractFiles(zipOf({ "../evil.ts": "x", "/abs.ts": "x", "ok.ts": "export {}" }));
    expect(files.map((f) => f.path)).toEqual(["ok.ts"]);
  });

  it("skips files with binary content", () => {
    const files = extractFiles(zipOf({ "a.ts": "abc\u0000def", "b.ts": "ok" }));
    expect(files.map((f) => f.path)).toEqual(["b.ts"]);
  });

  it("rejects a corrupt ZIP", () => {
    expect(() => extractFiles(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(IngestError);
  });
});

describe("ingest input validation", () => {
  it("rejects uploads that are not ZIP archives", async () => {
    await expect(ingestFromZip("x.zip", new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow("not a ZIP");
  });

  it("rejects non-GitHub URLs before making any network call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(ingestFromGithub("https://example.com/a/b")).rejects.toThrow("GitHub repository URL");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects dot-only owner or repo names", async () => {
    await expect(ingestFromGithub("https://github.com/../x")).rejects.toThrow(IngestError);
  });
});