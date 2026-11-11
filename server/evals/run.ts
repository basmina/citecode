import "dotenv/config";
import "./env.js";
import { readFile, writeFile } from "node:fs/promises";
import { embed } from "../src/embeddings.js";
import { loadChunks, vectorSearch } from "../src/store.js";
import { buildBm25, bm25Search } from "../src/bm25.js";
import { hybridSearch } from "../src/hybrid.js";
import { ask } from "../src/agent.js";
import { pool } from "../src/db.js";

interface EvalQuestion {
  q: string;
  answerable: boolean;
  expectedFiles?: string[];
}

const K = 5;
const withLlm = !process.argv.includes("--no-llm");

const set: { repoId: string; questions: EvalQuestion[] } = JSON.parse(
  await readFile(new URL("./questions.json", import.meta.url), "utf8")
);
const { repoId } = set;

buildBm25(repoId, await loadChunks(repoId));

const modes = ["bm25", "vector", "hybrid"] as const;
type Mode = (typeof modes)[number];

const rankOf = (paths: string[], expected: string[]): number | null => {
  const distinct = [...new Set(paths)];
  const i = distinct.findIndex((p) => expected.some((e) => p.endsWith(e)));
  return i === -1 ? null : i + 1;
};

const answerable = set.questions.filter((x) => x.answerable && x.expectedFiles?.length);
const ranks: Record<Mode, (number | null)[]> = { bm25: [], vector: [], hybrid: [] };

for (const item of answerable) {
  const [vec] = await embed([item.q]);
  const files: Record<Mode, string[]> = {
    bm25: bm25Search(repoId, item.q, 30).map((c) => c.filePath),
    vector: (await vectorSearch(repoId, vec, 30)).map((c) => c.filePath),
    hybrid: (await hybridSearch(repoId, item.q, 30)).map((c) => c.filePath),
  };
  for (const m of modes) ranks[m].push(rankOf(files[m], item.expectedFiles!));
}

const n = answerable.length;
const hitAt = (r: (number | null)[], k: number) => r.filter((x) => x !== null && x <= k).length;
const pct = (count: number) => `${((100 * count) / n).toFixed(0)}%`;

const retrievalSummary = modes.map((m) => ({
  mode: m,
  "hit@1": pct(hitAt(ranks[m], 1)),
  [`hit@${K}`]: pct(hitAt(ranks[m], K)),
}));

console.log(`\nRetrieval over ${n} answerable questions (rank by distinct file; "-" = not found in top 30)`);
console.table(
  answerable.map((item, i) => ({
    question: item.q.slice(0, 55),
    bm25: ranks.bm25[i] ?? "-",
    vector: ranks.vector[i] ?? "-",
    hybrid: ranks.hybrid[i] ?? "-",
  }))
);
console.table(retrievalSummary);

interface AnswerResult {
  question: string;
  answerable: boolean;
  pass: boolean;
  notFound: boolean;
  citations: number;
  invalidCitations: number;
  citesExpectedFile: boolean | null;
  steps: number;
  tokens: number;
  cachedPct: number;
  billedInput: number;
  seconds: number;
  note?: string;
}
const answers: AnswerResult[] = [];

if (withLlm) {
  console.log("\nRunning answer checks with the LLM (this makes real API calls)...");
  for (const item of set.questions) {
    try {
      const { answer, stats, citations: cites } = await ask(repoId, item.q);
      const notFound = /^\s*not found in this repo/i.test(answer);
      const badCites = cites.filter((c) => !c.valid).map((c) => `${c.path}:${c.start}-${c.end}`);
      const invalid = badCites.length;

      const totalIn = stats.inputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;

      const citesExpectedFile = item.expectedFiles?.length
        ? cites.some((c) => item.expectedFiles!.some((e) => c.path.endsWith(e)))
        : null;
      const pass = item.answerable
        ? !notFound && cites.length > 0 && invalid === 0
        : notFound && cites.length === 0;
      answers.push({
        question: item.q,
        answerable: item.answerable,
        pass,
        notFound,
        citations: cites.length,
        invalidCitations: invalid,
        citesExpectedFile,
        steps: stats.steps,
        tokens: totalIn + stats.outputTokens,
        cachedPct: totalIn ? Math.round((100 * stats.cacheReadTokens) / totalIn) : 0,
        billedInput: Math.round(stats.inputTokens + 1.25 * stats.cacheCreationTokens + 0.1 * stats.cacheReadTokens),
        seconds: Number((stats.latencyMs / 1000).toFixed(1)),
        note: badCites.length ? `invalid: ${badCites.join(", ")}` : undefined,
      });
    } catch (err) {
      answers.push({
        question: item.q,
        answerable: item.answerable,
        pass: false,
        notFound: false,
        citations: 0,
        invalidCitations: 0,
        citesExpectedFile: null,
        steps: 0,
        tokens: 0,
        cachedPct: 0,
        billedInput: 0,
        seconds: 0,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.table(answers.map((a) => ({ ...a, question: a.question.slice(0, 45) })));

  const positives = answers.filter((a) => a.answerable);
  const negatives = answers.filter((a) => !a.answerable);
  const totalCites = answers.reduce((s, a) => s + a.citations, 0);
  const invalidTotal = answers.reduce((s, a) => s + a.invalidCitations, 0);
  const avg = (f: (a: AnswerResult) => number) =>
    Math.round(answers.reduce((s, a) => s + f(a), 0) / answers.length);

  console.log(`Answerable passed:      ${positives.filter((a) => a.pass).length}/${positives.length}`);
  console.log(`Unanswerable refused:   ${negatives.filter((a) => a.pass).length}/${negatives.length}`);
  console.log(`Valid citations:        ${totalCites - invalidTotal}/${totalCites}`);
  console.log(`Avg tokens/question:    ${avg((a) => a.tokens)}   (input + cache + output; compare with the ~14,000 baseline)`);
  console.log(`Avg billed input units: ${avg((a) => a.billedInput)}   (cache writes 1.25x, reads 0.1x)`);
  console.log(`Avg cached input:       ${avg((a) => a.cachedPct)}%`);
  if (answers.some((a) => !a.pass)) process.exitCode = 1;
}

await writeFile(
  new URL("./results.json", import.meta.url),
  JSON.stringify({ date: new Date().toISOString(), repoId, k: K, retrieval: retrievalSummary, answers }, null, 2)
);
console.log("\nSaved evals/results.json");

await pool.end();