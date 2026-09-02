import { Pool } from "pg";

export const POSTGRES_TEST_URL =
  process.env.POSTGRES_TEST_URL ??
  "postgres://file_next:file_next@localhost:5433/file_next";

/** True when a Postgres server answers. Used to skipIf like the S3 suite. */
export async function isPostgresReachable(
  url: string = POSTGRES_TEST_URL,
): Promise<boolean> {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
