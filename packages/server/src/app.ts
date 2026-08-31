import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { requireAuthSecret, sessionCookieOptions, type ServerConfig } from "./config.js";
import type { Database } from "./db/index.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";

export interface BuildAppOptions {
  database: Database;
  config: Pick<ServerConfig, "webOrigin" | "authSecret">;
}

export function buildApp({ database, config }: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  const cookieOptions = sessionCookieOptions(config.webOrigin);

  app.register(cors, { origin: config.webOrigin, credentials: true });
  // The signing secret gates boot rather than request handling: a server that
  // starts without one would hand out session cookies anybody could forge.
  app.register(cookie, { secret: requireAuthSecret(config.authSecret) });
  app.register(healthRoutes);
  app.register(authRoutes, { database, cookie: cookieOptions });
  app.register(projectRoutes, { database });

  return app;
}
