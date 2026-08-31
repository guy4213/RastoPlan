import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { ServerConfig } from "../config.js";

export interface Database {
  query<T extends object>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(config: ServerConfig): Database {
  const pool = new Pool(databasePoolOptions(config.databaseUrl));

  return new PostgresDatabase(pool);
}

class PostgresDatabase implements Database {
  constructor(private readonly pool: Pool) {}

  async query<T extends object>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async initialize(): Promise<void> {
    const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await this.pool.query(schema);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function databasePoolOptions(databaseUrl: string | undefined) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const url = new URL(databaseUrl);
  if (!url.hostname.includes("-pooler")) {
    throw new Error("DATABASE_URL must use the Neon pooled (-pooler) hostname");
  }
  if (url.searchParams.get("sslmode") !== "require") {
    throw new Error("DATABASE_URL must include sslmode=require");
  }

  // pg lets URL SSL options overwrite an explicit ssl object. Validation above
  // keeps the deployment contract, then removal lets the Pool retain strict TLS.
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
}
