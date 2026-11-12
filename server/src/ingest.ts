import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { chunkFile } from "./chunker.js";
import type { Embedder } from "./embeddings.js";
import type { Store } from "./store.js";
import type { Bm25Index } from "./bm25.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { shouldIndex, isSkippedPath, type SourceFile } from "./files.js";

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 80 * 1024 * 1024;

export class IngestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface IngestResult {
  repoId: string;
  files: number;
  chunks: number;
  truncated: boolean;
  ms: number;
}

export interface IngestorDeps {
  embedder: Pick<Embedder, "embed">;
  store: Pick<Store, "replaceRepoChunks" | "loadChunks">;
  bm25: Pick<Bm25Index, "build">;
  logger: Pick<Logger, "info">;
  config: Pick<Config, "maxRepoFiles" | "maxChunks" | "githubToken">;
}

interface IngestContext extends IngestorDeps {
  inFlight: Set<string>;
}

const isSafePath = (name: string) =>
  !name.startsWith("/") && !name.includes("\\") && !name.split("/").includes("..");

export function extractFiles(zip: Uint8Array): SourceFile[] {
  let unpacked = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (!isSafePath(f.name) || isSkippedPath(f.name)) return false;
        if (!shouldIndex(f.name, f.originalSize)) return false;
        unpacked += f.originalSize;
        return unpacked <= MAX_UNPACKED_BYTES;
      },
    });
  } catch {
    throw new IngestError("Could not read the ZIP file. Please upload a valid .zip.");
  }

  const names = Object.keys(entries).sort();
  const top = names[0]?.split("/")[0] ?? "";
  const strip = top !== "" && names.every((n) => n.startsWith(top + "/"));

  const decoder = new TextDecoder("utf-8");
  const files: SourceFile[] = [];
  for (const name of names) {
    const text = decoder.decode(entries[name]);
    if (text.includes("\0")) continue;
    files.push({ path: strip ? name.slice(top.length + 1) : name, text });
  }
  return files;
}

async function runIngest(ctx: IngestContext, repoId: string, zip: Uint8Array): Promise<IngestResult> {
  const { embedder, store, bm25, logger, config, inFlight } = ctx;
  if (inFlight.has(repoId)) throw new IngestError("This repository is already being indexed. Please wait.", 409);
  inFlight.add(repoId);
  const started = Date.now();
  try {
    let files = extractFiles(zip);
    let truncated = false;
    if (files.length > config.maxRepoFiles) {
      files = files.slice(0, config.maxRepoFiles);
      truncated = true;
    }

    let chunks = files.flatMap((f) => chunkFile(f.path, f.text));
    if (chunks.length === 0) throw new IngestError("No supported source files were found in this repository.");
    if (chunks.length > config.maxChunks) {
      chunks = chunks.slice(0, config.maxChunks);
      truncated = true;
    }

    const embeddings = await embedder.embed(chunks.map((c) => c.content));
    await store.replaceRepoChunks(repoId, chunks, embeddings);
    bm25.build(repoId, await store.loadChunks(repoId));

    const result = { repoId, files: files.length, chunks: chunks.length, truncated, ms: Date.now() - started };
    logger.info(result, "repository indexed");
    return result;
  } finally {
    inFlight.delete(repoId);
  }
}

async function ingestFromZip(ctx: IngestContext, originalName: string, bytes: Uint8Array): Promise<IngestResult> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new IngestError("That file is not a ZIP archive.");
  }
  const base =
    originalName.replace(/\.zip$/i, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "upload";
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 6);
  return runIngest(ctx, `${base}-${hash}`, bytes);
}

const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? 0) > limit) {
    throw new IngestError("Repository is too large to index (limit 25 MB zipped).", 413);
  }
  if (!res.body) throw new IngestError("GitHub returned an empty response.", 502);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new IngestError("Repository is too large to index (limit 25 MB zipped).", 413);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function ingestFromGithub(ctx: IngestContext, url: string): Promise<IngestResult> {
  const m = GITHUB_URL.exec(url.trim());
  if (!m) throw new IngestError("Enter a GitHub repository URL like https://github.com/owner/repo");
  const [, owner, repo] = m;
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) {
    throw new IngestError("Enter a GitHub repository URL like https://github.com/owner/repo");
  }
  const headers: Record<string, string> = { "User-Agent": "citecode", Accept: "application/vnd.github+json" };
  if (ctx.config.githubToken) headers.Authorization = `Bearer ${ctx.config.githubToken}`;

  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball`, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new IngestError("Could not reach GitHub. Please try again.", 502);
  }
  if (res.status === 404) throw new IngestError("Repository not found, or it is private.", 404);
  if (res.status === 403 || res.status === 429) {
    throw new IngestError("GitHub rate limit reached. Try again later or set a GITHUB_TOKEN.", 429);
  }
  if (!res.ok) throw new IngestError(`GitHub returned an error (${res.status}).`, 502);

  const zip = await readLimited(res, MAX_ZIP_BYTES);
  return runIngest(ctx, `${owner}-${repo}`.toLowerCase(), zip);
}

export function createIngestor(deps: IngestorDeps) {
  const ctx: IngestContext = { ...deps, inFlight: new Set<string>() };
  return {
    ingestFromZip: (originalName: string, bytes: Uint8Array) => ingestFromZip(ctx, originalName, bytes),
    ingestFromGithub: (url: string) => ingestFromGithub(ctx, url),
  };
}

export type Ingestor = ReturnType<typeof createIngestor>;
