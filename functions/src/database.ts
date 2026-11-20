import { Pool } from "pg";

let pool: Pool | undefined;
let poolConnectionString: string | undefined;

/**
 * Reuses a small pool for the lifetime of a warm Functions instance.
 * Each instance is capped at two database connections; the function itself
 * is also capped at three instances in index.ts.
 */
export function getDatabasePool(connectionString: string): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL secret is not configured");
  }

  if (pool && poolConnectionString !== connectionString) {
    void pool.end();
    pool = undefined;
  }

  if (!pool) {
    poolConnectionString = connectionString;
    pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: true },
      application_name: "easy-license-functions",
    });
  }

  return pool;
}

export async function checkDatabase(connectionString: string): Promise<void> {
  await getDatabasePool(connectionString).query("SELECT 1");
}
