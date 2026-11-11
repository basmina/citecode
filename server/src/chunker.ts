import type { Chunk } from "./types.js";

export function chunkFile(filePath: string, text: string, maxLines = 30, overlap = 6): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];

  for (let start = 0; start < lines.length; start += maxLines - overlap) {
    const end = Math.min(start + maxLines, lines.length);
    const content = lines.slice(start, end).join("\n");
    if (content.trim()) {
      chunks.push({ filePath, startLine: start + 1, endLine: end, content });
    }
    if (end === lines.length) break;
  }
  return chunks;
}