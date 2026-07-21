// Central place for reading environment configuration. Keeps `process.env`
// access out of the rest of the server code so routes/auth/db stay testable.

export interface ServerConfig {
  port: number;
  host: string;
  /** Postgres connection string. Unused until Milestone 3 (db/index.ts is a stub). */
  databaseUrl: string | undefined;
  /** Shared office password (see spec 12.3) used to mint a session/JWT. No per-user accounts in MVP. */
  officePassword: string | undefined;
  /** Secret used to sign the session/JWT once auth is implemented. */
  authSecret: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: env.PORT ? Number(env.PORT) : 3000,
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL,
    officePassword: env.OFFICE_PASSWORD,
    authSecret: env.AUTH_SECRET,
  };
}
