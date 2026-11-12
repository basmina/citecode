import { loadConfig } from "./src/config.js";
import { createPool } from "./src/db.js";

const pool = createPool(loadConfig().databaseUrl);

const ext = await pool.query(
  "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'"
);
console.log("pgvector:", ext.rows);

const count = await pool.query("SELECT count(*) FROM chunks");
console.log("chunks table rows:", count.rows[0].count);

await pool.end();
