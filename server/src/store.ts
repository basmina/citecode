import type pg from "pg";
import type { Chunk, StoredChunk } from "./types.js";

interface ChunkRow {
  id: string | number;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
}

const toVector = (v: number[]) => `[${v.join(",")}]`;

const mapRow = (r: ChunkRow): StoredChunk => ({
  id: Number(r.id),
  filePath: r.file_path,
  startLine: r.start_line,
  endLine: r.end_line,
  content: r.content,
});

export interface FileLines {
  from: number;
  to: number;
  total: number;
  lines: string[];
}

export function createStore(pool: pg.Pool) {
  async function replaceRepoChunks(repoId: string, chunks: Chunk[], embeddings: number[][]) {
    await pool.query("DELETE FROM chunks WHERE repo_id = $1", [repoId]);
    const BATCH = 100;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows = slice.map((c, j) => {
        const o = j * 6;
        values.push(repoId, c.filePath, c.startLine, c.endLine, c.content, toVector(embeddings[i + j]));
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6}::vector)`;
      });
      await pool.query(
        `INSERT INTO chunks (repo_id, file_path, start_line, end_line, content, embedding)
         VALUES ${rows.join(",")}`,
        values
      );
    }
  }

  async function loadChunks(repoId: string): Promise<StoredChunk[]> {
    const res = await pool.query<ChunkRow>(
      "SELECT id, file_path, start_line, end_line, content FROM chunks WHERE repo_id = $1",
      [repoId]
    );
    return res.rows.map(mapRow);
  }

  async function vectorSearch(repoId: string, queryVec: number[], limit: number): Promise<StoredChunk[]> {
    const res = await pool.query<ChunkRow>(
      `SELECT id, file_path, start_line, end_line, content
       FROM chunks WHERE repo_id = $1
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [repoId, toVector(queryVec), limit]
    );
    return res.rows.map(mapRow);
  }

  async function listFiles(repoId: string): Promise<string[]> {
    const res = await pool.query<{ file_path: string }>(
      "SELECT DISTINCT file_path FROM chunks WHERE repo_id = $1 ORDER BY file_path",
      [repoId]
    );
    return res.rows.map((r) => r.file_path);
  }

  async function getFileLines(
    repoId: string,
    filePath: string,
    start = 1,
    end = Number.MAX_SAFE_INTEGER,
    maxLines = 150
  ): Promise<FileLines | null> {
    const res = await pool.query<{ start_line: number; content: string }>(
      "SELECT start_line, content FROM chunks WHERE repo_id = $1 AND file_path = $2 ORDER BY start_line",
      [repoId, filePath]
    );
    if (res.rows.length === 0) return null;

    const byLine = new Map<number, string>();
    for (const row of res.rows) {
      row.content.split("\n").forEach((line, i) => byLine.set(row.start_line + i, line));
    }
    const total = Math.max(...byLine.keys());
    const from = Math.max(1, start);
    const to = Math.min(total, end, from + maxLines - 1);

    const lines: string[] = [];
    for (let n = from; n <= to; n++) lines.push(`${n}: ${byLine.get(n) ?? ""}`);
    return { from, to, total, lines };
  }

  async function repoExists(repoId: string): Promise<boolean> {
    const res = await pool.query("SELECT 1 FROM chunks WHERE repo_id = $1 LIMIT 1", [repoId]);
    return res.rows.length > 0;
  }

  async function listRepos() {
    const res = await pool.query<{ repo_id: string; chunks: number; files: number }>(
      `SELECT repo_id, count(*)::int AS chunks, count(DISTINCT file_path)::int AS files
       FROM chunks GROUP BY repo_id ORDER BY repo_id`
    );
    return res.rows.map((r) => ({ repoId: r.repo_id, files: r.files, chunks: r.chunks }));
  }

  return { replaceRepoChunks, loadChunks, vectorSearch, listFiles, getFileLines, repoExists, listRepos };
}

export type Store = ReturnType<typeof createStore>;
