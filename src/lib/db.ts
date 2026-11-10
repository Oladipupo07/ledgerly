import { Pool } from "pg";

const globalForDb = globalThis as unknown as { ledgerlyPool?: Pool };

export function getDb(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!globalForDb.ledgerlyPool) {
    const databaseHost = new URL(process.env.DATABASE_URL).hostname;
    const localDatabase = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost);
    const strictTls = process.env.DATABASE_SSL_STRICT === "true";
    globalForDb.ledgerlyPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Keep local development convenient, and allow managed poolers (e.g. Supabase) unless strict CA pinning is requested.
      ssl: process.env.DATABASE_SSL === "true" || !localDatabase
        ? { rejectUnauthorized: strictTls }
        : undefined,
    });
  }
  return globalForDb.ledgerlyPool;
}
