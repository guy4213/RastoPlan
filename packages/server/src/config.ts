// Central place for reading environment configuration. Keeps `process.env`
// access out of the rest of the server code so routes/auth/db stay testable.

export interface ServerConfig {
  port: number;
  host: string;
  /** Neon pooled Postgres connection string. */
  databaseUrl: string | undefined;
  /** The single browser origin allowed to call the API with cookies. */
  webOrigin: string;
  /** Secret used to sign the session cookie. Required once auth is enabled. */
  authSecret: string | undefined;
}

const AUTH_SECRET_PLACEHOLDER = "change-me-to-at-least-32-characters-long";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: env.PORT ? Number(env.PORT) : 3000,
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL,
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:5173",
    authSecret: env.AUTH_SECRET,
  };
}

/** Session cookies must be signed; refusing to boot beats issuing forgeable ones. */
export function requireAuthSecret(authSecret: string | undefined): string {
  if (!authSecret || authSecret.length < 32 || authSecret === AUTH_SECRET_PLACEHOLDER) {
    throw new Error("AUTH_SECRET is required, must be at least 32 characters, and cannot use the example placeholder");
  }
  return authSecret;
}

/**
 * Cross-site cookies need SameSite=None, which browsers only accept together
 * with Secure — and Secure cookies are dropped on plain http. Local development
 * therefore has to fall back to Lax, which works because Vite and the API are
 * both on http://localhost.
 */
export function sessionCookieOptions(webOrigin: string): {
  sameSite: "none" | "lax";
  secure: boolean;
} {
  const crossSiteCapable = webOrigin.startsWith("https://");
  return crossSiteCapable ? { sameSite: "none", secure: true } : { sameSite: "lax", secure: false };
}
