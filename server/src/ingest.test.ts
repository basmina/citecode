import { describe, it, expect, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractFiles, createIngestor, IngestError } from "./ingest.js";

const ingestor = createIngestor({
  embedder: { embed: vi.fn() },
  store: { replaceRepoChunks: vi.fn(), loadChunks: vi.fn() },
  bm25: { build: vi.fn() },
  logger: { info: vi.fn() },
  config: { maxRepoFiles: 1500, maxChunks: 3000 },
});

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
    await expect(ingestor.ingestFromZip("x.zip", new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow("not a ZIP");
  });

  it("rejects non-GitHub URLs before making any network call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(ingestor.ingestFromGithub("https://example.com/a/b")).rejects.toThrow("GitHub repository URL");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects dot-only owner or repo names", async () => {
    await expect(ingestor.ingestFromGithub("https://github.com/../x")).rejects.toThrow(IngestError);
  });
});

describe("ingest", () => {
  it("indexes a ZIP through the injected embedder, store and BM25 index", async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    const replaceRepoChunks = vi.fn();
    const build = vi.fn();
    const local = createIngestor({
      embedder: { embed },
      store: { replaceRepoChunks, loadChunks: vi.fn().mockResolvedValue([]) },
      bm25: { build },
      logger: { info: vi.fn() },
      config: { maxRepoFiles: 1500, maxChunks: 3000 },
    });

    const result = await local.ingestFromZip("My Repo.zip", zipOf({ "src/a.ts": "export const a = 1;" }));

    expect(result).toMatchObject({ files: 1, chunks: 1, truncated: false });
    expect(result.repoId).toMatch(/^my-repo-[0-9a-f]{6}$/);
    expect(replaceRepoChunks).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(result.repoId, []);
  });

  it("truncates to the configured chunk limit", async () => {
    const embed = vi.fn().mockImplementation(async (texts: string[]) => texts.map(() => [0]));
    const local = createIngestor({
      embedder: { embed },
      store: { replaceRepoChunks: vi.fn(), loadChunks: vi.fn().mockResolvedValue([]) },
      bm25: { build: vi.fn() },
      logger: { info: vi.fn() },
      config: { maxRepoFiles: 1500, maxChunks: 1 },
    });

    const result = await local.ingestFromZip("x.zip", zipOf({ "a.ts": "export {}", "b.ts": "export {}" }));

    expect(result).toMatchObject({ chunks: 1, truncated: true });
  });
});
