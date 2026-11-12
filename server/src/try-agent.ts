import { loadConfig } from "./config.js";
import { createServices } from "./services.js";

const [repoId, ...rest] = process.argv.slice(2);
const question = rest.join(" ");
const { agent, pool } = createServices(loadConfig());

if (!repoId || !question) {
  console.log('Usage: npx tsx src/try-agent.ts <repoId> "<question>"');
} else {
  try {
    const { answer, stats } = await agent.ask(repoId, question);
    console.log("\n=== ANSWER ===\n" + answer);
    console.log("\n=== STATS ===\n" + JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error("Failed:", err instanceof Error ? err.message : err);
  }
}
await pool.end();
