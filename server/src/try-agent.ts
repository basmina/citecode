import { ask } from "./agent.js";
import { pool } from "./db.js";

const [repoId, ...rest] = process.argv.slice(2);
const question = rest.join(" ");

if (!repoId || !question) {
  console.log('Usage: npx tsx src/try-agent.ts <repoId> "<question>"');
} else {
  try {
    const { answer, stats } = await ask(repoId, question);
    console.log("\n=== ANSWER ===\n" + answer);
    console.log("\n=== STATS ===\n" + JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error("Failed:", err instanceof Error ? err.message : err);
  }
}
await pool.end();