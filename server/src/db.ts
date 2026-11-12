import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on("error", (err) => console.error("idle database client error:", err.message));
  return pool;
}
