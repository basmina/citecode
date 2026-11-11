import { readLocalFiles } from "./files.js";
import { chunkFile } from "./chunker.js";
import { embed } from "./embeddings.js";
import { replaceRepoChunks, loadChunks } from "./store.js";
import { buildBm25 } from "./bm25.js";
import { hybridSearch } from "./hybrid.js";
import { pool } from "./db.js";

const [mode, arg1, arg2] = process.argv.slice(2);

if (mode === "index") {
  const dir = arg1;
  const repoId = arg2 ?? "demo";
  const files = await readLocalFiles(dir);
  const chunks = files.flatMap((f) => chunkFile(f.path, f.text));
  console.log(`${files.length} files -> ${chunks.length} chunks. Embedding (first run downloads the model)...`);
  const embeddings = await embed(chunks.map((c) => c.content));
  await replaceRepoChunks(repoId, chunks, embeddings);
  console.log("Saved to Postgres.");
} else if (mode === "search") {
  const repoId = arg1;
  const query = arg2;
  buildBm25(repoId, await loadChunks(repoId));
  const hits = await hybridSearch(repoId, query);
  for (const h of hits) {
    console.log(`\n${h.filePath}:${h.startLine}-${h.endLine}  score=${h.score.toFixed(4)}  [${h.sources.join("+")}]`);
    console.log(h.content.split("\n").slice(0, 3).join("\n"));
  }
} else {
  console.log('Usage:\n  index <folder> <repoId>\n  search <repoId> "<query>"');
}

await pool.end();