import { readLocalFiles } from "./files.js";
import { chunkFile } from "./chunker.js";
import { loadConfig } from "./config.js";
import { createServices } from "./services.js";

const [mode, arg1, arg2] = process.argv.slice(2);
const { embedder, store, bm25, hybridSearch, pool } = createServices(loadConfig());

if (mode === "index") {
  const dir = arg1;
  const repoId = arg2 ?? "demo";
  const files = await readLocalFiles(dir);
  const chunks = files.flatMap((f) => chunkFile(f.path, f.text));
  console.log(`${files.length} files -> ${chunks.length} chunks. Embedding (first run downloads the model)...`);
  const embeddings = await embedder.embed(chunks.map((c) => c.content));
  await store.replaceRepoChunks(repoId, chunks, embeddings);
  console.log("Saved to Postgres.");
} else if (mode === "search") {
  const repoId = arg1;
  const query = arg2;
  bm25.build(repoId, await store.loadChunks(repoId));
  const hits = await hybridSearch(repoId, query);
  for (const h of hits) {
    console.log(`\n${h.filePath}:${h.startLine}-${h.endLine}  score=${h.score.toFixed(4)}  [${h.sources.join("+")}]`);
    console.log(h.content.split("\n").slice(0, 3).join("\n"));
  }
} else {
  console.log('Usage:\n  index <folder> <repoId>\n  search <repoId> "<query>"');
}

await pool.end();
