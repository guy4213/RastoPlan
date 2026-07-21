// Postgres connection stub (spec 12.4). Real connection lands in Milestone 3
// alongside ApiProvider — deliberately not wired up yet per Milestone 1 scope.
import type { ServerConfig } from "../config.js";

export interface Database {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export function createDatabase(_config: ServerConfig): Database {
  return {
    query() {
      throw new Error("not implemented: Postgres connection lands in Milestone 3");
    },
  };
}
