import { pool } from "./db.js";
import type { Chunk, StoredChunk } from "./types.js";

const toVector = (v: number[]) => `[${v.join(",")}]`;

const mapRow = (r: any): StoredChunk => ({
  id: Number(r.id),
  filePath: r.file_path,
  startLine: r.start_line,
  endLine: r.end_line,
  content: r.content,
});

export async function replaceRepoChunks(repoId: string, chunks: Chunk[], embeddings: number[][]) {
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

export async function loadChunks(repoId: string): Promise<StoredChunk[]> {
  const res = await pool.query(
    "SELECT id, file_path, start_line, end_line, content FROM chunks WHERE repo_id = $1",
    [repoId]
  );
  return res.rows.map(mapRow);
}

export async function vectorSearch(repoId: string, queryVec: number[], limit: number): Promise<StoredChunk[]> {
  const res = await pool.query(
    `SELECT id, file_path, start_line, end_line, content
     FROM chunks WHERE repo_id = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [repoId, toVector(queryVec), limit]
  );
  return res.rows.map(mapRow);
}

export async function listFiles(repoId: string): Promise<string[]> {
  const res = await pool.query(
    "SELECT DISTINCT file_path FROM chunks WHERE repo_id = $1 ORDER BY file_path",
    [repoId]
  );
  return res.rows.map((r: any) => r.file_path as string);
}

export async function getFileLines(
  repoId: string,
  filePath: string,
  start = 1,
  end = Number.MAX_SAFE_INTEGER,
  maxLines = 150
): Promise<{ from: number; to: number; total: number; lines: string[] } | null> {
  const res = await pool.query(
    "SELECT start_line, content FROM chunks WHERE repo_id = $1 AND file_path = $2 ORDER BY start_line",
    [repoId, filePath]
  );
  if (res.rows.length === 0) return null;

  const byLine = new Map<number, string>();
  for (const row of res.rows) {
    (row.content as string).split("\n").forEach((line, i) => byLine.set(row.start_line + i, line));
  }
  const total = Math.max(...byLine.keys());
  const from = Math.max(1, start);
  const to = Math.min(total, end, from + maxLines - 1);

  const lines: string[] = [];
  for (let n = from; n <= to; n++) lines.push(`${n}: ${byLine.get(n) ?? ""}`);
  return { from, to, total, lines };
}
export async function repoExists(repoId: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM chunks WHERE repo_id = $1 LIMIT 1", [repoId]);
  return res.rows.length > 0;
}

export async function listRepos() {
  const res = await pool.query(
    `SELECT repo_id, count(*)::int AS chunks, count(DISTINCT file_path)::int AS files
     FROM chunks GROUP BY repo_id ORDER BY repo_id`
  );
  return res.rows.map((r: any) => ({ repoId: r.repo_id as string, files: r.files as number, chunks: r.chunks as number }));
}